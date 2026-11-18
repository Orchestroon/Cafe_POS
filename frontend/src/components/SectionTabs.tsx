import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";
import { confirmLeave } from "../lib/unsaved";

/** Tab strip for a merged admin page, same look as the Reports tabs. Every tab is its own URL. */
export function SectionTabs({ tabs }: { tabs: { to: string; label: string }[] }) {
  return (
    <div className="report-nav" role="tablist">
      {tabs.map((x) => (
        <NavLink key={x.to} to={x.to} role="tab" className={({ isActive }) => `tab${isActive ? " active" : ""}`} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); }}>{x.label}</NavLink>
      ))}
    </div>
  );
}

/** Menu & Recipes: products, modifiers, categories. */
export function MenuTabs() {
  const { t } = useTranslation();
  return <SectionTabs tabs={[{ to: "/admin/products", label: t("nav.products") }, { to: "/admin/modifiers", label: t("nav.modifiers") }, { to: "/admin/categories", label: t("nav.categories") }]} />;
}

/** Buying & Suppliers: purchases, suppliers. */
export function BuyingTabs() {
  const { t } = useTranslation();
  return <SectionTabs tabs={[{ to: "/admin/purchases", label: t("nav.purchases") }, { to: "/admin/suppliers", label: t("nav.suppliers") }]} />;
}
