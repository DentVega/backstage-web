/** Authorization for the scaffolder (Bolt 06-2). Pure + testable. */

export class ScaffoldForbiddenError extends Error {
  readonly code = "FORBIDDEN";
  constructor(message = "No autorizado para crear miniapps en esta instancia.") {
    super(message);
    this.name = "ScaffoldForbiddenError";
  }
}

/**
 * Decide whether `login` may scaffold, given an allowlist of GitHub usernames.
 * Fail-closed: an empty allowlist or a missing login denies everyone. Matching
 * is case-insensitive and trims surrounding whitespace.
 */
export function canScaffold(
  login: string | null | undefined,
  allowlist: readonly string[],
): boolean {
  if (!login) return false;
  const l = login.trim().toLowerCase();
  if (l.length === 0) return false;
  return allowlist.some((a) => a.trim().toLowerCase() === l);
}
