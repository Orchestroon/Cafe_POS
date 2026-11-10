import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import type { PaymentBreakdown, SalesSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { Stat } from "../components/Stat";
import { ErrorBanner } from "../components/States";
import { formatMoney } from "../i18n/format";

export function Home() {
  const { t } = useTranslation();
  const { me } = useAuth();
  if (me?.user.role === "barista") return <Navigate to="/pos" replace />;
  return (
    <>
      <PageHeader title={t("home.welcome", { name: me?.user.display_name || me?.user.username })} subtitle={me?.organization.name} />
      {me?.user.role === "admin" ? <Dashboard /> : null}
    </>
  );
}

/** Today's numbers (the café's local day): sales, payment split, stock alerts, open shifts. */
function Dashboard() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const m = (v: string) => formatMoney(v, cur);
  const sales = useQuery({ queryKey: ["report", "sales-summary", "today"], queryFn: () => api.get<SalesSummary>("/reports/sales-summary"), refetchInterval: 60000 });
  const pay = useQuery({ queryKey: ["report", "payment-breakdown", "today"], queryFn: () => api.get<PaymentBreakdown>("/reports/payment-breakdown"), refetchInterval: 60000 });
  // All open shifts, not only today's: a shift forgotten from an earlier day must still show.
  const open = useQuery({ queryKey: ["shifts", "count", "open"], queryFn: () => api.list("/shifts", { status: "open", page_size: 1 }), refetchInterval: 60000 });
  const low = useQuery({ queryKey: ["balances", "count", "low"], queryFn: () => api.list("/inventory/balances", { is_low: true, page_size: 1 }) });
  const neg = useQuery({ queryKey: ["balances", "count", "negative"], queryFn: () => api.list("/inventory/balances", { is_negative: true, page_size: 1 }) });
  const s = sales.data;
  const p = pay.data;
  return (
    <>
      <ErrorBanner error={sales.error ?? pay.error ?? open.error ?? low.error ?? neg.error} />
      <h3 className="section-title">{t("home.today")}</h3>
      <div className="metrics-grid">
        <Stat title={t("reports.net")} value={s ? m(s.net_sales) : "…"} meta={s ? t("home.ordersToday", { count: s.orders_count }) : undefined} />
        <Stat title={t("reports.refunds")} value={s ? m(s.refunds) : "…"} meta={s ? t("reports.refundedOrders", { count: s.refunded_orders_count }) : undefined} />
        <Stat title={t("home.cashNet")} value={p ? m(p.cash_net) : "…"} />
        <Stat title={t("home.cardNet")} value={p ? m(p.card_net) : "…"} />
        <Stat title={t("home.openShifts")} value={open.data ? open.data.meta.total_count : "…"} />
        <Stat title={t("home.lowStock")} value={low.data ? low.data.meta.total_count : "…"} alert={!!low.data && low.data.meta.total_count > 0} meta={neg.data ? t("home.negativeCount", { count: neg.data.meta.total_count }) : undefined} />
      </div>
      <h3 className="section-title" style={{ marginTop: 20 }}>{t("home.shortcuts")}</h3>
      <div className="metrics-grid">
        {(["pos", "orders", "shift", "expenses"] as const).map((k) => (
          <Link key={k} to={`/${k}`} className="metric-card" style={{ textDecoration: "none" }}><div className="metric-title">{t(`nav.${k}`)}</div></Link>
        ))}
        {(["products", "modifiers", "categories", "ingredients", "inventory", "suppliers", "purchases", "shifts", "users", "settings"] as const).map((k) => (
          <Link key={k} to={`/admin/${k}`} className="metric-card" style={{ textDecoration: "none" }}><div className="metric-title">{t(`nav.${k}`)}</div></Link>
        ))}
        <Link to="/admin/reports/sales-summary" className="metric-card" style={{ textDecoration: "none" }}><div className="metric-title">{t("nav.reports")}</div></Link>
      </div>
    </>
  );
}
