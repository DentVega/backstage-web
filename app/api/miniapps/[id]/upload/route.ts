import { NextResponse } from "next/server";
import { unzipSync } from "fflate";
import { getStore } from "@/lib/registry/store";
import { publishVersion } from "@/lib/registry/registry";
import { pruneMiniapp } from "@/lib/registry/prune";
import { getStorage } from "@/lib/storage";
import { authorizeUpload } from "@/lib/auth";
import { defaultManifest, parseCapabilities, resolveDefaultShared } from "@/lib/manifest";
import { getHostContractStore } from "@/lib/host-contract/store";
import { sha256Integrity } from "@/lib/integrity";
import { errorBody, statusForError } from "@/lib/http";
import { githubProvider } from "@/lib/git/github";
import { githubToken, HOST_REPO, pruneKeep } from "@/lib/config";
import { openCapabilityRequests } from "@/lib/capability-request";
import { satisfiesShared, type SemVer } from "@dentvega/miniapp-contract";
import type { StorageFile } from "@/lib/storage/types";

export const runtime = "nodejs";

/**
 * POST /api/miniapps/:id/upload — publish a build (ADR-015).
 * Auth: an allowlisted session (UI) or Bearer PUBLISH_TOKEN (CI).
 * Body: multipart { file: zip(build/), version, manifest?, capabilities? }.
 * When `manifest` is omitted (UI flow) a default is built from id+version+capabilities.
 * Stores the chunks in Blob/fs under `<id>/<version>/` and publishes the version.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await authorizeUpload(req);
    const { id } = await params;

    const form = await req.formData();
    const file = form.get("file");
    const version = form.get("version");
    const manifestRaw = form.get("manifest");
    // Duck-type the file (cross-realm File is not `instanceof Blob` under some test envs).
    const isFile =
      file !== null &&
      typeof file !== "string" &&
      typeof (file as { arrayBuffer?: unknown }).arrayBuffer === "function";
    if (!isFile || typeof version !== "string") {
      return NextResponse.json(
        { error: "file (zip) and version are required" },
        { status: 400 },
      );
    }
    const uploaded = file as { arrayBuffer(): Promise<ArrayBuffer> };

    // Manifest: explicit JSON (CI) or built from simple fields (UI).
    let manifest: unknown;
    if (typeof manifestRaw === "string" && manifestRaw.length > 0) {
      try {
        manifest = JSON.parse(manifestRaw);
      } catch {
        return NextResponse.json({ error: "manifest is not valid JSON" }, { status: 400 });
      }
    } else {
      const capsRaw = form.get("capabilities");
      const caps = parseCapabilities(typeof capsRaw === "string" ? capsRaw : "");
      manifest = defaultManifest(id, version, caps, await resolveDefaultShared());
    }

    // Unzip the build output into individual files.
    const zip = new Uint8Array(await uploaded.arrayBuffer());
    const entries = unzipSync(zip);
    const files: StorageFile[] = Object.entries(entries).map(([path, data]) => ({ path, data }));
    if (files.length === 0) {
      return NextResponse.json({ error: "empty archive" }, { status: 400 });
    }

    // The archive must contain the container; its bytes drive the integrity hash.
    const containerName = `${id}.container.js.bundle`;
    const container = files.find((f) => f.path === containerName);
    if (container === undefined) {
      return NextResponse.json(
        { error: `archive is missing ${containerName}` },
        { status: 400 },
      );
    }
    // Integrity from the ACTUAL uploaded bytes (never a client-supplied value),
    // so the host can verify the CDN download before executing it.
    manifest = {
      ...(manifest as Record<string, unknown>),
      integrity: sha256Integrity(container.data),
    };

    // Gate de compatibilidad. Default WARN (loguea, no rechaza); con COMPAT_ENFORCE=1
    // rechaza el publish con 422. Chequea skew de shared + módulos nativos del host (Fase 2).
    // El check en sí es rollout-safe: si crashea, se loguea y NO bloquea (no rompemos por
    // un bug nuestro); solo bloquea una incompatibilidad real detectada.
    const compatProblems: string[] = [];
    try {
      const contract = await getHostContractStore().load();
      const m = manifest as {
        shared?: { name: string; requiredRange: string; singleton: boolean }[];
        nativeModules?: string[];
      };
      if (contract === null) {
        console.warn(`compat[${id}@${version}]: no host contract published — skipping check`);
      } else {
        // Skew de shared.
        if (!m.shared || m.shared.length === 0) {
          compatProblems.push("empty 'shared' (at-risk)");
        } else {
          // HostContract.shared is a plain Record<string, string>; satisfiesShared
          // wants the branded SemVer type — the store validates the shape (isHostContract)
          // but doesn't brand the values, so this cast is safe (not a runtime change).
          const skew = satisfiesShared(contract.shared as Readonly<Record<string, SemVer>>, m.shared);
          if (!skew.compatible) {
            compatProblems.push(
              ...skew.entries.filter((e) => e.status !== "ok")
                .map((e) => `${e.name} (${e.status}, needs ${e.requiredRange})`),
            );
          }
        }
        // Módulos nativos: los que la miniapp declara y el host NO tiene en su binario.
        const hostNatives = new Set(contract.nativeModules);
        const missingNatives = (m.nativeModules ?? []).filter((n) => !hostNatives.has(n));
        for (const n of missingNatives) {
          compatProblems.push(`${n} (native module not in host)`);
        }
        // Pedido automatizado de capability por cada nativo faltante (best-effort).
        if (missingNatives.length > 0) {
          try {
            const result = await openCapabilityRequests(
              githubProvider(githubToken()), HOST_REPO, missingNatives, { miniappId: id, version },
            );
            if (result.requested.length > 0) {
              console.warn(`compat[${id}@${version}]: opened/ensured capability request(s) for ${result.requested.join(", ")}`);
            }
          } catch (err) {
            console.warn(`compat[${id}@${version}]: capability request failed (ignored):`, err);
          }
        }
      }
    } catch (err) {
      console.warn(`compat[${id}@${version}]: check errored (ignored):`, err);
    }

    const compatEnforce = process.env.COMPAT_ENFORCE === "1";
    if (compatProblems.length > 0) {
      const mode = compatEnforce ? "ENFORCE → rechazando (422)" : "warn mode, not blocking";
      console.warn(`compat[${id}@${version}]: INCOMPATIBLE with host — ${compatProblems.join(", ")} [${mode}]`);
      if (compatEnforce) {
        return NextResponse.json(
          {
            error: `incompatible with host contract — ${compatProblems.join(", ")}`,
            code: "COMPAT_INCOMPATIBLE",
          },
          { status: 422 },
        );
      }
    }

    const reg = await getStore().load();
    const storage = await getStorage(reg[id]?.storageProvider ?? null);
    const { baseUrl } = await storage.putMany(`${id}/${version}`, files);
    const url = `${baseUrl}/${containerName}`;

    const next = publishVersion(reg, id, { version, url, manifest }, new Date().toISOString());
    await getStore().save(next);

    // Prune de versiones viejas (best-effort — el publish ya está guardado). Mantiene
    // las últimas PRUNE_KEEP + la servida/pinneada; borra el chunk + la entrada del resto.
    try {
      const { reg: prunedReg, pruned } = await pruneMiniapp(next, storage, id, pruneKeep());
      if (pruned.length > 0) await getStore().save(prunedReg);
    } catch {
      /* el prune nunca rompe el publish */
    }

    return NextResponse.json({ id, version, url }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
