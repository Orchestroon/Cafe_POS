import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, NetworkError } from "../api/client";
import type { Ingredient, PayMethod, PaySource, Purchase, Supplier, Unit } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Field, fieldError, isDecimal, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { HistoryLink } from "./AuditLog";
import { ErrorBanner, Loading } from "../components/States";
import { addMoney, lineTotal, normMoney, packCostFrom, packQty, toUnits } from "../lib/decimal";
import { avgFrom, costPer, readable, toBase, unitsFor, validEntry, type EntryUnit } from "../lib/units";
import { IngredientForm } from "../components/IngredientForm";
import { PaySupplierDialog } from "../components/PaySupplierDialog";
import { SupplierDialog } from "./Suppliers";
import { formatDateTime, formatMoney } from "../i18n/format";
import { newKey } from "../lib/uuid";

// Sprint 5 L4 (owner, 2026-11-17): a line is what was bought and what was paid ("500 kg for 785");
// the system works out the cost per unit. "By pack" stays as a second way to type it.
interface Row { key: string; ingredient_id: string; mode: "pack" | "qty"; pack_label: string; pack_count: string; pack_size: string; pack_cost: string; qty: string; entry_unit: EntryUnit; total: string }
interface Head { supplier_id: string; supplier_invoice_no: string; purchased_on: string; payment_method: PayMethod; source: PaySource; notes: string; on_credit: boolean }

const blank = (): Row => ({ key: newKey(), ingredient_id: "", mode: "qty", pack_label: "", pack_count: "", pack_size: "", pack_cost: "", qty: "", entry_unit: "kg", total: "" });

/** Derived values for a row (base quantity, cost per base unit, line total): previews only, the
 * server recomputes everything. The line total is always what was typed / paid. */
const derive = (r: Row, base: Unit | undefined) => {
  if (r.mode === "pack") {
    const qty = isDecimal(r.pack_count, 3) && isDecimal(r.pack_size, 3) ? packQty(r.pack_count, r.pack_size) : "";
    const total = isDecimal(r.pack_count, 3) && isDecimal(r.pack_cost, 4) ? lineTotal(r.pack_count, r.pack_cost) : "";
    return { qty, total, avg: qty && total ? avgFrom(total, qty) : null };
  }
  const units = base ? unitsFor(base) : [];
  const unit = units.includes(r.entry_unit) ? r.entry_unit : units[0];
  const qty = unit && validEntry(r.qty.trim(), unit) ? toBase(r.qty.trim(), unit) : "";
  const total = isDecimal(r.total, 2) ? normMoney(r.total) : "";
  return { qty, total, avg: qty && total ? avgFrom(total, qty) : null };
};

export function PurchaseEditor() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["purchase", id], queryFn: () => api.get<Purchase>(`/purchases/${id}`), enabled: id !== "new" });
  if (id !== "new" && (q.isLoading || !q.data)) return q.error ? <ErrorBanner error={q.error} /> : <Loading />;
  return <Editor key={id} purchase={id === "new" ? null : q.data!} />;
}

