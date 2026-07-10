import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { resolveMiniapp } from "@/lib/registry/registry";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** GET /api/resolve?id=&version=&range= — the host asks what to mount. */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (id === null) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const version = url.searchParams.get("version") ?? undefined;
    const range = url.searchParams.get("range") ?? undefined;

    const reg = await getStore().load();
    const resolved = resolveMiniapp(reg, id, { version, range });
    return NextResponse.json(resolved, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
