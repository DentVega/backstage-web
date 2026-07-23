/** Pure scaffold orchestration — no Next.js, no network (GitProvider injected). */
import { parseMiniappId } from "@dentvega/miniapp-contract";
import { registerMiniapp } from "./registry/registry";
import {
  InvalidManifestError,
  MiniappExistsError,
  type Registry,
} from "./registry/types";
import type { GitProvider } from "./git/types";

export interface ScaffoldInput {
  id: string;
  name: string;
  owner: string;
}

export interface ScaffoldResult {
  registry: Registry;
  repoUrl: string;
}

export interface SeedResult {
  seeded: string[];
  failed: { name: string; error: string }[];
}

/**
 * Siembra (crea/actualiza) los secrets de Actions de un repo, best-effort por
 * secret: un fallo no aborta los demás. Nunca logea el VALOR del secret.
 * Reusado por el scaffolder (al crear) y por el reseed (rotación).
 */
export async function seedRepoSecrets(
  gitProvider: GitProvider,
  owner: string,
  repo: string,
  secrets: Record<string, string>,
): Promise<SeedResult> {
  const seeded: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const [name, value] of Object.entries(secrets)) {
    try {
      await gitProvider.setSecret({ owner, repo, name, value });
      seeded.push(name);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ name, error });
      console.warn(`seedRepoSecrets: could not set secret ${name} for ${owner}/${repo}: ${error}`);
    }
  }
  return { seeded, failed };
}

/**
 * Validate → create repo from template (GitProvider) → register in the catalog.
 * Reuses the contract's id validation and the registry's registerMiniapp
 * (which throws MiniappExistsError on a duplicate).
 */
export async function scaffoldMiniapp(
  reg: Registry,
  gitProvider: GitProvider,
  templateRepo: string,
  input: ScaffoldInput,
  now: string,
  secrets: Record<string, string> = {},
): Promise<ScaffoldResult> {
  const id = parseMiniappId(input.id);
  if (id === null) {
    throw new InvalidManifestError(`bad miniapp id "${input.id}"`);
  }
  // Avoid creating a repo for an already-registered id — check up front.
  if (reg[id] !== undefined) {
    throw new MiniappExistsError(id);
  }

  const repo = `miniapp-${id}`;
  const { repoUrl } = await gitProvider.createFromTemplate({
    templateRepo,
    name: repo,
    owner: input.owner,
  });

  // Best-effort: let the miniapp's template-sync workflow open PRs (Capa 2). A
  // failure here must not abort an otherwise-successful scaffold or leave the
  // repo unregistered — the setting can be re-applied later.
  try {
    await gitProvider.enableActionsPullRequests({ owner: input.owner, repo });
  } catch (err) {
    console.warn(
      `scaffold: could not enable Actions PR creation for ${input.owner}/${repo}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Best-effort: seed the CI secrets (BACKSTAGE_URL + PUBLISH_TOKEN) so the
  // miniapp can publish on first push. A failure here must not abort the scaffold.
  await seedRepoSecrets(gitProvider, input.owner, repo, secrets);

  const registry = registerMiniapp(
    reg,
    { id, name: input.name, owner: input.owner, repoUrl },
    now,
  );

  return { registry, repoUrl };
}
