import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { removeMiniapp, updateMiniappMeta } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import { scaffoldAllowedLogins, githubToken } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { githubProvider } from "@/lib/git/github";
import { parseRepo } from "@/lib/git/miniapp-dispatch";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * DELETE /api/miniapps/:id — remove a miniapp (admin, canScaffold).
 * Default: solo la entrada del registry (comportamiento histórico).
 * Con `?repo=true`: además borra el repo de GitHub (orden repo→registry, fail-safe —
 * si el repo no se puede borrar, aborta sin tocar el registry). NO borra los chunks del CDN.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const alsoRepo = new URL(req.url).searchParams.get("repo") === "true";
    const reg = await getStore().load();
    // Lazy (evita el crash de next-auth/Next-16 en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, reg[id]?.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }

    let repoDeleted: boolean | undefined;
    if (alsoRepo) {
      const record = reg[id];
      if (record === undefined) throw new MiniappNotFoundError(id);
      const parsed = parseRepo(record.repoUrl);
      if (parsed === null) {
        return NextResponse.json(
          { error: "miniapp has no valid repo URL to delete" },
          { status: 400 },
        );
      }
      try {
        const result = await githubProvider(githubToken()).deleteRepo(parsed);
        repoDeleted = result.deleted;
      } catch (err) {
        // Fail-safe: no tocar el registry si el repo no se pudo borrar.
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "repo delete failed (¿el token del server tiene delete_repo?)",
            code: "REPO_DELETE_FAILED",
          },
          { status: 403 },
        );
      }
    }

    const next = removeMiniapp(reg, id);
    await getStore().save(next);
    return NextResponse.json(
      alsoRepo ? { id, deleted: true, repoDeleted } : { id, deleted: true },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}

/**
 * PATCH /api/miniapps/:id — update a miniapp's mutable metadata (admin, canScaffold).
 * Body `{ repoUrl?, owner? }`. `repoUrl` debe ser una URL de repo de GitHub válida.
 * Sirve para re-apuntar o corregir la metadata de una entrada (ej. repos migrados).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const reg = await getStore().load();
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, reg[id]?.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as { repoUrl?: unknown; owner?: unknown } | null;
    const patch: { repoUrl?: string; owner?: string } = {};
    if (typeof body?.repoUrl === "string") {
      if (parseRepo(body.repoUrl) === null) {
        return NextResponse.json(
          { error: "repoUrl is not a valid GitHub repo URL" },
          { status: 400 },
        );
      }
      patch.repoUrl = body.repoUrl;
    }
    if (typeof body?.owner === "string" && body.owner.length > 0) patch.owner = body.owner;
    if (patch.repoUrl === undefined && patch.owner === undefined) {
      return NextResponse.json(
        { error: "nothing to update (repoUrl or owner required)" },
        { status: 400 },
      );
    }
    const next = updateMiniappMeta(reg, id, patch); // MiniappNotFoundError → 404
    await getStore().save(next);
    const rec = next[id];
    return NextResponse.json({ id, repoUrl: rec?.repoUrl, owner: rec?.owner }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
