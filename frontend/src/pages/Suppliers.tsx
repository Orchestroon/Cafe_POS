import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Supplier } from "../api/types";
import { Check, fieldError, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { BuyingTabs } from "../components/SectionTabs";
import { Kbd } from "../components/ShortcutsHelp";
import { ErrorBanner } from "../components/States";
import { ListState, Pager, StatusBadge } from "../components/Table";
import { PaySupplierDialog, SupplierPaymentsDialog } from "../components/PaySupplierDialog";
import { useAuth } from "../auth/AuthContext";
import { formatMoney } from "../i18n/format";

export function Suppliers() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Supplier | "new" | null>(null);
  const [paying, setPaying] = useState<Supplier | null>(null);
  const [history, setHistory] = useState<Supplier | null>(null);
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const q = useQuery({ queryKey: ["suppliers", page], queryFn: () => api.list<Supplier>("/suppliers", { page }) });
  return (
    <>
      <PageHeader title={t("nav.buying")} actions={<button className="btn btn-primary" data-shortcut="new" onClick={() => setEdit("new")}>{t("common.new")}<Kbd k="N" /></button>} />
      <BuyingTabs />
      <div className="card">
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("common.name")}</th><th>{t("suppliers.phone")}</th><th className="num">{t("suppliers.owed")}</th><th>{t("common.status")}</th><th /></tr></thead>
            <tbody>
              {q.data?.data.map((s) => (
                <tr key={s.id}><td>{s.name}</td><td>{s.phone}</td>
                  <td className={`num${s.owed !== "0.00" ? " text-negative" : ""}`}>{formatMoney(s.owed, cur)}</td>
                  <td><StatusBadge active={s.is_active} /></td>
                  <td><div className="row-actions">
                    {s.owed !== "0.00" && <button className="btn btn-primary btn-sm" onClick={() => setPaying(s)}>{t("suppliers.pay")}</button>}
                    <button className="btn btn-outline btn-sm" onClick={() => setHistory(s)}>{t("suppliers.payments")}</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setEdit(s)}>{t("common.edit")}</button>
                  </div></td></tr>
              ))}
            </tbody>
          </table>
        </ListState>
        <Pager meta={q.data?.meta} page={page} onPage={setPage} />
      </div>
      {edit && <SupplierDialog supplier={edit === "new" ? null : edit} onClose={() => setEdit(null)} />}
      {paying && <PaySupplierDialog supplier={paying} onClose={() => setPaying(null)} />}
      {history && <SupplierPaymentsDialog supplier={history} onClose={() => setHistory(null)} />}
    </>
  );
}

/** New / edit supplier. `onSaved` gets the saved supplier (the purchase form's "+" selects it). */
export function SupplierDialog({ supplier, onClose, onSaved }: { supplier: Supplier | null; onClose: () => void; onSaved?: (s: Supplier) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: supplier?.name ?? "", phone: supplier?.phone ?? "", notes: supplier?.notes ?? "", is_active: supplier?.is_active ?? true });
  const save = useMutation({
    mutationFn: () => (supplier ? api.patch<Supplier>(`/suppliers/${supplier.id}`, f) : api.post<Supplier>("/suppliers", f)),
    onSuccess: (s) => { void qc.invalidateQueries({ queryKey: ["suppliers"] }); onSaved?.(s); onClose(); },
  });
  return (
    <Modal title={supplier ? t("common.edit") : t("common.new")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{t("common.save")}</button>
    </>}>
      <ErrorBanner error={save.error} />
      <TextField label={t("common.name")} value={f.name} maxLength={150} autoFocus onChange={(e) => setF({ ...f, name: e.target.value })} error={fieldError(save.error, "name")} />
      <TextField label={t("suppliers.phone")} value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} error={fieldError(save.error, "phone")} />
      <TextField label={t("suppliers.notes")} value={f.notes} maxLength={300} onChange={(e) => setF({ ...f, notes: e.target.value })} error={fieldError(save.error, "notes")} />
      <Check label={t("common.active")} checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
    </Modal>
  );
}
