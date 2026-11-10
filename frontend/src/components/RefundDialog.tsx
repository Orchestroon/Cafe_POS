import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, NetworkError } from "../api/client";
import type { OrderDetail, RefundResult } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { newKey } from "../lib/uuid";
import { formatMoney } from "../i18n/format";
import { fieldError, TextField } from "./Form";
import { Modal } from "./Modal";
import { ErrorBanner } from "./States";

/** Full refund (D8/D9): allocated back to the original methods. The Idempotency-Key stays the same
 * until the server answers definitively, so a retry after a dropped connection cannot refund twice. */
export function RefundDialog({ order, onClose }: { order: OrderDetail; onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const cur = me?.settings.currency ?? "";
  const key = useRef(newKey());
  const [reason, setReason] = useState("");
  const [ref, setRef] = useState("");
  const [clientErr, setClientErr] = useState("");
  const hasCard = order.payments.some((p) => p.method === "card");
  const refund = useMutation({
    mutationFn: () => api.postIdempotent<RefundResult>(`/orders/${order.id}/refunds`, {
      reason: reason.trim(), confirm_amount: order.total, ...(hasCard && ref.trim() ? { card_external_reference: ref.trim() } : {}),
    }, key.current),
    onError: (e) => { if (!(e instanceof NetworkError)) key.current = newKey(); },
    onSuccess: () => {
      for (const k of ["order", "orders", "shift", "shifts"]) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  const submit = () => (reason.trim().length >= 3 ? (setClientErr(""), refund.mutate()) : setClientErr(t("orders.reasonRequired")));
  return (
    <Modal title={t("orders.refundTitle", { invoice: order.invoice_no })} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-danger" disabled={refund.isPending} onClick={submit}>{refund.error instanceof NetworkError ? t("pos.retry") : t("orders.refundConfirm")}</button>
    </>}>
      {refund.error instanceof NetworkError ? <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{t("orders.refundUnsure")}</div> : <ErrorBanner error={refund.error} />}
      <div className="totals" style={{ marginBottom: 12 }}>
        <div className="totals-row grand"><span>{t("orders.refundTotal")}</span><span>{formatMoney(order.total, cur)}</span></div>
        {order.payments.map((p) => <div className="totals-row" key={p.method}><span>{t("orders.refundTo", { method: t(`pos.tabs.${p.method}`) })}</span><span>{formatMoney(p.amount, cur)}</span></div>)}
      </div>
      <TextField label={t("orders.reason")} value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} error={clientErr || fieldError(refund.error, "reason")} />
      {hasCard && <TextField label={t("orders.cardRef")} value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} error={fieldError(refund.error, "card_external_reference")} />}
      <div className="alert-banner alert-neutral" style={{ marginBottom: 6 }}>
        {hasCard && <div>{t("orders.refundCardWarning")}</div>}
        {order.payments.some((p) => p.method === "cash") && <div>{t("orders.refundCashNote")}</div>}
        <div>{t("orders.refundStockWarning")}</div>
      </div>
    </Modal>
  );
}
