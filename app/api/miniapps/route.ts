import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { registerMiniapp } from "@/lib/registry/registry";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** POST /api/miniapps — register a new miniapp. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json()) as { id?: string; name?: string; owner?: string };
    if (!body.id || !body.name || !body.owner) {
      return NextResponse.json(
        { error: "id, name and owner are required" },
        { status: 400 },
      );
    }
    const reg = await getStore().load();
    const next = registerMiniapp(
      reg,
      { id: body.id, name: body.name, owner: body.owner },
      new Date().toISOString(),
    );
    await getStore().save(next);
    return NextResponse.json({ id: body.id }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}

/** GET /api/miniapps — list the catalog (JSON). */
export async function GET(): Promise<NextResponse> {
  const { listCatalog } = await import("@/lib/registry/registry");
  const reg = await getStore().load();
  return NextResponse.json({ miniapps: listCatalog(reg) });
}
