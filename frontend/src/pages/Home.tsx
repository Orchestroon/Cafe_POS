import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { api } from "../api/client";
import { needsRecipe, type Ingredient, type ModifierGroup, type PaymentBreakdown, type Product, type SalesSummary, type Supplier } from "../api/types";
import { addMoney } from "../lib/decimal";
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
  // B3/R2: setup that blocks selling (sizes with no recipe, options with no ingredient).
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => api.all<Product>("/products") });
  const groups = useQuery({ queryKey: ["modifier-groups"], queryFn: () => api.all<ModifierGroup>("/modifier-groups", { ordering: "sort_order" }) });
  const missing = (products.data ?? []).filter((x) => x.is_active).flatMap((x) => x.variants.filter((v) => v.is_active && needsRecipe(v)).map((v) => `${x.name} · ${v.label}`));
  const ings = useQuery({ queryKey: ["ingredients", "all"], queryFn: () => api.all<Ingredient>("/ingredients", { ordering: "name" }) });
  const noPrice = (ings.data ?? []).filter((i) => i.is_active && i.avg_cost === null).map((i) => i.name);
  // Sprint 5 P4: what is still owed to suppliers for purchases on credit.
  const sups = useQuery({ queryKey: ["suppliers", "all"], queryFn: () => api.all<Supplier>("/suppliers") });
  const owed = (sups.data ?? []).reduce((sum, x) => addMoney(sum, x.owed), "0.00");
  const bareOptions = (groups.data ?? []).filter((g) => g.is_active).flatMap((g) => g.options.filter((o) => o.is_active && o.track_stock && (o.effects?.length ?? 0) === 0));
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
        <Link to="/admin/products?filter=no-recipe" style={{ textDecoration: "none" }} title={missing.join(", ")}>
          <Stat title={t("home.noRecipe")} value={products.data ? missing.length : "…"} alert={missing.length > 0 || bareOptions.length > 0}
            meta={bareOptions.length > 0 ? t("home.optionsNoIngredient", { count: bareOptions.length }) : missing.length > 0 ? t("home.noRecipeMeta") : undefined} />
        </Link>
        <Link to="/admin/inventory?flag=no-price" style={{ textDecoration: "none" }} title={noPrice.join(", ")}>
          <Stat title={t("home.noPrice")} value={ings.data ? noPrice.length : "…"} alert={noPrice.length > 0} meta={noPrice.length > 0 ? t("home.noPriceMeta") : undefined} />
        </Link>
        <Link to="/admin/suppliers" style={{ textDecoration: "none" }}>
          <Stat title={t("home.owed")} value={sups.data ? m(owed) : "…"} alert={owed !== "0.00"} />
        </Link>
        <Link to="/admin/inventory?flag=low" style={{ textDecoration: "none" }}>
          <Stat title={t("home.lowStock")} value={low.data ? low.data.meta.total_count : "…"} alert={!!low.data && low.data.meta.total_count > 0} meta={neg.data ? t("home.negativeCount", { count: neg.data.meta.total_count }) : undefined} />
        </Link>
      </div>
    </>
  );
}
