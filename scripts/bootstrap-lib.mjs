/** Pure helpers for the adoption bootstrap (no IO). */

const INCLUDE_EXT = new Set(["json", "ts", "tsx", "mjs", "js", "jsx", "yml", "yaml", "md"]);
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "build", "dist", ".next", "coverage", "@mf-types", "Pods", ".gradle",
]);
const EXCLUDE_FILES = new Set([
  "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
  "bootstrap.mjs", "bootstrap-lib.mjs", "bootstrap.test.mjs",
]);

/**
 * Replace the origin scope/owner/login literals with the new ones, in an order
 * that avoids corruption: scope (@dentvega) first, then owner (DentVega), then
 * the bare lowercase login (dentvega) — after the first two the only remaining
 * "dentvega" is the standalone login.
 */
export function renameContent(text, { scope, owner, login }) {
  return text
    .replaceAll("@dentvega", scope)
    .replaceAll("DentVega", owner)
    .replaceAll("dentvega", login);
}

/** true if the git remote origin URL points at the DentVega origin repos. */
export function isOriginRepo(remoteUrl) {
  if (!remoteUrl) return false;
  return /github\.com[:/]dentvega\//i.test(remoteUrl);
}

/** true if a directory name should be pruned from the walk. */
export function isExcludedDir(name) {
  return EXCLUDE_DIRS.has(name);
}

/**
 * Decide whether a repo-relative path (using "/" separators) should be scanned.
 * Includes known source/config extensions + `.npmrc`; excludes lockfiles, the
 * bootstrap's own files, excluded dirs, dotfiles, and everything else.
 */
export function shouldProcessFile(relPath) {
  const parts = relPath.split("/");
  const base = parts[parts.length - 1];
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
  if (EXCLUDE_FILES.has(base)) return false;
  if (base === ".npmrc") return true;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false; // no extension, or a dotfile like .gitignore
  return INCLUDE_EXT.has(base.slice(dot + 1).toLowerCase());
}
