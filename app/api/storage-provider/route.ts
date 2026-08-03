import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStorageProviderState } from "@/lib/storage";
import { getStoragePreferenceStore } from "@/lib/storage/preference";
import { availableProviders, isStorageProvider } from "@/lib/storage/provider";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * GET /api/storage-provider — current storage selection (no secrets).
 * Returns { available, active, source }. Público (solo estado).
 */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getStorageProviderState(), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}

/**
 * PUT /api/storage-provider — set the active provider (admin, canScaffold).
 * Body { provider }. 400 si no es un provider disponible (sin creds → no se activa).
 */
export async function PUT(req: Request): Promise<NextResponse> {
  try {
    // Lazy (evita el crash de next-auth/Next-16 al importarse en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
    const provider = body?.provider;
    if (!isStorageProvider(provider) || !availableProviders().includes(provider)) {
      return NextResponse.json({ error: "provider not available" }, { status: 400 });
    }
    await getStoragePreferenceStore().save(provider);
    return NextResponse.json(
      { provider, active: provider, source: "preference" },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
