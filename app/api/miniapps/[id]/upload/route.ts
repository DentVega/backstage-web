import { NextResponse } from "next/server";
import { unzipSync } from "fflate";
import { getStore } from "@/lib/registry/store";
import { publishVersion } from "@/lib/registry/registry";
import { getStorage } from "@/lib/storage";
import { requirePublishToken } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";
import type { StorageFile } from "@/lib/storage/types";

export const runtime = "nodejs";

/**
 * POST /api/miniapps/:id/upload — CI publishes a build (ADR-015).
 * Auth: Bearer PUBLISH_TOKEN. Body: multipart { file: zip(build/), version, manifest }.
 * Stores the chunks in Blob under `<id>/<version>/` and publishes the version.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    requirePublishToken(req);
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
    if (!isFile || typeof version !== "string" || typeof manifestRaw !== "string") {
      return NextResponse.json(
        { error: "file (zip), version and manifest are required" },
        { status: 400 },
      );
    }
    const uploaded = file as { arrayBuffer(): Promise<ArrayBuffer> };

    let manifest: unknown;
    try {
      manifest = JSON.parse(manifestRaw);
    } catch {
      return NextResponse.json({ error: "manifest is not valid JSON" }, { status: 400 });
    }

    // Unzip the build output into individual files.
    const zip = new Uint8Array(await uploaded.arrayBuffer());
    const entries = unzipSync(zip);
    const files: StorageFile[] = Object.entries(entries).map(([path, data]) => ({ path, data }));
    if (files.length === 0) {
      return NextResponse.json({ error: "empty archive" }, { status: 400 });
    }

    const { baseUrl } = await getStorage().putMany(`${id}/${version}`, files);
    const url = `${baseUrl}/${id}.container.js.bundle`;

    const reg = await getStore().load();
    const next = publishVersion(reg, id, { version, url, manifest }, new Date().toISOString());
    await getStore().save(next);

    return NextResponse.json({ id, version, url }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
