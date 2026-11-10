import { ApiError, NetworkError } from "../api/client";

/** May the request have been processed without us seeing the answer? Then the only safe move is
 * to resend it with the SAME Idempotency-Key (spec 10.2). Covers a dropped connection, a timeout,
 * and 5xx answers from a proxy (502/503/504 can arrive after the backend already committed). */
export function isUncertain(e: unknown): boolean {
  return e instanceof NetworkError || (e instanceof ApiError && e.status >= 500);
}

/** Automatic retries after the first attempt: 1 s, 2 s, 4 s, then the cashier taps Retry. */
export const RETRY_DELAYS_MS = [1000, 2000, 4000];
