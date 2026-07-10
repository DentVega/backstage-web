"use client";

import type { CiStatus } from "@/lib/ci";

const LABELS: Record<CiStatus, { icon: string; text: string; color: string }> = {
  success: { icon: "✅", text: "OK", color: "#1a7f37" },
  failure: { icon: "❌", text: "Fallo", color: "#cf222e" },
  in_progress: { icon: "🟡", text: "En curso", color: "#9a6700" },
  none: { icon: "⚪", text: "Sin runs", color: "#57606a" },
  unknown: { icon: "❔", text: "Desconocido", color: "#57606a" },
};

/** Presentational CI status badge. No network — receives the status as a prop. */
export function CiBadge({ status }: { status: CiStatus }) {
  const { icon, text, color } = LABELS[status];
  return (
    <span
      role="status"
      aria-label={`CI: ${status}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "1px 8px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      <span aria-hidden>{icon}</span>
      {text}
    </span>
  );
}
