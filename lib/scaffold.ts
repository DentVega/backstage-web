/** Pure scaffold orchestration — no Next.js, no network (GitProvider injected). */
import { parseMiniappId } from "@org/miniapp-contract";
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
): Promise<ScaffoldResult> {
  const id = parseMiniappId(input.id);
  if (id === null) {
    throw new InvalidManifestError(`bad miniapp id "${input.id}"`);
  }
  // Avoid creating a repo for an already-registered id — check up front.
  if (reg[id] !== undefined) {
    throw new MiniappExistsError(id);
  }

  const { repoUrl } = await gitProvider.createFromTemplate({
    templateRepo,
    name: `miniapp-${id}`,
    owner: input.owner,
  });

  const registry = registerMiniapp(
    reg,
    { id, name: input.name, owner: input.owner, repoUrl },
    now,
  );

  return { registry, repoUrl };
}
