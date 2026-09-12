import { describe, it, expect } from "vitest";
import { canonicalize, computeHash, verifyChain } from "../chain";
import type { AuditEvent } from "../types";

function evt(seq: number, prevHash: string): AuditEvent {
  const base = {
    seq,
    ts: 1000 + seq,
    actor: { type: "user" as const, login: "brian" },
    action: "publish" as const,
    chain: "hellow",
    miniappId: "hellow",
    details: { version: `0.1.${seq}` },
    prevHash,
  };
  return { ...base, hash: computeHash(prevHash, base) };
}

function chainOf(n: number): AuditEvent[] {
  const out: AuditEvent[] = [];
  let prev = "";
  for (let i = 1; i <= n; i++) {
    const e = evt(i, prev);
    out.push(e);
    prev = e.hash;
  }
  return out;
}

describe("canonicalize", () => {
  it("is stable regardless of key insertion order", () => {
    expect(canonicalize({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalize({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe("verifyChain", () => {
  it("accepts a valid chain", () => {
    expect(verifyChain(chainOf(3))).toEqual({ ok: true });
  });

  it("detects an edited entry", () => {
    const c = chainOf(3);
    c[1] = { ...c[1], details: { version: "9.9.9" } }; // tamper, hash no recomputado
    expect(verifyChain(c)).toEqual({ ok: false, brokenAt: 2 });
  });

  it("detects a deleted middle entry (broken prevHash link)", () => {
    const c = chainOf(3);
    const gapped = [c[0], c[2]]; // falta seq 2
    expect(verifyChain(gapped)).toEqual({ ok: false, brokenAt: 3 });
  });

  it("empty chain is ok", () => {
    expect(verifyChain([])).toEqual({ ok: true });
  });
});
