"use client";

import type { CiStatus } from "@/lib/ci";

const LABELS: Record<CiStatus, string> = {
  success: "OK",
  failure: "Fallo",
  in_progress: "En curso",
  none: "Sin runs",
  unknown: "Desconocido",
};

/** Presentational CI status badge. No network — receives the status as a prop. */
export function CiBadge({ status }: { status: CiStatus }) {
  return (
    <span role="status" aria-label={`CI: ${status}`} className={`ci-badge is-${status}`}>
      <span className="led" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
