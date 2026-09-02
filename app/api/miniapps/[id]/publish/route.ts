import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { publishVersion, asRecordMutation } from "@/lib/registry/registry";
import { authorizeUpload } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** POST /api/miniapps/:id/publish — publish a version (manifest + chunk url). */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    await authorizeUpload(req);
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
    const now = new Date().toISOString();
    await getStore().mutateApp(
      id,
      asRecordMutation(id, (reg) =>
        publishVersion(reg, id, { version: body.version!, url: body.url!, manifest: body.manifest }, now),
      ),
    );
    return NextResponse.json({ id, version: body.version }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
