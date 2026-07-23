/** Abstraction over a miniapp's drift vs the template (roadmap #7). */

/** Whether a miniapp is up to date with the template. Closed domain. */
export type DriftStatus = "up_to_date" | "drift" | "untracked" | "unknown";

export interface DriftProvider {
  /** SHA of the template's current HEAD (shared across miniapps; fetch once). */
  getTemplateHead(): Promise<string>;
  /** baseSha from the repo's `.template-sync`, or null if it has none (untracked). Throws on non-404 errors. */
  getBaseSha(repoFullName: string): Promise<string | null>;
}

export class DriftProviderError extends Error {
  readonly code = "DRIFT_PROVIDER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "DriftProviderError";
  }
}
