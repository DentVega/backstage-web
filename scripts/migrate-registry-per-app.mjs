#!/usr/bin/env node
/**
 * Migra el registry del blob único `registry` a keys por-miniapp (`registry:app:<id>`) + el
 * set `registry:index`. Idempotente (no-op si ya migró o si no hay blob). También corre lazy
 * en el primer `getAll()` del store; este script permite dispararla explícito contra prod.
 *
 * Uso: KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/migrate-registry-per-app.mjs
 */
import { Redis } from "@upstash/redis";

const APP_PREFIX = "registry:app:";
const INDEX_KEY = "registry:index";
const LEGACY_KEY = "registry";

const url = process.env.KV_REST_API_URL;
const token = process.env.KV_REST_API_TOKEN;
if (!url || !token) {
  console.error("Faltan KV_REST_API_URL / KV_REST_API_TOKEN.");
  process.exit(1);
}
const redis = new Redis({ url, token, automaticDeserialization: false });

const raw = await redis.get(LEGACY_KEY);
if (raw == null) {
  console.log("Sin blob `registry` — nada que migrar (¿ya migrado?).");
  process.exit(0);
}
const reg = JSON.parse(raw);
const ids = Object.keys(reg);
for (const id of ids) {
  await redis.set(`${APP_PREFIX}${id}`, JSON.stringify(reg[id]));
  await redis.sadd(INDEX_KEY, id);
  console.log(`  migrada: ${id}`);
}
await redis.del(LEGACY_KEY);
console.log(`✅ ${ids.length} miniapps migradas a keys por-app + índice; blob borrado.`);
