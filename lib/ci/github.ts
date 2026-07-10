import type { CiStatus, CiStatusProvider } from "./types";

type FetchImpl = typeof fetch;

interface WorkflowRun {
  status?: string | null;
  conclusion?: string | null;
}

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "cancelled",
  "timed_out",
  "startup_failure",
  "action_required",
]);

/** Map a GitHub Actions run to our closed CiStatus domain. */
function mapRun(run: WorkflowRun | undefined): CiStatus {
  if (run === undefined) return "none";
  const { conclusion } = run;
  if (conclusion === "success") return "success";
  if (conclusion != null && FAILED_CONCLUSIONS.has(conclusion)) return "failure";
  // No conclusion yet → the run is still queued/running.
  if (conclusion == null) return "in_progress";
  return "unknown";
}

/**
 * GitHub implementation: reads the latest workflow run for a repo
 * (`GET /repos/{owner}/{repo}/actions/runs?per_page=1`). Never throws —
 * any failure (HTTP error, network, missing token, unexpected body) → `unknown`.
 * `fetchImpl` is injectable so tests run without the network.
 */
export function githubCiProvider(fetchImpl: FetchImpl = fetch): CiStatusProvider {
  return {
    async getStatus(repoFullName: string, token: string): Promise<{ status: CiStatus }> {
      if (!token || !repoFullName) return { status: "unknown" };
      try {
        const res = await fetchImpl(
          `https://api.github.com/repos/${repoFullName}/actions/runs?per_page=1`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.github+json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
          },
        );
        if (!res.ok) return { status: "unknown" };
        const body = (await res.json()) as { workflow_runs?: WorkflowRun[] };
        const runs = body.workflow_runs;
        if (!Array.isArray(runs)) return { status: "unknown" };
        return { status: mapRun(runs[0]) };
      } catch {
        return { status: "unknown" };
      }
    },
  };
}
