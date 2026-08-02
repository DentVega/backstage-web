import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { removeMiniapp } from "@/lib/registry/registry";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * DELETE /api/miniapps/:id — remove a miniapp from the registry (admin cleanup,
 * e.g. throwaway/test entries). Guard: allowlisted session (canScaffold), same as
 * scaffolding — NOT the publish token. Does NOT delete the GitHub repo or the CDN
 * chunks; it only removes the catalog entry.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // Loaded lazily to avoid a pre-existing next-auth/Next-16 module-resolution
    // crash when this module is statically imported in the test transitive graph.
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const reg = await getStore().load();
    const next = removeMiniapp(reg, id);
    await getStore().save(next);
    return NextResponse.json({ id, deleted: true }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
