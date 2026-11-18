import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Expense, OrderDetail, OrderSummary, Shift } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { CashMoveDialog } from "../components/CashMoveDialog";
import { CloseShiftDialog } from "../components/CloseShiftDialog";
import { Drawer } from "../components/Drawer";
import { ExpenseDialog } from "../components/ExpenseDialog";
import { RefundDialog } from "../components/RefundDialog";
import { ShiftSummary } from "../components/ShiftSummary";
import { ErrorBanner, Loading } from "../components/States";
import { ListState, Pager } from "../components/Table";
import { formatDateTime, formatMoney } from "../i18n/format";

// Step 2: the three panels a Barista needs without leaving /pos. They reuse the dialogs and
// summaries of the old Orders / Expenses / Shift pages; only the list shells are new.

/** Today's orders (Barista) with invoice search, receipt reprint and the full refund. */
export function OrdersDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  const [page, setPage] = useState(1);
  const [invoice, setInvoice] = useState("");
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const params = { page, invoice_no: invoice.trim(), status };
  const q = useQuery({ queryKey: ["orders", "drawer", params], queryFn: () => api.list<OrderSummary>("/orders", params) });
  const reset = (set: (v: string) => void) => (v: string) => { set(v); setPage(1); };
  return (
    <Drawer title={t("pos.ordersRefund")} onClose={onClose}>
      <p className="form-hint" style={{ marginBottom: 10 }}>{me?.user.role === "admin" ? t("pos.ordersNoteAdmin") : t("orders.baristaNote")}</p>
      <div className="toolbar">
        <div className="form-group"><label className="form-label">{t("orders.invoiceSearch")}<input className="form-input" autoFocus value={invoice} onChange={(e) => reset(setInvoice)(e.target.value)} placeholder="POS-0000001" /></label></div>
        <div className="form-group"><label className="form-label">{t("common.status")}
          <select className="form-select" value={status} onChange={(e) => reset(setStatus)(e.target.value)}>
            <option value="">{t("common.all")}</option><option value="paid">{t("orders.paid")}</option><option value="refunded">{t("orders.refunded")}</option>
          </select></label></div>
      </div>
      <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
        <div className="order-cards drawer-orders" role="list">
          {q.data?.data.map((o) => (
            <div key={o.id} role="listitem">
              <button type="button" className="order-card" aria-expanded={openId === o.id} onClick={() => setOpenId(openId === o.id ? null : o.id)}>
                <span className="mono">{o.invoice_no}</span><span className="oc-total">{formatMoney(o.total, cur)}</span>
                <span className="form-hint">{formatDateTime(o.created_at, tz)} · {o.cashier.display_name}</span>
                <span><span className={`badge ${o.status === "paid" ? "badge-active" : "badge-danger"}`}>{t(`orders.${o.status}`)}</span></span>
              </button>
              {openId === o.id && <OrderPanel id={o.id} />}
            </div>
          ))}
        </div>
      </ListState>
      <Pager meta={q.data?.meta} page={page} onPage={setPage} />
    </Drawer>
  );
}

function OrderPanel({ id }: { id: string }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const [refunding, setRefunding] = useState(false);
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api.get<OrderDetail>(`/orders/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBanner error={q.error} />;
  const o = q.data;
  return (
    <div className="order-panel">
      {o.items.map((i) => (
        <div className="totals-row" key={i.id}>
          <span>{i.quantity} × {i.product_name} · {i.variant_label}{i.modifiers.length > 0 && <span className="form-hint"> ({i.modifiers.map((m) => m.option_label).join(", ")})</span>}</span>
          <span>{formatMoney(i.line_total, cur)}</span>
        </div>
      ))}
      <div className="totals-row grand"><span>{t("pos.total")}</span><span>{formatMoney(o.total, cur)}</span></div>
      {o.payments.map((p) => <div className="totals-row" key={p.method}><span>{t(`pos.tabs.${p.method}`)}</span><span>{formatMoney(p.amount, cur)}</span></div>)}
      {o.refund && <div className="form-hint">{t("orders.reason")}: {o.refund.reason}</div>}
      <div className="drawer-actions">
        <Link className="btn btn-outline btn-sm" to={`/orders/${o.id}/receipt?reprint=1`}>{t("orders.reprint")}</Link>
        {o.status === "paid" && <button className="btn btn-danger btn-sm" onClick={() => setRefunding(true)}>{t("orders.refund")}</button>}
      </div>
      {refunding && <RefundDialog order={o} onClose={() => setRefunding(false)} />}
    </div>
  );
}

/** "Pay from drawer" (no External option) and the drawer expenses of the current shift. */
export function ExpensesDrawer({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: ["expenses", "drawer", shift?.id, page],
    enabled: !!shift,
    queryFn: () => api.list<Expense>("/expenses", { shift_id: shift!.id, source: "cash_drawer", page }),
  });
  return (
    <Drawer title={t("expenses.payFromDrawer")} onClose={onClose}>
      {!shift ? <p>{t("pos.drawerNeedsShift")}</p> : (
        <>
          <button className="btn btn-primary btn-block" autoFocus onClick={() => setAdding(true)}>{t("expenses.payFromDrawer")}</button>
          <h4 className="drawer-subtitle">{t("pos.shiftExpenses")}</h4>
          <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
            <table className="erp-table">
              <thead><tr><th>{t("common.date")}</th><th>{t("expenses.description")}</th><th className="num">{t("expenses.amount")}</th></tr></thead>
              <tbody>
                {q.data?.data.map((e) => (
                  <tr key={e.id} className={e.status === "voided" ? "row-voided" : ""}>
                    <td>{formatDateTime(e.paid_at, tz)}</td>
                    <td>{t(`expenses.categories.${e.category}`)} · {e.description}{e.status === "voided" && <div className="form-hint">{t("expenses.voidedBecause", { reason: e.void_reason })}</div>}</td>
                    <td className="num">{formatMoney(e.amount, cur)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ListState>
          <Pager meta={q.data?.meta} page={page} onPage={setPage} />
        </>
      )}
      {adding && <ExpenseDialog drawerOnly onClose={() => setAdding(false)} />}
    </Drawer>
  );
}

/** Active shift summary with Cash in/out and Close shift. */
export function ShiftDrawer({ shift, onClose }: { shift: Shift | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const nav = useNavigate();
  const [dlg, setDlg] = useState<"cash" | "close" | null>(null);
  const admin = me?.user.role === "admin";
  return (
    <Drawer title={t("pos.shiftClose")} onClose={onClose}>
      {!shift ? <p>{t("shift.none")}</p> : (
        <>
          <ShiftSummary shift={shift} />
          <div className="drawer-actions">
            <button className="btn btn-outline" onClick={() => setDlg("cash")}>{t("cash.title")}</button>
            <button className="btn btn-primary" onClick={() => setDlg("close")}>{t("shift.closeShift")}</button>
          </div>
        </>
      )}
      {admin && <Link className="btn btn-ghost btn-block" style={{ marginTop: 12 }} to="/admin/shifts">{t("shift.allShifts")}</Link>}
      {dlg === "cash" && <CashMoveDialog onClose={() => setDlg(null)} />}
      {dlg === "close" && shift && <CloseShiftDialog shift={shift} onClose={() => setDlg(null)} onDone={(s) => { onClose(); if (admin) nav(`/shift/${s.id}`); }} />}
    </Drawer>
  );
}
