import { describe, expect, it } from "vitest";
import { inMemoryKvClient } from "@/lib/registry/kv";
import { migrateBlobToPerApp, APP_PREFIX, INDEX_KEY, LEGACY_KEY } from "@/lib/registry/migrate";

const blob = JSON.stringify({
  a: { id: "a", name: "A", owner: "o", versions: [] },
  b: { id: "b", name: "B", owner: "o", versions: [] },
});

describe("migrateBlobToPerApp", () => {
  it("divide el blob en keys por-app + índice y borra el blob", async () => {
    const kv = inMemoryKvClient();
    await kv.set(LEGACY_KEY, blob);
    const res = await migrateBlobToPerApp(kv);
    expect(res.migrated).toBe(2);
    expect(JSON.parse((await kv.get(`${APP_PREFIX}a`))!).id).toBe("a");
    expect((await kv.smembers(INDEX_KEY)).sort()).toEqual(["a", "b"]);
    expect(await kv.get(LEGACY_KEY)).toBeNull();
  });
  it("es idempotente (segunda corrida no hace nada)", async () => {
    const kv = inMemoryKvClient();
    await kv.set(LEGACY_KEY, blob);
    await migrateBlobToPerApp(kv);
    const res2 = await migrateBlobToPerApp(kv);
    expect(res2.migrated).toBe(0);
  });
  it("no hace nada si no hay blob", async () => {
    const kv = inMemoryKvClient();
    expect((await migrateBlobToPerApp(kv)).migrated).toBe(0);
  });
});
