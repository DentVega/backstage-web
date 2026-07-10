import type { CreateFromTemplateInput, GitProvider } from "./types";

/** No-network provider for tests. */
export function mockProvider(): GitProvider {
  return {
    async createFromTemplate(input: CreateFromTemplateInput): Promise<{ repoUrl: string }> {
      return { repoUrl: `https://github.com/${input.owner}/${input.name}` };
    },
  };
}
