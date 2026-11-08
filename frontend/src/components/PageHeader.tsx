import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="view-header">
      <div className="view-titles"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
      {actions && <div className="view-actions">{actions}</div>}
    </div>
  );
}
