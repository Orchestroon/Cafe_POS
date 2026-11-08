import type { InputHTMLAttributes, ReactNode } from "react";
import { ApiError } from "../api/client";

export const fieldError = (err: unknown, name: string) => {
  const v = err instanceof ApiError ? err.details.fields?.[name] : undefined;
  return Array.isArray(v) ? v.join(" ") : v;
};

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="form-group">
      <label className="form-label">{label}{children}</label>
      {hint && <div className="form-hint">{hint}</div>}
      {error && <div className="field-error" role="alert">{error}</div>}
    </div>
  );
}

export function TextField({ label, error, hint, ...p }: { label: string; error?: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return <Field label={label} error={error} hint={hint}><input className="form-input" {...p} /></Field>;
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="check-row">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

/** Decimal-string input: keeps the raw string (never parsed to a float). */
export const isDecimal = (s: string, dp: number, signed = false) =>
  new RegExp(`^${signed ? "-?" : ""}\\d+(\\.\\d{1,${dp}})?$`).test(s.trim());
