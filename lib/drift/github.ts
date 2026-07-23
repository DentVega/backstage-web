import { githubToken, TEMPLATE_REPO } from "@/lib/config";
import { DriftProviderError, type DriftProvider } from "./types";

type FetchImpl = typeof fetch;

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${githubToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * GitHub implementation. Reads the template's HEAD sha and each miniapp's
 * `.template-sync` baseSha via the REST API, using the scaffolder token.
 * `getBaseSha` returns null on 404 (untracked) but THROWS on other failures,
 * so the resolver can distinguish "untracked" from "unknown". `fetchImpl` is
 * injectable for tests.
 */
export function githubDriftProvider(fetchImpl: FetchImpl = fetch): DriftProvider {
  return {
    async getTemplateHead(): Promise<string> {
      const res = await fetchImpl(
        `https://api.github.com/repos/${TEMPLATE_REPO}/commits/main`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new DriftProviderError(`template HEAD failed: HTTP ${res.status}`);
      const body = (await res.json()) as { sha?: string };
      if (typeof body.sha !== "string") throw new DriftProviderError("template HEAD missing sha");
      return body.sha;
    },
    async getBaseSha(repoFullName: string): Promise<string | null> {
      const res = await fetchImpl(
        `https://api.github.com/repos/${repoFullName}/contents/.template-sync`,
        { headers: authHeaders() },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new DriftProviderError(`.template-sync fetch failed: HTTP ${res.status}`);
      const body = (await res.json()) as { content?: string };
      if (typeof body.content !== "string") throw new DriftProviderError(".template-sync missing content");
      const json = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) as {
        baseSha?: string;
      };
      if (typeof json.baseSha !== "string") throw new DriftProviderError(".template-sync missing baseSha");
      return json.baseSha;
    },
  };
}
