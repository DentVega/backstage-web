import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStore } from "@/lib/registry/store";
import { setMiniappPublicKey, getMiniappDetail, asRecordMutation } from "@/lib/registry/registry";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * PUT /api/miniapps/:id/public-key — registra (o limpia con `publicKey: null`) la pubkey de
 * firma de la miniapp (raw base64url). Auth: platform-admin O un maintainer. Sirve para alta y
 * rotación. Devuelve el MiniappDetail actualizado.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const store = getStore();
    const record = await store.getApp(id);
    if (record === undefined) {
      return NextResponse.json({ error: "miniapp no encontrada" }, { status: 404 });
    }
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, record.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as { publicKey?: unknown } | null;
    const pk = body?.publicKey ?? null;
    if (pk !== null && typeof pk !== "string") {
      return NextResponse.json({ error: "publicKey must be a string or null" }, { status: 400 });
    }
    const next = await store.mutateApp(id, asRecordMutation(id, (reg) => setMiniappPublicKey(reg, id, pk)));
    return NextResponse.json(getMiniappDetail(next ? { [id]: next } : {}, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
