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
    const platform = url.searchParams.get("platform") === "ios" ? "ios" : undefined;

    // Lee SOLO la key de esa miniapp (hot-path del host), no todo el registry.
    const rec = await getStore().getApp(id);
    const resolved = resolveMiniapp(rec ? { [id]: rec } : {}, id, { version, range, platform });
    return NextResponse.json(resolved, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
