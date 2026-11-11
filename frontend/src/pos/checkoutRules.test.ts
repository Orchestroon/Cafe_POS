import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "../api/client";
import { isUncertain, RETRY_DELAYS_MS } from "./checkoutRules";

// Sprint 2 audit H2: an answer we did not see may already be committed, so it is resent with the
// SAME key; a definite answer (4xx) never is.
describe("checkout retry rules", () => {
  it("treats network errors, timeouts and proxy 5xx as uncertain", () => {
    expect(isUncertain(new NetworkError("network"))).toBe(true);
    for (const s of [500, 502, 503, 504]) expect(isUncertain(new ApiError("UNKNOWN", "x", s, {}))).toBe(true);
  });
  it("treats every 4xx as a definite answer", () => {
    for (const s of [400, 401, 403, 404, 409, 422]) expect(isUncertain(new ApiError("X", "x", s, {}))).toBe(false);
  });
  it("treats unknown errors as definite (no blind resend)", () => {
    expect(isUncertain(new Error("boom"))).toBe(false);
    expect(isUncertain(undefined)).toBe(false);
  });
  it("backs off 1 s, 2 s, 4 s", () => {
    expect(RETRY_DELAYS_MS).toEqual([1000, 2000, 4000]);
  });
});
