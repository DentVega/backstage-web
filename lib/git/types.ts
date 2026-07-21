/** Abstraction over the git provider used to scaffold miniapp repos (ADR-013). */

export interface CreateFromTemplateInput {
  /** e.g. "org/miniapp-template" */
  readonly templateRepo: string;
  /** New repo name, e.g. "miniapp-payments". */
  readonly name: string;
  /** Owner (org or user) of the new repo. */
  readonly owner: string;
}

export interface DispatchWorkflowInput {
  readonly owner: string;
  readonly repo: string;
  /** Workflow file name, e.g. "ci.yml". */
  readonly workflow: string;
  /** Git ref (branch/tag) to run on, e.g. "main". */
  readonly ref: string;
}

export interface EnableActionsPullRequestsInput {
  readonly owner: string;
  readonly repo: string;
}

export interface GitProvider {
  createFromTemplate(input: CreateFromTemplateInput): Promise<{ repoUrl: string }>;
  /** Trigger a `workflow_dispatch` run (build + publish the miniapp). */
  dispatchWorkflow(input: DispatchWorkflowInput): Promise<void>;
  /**
   * Allow GitHub Actions to create pull requests in the repo, so the miniapp's
   * `template-sync.yml` can open its sync PR with the automatic GITHUB_TOKEN
   * (no extra secret). Off by default on new repos (ADR-016, Capa 2).
   */
  enableActionsPullRequests(input: EnableActionsPullRequestsInput): Promise<void>;
}

export class GitProviderError extends Error {
  readonly code = "GIT_PROVIDER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "GitProviderError";
  }
}
