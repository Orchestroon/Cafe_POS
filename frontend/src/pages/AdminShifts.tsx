import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Shift } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { ListState, Pager } from "../components/Table";
import { formatDateTime, formatMoney } from "../i18n/format";

export function AdminShifts() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ status: "", from: "", to: "" });
  const q = useQuery({ queryKey: ["shifts", page, f], queryFn: () => api.list<Shift>("/shifts", { page, ...f }) });
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  return (
    <>
      <PageHeader title={t("nav.shifts")} />
      <div className="card">
        <div className="toolbar">
          <div className="form-group"><label className="form-label">{t("common.status")}
            <select className="form-select" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">{t("common.all")}</option><option value="open">{t("shift.open")}</option><option value="closed">{t("shift.closed")}</option>
            </select></label></div>
          <div className="form-group"><label className="form-label">{t("common.from")}<input type="date" className="form-input" value={f.from} onChange={(e) => set("from", e.target.value)} /></label></div>
          <div className="form-group"><label className="form-label">{t("common.to")}<input type="date" className="form-input" value={f.to} onChange={(e) => set("to", e.target.value)} /></label></div>
        </div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("shift.cashier")}</th><th>{t("shift.opened")}</th><th>{t("common.status")}</th><th className="num">{t("shift.expectedCash")}</th><th className="num">{t("shift.actualCash")}</th><th className="num">{t("shift.difference")}</th><th /></tr></thead>
            <tbody>
              {q.data?.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.user.display_name}</td><td>{formatDateTime(s.opened_at, tz)}</td>
                  <td><span className={`badge ${s.status === "open" ? "badge-active" : "badge-off"}`}>{t(`shift.${s.status}`)}</span></td>
                  <td className="num">{formatMoney(s.expected_cash ?? s.totals.expected_cash, cur)}</td>
                  <td className="num">{s.actual_cash ? formatMoney(s.actual_cash, cur) : "—"}</td>
                  <td className={`num${s.difference?.startsWith("-") ? " text-negative" : ""}`}>{s.difference ? formatMoney(s.difference, cur) : "—"}</td>
                  <td><div className="row-actions"><Link className="btn btn-outline btn-sm" to={`/shift/${s.id}`}>{t("shift.details")}</Link></div></td>
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
