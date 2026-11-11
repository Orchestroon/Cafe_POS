import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { OrderDetail } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { RefundDialog } from "../components/RefundDialog";
import { PageHeader } from "../components/PageHeader";
import { HistoryLink } from "./AuditLog";
import { ErrorBanner, Loading } from "../components/States";
import { formatDateTime, formatMoney } from "../i18n/format";

export function OrderDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const { me } = useAuth();
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  const [refunding, setRefunding] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBanner error={q.error} />;
  const o = q.data;
  return (
    <>
      <PageHeader title={o.invoice_no} subtitle={`${formatDateTime(o.created_at, tz)} · ${o.cashier.display_name}`} actions={<>
        <Link className="btn btn-outline" to="/orders">{t("orders.back")}</Link>
        <HistoryLink entityType="sales.order" entityId={o.id} />
        {o.status === "paid" && <button className="btn btn-danger" onClick={() => setRefunding(true)}>{t("orders.refund")}</button>}
        <Link className="btn btn-primary" to={`/orders/${o.id}/receipt?reprint=1`}>{t("orders.reprint")}</Link>
      </>} />
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">{t("orders.items")}</div><span className={`badge ${o.status === "paid" ? "badge-active" : "badge-danger"}`}>{t(`orders.${o.status}`)}</span></div>
        <div className="table-scroll">
          <table className="erp-table">
            <thead><tr><th>{t("common.name")}</th><th className="num">{t("pos.quantity")}</th><th className="num">{t("products.price")}</th><th className="num">{t("pos.total")}</th></tr></thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id}>
                  <td>{i.product_name} · {i.variant_label}{i.modifiers.length > 0 && <div className="form-hint">{i.modifiers.map((m) => m.option_label).join(", ")}</div>}</td>
                  <td className="num">{i.quantity}</td><td className="num">{formatMoney(i.unit_price, cur)}</td><td className="num">{formatMoney(i.line_total, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals" style={{ marginTop: 12 }}>
          <div className="totals-row"><span>{t("pos.subtotal")}</span><span>{formatMoney(o.subtotal, cur)}</span></div>
          {o.tax.enabled && <div className="totals-row"><span>{o.tax.label} {o.tax.rate}%</span><span>{formatMoney(o.tax_total, cur)}</span></div>}
          <div className="totals-row grand"><span>{t("pos.total")}</span><span>{formatMoney(o.total, cur)}</span></div>
        </div>
      </div>
      {o.refund && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-header"><div className="card-title">{t("orders.refundInfo")}</div><span className="badge badge-danger">{t("orders.refunded")}</span></div>
          <div className="form-hint" style={{ marginBottom: 8 }}>{formatDateTime(o.refund.created_at, tz)} · {o.refund.actor.display_name}</div>
          <div style={{ marginBottom: 8 }}>{t("orders.reason")}: {o.refund.reason}</div>
          {o.refund.lines.map((l) => (
            <div className="totals-row" key={l.method}><span>{t("orders.refundTo", { method: t(`pos.tabs.${l.method}`) })}{l.external_reference ? ` · ${l.external_reference}` : ""}</span><span>{formatMoney(l.amount, cur)}</span></div>
          ))}
          {o.refund.lines.some((l) => l.method === "card") && <div className="form-hint">{t("orders.refundCardWarning")}</div>}
          <div className="form-hint">{t("orders.refundStockWarning")}</div>
        </div>
      )}
      <div className="card">
        <div className="card-header"><div className="card-title">{t("orders.payment")}</div></div>
        {o.payments.map((p) => (
          <div className="totals-row" key={p.method}>
            <span>{t(`pos.tabs.${p.method}`)}{p.external_reference ? ` · ${p.external_reference}` : ""}</span>
            <span>{formatMoney(p.amount, cur)}{p.method === "cash" && p.change_given && p.change_given !== "0.00" ? ` (${t("pos.change")} ${p.change_given})` : ""}</span>
          </div>
        ))}
      </div>
      {refunding && <RefundDialog order={o} onClose={() => setRefunding(false)} />}
    </>
  );
}
