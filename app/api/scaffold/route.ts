import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { scaffoldMiniapp } from "@/lib/scaffold";
import { githubProvider } from "@/lib/git/github";
import { TEMPLATE_REPO, githubToken } from "@/lib/config";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** POST /api/scaffold — create a miniapp repo from the template + register it. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
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

    const reg = await getStore().load();
    const provider = githubProvider(githubToken());
    const { registry, repoUrl } = await scaffoldMiniapp(
      reg,
      provider,
      TEMPLATE_REPO,
      { id: body.id, name: body.name, owner: body.owner },
      new Date().toISOString(),
    );
    await getStore().save(registry);

    return NextResponse.json({ id: body.id, repoUrl }, { status: 201 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
