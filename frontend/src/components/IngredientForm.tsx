import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, ApiError } from "../api/client";
import type { Ingredient, Unit } from "../api/types";
import { Check, Field, fieldError, isDecimal, TextField } from "./Form";
import { Modal } from "./Modal";
import { ErrorBanner } from "./States";

/** What the form needs of an ingredient (a stock balance row has all of it). */
export interface IngredientDraft { id?: string; name?: string; base_unit?: Unit; low_stock_threshold?: string | null; is_active?: boolean }

/** New / edit ingredient (Step 3: moved out of the old Ingredients page into Inventory & Stock). */
export function IngredientForm({ initial, onClose, onSaved }: { initial: IngredientDraft; onClose: () => void; onSaved?: (i: Ingredient) => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({
    name: initial.name ?? "", base_unit: (initial.base_unit ?? "g") as Unit,
    threshold: initial.low_stock_threshold ?? "", is_active: initial.is_active ?? true,
  });
  const [clientErr, setClientErr] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: f.name, is_active: f.is_active,
        low_stock_threshold: f.threshold.trim() === "" ? null : f.threshold.trim(),
      };
      if (!initial.id) body.base_unit = f.base_unit; // create-only
      return initial.id ? api.patch<Ingredient>(`/ingredients/${initial.id}`, body) : api.post<Ingredient>("/ingredients", body);
    },
    onSuccess: (i) => { void qc.invalidateQueries({ queryKey: ["ingredients"] }); void qc.invalidateQueries({ queryKey: ["balances"] }); onSaved?.(i); onClose(); },
  });
  const submit = () => {
    const e: Record<string, string> = {};
    if (f.threshold.trim() && !isDecimal(f.threshold, 3)) e.threshold = t("common.decimalInvalid");
    setClientErr(e);
    if (!Object.keys(e).length) save.mutate();
  };
  return (
    <Modal title={initial.id ? t("ingredients.edit") : t("ingredients.new")} onClose={onClose}
      footer={<><button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button></>}>
      <ErrorBanner error={save.error} />
      {save.error instanceof ApiError && save.error.code === "INGREDIENT_IN_USE" && (
        <ul className="form-hint" style={{ marginBottom: 12 }}>{((save.error.details as { used_by?: string[] }).used_by ?? []).map((u) => <li key={u}>{u}</li>)}</ul>
      )}
      <TextField label={t("common.name")} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} error={fieldError(save.error, "name")} autoFocus />
      <Field label={t("ingredients.unit")} hint={initial.id ? t("ingredients.unitLocked") : undefined} error={fieldError(save.error, "base_unit")}>
        <select className="form-select" value={f.base_unit} disabled={!!initial.id} onChange={(e) => setF({ ...f, base_unit: e.target.value as Unit })}>
          {(["g", "ml", "pcs"] as const).map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
        </select>
      </Field>
      <TextField label={t("ingredients.threshold")} inputMode="decimal" value={f.threshold} onChange={(e) => setF({ ...f, threshold: e.target.value })} error={clientErr.threshold ?? fieldError(save.error, "low_stock_threshold")} />
      <p className="form-hint" style={{ marginBottom: 10 }}>{t("ingredients.costHint")}</p>
      <Check label={t("common.active")} checked={f.is_active} onChange={(v) => setF({ ...f, is_active: v })} />
    </Modal>
  );
}
