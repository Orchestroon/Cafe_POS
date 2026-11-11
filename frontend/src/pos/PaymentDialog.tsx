import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "../components/Modal";
import { Kbd } from "../components/ShortcutsHelp";
import { formatMoney } from "../i18n/format";
import { cmpMoney, isDec, normMoney, roundUpTo, subMoney } from "../lib/decimal";

type Tab = "cash" | "card" | "mixed";
export type Payments = Record<string, string>[];

export function PaymentDialog({ total, currency, onConfirm, onClose }: { total: string; currency: string; onConfirm: (payments: Payments) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("cash");
  const [tendered, setTendered] = useState("");
  const [cashAmt, setCashAmt] = useState("");
  const [ref, setRef] = useState("");
  const quick = [...new Set([normMoney(total), roundUpTo(total, 50), roundUpTo(total, 100), ...(cmpMoney("200.00", total) >= 0 ? ["200.00"] : [])])];

  const free = cmpMoney(total, "0") === 0; // a 0.00 order takes no payment
  const build = (): Payments | null => {
    if (free) return [];
    const refField: Record<string, string> = ref.trim() ? { external_reference: ref.trim() } : {};
    if (tab === "cash") {
      const given = tendered.trim() || total;
      if (!isDec(given, 2) || cmpMoney(given, total) < 0) return null;
      return [{ method: "cash", amount: total, cash_tendered: normMoney(given) }];
    }
    if (tab === "card") return [{ method: "card", amount: total, ...refField }];
    if (!isDec(cashAmt, 2) || cmpMoney(cashAmt, "0") <= 0 || cmpMoney(cashAmt, total) >= 0) return null;
    const given = tendered.trim() || cashAmt;
    if (!isDec(given, 2) || cmpMoney(given, cashAmt) < 0) return null;
    return [
      { method: "cash", amount: normMoney(cashAmt), cash_tendered: normMoney(given) },
      { method: "card", amount: subMoney(total, cashAmt), ...refField },
    ];
  };
  const payments = build();
  const changeFor = (due: string) => (isDec(tendered, 2) && cmpMoney(tendered, due) >= 0 ? subMoney(tendered, due) : "0.00");
  const switchTab = (k: Tab) => { setTab(k); setTendered(""); };
  const TABS: Tab[] = ["cash", "card", "mixed"];
  const shortcuts = {
    nextMethod: () => (free ? false : switchTab(TABS[(TABS.indexOf(tab) + 1) % TABS.length])),
    // Enter confirms, except on a focused button (a quick amount or a tab), which keeps its click.
    confirmPay: () => {
      const a = document.activeElement as HTMLElement | null;
      if (a?.tagName === "BUTTON" || !payments) return false;
      onConfirm(payments);
    },
  };

  return (
    <Modal title={t("pos.payment")} onClose={onClose} shortcuts={shortcuts} footer={<><button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={!payments} onClick={() => payments && onConfirm(payments)}>{t("pos.confirmPayment")}<Kbd k="Enter" /></button></>}>
      <div className="pay-total"><span>{t("pos.total")}</span><strong>{formatMoney(total, currency)}</strong></div>
      {free ? <div className="alert-banner alert-neutral">{t("pos.noPaymentNeeded")}</div> : <>
      <div className="tabs" role="tablist">
        {(["cash", "card", "mixed"] as Tab[]).map((k) => <button key={k} role="tab" aria-selected={tab === k} className={`tab${tab === k ? " active" : ""}`} onClick={() => switchTab(k)}>{t(`pos.tabs.${k}`)}</button>)}
        <Kbd k="F8" />
      </div>

      {tab === "cash" && (
        <>
          <div className="quick-row">{quick.map((q) => <button key={q} className="btn btn-outline" onClick={() => setTendered(q)}>{q === normMoney(total) ? t("pos.exact") : q}</button>)}</div>
          <div className="form-group"><label className="form-label">{t("pos.tendered")}<input className="form-input" inputMode="decimal" value={tendered} placeholder={total} onChange={(e) => setTendered(e.target.value)} /></label></div>
          <div className="pay-change"><span>{t("pos.change")}</span><strong>{formatMoney(changeFor(total), currency)}</strong></div>
          {tendered && !payments && <div className="field-error" role="alert">{t("pos.tenderedShort")}</div>}
        </>
      )}
      {tab === "card" && (
        <>
          <div className="alert-banner alert-neutral" style={{ marginBottom: 12 }}>{t("pos.cardNote")}</div>
          <div className="form-group"><label className="form-label">{t("pos.reference")}<input className="form-input" value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} /></label></div>
        </>
      )}
      {tab === "mixed" && (
        <>
          <div className="form-grid">
            <div className="form-group"><label className="form-label">{t("pos.cashAmount")}<input className="form-input" inputMode="decimal" value={cashAmt} onChange={(e) => setCashAmt(e.target.value)} /></label></div>
            <div className="form-group"><label className="form-label">{t("pos.cardAmount")}<input className="form-input" readOnly value={isDec(cashAmt, 2) && cmpMoney(cashAmt, total) < 0 ? subMoney(total, cashAmt) : ""} /></label></div>
            <div className="form-group"><label className="form-label">{t("pos.tendered")}<input className="form-input" inputMode="decimal" value={tendered} placeholder={cashAmt} onChange={(e) => setTendered(e.target.value)} /></label></div>
            <div className="form-group"><label className="form-label">{t("pos.reference")}<input className="form-input" value={ref} maxLength={100} onChange={(e) => setRef(e.target.value)} /></label></div>
          </div>
          <div className="alert-banner alert-neutral" style={{ marginBottom: 8 }}>{t("pos.cardNote")}</div>
          {isDec(cashAmt, 2) && <div className="pay-change"><span>{t("pos.change")}</span><strong>{formatMoney(changeFor(cashAmt), currency)}</strong></div>}
          {cashAmt && !payments && <div className="field-error" role="alert">{t("pos.mixedInvalid")}</div>}
        </>
      )}
      </>}
    </Modal>
  );
}
