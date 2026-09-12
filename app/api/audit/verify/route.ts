import { NextResponse } from "next/server";
import { getAuditStore } from "@/lib/audit/log";
import { auditAdminLogins } from "@/lib/config";
import { canScaffold } from "@/lib/scaffold-authz";
import { AuthError } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/audit/verify — verifica la integridad de todas las cadenas. Solo admins. */
export async function GET(): Promise<NextResponse> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, auditAdminLogins())) throw new AuthError();
    const result = await getAuditStore().verify();
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
