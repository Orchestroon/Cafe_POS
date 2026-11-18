import type { PaperWidth } from "../api/types";

/** The print page rule for a paper width. It is rendered as an inline <style>, which the strict
 * Content-Security-Policy only allows by hash: ops/caddy/Caddyfile lists the sha256 of each of
 * these texts (receiptPage.test.ts keeps them in sync). Change a text here -> update the hash. */
export const pageRule = (w: PaperWidth) => (w === "a4" ? "@page { size: A4; margin: 12mm; }" : `@page { size: ${w} auto; margin: 2mm; }`);
