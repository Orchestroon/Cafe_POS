import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, NetworkError } from "../api/client";
import type { CashMovement } from "../api/types";
import { isDecimal, TextField } from "./Form";
import { Modal } from "./Modal";
import { ErrorBanner } from "./States";
import { newKey } from "../lib/uuid";

/** Cash taken out of / put into my own drawer (e.g. to the safe, change from the owner). It changes
 * expected cash only; it is not an expense. One Idempotency-Key per attempt, kept on a network error. */
export function CashMoveDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [kind, setKind] = useState<"out" | "in">("out");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [clientErr, setClientErr] = useState("");
  const key = useRef(newKey());
  const save = useMutation({
    mutationFn: () => api.postIdempotent<CashMovement>("/shifts/current/cash-movements", { kind, amount: amount.trim(), reason: reason.trim() }, key.current),
    onError: (e) => { if (!(e instanceof NetworkError)) key.current = newKey(); },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["shift"] }); onClose(); },
  });
  const submit = () => {
    if (!isDecimal(amount, 2) || Number(amount) <= 0) return setClientErr(t("expenses.amountInvalid"));
    if (!reason.trim()) return setClientErr(t("cash.reasonRequired"));
    setClientErr("");
    save.mutate();
  };
  return (
    <Modal title={t("cash.title")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{save.error instanceof NetworkError ? t("pos.retry") : t("common.save")}</button>
    </>}>
      <p className="form-hint" style={{ marginBottom: 10 }}>{t("cash.note")}</p>
      <ErrorBanner error={save.error} />
      {clientErr && <div className="alert-banner alert-error" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      <div role="radiogroup" aria-label={t("cash.title")} style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {(["out", "in"] as const).map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`btn ${kind === k ? "btn-primary" : "btn-outline"}`} onClick={() => setKind(k)}>{t(`cash.${k}`)}</button>
        ))}
      </div>
      <TextField label={t("expenses.amount")} inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
      <TextField label={t("cash.reason")} placeholder={t(kind === "out" ? "cash.reasonOut" : "cash.reasonIn")} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}

/** Admin: cancel a cash movement of a still-open shift, with a reason. */
export function VoidCashMoveDialog({ move, onClose }: { move: CashMovement; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [clientErr, setClientErr] = useState("");
  const v = useMutation({
    mutationFn: () => api.post<CashMovement>(`/cash-movements/${move.id}/void`, { reason: reason.trim() }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["shift"] }); onClose(); },
  });
  return (
    <Modal title={t("cash.voidTitle")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-primary" disabled={v.isPending} onClick={() => (reason.trim() ? (setClientErr(""), v.mutate()) : setClientErr(t("cash.reasonRequired")))}>{t("cash.voidConfirm")}</button>
    </>}>
      <p style={{ marginBottom: 10 }}>{t("cash.voidWhat", { kind: t(`cash.${move.kind}`), amount: move.amount, reason: move.reason })}</p>
      <ErrorBanner error={v.error} />
      <TextField label={t("cash.reason")} autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} error={clientErr} />
    </Modal>
  );
}
