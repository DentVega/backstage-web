// lib/drift/index.ts (Task 1 stub — Task 2 replaces getDriftProvider with the real one)
export type { DriftStatus, DriftProvider } from "./types";
export { DriftProviderError } from "./types";
export function getDriftProvider(): never {
  throw new Error("getDriftProvider not wired (Task 2)");
}
