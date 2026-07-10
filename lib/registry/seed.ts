/** Seed the registry with the current catalog (idempotent). Used on KV migration. */
import type { MiniappRecord, Registry } from "./types";
import type { RegistryStore } from "./store";

/** Current catalog fixture (account_dashboard). Cast because ids/versions are branded. */
export const SEED_REGISTRY = {
  account_dashboard: {
    id: "account_dashboard",
    name: "Account Dashboard",
    owner: "payments-team",
    createdAt: "2026-07-09T10:00:00.000Z",
    versions: [
      {
        version: "0.1.0",
        url: "http://localhost:9000/account_dashboard.container.js.bundle",
        manifest: {
          id: "account_dashboard",
          version: "0.1.0",
          entry: "./Entry",
          shared: [
            { name: "react", requiredRange: "^18.3.0", singleton: true },
            { name: "react-native", requiredRange: "^0.76.0", singleton: true },
            { name: "@tanstack/react-query", requiredRange: "^5.0.0", singleton: true },
            { name: "@shopify/flash-list", requiredRange: "^1.7.0", singleton: true },
          ],
          capabilities: ["accounts:read"],
          integrity: "sha256-PLACEHOLDER-set-in-bolt-4",
        },
        publishedAt: "2026-07-09T10:00:00.000Z",
      },
    ],
  },
} as unknown as Registry;

/**
 * Write the seed catalog to the store. Idempotent: existing entries are kept
 * (the seed does not clobber miniapps already registered).
 */
export async function seedRegistry(store: RegistryStore): Promise<Registry> {
  const current = await store.load();
  const merged: Record<string, MiniappRecord> = { ...SEED_REGISTRY, ...current };
  // Backfill createdAt from the seed for any kept record still missing it
  // (records that predate the metadata field).
  for (const [id, record] of Object.entries(merged)) {
    const seedCreatedAt = SEED_REGISTRY[id]?.createdAt;
    if (record.createdAt === undefined && seedCreatedAt !== undefined) {
      merged[id] = { ...record, createdAt: seedCreatedAt };
    }
  }
  await store.save(merged);
  return merged;
}
