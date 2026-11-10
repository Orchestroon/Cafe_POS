import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { EXPENSE_CATEGORIES, type Expense } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { ExpenseDialog } from "../components/ExpenseDialog";
import { fieldError, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ErrorBanner } from "../components/States";
import { ListState, Pager } from "../components/Table";
import { formatDateTime, formatMoney } from "../i18n/format";

/** /expenses: a Barista sees and adds their own drawer expenses; an Admin sees all and can void. */
export function Expenses() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const admin = me?.user.role === "admin";
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ status: "", category: "", source: "", from: "", to: "" });
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<Expense | null>(null);
  const q = useQuery({ queryKey: ["expenses", page, f], queryFn: () => api.list<Expense>("/expenses", { page, ...f }) });
  const set = (k: string, v: string) => { setF({ ...f, [k]: v }); setPage(1); };
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  return (
    <>
      <PageHeader title={t("nav.expenses")} actions={<button className="btn btn-primary" onClick={() => setAdding(true)}>{admin ? t("expenses.new") : t("expenses.payFromDrawer")}</button>} />
      <div className="card">
        <div className="toolbar">
          <div className="form-group"><label className="form-label">{t("common.status")}
            <select className="form-select" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="">{t("common.all")}</option><option value="posted">{t("expenses.posted")}</option><option value="voided">{t("expenses.voided")}</option>
            </select></label></div>
          <div className="form-group"><label className="form-label">{t("expenses.category")}
            <select className="form-select" value={f.category} onChange={(e) => set("category", e.target.value)}>
              <option value="">{t("common.all")}</option>
              {[...EXPENSE_CATEGORIES, "purchase"].map((c) => <option key={c} value={c}>{t(`expenses.categories.${c}`)}</option>)}
            </select></label></div>
          {admin && (
            <div className="form-group"><label className="form-label">{t("expenses.source")}
              <select className="form-select" value={f.source} onChange={(e) => set("source", e.target.value)}>
                <option value="">{t("common.all")}</option><option value="cash_drawer">{t("expenses.sources.cash_drawer")}</option><option value="external">{t("expenses.sources.external")}</option>
              </select></label></div>
          )}
          <div className="form-group"><label className="form-label">{t("common.from")}<input type="date" className="form-input" value={f.from} onChange={(e) => set("from", e.target.value)} /></label></div>
          <div className="form-group"><label className="form-label">{t("common.to")}<input type="date" className="form-input" value={f.to} onChange={(e) => set("to", e.target.value)} /></label></div>
        </div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("common.date")}</th><th>{t("expenses.category")}</th><th>{t("expenses.description")}</th><th>{t("expenses.source")}</th><th>{t("expenses.by")}</th><th className="num">{t("expenses.amount")}</th><th /></tr></thead>
            <tbody>
              {q.data?.data.map((e) => (
                <tr key={e.id} className={e.status === "voided" ? "row-voided" : ""}>
                  <td>{formatDateTime(e.paid_at, tz)}</td><td>{t(`expenses.categories.${e.category}`)}</td>
                  <td>{e.description}{e.status === "voided" && <div className="form-hint">{t("expenses.voidedBecause", { reason: e.void_reason })}</div>}</td>
                  <td>{t(`expenses.sources.${e.source}`)} · {t(`expenses.methods.${e.payment_method}`)}</td><td>{e.created_by.display_name}</td>
                  <td className="num">{formatMoney(e.amount, cur)}</td>
                  <td><div className="row-actions">{admin && e.status === "posted" && e.type === "general" && <button className="btn btn-outline btn-sm" onClick={() => setVoiding(e)}>{t("expenses.void")}</button>}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
        <Pager meta={q.data?.meta} page={page} onPage={setPage} />
      </div>
      {adding && <ExpenseDialog drawerOnly={!admin} onClose={() => setAdding(false)} />}
      {voiding && <VoidDialog expense={voiding} onClose={() => setVoiding(null)} />}
    </>
  );
}

function VoidDialog({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [clientErr, setClientErr] = useState("");
  const void_ = useMutation({
    mutationFn: () => api.post(`/expenses/${expense.id}/void`, { reason: reason.trim() }),
    onSuccess: () => { for (const k of ["expenses", "shift"]) void qc.invalidateQueries({ queryKey: [k] }); onClose(); },
  });
  const submit = () => (reason.trim().length >= 3 ? (setClientErr(""), void_.mutate()) : setClientErr(t("orders.reasonRequired")));
  return (
    <Modal title={t("expenses.voidTitle")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-danger" disabled={void_.isPending} onClick={submit}>{t("expenses.void")}</button>
    </>}>
      <p className="form-hint" style={{ marginBottom: 10 }}>{expense.description} · {expense.amount}. {t("expenses.voidNote")}</p>
      <ErrorBanner error={void_.error} />
      <TextField label={t("orders.reason")} value={reason} maxLength={300} autoFocus onChange={(e) => setReason(e.target.value)} error={clientErr || fieldError(void_.error, "reason")} />
    </Modal>
  );
}
