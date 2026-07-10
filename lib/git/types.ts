/** Abstraction over the git provider used to scaffold miniapp repos (ADR-013). */

export interface CreateFromTemplateInput {
  /** e.g. "org/miniapp-template" */
  readonly templateRepo: string;
  /** New repo name, e.g. "miniapp-payments". */
  readonly name: string;
  /** Owner (org or user) of the new repo. */
  readonly owner: string;
}

export interface GitProvider {
  createFromTemplate(input: CreateFromTemplateInput): Promise<{ repoUrl: string }>;
}

export class GitProviderError extends Error {
  readonly code = "GIT_PROVIDER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "GitProviderError";
  }
}
