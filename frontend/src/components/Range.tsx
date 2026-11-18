import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/AuthContext";
import { presetRange, type Preset } from "../lib/dateRange";

const PRESETS: Preset[] = ["today", "yesterday", "last7", "thisMonth"];

/** Today as a YYYY-MM-DD string in the café's time zone (report filters are local dates). */
export const localToday = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());

export interface RangeValue { from: string; to: string }

export function useRange(initial?: Partial<RangeValue>) {
  const { me } = useAuth();
  const today = localToday(me?.settings.timezone ?? "UTC");
  return useState<RangeValue>({ from: initial?.from ?? today, to: initial?.to ?? today });
}

export function RangeBar({ value, onChange, children }: { value: RangeValue; onChange: (v: RangeValue) => void; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const today = localToday(me?.settings.timezone ?? "UTC");
  return (
    <div className="toolbar">
      <div className="form-group"><label className="form-label">{t("common.from")}<input type="date" className="form-input" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} /></label></div>
      <div className="form-group"><label className="form-label">{t("common.to")}<input type="date" className="form-input" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} /></label></div>
      {PRESETS.map((k) => {
        const r = presetRange(today, k);
        const on = r.from === value.from && r.to === value.to;
        return <button key={k} className={`btn ${on ? "btn-primary" : "btn-outline"}`} aria-pressed={on} onClick={() => onChange(r)}>{t(`reports.presets.${k}`)}</button>;
      })}
      {children}
    </div>
  );
}
