import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Navigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import {
  REPORT_NAMES, type PaymentBreakdown, type PurchasesExpenses, type ReportName, type SalesSummary, type ShiftsReport, type StockReport, type TopProducts,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { RangeBar, useRange, type RangeValue } from "../components/Range";
import { Stat } from "../components/Stat";
import { ErrorBanner, Loading } from "../components/States";
import { formatDateTime, formatMoney } from "../i18n/format";

/** /admin/reports/:name: one page per report with a local-date range (spec 10.6). */
export function Reports() {
  const { t } = useTranslation();
  const { name } = useParams();
  const [range, setRange] = useRange();
  if (!REPORT_NAMES.includes(name as ReportName)) return <Navigate to="/admin/reports/sales-summary" replace />;
  const n = name as ReportName;
  return (
    <>
      <PageHeader title={t("nav.reports")} />
      <div className="report-nav" role="tablist">
        {REPORT_NAMES.map((r) => <NavLink key={r} to={`/admin/reports/${r}`} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>{t(`reports.names.${r}`)}</NavLink>)}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        {n === "stock" ? <p className="form-hint">{t("reports.stockNote")}</p> : null}
        <RangeBar value={range} onChange={setRange} />
      </div>
      <Body name={n} range={range} />
    </>
  );
}

function useReport<T>(name: ReportName, range: RangeValue, extra: Record<string, string> = {}) {
  return useQuery({ queryKey: ["report", name, range, extra], queryFn: () => api.get<T>(`/reports/${name}`, { ...range, ...extra }), enabled: !!range.from && !!range.to });
}

function Body({ name, range }: { name: ReportName; range: RangeValue }) {
  switch (name) {
    case "sales-summary": return <SalesSummaryView range={range} />;
    case "payment-breakdown": return <PaymentView range={range} />;
    case "top-products": return <TopView range={range} />;
    case "stock": return <StockView range={range} />;
    case "purchases-expenses": return <PurchasesView range={range} />;
    case "shifts": return <ShiftsView range={range} />;
  }
}

function useCur() {
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  return { cur, tz: me?.settings.timezone ?? "UTC", m: (v: string) => formatMoney(v, cur) };
}

function State({ q, children }: { q: { isLoading: boolean; error: unknown }; children: React.ReactNode }) {
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBanner error={q.error} />;
  return <>{children}</>;
}

export function SalesSummaryCards({ d }: { d: SalesSummary }) {
  const { t } = useTranslation();
  const { m } = useCur();
  return (
    <div className="stat-grid">
      <Stat title={t("reports.orders")} value={d.orders_count} />
      <Stat title={t("reports.gross")} value={m(d.gross_sales)} />
      <Stat title={t("reports.discounts")} value={m(d.discounts)} />
      <Stat title={t("reports.tax")} value={m(d.tax)} />
      <Stat title={t("reports.collected")} value={m(d.collected)} />
      <Stat title={t("reports.refunds")} value={m(d.refunds)} meta={t("reports.refundedOrders", { count: d.refunded_orders_count })} />
      <Stat title={t("reports.net")} value={m(d.net_sales)} />
    </div>
  );
}

function SalesSummaryView({ range }: { range: RangeValue }) {
  const q = useReport<SalesSummary>("sales-summary", range);
  return <State q={q}>{q.data && <SalesSummaryCards d={q.data} />}</State>;
}

export function PaymentTable({ d }: { d: PaymentBreakdown }) {
  const { t } = useTranslation();
  const { m } = useCur();
  return (
    <div className="card table-scroll">
      <table className="erp-table">
        <thead><tr><th>{t("reports.method")}</th><th className="num">{t("reports.collected")}</th><th className="num">{t("reports.refunded")}</th><th className="num">{t("reports.net")}</th></tr></thead>
        <tbody>
          {(["cash", "card"] as const).map((k) => (
            <tr key={k}><td>{t(`pos.tabs.${k}`)}</td><td className="num">{m(d[`${k}_collected`])}</td><td className="num">{m(d[`${k}_refunded`])}</td><td className="num">{m(d[`${k}_net`])}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PaymentView({ range }: { range: RangeValue }) {
  const q = useReport<PaymentBreakdown>("payment-breakdown", range);
  return <State q={q}>{q.data && <PaymentTable d={q.data} />}</State>;
}

function TopView({ range }: { range: RangeValue }) {
  const { t } = useTranslation();
  const { m } = useCur();
  const [ordering, setOrdering] = useState("revenue");
  const q = useReport<TopProducts>("top-products", range, { ordering });
  return (
    <State q={q}>
      <div className="card">
        <div className="toolbar"><div className="form-group"><label className="form-label">{t("reports.sortBy")}
          <select className="form-select" value={ordering} onChange={(e) => setOrdering(e.target.value)}><option value="revenue">{t("reports.revenue")}</option><option value="qty">{t("reports.qtySold")}</option></select></label></div></div>
        {q.data?.products.length === 0 ? <p>{t("common.empty")}</p> : (
          <div className="table-scroll"><table className="erp-table">
            <thead><tr><th>{t("nav.products")}</th><th className="num">{t("reports.qtySold")}</th><th className="num">{t("reports.revenue")}</th></tr></thead>
            <tbody>{q.data?.products.map((p) => <tr key={p.variant_id}><td>{p.product_name_snapshot} · {p.variant_label_snapshot}</td><td className="num">{p.qty_sold}</td><td className="num">{m(p.net_revenue)}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="form-hint" style={{ marginTop: 8 }}>{t("reports.topNote")}</p>
      </div>
    </State>
  );
}

function StockView({ range }: { range: RangeValue }) {
  const { t } = useTranslation();
  const q = useReport<StockReport>("stock", range);
  return (
    <State q={q}>
      <div className="card table-scroll"><table className="erp-table">
        <thead><tr><th>{t("nav.ingredients")}</th><th className="num">{t("inventory.qty")}</th><th className="num">{t("ingredients.threshold")}</th><th className="num">{t("reports.consumed")}</th><th /></tr></thead>
        <tbody>{q.data?.ingredients.map((i) => (
          <tr key={i.ingredient_id} className={i.is_negative ? "row-negative" : i.is_low ? "row-low" : ""}>
            <td>{i.name}</td><td className="num mono">{i.balance} {i.unit}</td><td className="num mono">{i.threshold ?? "—"}</td><td className="num mono">{i.consumed_qty_period} {i.unit}</td>
            <td>{i.is_negative ? <span className="badge badge-danger">{t("inventory.negative")}</span> : i.is_low ? <span className="badge badge-pending">{t("inventory.low")}</span> : null}</td>
          </tr>
        ))}</tbody>
      </table></div>
    </State>
  );
}

function PurchasesView({ range }: { range: RangeValue }) {
  const { t } = useTranslation();
  const { m } = useCur();
  const q = useReport<PurchasesExpenses>("purchases-expenses", range);
  const d = q.data;
  return (
    <State q={q}>
      {d && (
        <>
          <div className="stat-grid">
            <Stat title={t("reports.purchaseTotal")} value={m(d.purchase_total)} />
            <Stat title={t("reports.generalTotal")} value={m(d.general_expenses_total)} />
            <Stat title={t("reports.drawerTotal")} value={m(d.cash_drawer_total)} />
            <Stat title={t("reports.externalTotal")} value={m(d.external_total)} />
          </div>
          <div className="card table-scroll"><table className="erp-table">
            <thead><tr><th>{t("expenses.category")}</th><th className="num">{t("expenses.amount")}</th></tr></thead>
            <tbody>{d.breakdown.map((b) => <tr key={b.category}><td>{t(`expenses.categories.${b.category}`)}</td><td className="num">{m(b.total)}</td></tr>)}</tbody>
          </table></div>
        </>
      )}
    </State>
  );
}

function ShiftsView({ range }: { range: RangeValue }) {
  const { t } = useTranslation();
  const { m, tz } = useCur();
  const q = useReport<ShiftsReport>("shifts", range);
  const d = q.data;
  return (
    <State q={q}>
      {d && (
        <>
          <div className="stat-grid">
            <Stat title={t("reports.shiftsCount")} value={d.shifts_count} meta={t("reports.openClosed", { open: d.open_count, closed: d.closed_count })} />
            <Stat title={t("shift.expectedCash")} value={m(d.expected_cash_total)} />
            <Stat title={t("shift.actualCash")} value={m(d.actual_cash_total)} />
            <Stat title={t("shift.difference")} value={m(d.total_difference)} alert={d.total_difference.startsWith("-")} />
          </div>
          <div className="card table-scroll"><table className="erp-table">
            <thead><tr><th>{t("shift.cashier")}</th><th>{t("shift.opened")}</th><th className="num">{t("shift.openingCash")}</th><th className="num">{t("shift.expectedCash")}</th><th className="num">{t("shift.actualCash")}</th><th className="num">{t("shift.difference")}</th><th className="num">{t("shift.orders")}</th><th /></tr></thead>
            <tbody>{d.shifts.map((s) => (
              <tr key={s.id}><td>{s.user.display_name}</td><td>{formatDateTime(s.opened_at, tz)}</td><td className="num">{m(s.opening_cash)}</td>
                <td className="num">{s.expected ? m(s.expected) : "—"}</td><td className="num">{s.actual ? m(s.actual) : "—"}</td>
                <td className={`num${s.difference?.startsWith("-") ? " text-negative" : ""}`}>{s.difference ? m(s.difference) : "—"}</td><td className="num">{s.orders_count}</td>
                <td><Link className="btn btn-outline btn-sm" to={`/shift/${s.id}`}>{t("shift.details")}</Link></td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </State>
  );
}
