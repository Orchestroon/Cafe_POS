import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import { PAPER_WIDTHS, paperLabel, type Me, type Settings } from "../api/types";
import { Check, Field, fieldError, isDecimal, TextField } from "../components/Form";
import { PageHeader } from "../components/PageHeader";
import { ErrorBanner, Loading } from "../components/States";

export function SettingsPage() {
  const q = useQuery({ queryKey: ["settings"], queryFn: () => api.get<Settings>("/settings") });
  if (q.isLoading || !q.data) return <Loading />;
  return <SettingsForm initial={q.data} />;
}

function SettingsForm({ initial }: { initial: Settings }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState<Settings>(initial);
  const [clientErr, setClientErr] = useState("");
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.patch<Settings>("/settings", f),
    onSuccess: (s) => {
      setSaved(true);
      setF(s);
      qc.setQueryData(["settings"], s);
      qc.setQueryData<Me | null | undefined>(["me"], (m) => (m ? { ...m, settings: s } : m)); // keep the shell in sync
    },
  });
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setSaved(false); setF({ ...f, [k]: v }); };
  const err = (k: string) => fieldError(save.error, k);
  const submit = () => {
    if (!isDecimal(f.tax_rate, 2)) return setClientErr(t("settings.taxRateInvalid"));
    setClientErr("");
    save.mutate();
  };
  return (
    <>
      <PageHeader title={t("nav.settings")} actions={<button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button>} />
      <ErrorBanner error={save.error} />
      {clientErr && <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      {saved && <div className="alert-banner alert-success" role="status" style={{ marginBottom: 12 }}>{t("settings.saved")}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">{t("settings.business")}</div></div>
        <div className="form-grid">
          <TextField label={t("settings.businessName")} value={f.business_name} onChange={(e) => set("business_name", e.target.value)} error={err("business_name")} />
          <TextField label={t("settings.currency")} value={f.currency} onChange={(e) => set("currency", e.target.value.toUpperCase())} error={err("currency")} maxLength={3} />
          <TextField label={t("settings.timezone")} value={f.timezone} onChange={(e) => set("timezone", e.target.value)} error={err("timezone")} hint="Africa/Cairo" />
          <Field label={t("settings.language")} error={err("default_language")}>
            <select className="form-select" value={f.default_language} onChange={(e) => set("default_language", e.target.value as "en" | "ar")}><option value="en">English</option><option value="ar">العربية</option></select>
          </Field>
        </div>
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><div className="card-title">{t("settings.receipt")}</div></div>
        <Field label={t("settings.receiptHeader")}><textarea className="form-input" value={f.receipt_header} onChange={(e) => set("receipt_header", e.target.value)} /></Field>
        <Field label={t("settings.receiptFooter")}><textarea className="form-input" value={f.receipt_footer} onChange={(e) => set("receipt_footer", e.target.value)} /></Field>
        <div className="form-grid">
          <Field label={t("settings.paperWidth")} error={err("receipt_paper_width")}>
            <select className="form-select" value={f.receipt_paper_width} onChange={(e) => set("receipt_paper_width", e.target.value as Settings["receipt_paper_width"])}>{PAPER_WIDTHS.map((w) => <option key={w} value={w}>{paperLabel(w)}</option>)}</select>
          </Field>
          <TextField label={t("settings.invoicePrefix")} value={f.invoice_prefix ?? ""} onChange={(e) => set("invoice_prefix", e.target.value)} error={err("invoice_prefix")} />
        </div>
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title">{t("settings.tax")}</div></div>
        <Check label={t("settings.taxEnabled")} checked={f.tax_enabled} onChange={(v) => set("tax_enabled", v)} />
        <div className="form-grid">
          <TextField label={t("settings.taxRate")} inputMode="decimal" value={f.tax_rate} onChange={(e) => set("tax_rate", e.target.value)} error={err("tax_rate")} />
          <TextField label={t("settings.taxLabel")} value={f.tax_label} onChange={(e) => set("tax_label", e.target.value)} error={err("tax_label")} />
          <TextField label={t("settings.taxNumber")} value={f.tax_registration_number} onChange={(e) => set("tax_registration_number", e.target.value)} error={err("tax_registration_number")} />
        </div>
        <Check label={t("settings.pricesIncludeTax")} checked={f.prices_include_tax} onChange={(v) => set("prices_include_tax", v)} />
      </div>
      <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
        <button className="btn btn-primary" disabled={save.isPending} onClick={submit}>{t("common.save")}</button>
      </div>
    </>
  );
}
