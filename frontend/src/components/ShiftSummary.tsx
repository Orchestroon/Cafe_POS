import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { CashMovement, Shift } from "../api/types";
import { VoidCashMoveDialog } from "./CashMoveDialog";
import { useAuth } from "../auth/AuthContext";
import { formatDateTime, formatMoney } from "../i18n/format";

/** Opening cash, sales, refunds, drawer expenses, cash in/out and expected cash; the cash movements,
 * the gap since the previous close, and the close result when closed. */
export function ShiftSummary({ shift }: { shift: Shift }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  const m = (v: string) => formatMoney(v, cur);
  const closed = shift.status === "closed";
  const diff = shift.difference;
  const admin = me?.user.role === "admin";
  const [voiding, setVoiding] = useState<CashMovement | null>(null);
  const gap = shift.since_previous_close;
  const rows: [string, string][] = [
    [t("shift.openingCash"), m(shift.opening_cash)],
    [t("shift.cashSales"), m(shift.totals.cash_sales)],
    [t("shift.cardSales"), m(shift.totals.card_sales)],
    [t("shift.cashRefunds"), m(shift.totals.cash_refunds)],
    [t("shift.cardRefunds"), m(shift.totals.card_refunds)],
    [t("shift.drawerExpenses"), m(shift.totals.drawer_expenses)],
    [t("cash.inTotal"), m(shift.totals.cash_in ?? "0.00")],
    [t("cash.outTotal"), m(shift.totals.cash_out ?? "0.00")],
    [t("shift.orders"), String(shift.totals.orders_count)],
  ];
  return (
    <div className="card shift-report">
      <div className="card-header">
        <div className="card-title">{shift.user.display_name} · {formatDateTime(shift.opened_at, tz)}</div>
        <span className={`badge ${closed ? "badge-off" : "badge-active"}`}>{t(`shift.${shift.status}`)}</span>
      </div>
      {gap && gap.difference !== "0.00" && (
        <div className="alert-banner alert-warning" role="note" style={{ marginBottom: 12 }}>
          {t(gap.difference.startsWith("-") ? "cash.gapOut" : "cash.gapIn", { previous: m(gap.previous_actual_cash), opening: m(shift.opening_cash), amount: m(gap.difference.replace("-", "")) })}
        </div>
      )}
      <div className="totals">
        {rows.map(([k, v]) => <div className="totals-row" key={k}><span>{k}</span><span>{v}</span></div>)}
        <div className="totals-row grand"><span>{t("shift.expectedCash")}</span><span>{m(shift.expected_cash ?? shift.totals.expected_cash)}</span></div>
        {closed && (
          <>
            <div className="totals-row"><span>{t("shift.actualCash")}</span><span>{m(shift.actual_cash ?? "0.00")}</span></div>
            <div className="totals-row grand">
              <span>{t("shift.difference")}</span>
              <span className={diff && diff.startsWith("-") ? "text-negative" : ""}>{m(diff ?? "0.00")}</span>
            </div>
            {diff && diff !== "0.00" && <div className="form-hint">{diff.startsWith("-") ? t("shift.shortage") : t("shift.overage")}</div>}
            <div className="form-hint">{t("shift.closedAt", { time: shift.closed_at ? formatDateTime(shift.closed_at, tz) : "", by: shift.closed_by?.display_name ?? "" })}</div>
            {shift.close_note && <div className="form-hint">{t("shift.note")}: {shift.close_note}</div>}
          </>
        )}
      </div>
      {!!shift.cash_movements?.length && (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <div className="card-title" style={{ marginBottom: 6 }}>{t("cash.listTitle")}</div>
          <table className="erp-table">
            <thead><tr><th>{t("common.date")}</th><th>{t("cash.kind")}</th><th className="num">{t("expenses.amount")}</th><th>{t("cash.reason")}</th><th>{t("audit.who")}</th><th className="no-print" /></tr></thead>
            <tbody>{shift.cash_movements.map((c) => (
              <tr key={c.id} className={c.status === "voided" ? "row-voided" : ""}>
                <td>{formatDateTime(c.created_at, tz)}</td><td>{t(`cash.${c.kind}`)}</td><td className="num">{m(c.amount)}</td>
                <td>{c.reason}{c.status === "voided" && <div className="form-hint">{t("cash.voided", { reason: c.void_reason })}</div>}</td><td>{c.created_by.display_name}</td>
                <td className="no-print">{admin && !closed && c.status === "posted" && <button className="btn btn-outline btn-sm" onClick={() => setVoiding(c)}>{t("cash.voidTitle")}</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {voiding && <VoidCashMoveDialog move={voiding} onClose={() => setVoiding(null)} />}
    </div>
  );
}