function Editor({ purchase }: { purchase: Purchase | null }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const nav = useNavigate();
  const cur = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";
  const posted = !!purchase && purchase.status !== "draft";
  const ings = useQuery({ queryKey: ["ingredients", "active"], queryFn: () => api.all<Ingredient>("/ingredients", { is_active: true, ordering: "name" }) });
  const sups = useQuery({ queryKey: ["suppliers", "active"], queryFn: () => api.all<Supplier>("/suppliers", { is_active: true }) });
  const [head, setHead] = useState<Head>({
    supplier_id: purchase?.supplier?.id ?? "", supplier_invoice_no: purchase?.supplier_invoice_no ?? "",
    purchased_on: purchase?.purchased_on ?? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()),
    payment_method: purchase?.payment_method ?? "cash", source: purchase?.source ?? "external", notes: purchase?.notes ?? "", on_credit: purchase?.on_credit ?? false,
  });
  const [rows, setRows] = useState<Row[]>(() =>
    purchase && purchase.items.length > 0
      ? purchase.items.map((i) => {
          const pack = i.pack_count !== null && i.pack_size !== null;
          return { key: newKey(), ingredient_id: i.ingredient_id, mode: pack ? "pack" : "qty", pack_label: i.pack_label, pack_count: i.pack_count ?? "", pack_size: i.pack_size ?? "",
            pack_cost: pack ? i.pack_cost ?? packCostFrom(i.unit_cost, i.pack_size!) : "", qty: i.qty, entry_unit: i.unit ?? "g", total: i.line_total ?? "" };
        })
      : [blank()],
  );
  const [dirty, setDirty] = useState(purchase === null);
  const [clientErr, setClientErr] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [paying, setPaying] = useState(false);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [addingIngredientFor, setAddingIngredientFor] = useState<string | null>(null); // the line that gets the new ingredient
  const qtyText = (q: string, u: Unit) => { const r = readable(q, u); return `${r.qty} ${t(`units.${r.unit}`)}`; };
  const perText = (avg: string, u: Unit) => { const c = costPer(avg, u); return t("reports.perUnit", { cost: formatMoney(c.amount, cur), unit: t(`units.${c.unit}`) }); };

  const setH = <K extends keyof Head>(k: K, v: Head[K]) => { setDirty(true); setHead({ ...head, [k]: v }); };
  const setRow = (key: string, patch: Partial<Row>) => { setDirty(true); setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))); };
  const baseOf = (id: string) => ings.data?.find((i) => i.id === id)?.base_unit;
  const total = rows.reduce((s, r) => { const d = derive(r, baseOf(r.ingredient_id)); return d.total ? addMoney(s, d.total) : s; }, "0.00");

  const body = () => ({
    supplier_id: head.supplier_id || null, supplier_invoice_no: head.supplier_invoice_no.trim(), purchased_on: head.purchased_on,
    payment_method: head.source === "cash_drawer" ? "cash" : head.payment_method, source: head.source, notes: head.notes.trim(), on_credit: head.on_credit,
    items: rows.map((r) => {
      if (r.mode === "pack") return { ingredient_id: r.ingredient_id, pack_label: r.pack_label.trim(), pack_count: r.pack_count.trim(), pack_size: r.pack_size.trim(), pack_cost: r.pack_cost.trim() };
      const d = derive(r, baseOf(r.ingredient_id));
      return { ingredient_id: r.ingredient_id, qty: d.qty, line_total: d.total, pack_label: "" };
    }),
  });
  const save = useMutation({
    mutationFn: () => (purchase ? api.patch<Purchase>(`/purchases/${purchase.id}`, body()) : api.post<Purchase>("/purchases", body())),
    onSuccess: (p) => {
      setDirty(false);
      qc.setQueryData(["purchase", p.id], p);
      void qc.invalidateQueries({ queryKey: ["purchases"] });
      if (!purchase) nav(`/admin/purchases/${p.id}`, { replace: true });
    },
  });
  const validate = () => {
    if (!head.purchased_on) return t("purchases.dateRequired");
    if (rows.length === 0) return t("purchases.itemsRequired");
    for (const r of rows) {
      const d = derive(r, baseOf(r.ingredient_id));
      if (!r.ingredient_id || !d.qty || !d.total || toUnits(d.qty, 3) <= 0n) return t("purchases.rowInvalid");
    }
    if (head.on_credit && !head.supplier_id) return t("purchases.creditNeedsSupplier");
    return "";
  };
  const submit = () => { const e = validate(); setClientErr(e); if (!e) save.mutate(); };
  const del = useMutation({
    mutationFn: () => api.del(`/purchases/${purchase!.id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["purchases"] }); nav("/admin/purchases"); },
  });
  const key = useRef(newKey());
  const post = useMutation({
    mutationFn: () => api.postIdempotent<Purchase>(`/purchases/${purchase!.id}/post`, {}, key.current),
    onError: (e) => { if (!(e instanceof NetworkError)) key.current = newKey(); },
    onSuccess: (p) => {
      qc.setQueryData(["purchase", p.id], p);
      for (const k of ["purchases", "balances", "movements", "expenses", "shift"]) void qc.invalidateQueries({ queryKey: [k] });
      setConfirmPost(false);
      nav(`/admin/purchases/${p.id}`, { replace: true });
    },
  });
  const err = (k: string) => fieldError(save.error, k);

  if (posted) {
    return (
      <>
        <PageHeader title={t("purchases.viewTitle")} subtitle={`${purchase.receipt_no ? `${purchase.receipt_no} · ` : ""}${purchase.purchased_on} · ${purchase.supplier?.name ?? "—"}`} actions={<><Link className="btn btn-outline" to="/admin/purchases">{t("orders.back")}</Link><HistoryLink entityType="purchasing.purchase" entityId={purchase.id} />
          {purchase.status === "posted" && <button className="btn btn-outline" onClick={() => setVoiding(true)}>{t("purchases.void")}</button>}</>} />
        <div className="card">
          <div className="alert-banner alert-success" style={{ marginBottom: 12 }}>{t("purchases.postedNote", { time: purchase.posted_at ? formatDateTime(purchase.posted_at, tz) : "", by: purchase.posted_by?.display_name ?? "" })}</div>
          {purchase.status === "voided" && <div className="alert-banner alert-warning" role="note" style={{ marginBottom: 12 }}>{t("purchases.voidedNote", { time: purchase.voided_at ? formatDateTime(purchase.voided_at, tz) : "", by: purchase.voided_by?.display_name ?? "", reason: purchase.void_reason })}</div>}
          <div className="table-scroll"><table className="erp-table">
            <thead><tr><th>{t("nav.ingredients")}</th><th className="num">{t("inventory.qty")}</th><th className="num">{t("purchases.unitCost")}</th><th className="num">{t("pos.total")}</th></tr></thead>
            <tbody>
              {purchase.items.map((i) => {
                const avg = i.line_total ? avgFrom(i.line_total, i.qty) : null;
                return (
                  <tr key={i.id}><td>{i.ingredient_name}{i.pack_count && <div className="form-hint">{i.pack_count} × {i.pack_size} {i.unit} {i.pack_label}</div>}</td>
                    <td className="num mono">{i.unit ? qtyText(i.qty, i.unit) : i.qty}</td><td className="num mono">{avg && i.unit ? perText(avg, i.unit) : "—"}</td><td className="num">{i.line_total}</td></tr>
                );
              })}
            </tbody>
          </table></div>
          <div className="totals" style={{ marginTop: 12 }}>
            <div className="totals-row"><span>{t("purchases.pay")}</span><span>{purchase.on_credit ? t("purchases.onCredit") : `${t(`expenses.sources.${purchase.source}`)} · ${t(`expenses.methods.${purchase.payment_method}`)}`}</span></div>
            <div className="totals-row grand"><span>{t("pos.total")}</span><span>{formatMoney(purchase.total, cur)}</span></div>
            {purchase.on_credit && <>
              <div className="totals-row"><span>{t("suppliers.paid")}</span><span>{formatMoney(purchase.amount_paid, cur)}</span></div>
              <div className="totals-row grand"><span>{t("suppliers.owed")}</span><span className={purchase.owed !== "0.00" ? "text-negative" : ""}>{formatMoney(purchase.owed, cur)}</span></div>
            </>}
          </div>
          {purchase.on_credit && purchase.owed !== "0.00" && purchase.supplier && (
            <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => setPaying(true)}>{t("suppliers.pay")}</button>
          )}
        </div>
        {voiding && <VoidPurchaseDialog purchase={purchase} onClose={() => setVoiding(false)} />}
        {paying && purchase.supplier && <PaySupplierDialog supplier={purchase.supplier} preselect={purchase.id} onClose={() => setPaying(false)} />}
      </>
    );
  }

  return (
    <>
      <PageHeader title={purchase ? t("purchases.editTitle") : t("purchases.newTitle")} actions={<>
        <Link className="btn btn-outline" to="/admin/purchases">{t("orders.back")}</Link>
        {purchase && <HistoryLink entityType="purchasing.purchase" entityId={purchase.id} />}
        {purchase && <button className="btn btn-outline" disabled={del.isPending} onClick={() => window.confirm(t("purchases.deleteConfirm")) && del.mutate()}>{t("purchases.delete")}</button>}
        <button className="btn btn-outline" disabled={save.isPending || !dirty} onClick={submit}>{t("common.save")}</button>
        {purchase && <button className="btn btn-primary" disabled={dirty || save.isPending} onClick={() => setConfirmPost(true)}>{t("purchases.post")}</button>}
      </>} />
      <ErrorBanner error={save.error ?? del.error} />
      {clientErr && <div className="alert-banner alert-error" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      {purchase && dirty && <div className="alert-banner alert-neutral" style={{ marginBottom: 12 }}>{t("purchases.saveFirst")}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <div className="form-group">
            <label className="form-label" htmlFor="pu-supplier">{t("purchases.supplier")}</label>
            <span className="with-add">
              <select id="pu-supplier" className="form-select" value={head.supplier_id} onChange={(e) => setH("supplier_id", e.target.value)}>
                <option value="">—</option>{sups.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" className="btn btn-outline" aria-label={t("purchases.newSupplier")} title={t("purchases.newSupplier")} onClick={() => setAddingSupplier(true)}>+</button>
            </span>
            {err("supplier_id") && <div className="field-error" role="alert">{err("supplier_id")}</div>}
          </div>
          <TextField label={t("purchases.invoiceNo")} value={head.supplier_invoice_no} maxLength={60} onChange={(e) => setH("supplier_invoice_no", e.target.value)} error={err("supplier_invoice_no")} />
          <TextField label={t("common.date")} type="date" value={head.purchased_on} onChange={(e) => setH("purchased_on", e.target.value)} error={err("purchased_on")} />
          <Field label={t("purchases.paymentTerms")} hint={head.on_credit ? t("purchases.creditHint") : undefined}>
            <select className="form-select" value={head.on_credit ? "credit" : "paid"} onChange={(e) => setH("on_credit", e.target.value === "credit")}>
              <option value="paid">{t("purchases.paidNow")}</option><option value="credit">{t("purchases.onCredit")}</option>
            </select>
          </Field>
          {!head.on_credit && <Field label={t("purchases.source")} error={err("source")} hint={head.source === "cash_drawer" ? t("purchases.drawerNote") : undefined}>
            <select className="form-select" value={head.source} onChange={(e) => setH("source", e.target.value as PaySource)}>
              <option value="external">{t("expenses.sources.external")}</option><option value="cash_drawer">{t("expenses.sources.cash_drawer")}</option>
            </select>
          </Field>}
          {!head.on_credit && head.source === "external" && (
            <Field label={t("expenses.method")} error={err("payment_method")}>
              <select className="form-select" value={head.payment_method} onChange={(e) => setH("payment_method", e.target.value as PayMethod)}>
                {(["cash", "card", "transfer"] as const).map((m) => <option key={m} value={m}>{t(`expenses.methods.${m}`)}</option>)}
              </select>
            </Field>
          )}
          <TextField label={t("suppliers.notes")} value={head.notes} maxLength={300} onChange={(e) => setH("notes", e.target.value)} />
        </div>
      </div>
      <div className="card">
        <div className="card-header"><div className="card-title">{t("purchases.items")}</div>
          <button className="btn btn-outline btn-sm" onClick={() => { setDirty(true); setRows([...rows, blank()]); }}>{t("purchases.addItem")}</button></div>
        <p className="form-hint" style={{ marginBottom: 8 }}>{t("purchases.packHint")}</p>
        <div className="table-scroll">
          <table className="erp-table">
            <thead><tr><th>{t("nav.ingredients")}</th><th>{t("purchases.entry")}</th><th>{t("inventory.qty")}</th><th className="num">{t("purchases.price")}</th><th className="num">{t("purchases.unitCost")}</th><th className="num">{t("pos.total")}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const base = baseOf(r.ingredient_id);
                const d = derive(r, base);
                const units = base ? unitsFor(base) : [];
                const unit = units.includes(r.entry_unit) ? r.entry_unit : units[0];
                const pack = r.mode === "pack";
                return (
                  <tr key={r.key}>
                    <td><span className="with-add"><select aria-label={t("nav.ingredients")} className="form-select" value={r.ingredient_id} onChange={(e) => setRow(r.key, { ingredient_id: e.target.value })}>
                      <option value="">—</option>{ings.data?.map((i) => <option key={i.id} value={i.id}>{i.name} ({t(`units.${i.base_unit}`)})</option>)}</select>
                      <button type="button" className="btn btn-outline" aria-label={t("purchases.newIngredient")} title={t("purchases.newIngredient")} onClick={() => setAddingIngredientFor(r.key)}>+</button></span></td>
                    <td><select aria-label={t("purchases.entry")} className="form-select" value={r.mode} onChange={(e) => setRow(r.key, { mode: e.target.value as Row["mode"] })}>
                      <option value="qty">{t("purchases.byQty")}</option><option value="pack">{t("purchases.byPack")}</option></select></td>
                    <td>{pack ? (
                      <div className="inline-pair">
                        <input aria-label={t("purchases.packCount")} placeholder={t("purchases.packCount")} className="form-input inline-input num" inputMode="decimal" value={r.pack_count} onChange={(e) => setRow(r.key, { pack_count: e.target.value })} />
                        <span>×</span>
                        <input aria-label={t("purchases.packSize")} placeholder={base ? t(`units.${base}`) : t("purchases.packSize")} className="form-input inline-input num" inputMode="decimal" value={r.pack_size} onChange={(e) => setRow(r.key, { pack_size: e.target.value })} />
                      </div>
                    ) : (
                      <div className="inline-pair">
                        <input aria-label={t("inventory.qty")} className="form-input inline-input num" inputMode="decimal" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />
                        <select aria-label={t("ingredients.unit")} className="form-select" value={unit ?? ""} onChange={(e) => setRow(r.key, { entry_unit: e.target.value as EntryUnit })}>
                          {units.map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
                        </select>
                      </div>
                    )}</td>
                    <td>{pack
                      ? <input aria-label={t("purchases.packCost")} placeholder={t("purchases.packCost")} className="form-input inline-input num" inputMode="decimal" value={r.pack_cost} onChange={(e) => setRow(r.key, { pack_cost: e.target.value })} />
                      : <input aria-label={t("purchases.totalPaid")} placeholder={t("purchases.totalPaid")} className="form-input inline-input num" inputMode="decimal" value={r.total} onChange={(e) => setRow(r.key, { total: e.target.value })} />}</td>
                    <td className="num mono">{d.avg && base ? perText(d.avg, base) : "—"}</td>
                    <td className="num">{d.total}</td>
                    <td><button className="icon-btn" aria-label={t("common.remove")} onClick={() => { setDirty(true); setRows(rows.filter((x) => x.key !== r.key)); }}>✕</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="totals" style={{ marginTop: 12 }}><div className="totals-row grand"><span>{t("pos.total")}</span><span>{formatMoney(total, cur)}</span></div></div>
      </div>
      {addingIngredientFor && (
        <IngredientForm initial={{ base_unit: "g", is_active: true }} onClose={() => setAddingIngredientFor(null)}
          onSaved={(i) => { qc.setQueryData<Ingredient[]>(["ingredients", "active"], (old) => [...(old ?? []).filter((x) => x.id !== i.id), i].sort((a, b) => a.name.localeCompare(b.name))); setRow(addingIngredientFor, { ingredient_id: i.id }); }} />
      )}
      {addingSupplier && (
        <SupplierDialog supplier={null} onClose={() => setAddingSupplier(false)}
          onSaved={(s) => { qc.setQueryData<Supplier[]>(["suppliers", "active"], (old) => [...(old ?? []).filter((x) => x.id !== s.id), s]); setH("supplier_id", s.id); }} />
      )}
      {confirmPost && (
        <Modal title={t("purchases.postTitle")} onClose={() => setConfirmPost(false)} footer={<>
          <button className="btn btn-outline" onClick={() => setConfirmPost(false)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={post.isPending} onClick={() => post.mutate()}>{post.error instanceof NetworkError ? t("pos.retry") : t("purchases.postConfirm")}</button>
        </>}>
          <p>{head.on_credit ? t("purchases.postWarningCredit", { total: formatMoney(purchase!.total, cur) }) : t("purchases.postWarning", { total: formatMoney(purchase!.total, cur) })}</p>
          {!head.on_credit && head.source === "cash_drawer" && <p className="form-hint">{t("purchases.drawerNote")}</p>}
          {post.error instanceof NetworkError ? <div className="alert-banner alert-error" role="alert">{t("purchases.postUnsure")}</div> : <ErrorBanner error={post.error} />}
        </Modal>
      )}
    </>
  );
}

/** Void a posted purchase (Admin, reason required): stock goes back out, its expense is cancelled. */
function VoidPurchaseDialog({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [clientErr, setClientErr] = useState("");
  const v = useMutation({
    mutationFn: () => api.post<Purchase>(`/purchases/${purchase.id}/void`, { reason: reason.trim() }),
    onSuccess: (p) => {
      qc.setQueryData(["purchase", p.id], p);
      for (const k of ["purchases", "balances", "movements", "expenses", "shift", "report"]) void qc.invalidateQueries({ queryKey: [k] });
      onClose();
    },
  });
  const submit = () => (reason.trim() ? (setClientErr(""), v.mutate()) : setClientErr(t("purchases.voidReasonRequired")));
  return (
    <Modal title={t("purchases.voidTitle")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-primary" disabled={v.isPending} onClick={submit}>{t("purchases.voidConfirm")}</button>
    </>}>
      <p style={{ marginBottom: 10 }}>{t("purchases.voidText", { total: formatMoney(purchase.total, me?.settings.currency ?? "") })}</p>
      <ErrorBanner error={v.error} />
      <TextField label={t("purchases.voidReason")} autoFocus value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} error={clientErr} />
    </Modal>
  );
}
