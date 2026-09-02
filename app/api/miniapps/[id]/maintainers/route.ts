import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { setMaintainers, getMiniappDetail, asRecordMutation } from "@/lib/registry/registry";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { repoCollaboratorLogins } from "@/lib/git/collaborators";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * PUT /api/miniapps/:id/maintainers — setea los maintainers (logins de GitHub) de una
 * miniapp. Auth: platform-admin O un maintainer actual (auto-gobierno del equipo).
 * Body `{ maintainers: string[] }`. Devuelve el MiniappDetail actualizado.
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
    const body = (await req.json().catch(() => null)) as { maintainers?: unknown } | null;
    const list = Array.isArray(body?.maintainers)
      ? body.maintainers.filter((x): x is string => typeof x === "string")
      : [];
    // Seguridad: un maintainer DEBE tener acceso al repo de la miniapp (ser collaborator).
    // Se valida contra la fuente de verdad de GitHub, no solo en el cliente.
    if (list.length > 0) {
      const allowed = await repoCollaboratorLogins(record.repoUrl);
      const invalid = list.filter((m) => !allowed.includes(m.toLowerCase()));
      if (invalid.length > 0) {
        return NextResponse.json(
          {
            error:
              record.repoUrl === undefined
                ? "la miniapp no tiene repo para validar acceso; agregá maintainers luego de crear el repo"
                : `estos no tienen acceso al repo: ${invalid.join(", ")}`,
          },
          { status: 400 },
        );
      }
    }
    const next = await store.mutateApp(id, asRecordMutation(id, (reg) => setMaintainers(reg, id, list)));
    return NextResponse.json(getMiniappDetail(next ? { [id]: next } : {}, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
