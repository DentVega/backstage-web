import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStore } from "@/lib/registry/store";
import { registerMiniapp, asRecordMutation } from "@/lib/registry/registry";
import { scaffoldMiniapp } from "@/lib/scaffold";
import { githubProvider } from "@/lib/git/github";
import { TEMPLATE_REPO, githubToken, scaffoldAllowedLogins, scaffoldSecrets } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** POST /api/scaffold — create a miniapp repo from the template + register it. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    // Authorization gate — before touching GitHub or the registry (Bolt 06-2).
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }

    const body = (await req.json()) as {
      id?: string;
      name?: string;
      owner?: string;
    };
    if (!body.id || !body.name || !body.owner) {
      return NextResponse.json(
        { error: "id, name and owner are required" },
        { status: 400 },
      );
    }

    const store = getStore();
    const existing = await store.getApp(body.id);
    const provider = githubProvider(githubToken());
    const now = new Date().toISOString();
    // scaffoldMiniapp valida (MiniappExistsError si ya existe) y crea el repo (I/O), afuera del CAS.
    const { repoUrl } = await scaffoldMiniapp(
      existing ? { [body.id]: existing } : {},
      provider,
      TEMPLATE_REPO,
      { id: body.id, name: body.name, owner: body.owner },
      now,
      scaffoldSecrets(),
    );
    // Registra la entrada vía CAS por-miniapp.
    await store.mutateApp(
      body.id,
      asRecordMutation(body.id, (reg) =>
        registerMiniapp(reg, { id: body.id!, name: body.name!, owner: body.owner!, repoUrl }, now),
      ),
    );

    return NextResponse.json({ id: body.id, repoUrl }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
