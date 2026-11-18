import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, NetworkError } from "../api/client";
import type { PayMethod, PaySource, Purchase, SupplierPayment } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { formatMoney } from "../i18n/format";
import { addMoney, cmpMoney, isDec, normMoney } from "../lib/decimal";
import { newKey } from "../lib/uuid";
import { Field, fieldError, TextField } from "./Form";
import { Modal } from "./Modal";
import { ErrorBanner, Loading } from "./States";

/** Sprint 5 P4: pay a supplier for purchases bought on credit, in full or in part, from the drawer
 * (your open shift) or from outside. One Idempotency-Key per attempt, kept on a network error. */
export function PaySupplierDialog({ supplier, preselect, onClose }: { supplier: { id: string; name: string }; preselect?: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const cur = me?.settings.currency ?? "";
  const owed = useQuery({ queryKey: ["purchases", "owed", supplier.id], queryFn: () => api.all<Purchase>("/purchases", { supplier_id: supplier.id, owed: true }) });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [source, setSource] = useState<PaySource>("external");
  const [method, setMethod] = useState<PayMethod>("transfer");
  const [note, setNote] = useState("");
  const [clientErr, setClientErr] = useState("");
  const key = useRef(newKey());
  const value = (p: Purchase) => amounts[p.id] ?? (p.id === preselect ? p.owed : "");
  const lines = (owed.data ?? []).filter((p) => value(p).trim() !== "").map((p) => ({ p, amount: value(p).trim() }));
  const total = lines.reduce((s, l) => (isDec(l.amount, 2) ? addMoney(s, l.amount) : s), "0.00");
  const pay = useMutation({
    mutationFn: () => api.postIdempotent<SupplierPayment>("/supplier-payments", {
      supplier_id: supplier.id, source, payment_method: source === "cash_drawer" ? "cash" : method, note: note.trim(),
      lines: lines.map((l) => ({ purchase_id: l.p.id, amount: normMoney(l.amount) })),
    }, key.current),
    onError: (e) => { if (!(e instanceof NetworkError)) key.current = newKey(); },
    onSuccess: () => {
      for (const k of ["suppliers", "purchases", "purchase", "supplier-payments", "expenses", "shift", "report"]) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  const submit = () => {
    if (!lines.length) return setClientErr(t("suppliers.payNothing"));
    if (lines.some((l) => !isDec(l.amount, 2) || cmpMoney(l.amount, "0") <= 0 || cmpMoney(l.amount, l.p.owed) > 0)) return setClientErr(t("suppliers.payInvalid"));
    setClientErr("");
    pay.mutate();
  };
  return (
    <Modal title={t("suppliers.payTitle", { name: supplier.name })} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-primary" disabled={pay.isPending} onClick={submit}>{pay.error instanceof NetworkError ? t("pos.retry") : t("suppliers.payConfirm", { amount: formatMoney(total, cur) })}</button>
    </>}>
      {pay.error instanceof NetworkError ? <div className="alert-banner alert-error" role="alert" style={{ marginBottom: 12 }}>{t("suppliers.payUnsure")}</div> : <ErrorBanner error={pay.error} />}
      {clientErr && <div className="alert-banner alert-error" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      {owed.isLoading ? <Loading /> : (owed.data ?? []).length === 0 ? <p>{t("suppliers.nothingOwed")}</p> : (
        <div className="table-scroll" style={{ marginBottom: 12 }}>
          <table className="erp-table">
            <thead><tr><th>{t("common.date")}</th><th>{t("purchases.receiptNo")}</th><th className="num">{t("suppliers.owed")}</th><th className="num">{t("suppliers.payNow")}</th></tr></thead>
            <tbody>{owed.data?.map((p) => (
              <tr key={p.id}><td>{p.purchased_on}</td><td>{[p.receipt_no, p.supplier_invoice_no].filter(Boolean).join(" · ") || "—"}</td><td className="num">{formatMoney(p.owed, cur)}</td>
                <td><div className="inline-pair">
                  <input aria-label={t("suppliers.payNow")} className="form-input inline-input num" inputMode="decimal" value={value(p)} onChange={(e) => setAmounts({ ...amounts, [p.id]: e.target.value })} />
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setAmounts({ ...amounts, [p.id]: p.owed })}>{t("suppliers.all")}</button>
                </div></td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="form-grid">
        <Field label={t("expenses.source")} hint={source === "cash_drawer" ? t("purchases.drawerNote") : undefined}>
          <select className="form-select" value={source} onChange={(e) => setSource(e.target.value as PaySource)}>
            <option value="external">{t("expenses.sources.external")}</option><option value="cash_drawer">{t("expenses.sources.cash_drawer")}</option>
          </select>
        </Field>
        {source === "external" && (
          <Field label={t("expenses.method")}>
            <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
              {(["cash", "card", "transfer"] as const).map((m) => <option key={m} value={m}>{t(`expenses.methods.${m}`)}</option>)}
            </select>
          </Field>
        )}
      </div>
      <TextField label={t("suppliers.notes")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} error={fieldError(pay.error, "note")} />
    </Modal>
  );
}

/** The supplier's payments, newest first; an Admin can void one (reason required). */
export function SupplierPaymentsDialog({ supplier, onClose }: { supplier: { id: string; name: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const cur = me?.settings.currency ?? "";
  const q = useQuery({ queryKey: ["supplier-payments", supplier.id], queryFn: () => api.all<SupplierPayment>("/supplier-payments", { supplier_id: supplier.id }) });
  const [voiding, setVoiding] = useState<SupplierPayment | null>(null);
  const [reason, setReason] = useState("");
  const v = useMutation({
    mutationFn: () => api.post(`/supplier-payments/${voiding!.id}/void`, { reason: reason.trim() }),
    onSuccess: () => {
      for (const k of ["suppliers", "purchases", "purchase", "supplier-payments", "expenses", "shift", "report"]) void qc.invalidateQueries({ queryKey: [k] });
      setVoiding(null); setReason("");
    },
  });
  return (
    <Modal title={t("suppliers.paymentsTitle", { name: supplier.name })} onClose={onClose} footer={<button className="btn btn-outline" onClick={onClose}>{t("common.close")}</button>}>
      {q.isLoading ? <Loading /> : (q.data ?? []).length === 0 ? <p>{t("common.empty")}</p> : (
        <div className="table-scroll">
          <table className="erp-table">
            <thead><tr><th>{t("common.date")}</th><th className="num">{t("expenses.amount")}</th><th>{t("expenses.source")}</th><th>{t("purchases.receiptNo")}</th><th /></tr></thead>
            <tbody>{q.data?.map((p) => (
              <tr key={p.id} className={p.status === "voided" ? "row-voided" : ""}>
                <td>{p.paid_at.slice(0, 10)}</td><td className="num">{formatMoney(p.amount, cur)}</td>
                <td>{t(`expenses.sources.${p.source}`)} · {t(`expenses.methods.${p.payment_method}`)}{p.status === "voided" && <div className="form-hint">{t("expenses.voidedBecause", { reason: p.void_reason })}</div>}</td>
                <td>{p.lines.map((l) => l.receipt_no || l.supplier_invoice_no || l.purchased_on).join(t("audit.listSep"))}</td>
                <td>{p.status === "posted" && <button className="btn btn-outline btn-sm" onClick={() => setVoiding(p)}>{t("expenses.void")}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {voiding && (
        <div className="card" style={{ marginTop: 12 }}>
          <p className="form-hint">{t("suppliers.voidNote", { amount: formatMoney(voiding.amount, cur) })}</p>
          <ErrorBanner error={v.error} />
          <TextField label={t("orders.reason")} autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-outline" onClick={() => setVoiding(null)}>{t("common.cancel")}</button>
            <button className="btn btn-danger" disabled={v.isPending || !reason.trim()} onClick={() => v.mutate()}>{t("expenses.void")}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
