import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { publishVersion } from "@/lib/registry/registry";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** POST /api/miniapps/:id/publish — publish a version (manifest + chunk url). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const body = (await req.json()) as {
      version?: string;
      url?: string;
      manifest?: unknown;
    };
    if (!body.version || !body.url || body.manifest === undefined) {
      return NextResponse.json(
        { error: "version, url and manifest are required" },
        { status: 400 },
      );
    }
    const reg = await getStore().load();
    const next = publishVersion(
      reg,
      id,
      { version: body.version, url: body.url, manifest: body.manifest },
      new Date().toISOString(),
    );
    await getStore().save(next);
    return NextResponse.json({ id, version: body.version }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
