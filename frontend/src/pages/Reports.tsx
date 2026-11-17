import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, NavLink, Navigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import {
  MONEY_METHODS, REPORT_NAMES, type MoneyInOut, type MoneyRow, type PaymentBreakdown, type ProfitReport, type PurchasesExpenses, type ReportName,
  type SalesSummary, type ShiftsReport, type StockReport, type TopProducts,
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
  if (!REPORT_NAMES.includes(name as ReportName)) return <Navigate to="/admin/reports/money-in-out" replace />;
  const n = name as ReportName;
  return (
    <>
      <PageHeader title={t("nav.reports")} />
      <div className="report-nav" role="tablist">
        {REPORT_NAMES.map((r) => <NavLink key={r} to={`/admin/reports/${r}`} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>{t(`reports.names.${r}`)}</NavLink>)}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        {n === "stock" ? <p className="form-hint">{t("reports.stockNote")}</p> : null}
        {n === "money-in-out" || n === "profit" ? <p className="form-hint">{t(`reports.notes.${n}`)}</p> : null}
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
    case "money-in-out": return <MoneyView range={range} />;
    case "profit": return <ProfitView range={range} />;
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
            <thead><tr><th>{t("nav.products")}</th><th className="num">{t("reports.qtySold")}</th><th className="num">{t("reports.qtyRefunded")}</th><th className="num">{t("reports.revenue")}</th></tr></thead>
            <tbody>{q.data?.products.map((p) => <tr key={p.variant_id}><td>{p.product_name_snapshot} · {p.variant_label_snapshot}</td><td className="num">{p.qty_sold}</td><td className="num">{p.qty_refunded || "—"}</td><td className="num">{m(p.net_revenue)}</td></tr>)}</tbody>
          </table></div>
        )}
        <p className="form-hint" style={{ marginTop: 8 }}>{t("reports.topNote")}</p>
      </div>
    </State>
  );
}

