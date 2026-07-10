import {
  GitProviderError,
  type CreateFromTemplateInput,
  type GitProvider,
} from "./types";

/**
 * GitHub implementation: creates a repo from a template repository via the REST
 * API (`POST /repos/{template_owner}/{template_repo}/generate`). Token by env.
 */
export function githubProvider(token: string): GitProvider {
  return {
    async createFromTemplate(input: CreateFromTemplateInput): Promise<{ repoUrl: string }> {
      const res = await fetch(
        `https://api.github.com/repos/${input.templateRepo}/generate`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            owner: input.owner,
            name: input.name,
            private: true,
            description: `Miniapp ${input.name} — generated from template`,
          }),
        },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new GitProviderError(
          `GitHub generate failed: HTTP ${res.status} ${detail.slice(0, 200)}`,
        );
      }
      const body = (await res.json()) as { html_url?: string };
      if (typeof body.html_url !== "string") {
        throw new GitProviderError("GitHub response missing html_url");
      }
      return { repoUrl: body.html_url };
    },
  };
}
