/** Resuelve el actor de un evento de audit a partir de datos ya conocidos por la ruta. */
import type { AuditActor } from "./types";

/**
 * @param login  github login de la sesión (UI), o null/undefined si la request es del CI (token).
 * @param ci     campos reportados por el CI en el upload (actor/commit/repo). Opcional.
 */
export function resolveActor(
  login: string | null | undefined,
  ci?: { actor?: string; commit?: string; repo?: string },
): AuditActor {
  if (login && login.trim().length > 0) return { type: "user", login: login.trim() };
  const actor: AuditActor = { type: "ci", login: ci?.actor?.trim() || "ci" };
  if (ci?.commit) actor.commit = ci.commit;
  if (ci?.repo) actor.repo = ci.repo;
  return actor;
}
