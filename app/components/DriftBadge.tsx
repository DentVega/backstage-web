"use client";

import type { DriftStatus } from "@/lib/drift";

const LABELS: Record<DriftStatus, string> = {
  up_to_date: "Al día",
  drift: "Actualización disponible",
  untracked: "Sin sync",
  unknown: "Desconocido",
};

/** Presentational drift badge. No network — receives the status as a prop. */
export function DriftBadge({ status }: { status: DriftStatus }) {
  return (
    <span role="status" aria-label={`Drift: ${status}`} className={`drift-badge is-${status}`}>
      <span className="led" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
