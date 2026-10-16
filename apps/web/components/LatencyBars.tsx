import type { DashboardView } from "@/lib/dashboard";
import { formatSeconds, STEP_COPY } from "@/lib/ui/labels";

// Barra = mediana; traço = p95. Escala comum: o maior p95 ocupa a largura toda.
export function LatencyBars({ rows }: { rows: DashboardView["latency"] }) {
  const max = Math.max(1, ...rows.map((r) => r.p95Ms ?? 0));
  return (
    <ul className="latency">
      {rows.map((r) => (
        <li key={r.name} data-testid="dash-latency-row">
          <span className="latency-label">{STEP_COPY[r.name].title}</span>
          <svg viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true" focusable="false">
            <rect className="latency-track" x="0" y="3" width="100" height="4" />
            {r.p50Ms !== null && <rect className="latency-bar" x="0" y="3" width={(r.p50Ms / max) * 100} height="4" />}
            {r.p95Ms !== null && <rect className="latency-p95" x={Math.min(99.4, (r.p95Ms / max) * 100)} y="1" width="0.6" height="8" />}
          </svg>
          <span className="latency-values small">
            {r.p50Ms === null || r.p95Ms === null
              ? "sem dados"
              : `mediana ${formatSeconds(r.p50Ms)} · p95 ${formatSeconds(r.p95Ms)} · ${r.samples} amostras`}
          </span>
        </li>
      ))}
    </ul>
  );
}
