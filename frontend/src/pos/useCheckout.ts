import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { api, ApiError } from "../api/client";
import type { CheckoutResult } from "../api/types";
import { newKey } from "../lib/uuid";
import { loadPending, savePending, type PendingCheckout } from "./cart";
import { isUncertain, RETRY_DELAYS_MS } from "./checkoutRules";

export type Phase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "unconfirmed" }
  | { kind: "priceChanged"; oldTotal: string; serverTotal: string }
  | { kind: "error"; error: unknown }
  | { kind: "done"; result: CheckoutResult };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The checkout reliability flow (spec 10.2). One unresolved sale at a time, per user; it is only
 * ever resent with its own key until the server gives a definitive answer. */
export function useCheckout(userId: string, onSold: () => void) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>(() => (loadPending(userId) ? { kind: "unconfirmed" } : { kind: "idle" }));
  const running = useRef(false);

  const run = async (p: PendingCheckout) => {
    if (running.current) return;
    running.current = true;
    setPhase({ kind: "checking" });
    try {
      for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
        try {
          const result = await api.postIdempotent<CheckoutResult>("/orders/checkout", p.payload, p.key);
          savePending(userId, null);
          onSold();
          setPhase({ kind: "done", result });
          void qc.invalidateQueries({ queryKey: ["shift"] });
          void qc.invalidateQueries({ queryKey: ["orders"] });
          return;
        } catch (e) {
          if (isUncertain(e)) {
            if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
            continue;
          }
          savePending(userId, null); // definitive answer: nothing was created, the key is spent
          if (e instanceof ApiError && e.code === "PRICE_CHANGED") {
            setPhase({ kind: "priceChanged", oldTotal: p.payload.expected_total, serverTotal: String((e.details as { server_total?: string }).server_total ?? "") });
            void qc.invalidateQueries({ queryKey: ["quote"] });
          } else setPhase({ kind: "error", error: e });
          return;
        }
      }
      setPhase({ kind: "unconfirmed" }); // still stored; Retry resends the same key
    } finally {
      running.current = false;
    }
  };

  /** Never a second key while a sale is unresolved (spec 10.2 rule 3). */
  const start = (payload: PendingCheckout["payload"]) => {
    if (loadPending(userId)) return setPhase({ kind: "unconfirmed" });
    const pending = { key: newKey(), payload };
    savePending(userId, pending);
    void run(pending);
  };
  const retry = () => {
    const p = loadPending(userId);
    if (p) void run(p);
    else setPhase({ kind: "idle" });
  };
  const busy = phase.kind === "checking" || phase.kind === "unconfirmed";
  return { phase, start, retry, busy, reset: () => setPhase({ kind: "idle" }) };
}
