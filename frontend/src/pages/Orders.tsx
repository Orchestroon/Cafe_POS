import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { OrderSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { ListState, Pager } from "../components/Table";
import { formatDateTime, formatMoney } from "../i18n/format";

export function Orders() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const nav = useNavigate();
  const admin = me?.user.role === "admin";
  const [page, setPage] = useState(1);
  const [invoice, setInvoice] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const params = { page, invoice_no: invoice.trim(), status, ...(admin ? { from, to } : {}) };
  const q = useQuery({ queryKey: ["orders", params], queryFn: () => api.list<OrderSummary>("/orders", params) });
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  return (
    <>
      <PageHeader title={t("nav.orders")} subtitle={admin ? undefined : t("orders.baristaNote")} />
      <div className="card">
        <div className="toolbar">
          <div className="form-group"><label className="form-label">{t("orders.invoiceSearch")}<input className="form-input" value={invoice} onChange={(e) => reset(setInvoice)(e.target.value)} placeholder="POS-0000001" /></label></div>
          {admin && <div className="form-group"><label className="form-label">{t("common.from")}<input className="form-input" type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} /></label></div>}
          {admin && <div className="form-group"><label className="form-label">{t("common.to")}<input className="form-input" type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} /></label></div>}
          <div className="form-group"><label className="form-label">{t("common.status")}
            <select className="form-select" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
              <option value="">{t("common.all")}</option><option value="paid">{t("orders.paid")}</option><option value="refunded">{t("orders.refunded")}</option>
            </select></label></div>
        </div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("pos.invoice")}</th><th>{t("receipt.date")}</th><th>{t("receipt.cashier")}</th><th className="num">{t("orders.items")}</th><th>{t("orders.payment")}</th><th className="num">{t("pos.total")}</th><th>{t("common.status")}</th></tr></thead>
            <tbody>
              {q.data?.data.map((o) => (
                <tr key={o.id} className="clickable" tabIndex={0} onClick={() => nav(`/orders/${o.id}`)} onKeyDown={(e) => e.key === "Enter" && nav(`/orders/${o.id}`)}>
                  <td className="mono">{o.invoice_no}</td><td>{formatDateTime(o.created_at, tz)}</td><td>{o.cashier.display_name}</td>
                  <td className="num">{o.items_count}</td><td>{o.payment_methods.map((m) => t(`pos.tabs.${m}`)).join(" + ")}</td>
                  <td className="num">{formatMoney(o.total, cur)}</td>
                  <td><span className={`badge ${o.status === "paid" ? "badge-active" : "badge-danger"}`}>{t(`orders.${o.status}`)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
        <Pager meta={q.data?.meta} page={page} onPage={setPage} />
      </div>
    </>
  );
}
