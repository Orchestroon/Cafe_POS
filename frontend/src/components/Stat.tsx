import type { ReactNode } from "react";

export function Stat({ title, value, meta, alert }: { title: string; value: ReactNode; meta?: string; alert?: boolean }) {
  return (
    <div className="metric-card">
      <div className="metric-title">{title}</div>
      <div className="metric-value">{value}</div>
      {meta && <div className={`metric-meta${alert ? " alert" : ""}`}>{meta}</div>}
    </div>
  );
}
