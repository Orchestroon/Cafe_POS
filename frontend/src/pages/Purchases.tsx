import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Purchase } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { BuyingTabs } from "../components/SectionTabs";
import { Kbd } from "../components/ShortcutsHelp";
import { ListState, Pager } from "../components/Table";
import { formatMoney } from "../i18n/format";

export function Purchases() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["purchases", page, status], queryFn: () => api.list<Purchase>("/purchases", { page, status }) });
  const cur = me?.settings.currency ?? "";
  return (
    <>
      <PageHeader title={t("nav.buying")} actions={<Link className="btn btn-primary" data-shortcut="new" to="/admin/purchases/new">{t("common.new")}<Kbd k="N" /></Link>} />
      <BuyingTabs />
      <div className="card">
        <div className="toolbar">
          <div className="form-group"><label className="form-label">{t("common.status")}
            <select className="form-select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
              <option value="">{t("common.all")}</option><option value="draft">{t("purchases.draft")}</option><option value="posted">{t("purchases.posted")}</option><option value="voided">{t("purchases.voided")}</option>
            </select></label></div>
        </div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("purchases.receiptNo")}</th><th>{t("common.date")}</th><th>{t("purchases.supplier")}</th><th>{t("purchases.invoiceNo")}</th><th>{t("common.status")}</th><th className="num">{t("pos.total")}</th><th /></tr></thead>
            <tbody>
              {q.data?.data.map((p) => (
                <tr key={p.id}>
                  <td className="mono">{p.receipt_no || "—"}</td><td>{p.purchased_on}</td><td>{p.supplier?.name ?? "—"}</td><td>{p.supplier_invoice_no}</td>
                  <td><span className={`badge ${p.status === "posted" ? "badge-active" : p.status === "voided" ? "badge-off" : "badge-draft"}`}>{t(`purchases.${p.status}`)}</span></td>
                  <td className="num">{formatMoney(p.total, cur)}</td>
                  <td><div className="row-actions"><Link className="btn btn-outline btn-sm" to={`/admin/purchases/${p.id}`}>{p.status === "draft" ? t("common.edit") : t("shift.details")}</Link></div></td>
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
