import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { EXPENSE_CATEGORIES, type Expense, type PayMethod, type PaySource } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Field, fieldError, isDecimal, TextField } from "./Form";
import { Modal } from "./Modal";
import { ErrorBanner } from "./States";

/** `drawerOnly` ("Pay from drawer"): cash from the user's own open shift. Otherwise an Admin picks
 * the source and method. The server forces a Barista's expense onto their own shift either way (D10). */
export function ExpenseDialog({ drawerOnly, onClose }: { drawerOnly: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const admin = me?.user.role === "admin";
  const [f, setF] = useState({ category: "supplies", description: "", amount: "" });
  const [source, setSource] = useState<PaySource>(drawerOnly ? "cash_drawer" : "external");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [clientErr, setClientErr] = useState("");
  const save = useMutation({
    mutationFn: () => api.post<Expense>("/expenses", {
      category: f.category, description: f.description.trim(), amount: f.amount.trim(),
      ...(admin ? { source, payment_method: source === "cash_drawer" ? "cash" : method } : {}),
    }),
    onSuccess: () => {
      for (const k of ["expenses", "shift"]) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  const submit = () => {
    if (!f.description.trim()) return setClientErr(t("expenses.descriptionRequired"));
    if (!isDecimal(f.amount, 2) || Number(f.amount) <= 0) return setClientErr(t("expenses.amountInvalid"));
    setClientErr("");
    save.mutate();
  };
  return (
    <Modal title={drawerOnly ? t("expenses.payFromDrawer") : t("expenses.new")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button>
    </>}>
      {drawerOnly && <p className="form-hint" style={{ marginBottom: 10 }}>{t("expenses.drawerNote")}</p>}
      <ErrorBanner error={save.error} />
      {clientErr && <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      <Field label={t("expenses.category")} error={fieldError(save.error, "category")}>
        <select className="form-select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
          {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{t(`expenses.categories.${c}`)}</option>)}
        </select>
      </Field>
      <TextField label={t("expenses.description")} value={f.description} maxLength={300} onChange={(e) => setF({ ...f, description: e.target.value })} error={fieldError(save.error, "description")} />
      <TextField label={t("expenses.amount")} inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} error={fieldError(save.error, "amount")} />
      {admin && !drawerOnly && (
        <>
          <Field label={t("expenses.source")}>
            <select className="form-select" value={source} onChange={(e) => setSource(e.target.value as PaySource)}>
              <option value="external">{t("expenses.sources.external")}</option><option value="cash_drawer">{t("expenses.sources.cash_drawer")}</option>
            </select>
          </Field>
          {source === "external" && (
            <Field label={t("expenses.method")}>
              <select className="form-select" value={method} onChange={(e) => setMethod(e.target.value as PayMethod)}>
                {(["cash", "card", "transfer"] as const).map((m) => <option key={m} value={m}>{t(`expenses.methods.${m}`)}</option>)}
              </select>
            </Field>
          )}
        </>
      )}
    </Modal>
  );
}
