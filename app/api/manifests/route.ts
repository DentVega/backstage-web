import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { selectLatest } from "@/lib/registry/registry";

export const runtime = "nodejs";

/**
 * GET /api/manifests — el manifest de la última versión publicada de cada miniapp.
 * Usado por el gate de gobernanza del host (blast-radius). Miniapps sin versiones
 * publicadas se omiten. Lectura pública (no secreto).
 */
export async function GET(): Promise<NextResponse> {
  const reg = await getStore().load();
  const manifests: unknown[] = [];
  for (const rec of Object.values(reg)) {
    const latest = selectLatest(rec.versions ?? []);
    if (latest?.manifest !== undefined) manifests.push(latest.manifest);
  }
  return NextResponse.json({ manifests }, { status: 200 });
}
