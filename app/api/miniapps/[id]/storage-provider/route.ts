import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStore } from "@/lib/registry/store";
import { setMiniappStorageProvider } from "@/lib/registry/registry";
import { getMiniappStorageState } from "@/lib/storage";
import { availableProviders, isStorageProvider } from "@/lib/storage/provider";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * PUT /api/miniapps/:id/storage-provider — set (or clear with null) this miniapp's
 * storage override (admin, canScaffold). 400 si el provider no está disponible;
 * 404 si la miniapp no existe. Devuelve el estado de storage de la miniapp.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // Lazy (evita el crash de next-auth/Next-16 al importarse en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
    const provider = body?.provider ?? null;
    if (provider !== null && (!isStorageProvider(provider) || !availableProviders().includes(provider))) {
      return NextResponse.json({ error: "provider not available" }, { status: 400 });
    }
    const reg = await getStore().load();
    const next = setMiniappStorageProvider(reg, id, provider); // MiniappNotFoundError → 404
    await getStore().save(next);
    return NextResponse.json(await getMiniappStorageState(provider), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
