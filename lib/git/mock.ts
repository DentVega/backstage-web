import type { CreateFromTemplateInput, GitProvider } from "./types";

/** No-network provider for tests. `collaborators` alimenta listCollaborators (default []). */
export function mockProvider(collaborators: string[] = []): GitProvider {
  return {
    async createFromTemplate(input: CreateFromTemplateInput): Promise<{ repoUrl: string }> {
      return { repoUrl: `https://github.com/${input.owner}/${input.name}` };
    },
    async dispatchWorkflow(): Promise<void> {
      // no-op
    },
    async enableActionsPullRequests(): Promise<void> {
      // no-op
    },
    async setSecret(): Promise<void> {
      // no-op
    },
    async ensureIssue(input) {
      return { created: true, url: `https://github.com/${input.owner}/${input.repo}/issues/1` };
    },
    async deleteRepo(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
    async listCollaborators(): Promise<{ login: string }[]> {
      return collaborators.map((login) => ({ login }));
    },
  };
}
