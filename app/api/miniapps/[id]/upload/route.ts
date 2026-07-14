import { NextResponse } from "next/server";
import { unzipSync } from "fflate";
import { auth } from "@/auth";
import { getStore } from "@/lib/registry/store";
import { publishVersion } from "@/lib/registry/registry";
import { getStorage } from "@/lib/storage";
import { requirePublishToken } from "@/lib/auth";
import { canScaffold } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";
import { defaultManifest, parseCapabilities } from "@/lib/manifest";
import { sha256Integrity } from "@/lib/integrity";
import { errorBody, statusForError } from "@/lib/http";
import type { StorageFile } from "@/lib/storage/types";

export const runtime = "nodejs";

/**
 * Authorize an upload: an allowlisted signed-in user (the UI flow) OR a valid
 * `PUBLISH_TOKEN` bearer (the CI flow). Throws if neither applies.
 */
async function authorizeUpload(req: Request): Promise<void> {
  const session = await auth();
  if (canScaffold(session?.githubLogin, scaffoldAllowedLogins())) return;
  requirePublishToken(req);
}

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
      manifest = defaultManifest(id, version, caps);
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

    const { baseUrl } = await getStorage().putMany(`${id}/${version}`, files);
    const url = `${baseUrl}/${containerName}`;

    const reg = await getStore().load();
    const next = publishVersion(reg, id, { version, url, manifest }, new Date().toISOString());
    await getStore().save(next);

    return NextResponse.json({ id, version, url }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
