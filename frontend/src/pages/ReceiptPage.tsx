import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import { PAPER_WIDTHS, paperLabel, type PaperWidth, type Receipt } from "../api/types";
import { ErrorBanner, Loading } from "../components/States";
import { formatDateTime } from "../i18n/format";

const KEY = "receipt.width";
// Per-device choice (spec 10.3). localStorage may be unavailable, so every access is guarded.
const readWidth = (): PaperWidth | null => {
  try {
    const v = localStorage.getItem(KEY);
    return PAPER_WIDTHS.find((w) => w === v) ?? null;
  } catch {
    return null;
  }
};
const saveWidth = (w: PaperWidth) => {
  try {
    localStorage.setItem(KEY, w);
  } catch {
    /* the choice just won't persist */
  }
};
const pageRule = (w: PaperWidth) => (w === "a4" ? "@page { size: A4; margin: 12mm; }" : `@page { size: ${w} auto; margin: 2mm; }`);

export function ReceiptPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const [params] = useSearchParams();
  const reprint = params.get("reprint") === "1";
  const q = useQuery({ queryKey: ["receipt", id], queryFn: () => api.get<Receipt>(`/orders/${id}/receipt`) });
  const [device, setDevice] = useState<PaperWidth | null>(readWidth);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <div style={{ padding: 16 }}><ErrorBanner error={q.error} /><Link to="/orders">{t("orders.back")}</Link></div>;
  const r = q.data;
  const width = device ?? r.paper_width; // this device's printer, else the Settings default
  const money = (a: string) => a;
  return (
    <div className="receipt-page">
      <style>{pageRule(width)}</style>
      <div className="receipt-toolbar">
        <Link className="btn btn-outline" to={`/orders/${id}`}>{t("orders.back")}</Link>
        <label className="form-label" style={{ margin: 0 }}>{t("receipt.paper")}
          <select className="form-select" value={width} onChange={(e) => { const w = e.target.value as PaperWidth; saveWidth(w); setDevice(w); }}>
            {PAPER_WIDTHS.map((w) => <option key={w} value={w}>{paperLabel(w)}</option>)}
          </select>
        </label>
        <button className="btn btn-primary" onClick={() => window.print()}>{t("receipt.print")}</button>
      </div>
      <div className="receipt" data-width={width}>
        {r.status === "refunded" && <div className="receipt-banner">{t("receipt.refunded")}</div>}
        {reprint && <div className="receipt-banner small">{t("receipt.reprint")}</div>}
        <div className="receipt-center">
          <strong className="receipt-title">{r.business.name}</strong>
          {r.business.header && <div className="receipt-pre">{r.business.header}</div>}
          {r.business.tax_registration_number && <div>{t("settings.taxNumber")}: {r.business.tax_registration_number}</div>}
        </div>
        <div className="receipt-rule" />
        <div className="receipt-row"><span>{t("pos.invoice")}</span><span>{r.invoice_no}</span></div>
        <div className="receipt-row"><span>{t("receipt.date")}</span><span>{formatDateTime(r.created_at, r.timezone)}</span></div>
        <div className="receipt-row"><span>{t("receipt.cashier")}</span><span>{r.cashier}</span></div>
        <div className="receipt-rule" />
        {r.items.map((i, n) => (
          <div key={n} className="receipt-item">
            <div className="receipt-row"><span>{i.quantity} × {i.name} ({i.variant})</span><span>{money(i.line_total)}</span></div>
            {i.modifiers.map((m) => <div key={m} className="receipt-mod">+ {m}</div>)}
          </div>
        ))}
        <div className="receipt-rule" />
        <div className="receipt-row"><span>{t("pos.subtotal")}</span><span>{money(r.subtotal)}</span></div>
        {r.discount_total !== "0.00" && <div className="receipt-row"><span>{t("receipt.discount")}</span><span>-{money(r.discount_total)}</span></div>}
        {r.tax.enabled && <div className="receipt-row"><span>{r.tax.label} {r.tax.rate}%{r.tax.inclusive ? ` (${t("pos.included")})` : ""}</span><span>{money(r.tax.amount)}</span></div>}
        <div className="receipt-row receipt-total"><span>{t("pos.total")}</span><span>{money(r.total)} {r.currency}</span></div>
        <div className="receipt-rule" />
        {r.payments.map((p) => (
          <div key={p.method}>
            <div className="receipt-row"><span>{t(`pos.tabs.${p.method}`)}</span><span>{money(p.amount)}</span></div>
            {p.method === "cash" && p.cash_tendered && p.change_given !== "0.00" && (
              <>
                <div className="receipt-row small"><span>{t("pos.tendered")}</span><span>{money(p.cash_tendered)}</span></div>
                <div className="receipt-row small"><span>{t("pos.change")}</span><span>{money(p.change_given ?? "0.00")}</span></div>
              </>
            )}
            {p.method === "card" && p.external_reference && <div className="receipt-row small"><span>{t("pos.reference")}</span><span>{p.external_reference}</span></div>}
          </div>
        ))}
        {r.business.footer && <><div className="receipt-rule" /><div className="receipt-center receipt-pre">{r.business.footer}</div></>}
      </div>
    </div>
  );
}
