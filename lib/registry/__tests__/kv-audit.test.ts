import { describe, it, expect } from "vitest";
import { inMemoryKvClient } from "../kv";

describe("KvClient audit primitives (in-memory)", () => {
  it("lpush prepends and lrange reads newest-first", async () => {
    const kv = inMemoryKvClient();
    await kv.lpush("l", "a");
    await kv.lpush("l", "b");
    expect(await kv.lrange("l", 0, -1)).toEqual(["b", "a"]);
    expect(await kv.lrange("l", 0, 0)).toEqual(["b"]);
  });

  it("casAppend succeeds only when head matches, atomically prepending + advancing head", async () => {
    const kv = inMemoryKvClient();
    // first append: expected head null (absent)
    expect(await kv.casAppend("h", "l", null, "H1", "e1")).toBe(true);
    expect(await kv.get("h")).toBe("H1");
    expect(await kv.lrange("l", 0, -1)).toEqual(["e1"]);
    // stale expected head → rejected, no mutation
    expect(await kv.casAppend("h", "l", "STALE", "H2", "e2")).toBe(false);
    expect(await kv.lrange("l", 0, -1)).toEqual(["e1"]);
    // correct expected head → appended
    expect(await kv.casAppend("h", "l", "H1", "H2", "e2")).toBe(true);
    expect(await kv.lrange("l", 0, -1)).toEqual(["e2", "e1"]);
    expect(await kv.get("h")).toBe("H2");
  });
});
