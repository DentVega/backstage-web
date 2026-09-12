import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/log";
import { getStore } from "@/lib/registry/store";
import { auditAdminLogins } from "@/lib/config";
import { canScaffold, canManageMiniapp } from "@/lib/scaffold-authz";
import { AuthError } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/audit?miniapp=&actor=&action=&limit= — feed del audit log.
 * Sin `miniapp`: feed global (solo admins). Con `miniapp`: admin o maintainer de esa miniapp.
 */
export async function GET(req: Request): Promise<NextResponse> {
  try {
    const url = new URL(req.url);
    const miniapp = url.searchParams.get("miniapp") ?? undefined;
    const actor = url.searchParams.get("actor") ?? undefined;
    const action = url.searchParams.get("action") ?? undefined;
    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const { auth } = await import("@/auth");
    const session = await auth();
    const login = session?.githubLogin;
    const admins = auditAdminLogins();

    if (miniapp) {
      const rec = await getStore().getApp(miniapp);
      if (!canManageMiniapp(login, rec?.maintainers, admins)) throw new AuthError();
    } else if (!canScaffold(login, admins)) {
      throw new AuthError();
    }

    const events = await getAuditStore().readAll({ miniapp, actor, action, limit });
    return NextResponse.json({ events }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
