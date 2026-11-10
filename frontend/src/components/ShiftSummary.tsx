import { useTranslation } from "react-i18next";
import type { Shift } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { formatDateTime, formatMoney } from "../i18n/format";

/** Opening cash, sales, refunds, drawer expenses and expected cash; plus the close result when closed. */
export function ShiftSummary({ shift }: { shift: Shift }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  const m = (v: string) => formatMoney(v, cur);
  const closed = shift.status === "closed";
  const diff = shift.difference;
  const rows: [string, string][] = [
    [t("shift.openingCash"), m(shift.opening_cash)],
    [t("shift.cashSales"), m(shift.totals.cash_sales)],
    [t("shift.cardSales"), m(shift.totals.card_sales)],
    [t("shift.cashRefunds"), m(shift.totals.cash_refunds)],
    [t("shift.cardRefunds"), m(shift.totals.card_refunds)],
    [t("shift.drawerExpenses"), m(shift.totals.drawer_expenses)],
    [t("shift.orders"), String(shift.totals.orders_count)],
  ];
  return (
    <div className="card shift-report">
      <div className="card-header">
        <div className="card-title">{shift.user.display_name} · {formatDateTime(shift.opened_at, tz)}</div>
        <span className={`badge ${closed ? "badge-off" : "badge-active"}`}>{t(`shift.${shift.status}`)}</span>
      </div>
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
    </div>
  );
}