function StockView({ range }: { range: RangeValue }) {
  const { t } = useTranslation();
  const { m } = useCur();
  const q = useReport<StockReport>("stock", range);
  const d = q.data;
  return (
    <State q={q}>
      {d && (
        <div className="stat-grid">
          <Stat title={t("reports.stockValue")} value={m(d.stock_value)} meta={d.without_cost_count ? t("reports.withoutCost", { count: d.without_cost_count }) : undefined} alert={d.without_cost_count > 0} />
        </div>
      )}
      <div className="card table-scroll"><table className="erp-table">
        <thead><tr><th>{t("nav.ingredients")}</th><th className="num">{t("inventory.qty")}</th><th className="num">{t("ingredients.threshold")}</th><th className="num">{t("reports.consumed")}</th><th className="num">{t("reports.avgCost")}</th><th className="num">{t("reports.value")}</th><th /></tr></thead>
        <tbody>{d?.ingredients.map((i) => (
          <tr key={i.ingredient_id} className={i.is_negative ? "row-negative" : i.is_low ? "row-low" : ""}>
            <td>{i.name}{!i.is_active && <span className="badge badge-off" style={{ marginInlineStart: 6 }}>{t("common.inactive")}</span>}</td><td className="num mono">{i.balance} {i.unit}</td><td className="num mono">{i.threshold ?? "—"}</td><td className="num mono">{i.consumed_qty_period} {i.unit}</td>
            <td className="num mono">{i.unit_cost ? t("reports.perUnit", { cost: i.unit_cost, unit: t(`units.${i.unit}`) }) : t("reports.noCost")}</td><td className="num">{i.value ? m(i.value) : "—"}</td>
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
            <Stat title={t("cash.inTotal")} value={m(d.cash_in_total)} />
            <Stat title={t("cash.outTotal")} value={m(d.cash_out_total)} />
            <Stat title={t("cash.gapTotal")} value={m(d.gap_total)} meta={t("cash.gapHint")} alert={d.gap_total !== "0.00"} />
          </div>
          <div className="card table-scroll"><table className="erp-table">
            <thead><tr><th>{t("shift.cashier")}</th><th>{t("shift.opened")}</th><th className="num">{t("cash.gap")}</th><th className="num">{t("shift.openingCash")}</th><th className="num">{t("cash.inTotal")}</th><th className="num">{t("cash.outTotal")}</th><th className="num">{t("shift.expectedCash")}</th><th className="num">{t("shift.actualCash")}</th><th className="num">{t("shift.difference")}</th><th className="num">{t("shift.orders")}</th><th /></tr></thead>
            <tbody>{d.shifts.map((s) => (
              <tr key={s.id}><td>{s.user.display_name}</td><td>{formatDateTime(s.opened_at, tz)}</td><td className={`num${s.gap && s.gap !== "0.00" ? " text-negative" : ""}`} title={s.previous_actual ? t("cash.previousClose", { cash: m(s.previous_actual) }) : undefined}>{s.gap ? m(s.gap) : "—"}</td><td className="num">{m(s.opening_cash)}</td>
                <td className="num">{m(s.cash_in)}</td><td className="num">{m(s.cash_out)}</td>
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

function MoneyView({ range }: { range: RangeValue }) {
  const { t } = useTranslation();
  const { m } = useCur();
  const q = useReport<MoneyInOut>("money-in-out", range);
  const d = q.data;
  const row = (r: MoneyRow, strong = false) => (
    <tr key={r.key} className={strong ? "row-total" : ""}>
      <td>{strong ? <strong>{t(`reports.money.${r.key}`)}</strong> : t(`reports.money.${r.key}`)}</td>
      {MONEY_METHODS.map((k) => <td key={k} className={`num${r[k].startsWith("-") ? " text-negative" : ""}`}>{r[k] === "0.00" && !strong ? "—" : m(r[k])}</td>)}
      <td className={`num${r.total.startsWith("-") ? " text-negative" : ""}`}><strong>{m(r.total)}</strong></td>
    </tr>
  );
  return (
    <State q={q}>
      {d && (
        <>
          <div className="stat-grid">
            <Stat title={t("reports.money.total_in")} value={m(d.total_in.total)} />
            <Stat title={t("reports.money.total_out")} value={m(d.total_out.total)} />
            <Stat title={t("reports.money.net")} value={m(d.net.total)} alert={d.net.total.startsWith("-")} meta={d.net.total.startsWith("-") ? t("reports.money.netNegative") : undefined} />
          </div>
          <div className="card table-scroll" style={{ marginBottom: 16 }}><table className="erp-table">
            <thead><tr><th /> {MONEY_METHODS.map((k) => <th key={k} className="num">{t(`expenses.methods.${k}`)}</th>)}<th className="num">{t("pos.total")}</th></tr></thead>
            <tbody>
              {d.rows.filter((r) => r.direction === "in").map((r) => row(r))}
              {row(d.total_in, true)}
              {d.rows.filter((r) => r.direction === "out").map((r) => row(r))}
              {row(d.total_out, true)}
              {row(d.net, true)}
            </tbody>
          </table></div>
          <div className="card">
            <div className="card-title" style={{ marginBottom: 8 }}>{t("reports.money.drawerTitle")}</div>
            <p className="form-hint" style={{ marginBottom: 8 }}>{t("reports.money.drawerNote")}</p>
            <div className="totals">
              <div className="totals-row"><span>{t("cash.inTotal")}</span><span>{m(d.drawer.cash_in)}</span></div>
              <div className="totals-row"><span>{t("cash.outTotal")}</span><span>{m(d.drawer.cash_out)}</span></div>
              <div className="totals-row"><span>{t("cash.gapTotal")}</span><span className={d.drawer.gap_total.startsWith("-") ? "text-negative" : ""}>{m(d.drawer.gap_total)}</span></div>
              <div className="totals-row"><span>{t("reports.money.closedDiff", { count: d.drawer.closed_count })}</span><span className={d.drawer.total_difference.startsWith("-") ? "text-negative" : ""}>{m(d.drawer.total_difference)}</span></div>
            </div>
            <Link className="btn btn-outline btn-sm" style={{ marginTop: 10 }} to="/admin/reports/shifts">{t("reports.money.eachShift")}</Link>
          </div>
        </>
      )}
    </State>
  );
}

function ProfitView({ range }: { range: RangeValue }) {
  const { t } = useTranslation();
  const { m } = useCur();
  const q = useReport<ProfitReport>("profit", range);
  const d = q.data;
  const neg = (v: string) => (v.startsWith("-") ? " text-negative" : "");
  const line = (k: string, v: string, sign: "" | "−" | "+" = "", grand = false) => (
    <div className={`totals-row${grand ? " grand" : ""}`} key={k}><span>{sign && `${sign} `}{t(`reports.profitRows.${k}`)}</span><span className={neg(v)}>{m(v)}</span></div>
  );
  return (
    <State q={q}>
      {d && (
        <>
          {(d.orders_without_cost > 0 || d.adjustments_without_cost > 0) && (
            <div className="alert-banner alert-warning" role="note" style={{ marginBottom: 12 }}>
              {d.orders_without_cost > 0 && <div>{t("reports.missingOrders", { count: d.orders_without_cost, amount: m(d.sales_without_cost) })}</div>}
              {d.adjustments_without_cost > 0 && <div>{t("reports.missingAdjustments", { count: d.adjustments_without_cost })}</div>}
            </div>
          )}
          <div className="stat-grid">
            <Stat title={t("reports.profitRows.net_sales")} value={m(d.net_sales)} />
            <Stat title={t("reports.profitRows.gross_profit")} value={m(d.gross_profit)} meta={d.gross_margin_pct ? t("reports.margin", { pct: d.gross_margin_pct }) : undefined} alert={d.gross_profit.startsWith("-")} />
            <Stat title={t("reports.profitRows.net_profit")} value={m(d.net_profit)} alert={d.net_profit.startsWith("-")} />
          </div>
          <div className="card">
            <div className="totals">
              {line("sales", d.sales)}
              {line("refunds", d.refunds, "−")}
              {line("net_sales", d.net_sales, "", true)}
              {line("cost_of_sales", d.cost_of_sales, "−")}
              {line("gross_profit", d.gross_profit, "", true)}
              {line("stock_losses", d.stock_losses, "−")}
              {line("stock_gains", d.stock_gains, "+")}
              {line("general_expenses", d.general_expenses, "−")}
              {line("net_profit", d.net_profit, "", true)}
            </div>
            <p className="form-hint" style={{ marginTop: 10 }}>{t("reports.purchasesInfo", { amount: m(d.purchases_info) })}</p>
          </div>
        </>
      )}
    </State>
  );
}
