import { NextResponse } from "next/server";
import { buildSearchIndex } from "@/lib/docs/search";

export const runtime = "nodejs";

/** GET /api/docs/search-index — índice de búsqueda de las docs (público). */
export function GET() {
  return NextResponse.json(
    { sections: buildSearchIndex() },
    { headers: { "cache-control": "public, max-age=3600" } },
  );
}
