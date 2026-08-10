import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { getMetricsStore } from "@/lib/metrics/store";
import type { MetricEvent } from "@/lib/metrics/types";

export const runtime = "nodejs";

const MAX_BATCH = 50;

function isValidEvent(ev: unknown, ids: ReadonlySet<string>): ev is MetricEvent {
  if (typeof ev !== "object" || ev === null) return false;
  const e = ev as Record<string, unknown>;
  if (typeof e.id !== "string" || !ids.has(e.id)) return false; // id debe existir en el registry
  if (e.type === "mount") return e.version === undefined || typeof e.version === "string";
  if (e.type === "fallback") return typeof e.reason === "string";
  return false;
}

/**
 * POST /api/metrics — ingest de eventos del host (público, best-effort). Valida el
 * tipo + que el `id` exista en el registry (anti-poisoning) + batch acotado. NUNCA
 * falla duro: siempre 200 (las métricas no rompen el reporte del host).
 */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const body = (await req.json().catch(() => null)) as { events?: unknown } | null;
    const raw = Array.isArray(body?.events) ? body.events.slice(0, MAX_BATCH) : [];
    const reg = await getStore().load();
    const ids = new Set(Object.keys(reg));
    const store = getMetricsStore();
    let tracked = 0;
    for (const ev of raw) {
      if (isValidEvent(ev, ids)) {
        await store.track(ev);
        tracked++;
      }
    }
    return NextResponse.json({ tracked }, { status: 200 });
  } catch {
    return NextResponse.json({ tracked: 0 }, { status: 200 });
  }
}

/** GET /api/metrics — snapshot agregado (mounts por miniapp + fallbacks por razón). */
export async function GET(): Promise<NextResponse> {
  const reg = await getStore().load();
  const snapshot = await getMetricsStore().snapshot(Object.keys(reg));
  return NextResponse.json(snapshot, { status: 200 });
}
