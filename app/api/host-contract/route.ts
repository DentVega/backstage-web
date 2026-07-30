import { NextResponse } from "next/server";
import { getHostContractStore } from "@/lib/host-contract/store";
import { isHostContract } from "@/lib/host-contract/types";
import { requireHostContractToken } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** GET /api/host-contract — el contract vigente (404 si no hay). */
export async function GET(): Promise<NextResponse> {
  const contract = await getHostContractStore().load();
  if (contract === null) {
    return NextResponse.json({ error: "no host contract published" }, { status: 404 });
  }
  return NextResponse.json(contract, { status: 200 });
}

/** PUT /api/host-contract — publica el contract (solo el CI del host, HOST_CONTRACT_TOKEN). */
export async function PUT(req: Request): Promise<NextResponse> {
  try {
    requireHostContractToken(req);
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
    }
    if (!isHostContract(body)) {
      return NextResponse.json({ error: "invalid host contract" }, { status: 400 });
    }
    await getHostContractStore().save(body);
    return NextResponse.json({ ok: true, contractVersion: body.contractVersion }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
