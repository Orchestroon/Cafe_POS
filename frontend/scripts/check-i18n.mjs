// i18n coverage check (Sprint 4, spec 5.8). Fails when:
//  1. en.json and ar.json do not have exactly the same keys;
//  2. an Arabic value is empty (owner decision 2026-11-10: Arabic is filled in Sprint 4);
//  3. the code uses a t("…") key that does not exist in en.json;
//  4. a {{placeholder}} in English is missing from the Arabic text.
// Keys never referenced in the code are listed as warnings (dynamic keys make this a hint only).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("../src/", import.meta.url).pathname;
const en = JSON.parse(readFileSync(join(root, "i18n/en.json"), "utf8"));
const ar = JSON.parse(readFileSync(join(root, "i18n/ar.json"), "utf8"));

const flat = (o, p = "") =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === "object" ? flat(v, `${p}${k}.`) : [[`${p}${k}`, v]]));
const E = new Map(flat(en));
const A = new Map(flat(ar));
const errors = [];

// Plurals: English has _one/_other; Arabic needs all six forms (i18next CLDR rules for "ar").
const AR_FORMS = ["_zero", "_one", "_two", "_few", "_many", "_other"];
const pluralBases = new Set([...E.keys()].filter((k) => k.endsWith("_other")).map((k) => k.slice(0, -6)));
const pluralBase = (k) => [...pluralBases].find((b) => AR_FORMS.some((f) => k === b + f));
for (const k of E.keys()) if (!A.has(k)) errors.push(`missing in ar.json: ${k}`);
for (const b of pluralBases) for (const f of AR_FORMS) if (!A.has(b + f)) errors.push(`missing Arabic plural form: ${b + f}`);
for (const k of A.keys()) if (!E.has(k) && !pluralBase(k)) errors.push(`only in ar.json (remove it): ${k}`);
for (const [k, v] of A) if (String(v).trim() === "") errors.push(`empty Arabic text: ${k}`);
const vars = (s) => new Set([...String(s).matchAll(/{{\s*(\w+)\s*}}/g)].map((m) => m[1]));
for (const [k, v] of E) {
  if (!A.get(k)) continue;
  // "one", "two" and "zero" forms may spell the number out instead of using {{count}}.
  const a = vars(A.get(k));
  for (const x of vars(v)) if (!a.has(x) && !(x === "count" && /_(zero|one|two)$/.test(k))) errors.push(`Arabic text of ${k} lacks {{${x}}}`);
}
for (const b of pluralBases) for (const f of ["_few", "_many", "_other"]) {
  if (A.get(b + f) && !vars(A.get(b + f)).has("count")) errors.push(`Arabic text of ${b + f} lacks {{count}}`);
}

// Keys used in code: t("a.b") and t(`a.${x}`) (the latter checks the prefix exists).
const files = [];
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f) && !/\.test\.ts$/.test(f)) files.push(p);
  }
};
walk(root);
const PLURAL = ["_zero", "_one", "_two", "_few", "_many", "_other"];
const exists = (k) => E.has(k) || PLURAL.some((s) => E.has(k + s));
const prefixes = new Set();
const used = new Set();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bt\(\s*"([\w.]+)"/g)) {
    used.add(m[1]);
    if (!exists(m[1])) errors.push(`${f.replace(root, "src/")}: unknown key "${m[1]}"`);
  }
  for (const m of src.matchAll(/\bt\(\s*`([\w.]*)\$\{/g)) {
    const pre = m[1];
    prefixes.add(pre);
    if (![...E.keys()].some((k) => k.startsWith(pre))) errors.push(`${f.replace(root, "src/")}: no keys under "${pre}"`);
  }
}
const unused = [...E.keys()].filter((k) => {
  const base = k.replace(/_(zero|one|two|few|many|other)$/, "");
  return !used.has(k) && !used.has(base) && ![...prefixes].some((p) => k.startsWith(p));
});

if (unused.length) console.warn(`warning: ${unused.length} key(s) not referenced directly:\n  ${unused.join("\n  ")}`);
if (errors.length) {
  console.error(`i18n check failed (${errors.length}):\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log(`i18n check passed: ${E.size} keys, en/ar in sync, ${used.size} used keys exist.`);
