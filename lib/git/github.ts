import _sodium from "libsodium-wrappers";
import {
  GitProviderError,
  type CreateFromTemplateInput,
  type DispatchWorkflowInput,
  type EnableActionsPullRequestsInput,
  type GitProvider,
  type SetSecretInput,
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

    async dispatchWorkflow(input: DispatchWorkflowInput): Promise<void> {
      const res = await fetch(
        `https://api.github.com/repos/${input.owner}/${input.repo}/actions/workflows/${input.workflow}/dispatches`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ ref: input.ref }),
        },
      );
      // GitHub returns 204 No Content on a successful dispatch.
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new GitProviderError(
          `workflow dispatch failed: HTTP ${res.status} ${detail.slice(0, 200)}`,
        );
      }
    },

    async enableActionsPullRequests(input: EnableActionsPullRequestsInput): Promise<void> {
      const res = await fetch(
        `https://api.github.com/repos/${input.owner}/${input.repo}/actions/permissions/workflow`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          // Only flip the create-PR toggle; leave default_workflow_permissions as-is.
          body: JSON.stringify({ can_approve_pull_request_reviews: true }),
        },
      );
      // GitHub returns 204 No Content on success.
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new GitProviderError(
          `enable Actions PR creation failed: HTTP ${res.status} ${detail.slice(0, 200)}`,
        );
      }
    },

    async setSecret(input: SetSecretInput): Promise<void> {
      const ghHeaders = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      // 1) fetch the repo's public key.
      const keyRes = await fetch(
        `https://api.github.com/repos/${input.owner}/${input.repo}/actions/secrets/public-key`,
        { headers: ghHeaders },
      );
      if (!keyRes.ok) {
        const detail = await keyRes.text().catch(() => "");
        throw new GitProviderError(
          `fetch secret public-key failed: HTTP ${keyRes.status} ${detail.slice(0, 200)}`,
        );
      }
      const { key, key_id } = (await keyRes.json()) as { key?: string; key_id?: string };
      if (typeof key !== "string" || typeof key_id !== "string") {
        throw new GitProviderError("secret public-key response missing key/key_id");
      }
      // 2) encrypt with a libsodium sealed box (GitHub's required scheme).
      // Tolerate CJS/ESM interop: some loaders nest the module under `.default`.
      const sodium = (_sodium as unknown as { default?: typeof _sodium }).default ?? _sodium;
      await sodium.ready;
      const encrypted_value = sodium.to_base64(
        sodium.crypto_box_seal(
          sodium.from_string(input.value),
          sodium.from_base64(key, sodium.base64_variants.ORIGINAL),
        ),
        sodium.base64_variants.ORIGINAL,
      );
      // 3) create/update the secret.
      const putRes = await fetch(
        `https://api.github.com/repos/${input.owner}/${input.repo}/actions/secrets/${input.name}`,
        {
          method: "PUT",
          headers: ghHeaders,
          body: JSON.stringify({ encrypted_value, key_id }),
        },
      );
      // 201 (created) or 204 (updated) on success.
      if (!putRes.ok) {
        const detail = await putRes.text().catch(() => "");
        throw new GitProviderError(
          `set secret "${input.name}" failed: HTTP ${putRes.status} ${detail.slice(0, 200)}`,
        );
      }
    },
  };
}
