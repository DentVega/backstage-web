import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { seedRegistry } from "@/lib/registry/seed";
import { requirePublishToken } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";
import { recordAudit, GLOBAL_CHAIN } from "@/lib/audit/log";
import { resolveActor } from "@/lib/audit/actor";

export const runtime = "nodejs";

/**
 * POST /api/seed — load the seed catalog into the store (e.g. KV after deploy).
 * Auth: Bearer PUBLISH_TOKEN. Idempotent (does not clobber existing entries).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    requirePublishToken(req);
    const reg = await seedRegistry(getStore());
    const count = Object.keys(reg).length;
    await recordAudit({
      actor: resolveActor(null), // token/CI: sin sesión
      action: "seed",
      chain: GLOBAL_CHAIN,
      details: { count },
    });
    return NextResponse.json({ seeded: true, count });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
