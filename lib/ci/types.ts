/** Abstraction over the CI status of a miniapp's repo (ADR-020). */

/** Status of a miniapp repo's latest CI run. Closed domain. */
export type CiStatus =
  | "success"
  | "failure"
  | "in_progress"
  | "none"
  | "unknown";

export interface CiStatusProvider {
  /**
   * Latest CI run status for `repoFullName` ("owner/repo"), using the caller's
   * session token. Never throws: any failure resolves to `{ status: "unknown" }`.
   */
  getStatus(repoFullName: string, token: string): Promise<{ status: CiStatus }>;
}

export class CiProviderError extends Error {
  readonly code = "CI_PROVIDER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "CiProviderError";
  }
}

/**
 * Derive "owner/repo" for a miniapp. Prefers the record's repoUrl
 * (e.g. "https://github.com/acme/miniapp-x" → "acme/miniapp-x"); otherwise
 * falls back to the scaffolder convention `<owner>/miniapp-<id>`.
 */
export function repoFullNameFor(input: {
  owner: string;
  id: string;
  repoUrl?: string;
}): string {
  if (input.repoUrl) {
    const m = input.repoUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/);
    if (m) return m[1];
  }
  return `${input.owner}/miniapp-${input.id}`;
}
