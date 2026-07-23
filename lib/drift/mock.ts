import type { DriftProvider } from "./types";

/** No-network provider for tests. Configurable head + per-repo baseSha + forced throws. */
export function mockDriftProvider(opts: {
  head?: string;
  baseByRepo?: Record<string, string | null>;
  throwHead?: boolean;
  throwRepos?: string[];
} = {}): DriftProvider {
  return {
    async getTemplateHead(): Promise<string> {
      if (opts.throwHead) throw new Error("template head failed");
      return opts.head ?? "HEAD";
    },
    async getBaseSha(repoFullName: string): Promise<string | null> {
      if (opts.throwRepos?.includes(repoFullName)) throw new Error("base sha failed");
      return opts.baseByRepo?.[repoFullName] ?? null;
    },
  };
}
