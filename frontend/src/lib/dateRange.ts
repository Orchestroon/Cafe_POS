// Report date presets (Step 3). Pure string math on YYYY-MM-DD in UTC, so the browser's time zone
// and DST never move a date; "today" itself comes from the café's time zone (localToday).
export type Preset = "today" | "yesterday" | "last7" | "thisMonth";
export interface DateRange { from: string; to: string }

const MS = 86400000;
const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
const fmt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => fmt(parse(d) + n * MS);

/** last7 = today and the 6 days before it; thisMonth = the 1st through today (the future is empty). */
export function presetRange(today: string, kind: Preset): DateRange {
  switch (kind) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
    case "last7": return { from: addDays(today, -6), to: today };
    case "thisMonth": return { from: `${today.slice(0, 8)}01`, to: today };
  }
}
