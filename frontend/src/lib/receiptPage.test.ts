import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAPER_WIDTHS } from "../api/types";
import { pageRule } from "./receiptPage";

// The production CSP (ops/caddy/Caddyfile) allows the receipt page's inline <style> only by hash.
// A paper width whose hash is missing would print at the wrong size in production.
const file = new URL("../../../ops/caddy/Caddyfile", import.meta.url);
const here = existsSync(file); // the frontend-only dev container does not mount ops/
const caddy = here ? readFileSync(file, "utf8") : "";
const hash = (s: string) => `'sha256-${createHash("sha256").update(s).digest("base64")}'`;

describe.skipIf(!here)("receipt @page rules and the CSP", () => {
  it.each(PAPER_WIDTHS)("the Caddyfile allows the %s page rule", (w) => {
    expect(caddy).toContain(hash(pageRule(w)));
  });
  it("no unsafe-inline for styles", () => {
    expect(caddy).not.toMatch(/style-src[^;"]*unsafe-inline/);
  });
});
