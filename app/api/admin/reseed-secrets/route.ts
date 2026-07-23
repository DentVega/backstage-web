import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { seedRepoSecrets } from "@/lib/scaffold";
import { githubProvider } from "@/lib/git/github";
import { githubToken, scaffoldAllowedLogins, scaffoldSecrets } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/admin/reseed-secrets — re-siembra los secrets de CI
 * (BACKSTAGE_URL + PUBLISH_TOKEN, valores actuales del env de Backstage) en TODOS
 * los repos del registry. Usado para rotar el PUBLISH_TOKEN sin downtime.
 * Auth: sesión allowlisted (canScaffold) — acción administrativa, no el token.
 * Best-effort por repo → { reseeded, failed }.
 */
export async function POST(_req: Request): Promise<NextResponse> {
  try {
    // Loaded lazily to avoid a pre-existing next-auth/Next-16 module-resolution
    // crash when this module is statically imported in the test transitive graph.
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }

    const reg = await getStore().load();
    const provider = githubProvider(githubToken());
    const secrets = scaffoldSecrets();

    const reseeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const rec of Object.values(reg)) {
      const repo = `miniapp-${rec.id}`;
      try {
        const result = await seedRepoSecrets(provider, rec.owner, repo, secrets);
        if (result.failed.length > 0) {
          failed.push({ id: rec.id, error: result.failed.map((f) => `${f.name}: ${f.error}`).join("; ") });
        } else {
          reseeded.push(rec.id);
        }
      } catch (err) {
        failed.push({ id: rec.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ reseeded, failed }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
