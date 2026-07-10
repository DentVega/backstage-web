import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { seedRegistry } from "@/lib/registry/seed";
import { requirePublishToken } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/seed — load the seed catalog into the store (e.g. KV after deploy).
 * Auth: Bearer PUBLISH_TOKEN. Idempotent (does not clobber existing entries).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    requirePublishToken(req);
    const reg = await seedRegistry(getStore());
    return NextResponse.json({ seeded: true, count: Object.keys(reg).length });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
