/** Eventos que el host reporta a POST /api/metrics. */
export type MetricEvent =
  | { readonly type: "mount"; readonly id: string; readonly version?: string }
  | { readonly type: "fallback"; readonly id: string; readonly reason: string };

/** Snapshot agregado para el dashboard. */
export interface MetricsSnapshot {
  /** id de miniapp → total de mounts. */
  readonly mounts: Readonly<Record<string, number>>;
  /** razón de fallback → total. */
  readonly fallbacks: Readonly<Record<string, number>>;
}
