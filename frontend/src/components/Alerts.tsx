import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { needsRecipe, type Product } from "../api/types";

/** Top-bar bell (Admin): things that need attention, from data the app already has — no new
 *  notification system. Low / negative stock, sizes without a recipe, shifts still open. */
export function Alerts({ icon, onGo }: { icon: ReactNode; onGo: (to: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const opt = { refetchInterval: 120000 };
  const low = useQuery({ queryKey: ["balances", "count", "low"], queryFn: () => api.list("/inventory/balances", { is_low: true, page_size: 1 }), ...opt });
  const neg = useQuery({ queryKey: ["balances", "count", "negative"], queryFn: () => api.list("/inventory/balances", { is_negative: true, page_size: 1 }), ...opt });
  const shifts = useQuery({ queryKey: ["shifts", "count", "open"], queryFn: () => api.list("/shifts", { status: "open", page_size: 1 }), ...opt });
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => api.all<Product>("/products", { ordering: "sort_order" }) });
  const noRecipe = (products.data ?? []).filter((p) => p.is_active).flatMap((p) => p.variants.filter((v) => v.is_active && needsRecipe(v))).length;
  const items = [
    { n: neg.data?.meta.total_count ?? 0, text: t("alerts.negative", { count: neg.data?.meta.total_count ?? 0 }), to: "/admin/inventory", bad: true },
    { n: low.data?.meta.total_count ?? 0, text: t("alerts.low", { count: low.data?.meta.total_count ?? 0 }), to: "/admin/inventory" },
    { n: noRecipe, text: t("alerts.noRecipe", { count: noRecipe }), to: "/admin/products", bad: true },
    { n: shifts.data?.meta.total_count ?? 0, text: t("alerts.openShifts", { count: shifts.data?.meta.total_count ?? 0 }), to: "/admin/shifts" },
  ].filter((i) => i.n > 0);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => { window.removeEventListener("mousedown", close); window.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <div className="alerts" ref={box}>
      <button className="top-icon-btn" aria-label={t("alerts.title")} aria-expanded={open} onClick={() => setOpen(!open)}>
        {icon}{items.length > 0 && <span className="alerts-dot" aria-label={t("alerts.count", { count: items.length })} />}
      </button>
      {open && (
        <div className="alerts-pop" role="dialog" aria-label={t("alerts.title")}>
          <div className="alerts-title">{t("alerts.title")}</div>
          {items.length === 0 ? <div className="form-hint">{t("alerts.none")}</div> : items.map((i) => (
            <button key={i.text} className={`alerts-item${i.bad ? " bad" : ""}`} onClick={() => { setOpen(false); onGo(i.to); }}>{i.text}</button>
          ))}
        </div>
      )}
    </div>
  );
}
