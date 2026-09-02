import { describe, expect, it } from "vitest";
import { inMemoryKvClient, kvStore, type KvClient } from "@/lib/registry/kv";
import type { MiniappRecord } from "@/lib/registry/types";

const rec = (id: string, versions: unknown[] = []): MiniappRecord =>
  ({ id, name: id, owner: "o", versions } as unknown as MiniappRecord);

describe("store v2 — getApp/getAll/mutateApp", () => {
  it("crea, lee y borra un record", async () => {
    const s = kvStore(inMemoryKvClient());
    expect(await s.getApp("a")).toBeUndefined();
    await s.mutateApp("a", () => rec("a"));
    expect((await s.getApp("a"))!.id).toBe("a");
    expect(await s.getAll()).toEqual({ a: rec("a") });
    await s.mutateApp("a", () => null); // borrar
    expect(await s.getApp("a")).toBeUndefined();
    expect(await s.getAll()).toEqual({});
  });
});

describe("mutateApp — concurrencia", () => {
  it("dos writes a miniapps DISTINTAS: ambos sobreviven", async () => {
    const s = kvStore(inMemoryKvClient());
    await s.mutateApp("a", () => rec("a"));
    await s.mutateApp("b", () => rec("b"));
    expect(Object.keys(await s.getAll()).sort()).toEqual(["a", "b"]);
  });

  it("dos writes a la MISMA miniapp con interleave: reintenta, no se pierde", async () => {
    const base = inMemoryKvClient();
    let injected = false;
    const kv: KvClient = {
      ...base,
      async casSet(key, expected, value) {
        if (!injected && key.endsWith(":a")) {
          injected = true;
          // Simula que OTRO publish escribió la versión 9.9.9 justo antes del CAS.
          await base.set(key, JSON.stringify(rec("a", [{ version: "9.9.9" }])));
        }
        return base.casSet(key, expected, value);
      },
    };
    const s = kvStore(kv);
    await base.casSet("registry:app:a", null, JSON.stringify(rec("a", [])));
    await base.sadd("registry:index", "a");
    // fn agrega "1.0.0"; el interleave metió "9.9.9". Tras el retry deben estar LAS DOS.
    await s.mutateApp("a", (r) => ({
      ...(r as MiniappRecord),
      versions: [...(r?.versions ?? []), { version: "1.0.0" } as never],
    }));
    const got = await s.getApp("a");
    const vs = (got!.versions as readonly { version: string }[]).map((v) => v.version).sort();
    expect(vs).toEqual(["1.0.0", "9.9.9"]); // con el bug viejo, "9.9.9" se perdía
  });
});

describe("mutateApp — robustez bajo carga", () => {
  // KvClient con latencia: fuerza interleaving real entre mutateApp concurrentes.
  const racyKv = (): KvClient => {
    const base = inMemoryKvClient();
    return {
      ...base,
      async casSet(k, e, v) {
        await new Promise((r) => setTimeout(r, 1));
        return base.casSet(k, e, v);
      },
    };
  };

  it("invariante: cada write a la misma miniapp ATERRIZA o da 409 — cero pérdida silenciosa", async () => {
    const { ConflictError } = await import("@/lib/registry/types");
    const s = kvStore(racyKv());
    await s.mutateApp("acc", () => rec("acc", []));
    let ok = 0;
    await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        s
          .mutateApp("acc", (r) => ({
            ...(r as MiniappRecord),
            versions: [...(r?.versions ?? []), { version: `v${i}` } as never],
          }))
          .then(() => {
            ok++;
          })
          .catch((e) => {
            if (!(e instanceof ConflictError)) throw e; // solo 409 es aceptable
          }),
      ),
    );
    const landed = (await s.getApp("acc"))!.versions.length;
    expect(landed).toBe(ok); // TODO write exitoso quedó guardado: cero lost update
  });

  it("burst moderado (8) a la misma miniapp: TODOS aterrizan (retries + jitter)", async () => {
    const s = kvStore(racyKv());
    await s.mutateApp("acc", () => rec("acc", []));
    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        s.mutateApp("acc", (r) => ({
          ...(r as MiniappRecord),
          versions: [...(r?.versions ?? []), { version: `v${i}` } as never],
        })),
      ),
    );
    expect((await s.getApp("acc"))!.versions).toHaveLength(8);
  });
});
