import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, NetworkError } from "../api/client";
import type { Ingredient, PayMethod, PaySource, Purchase, Supplier } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Field, fieldError, isDecimal, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ErrorBanner, Loading } from "../components/States";
import { addMoney, lineTotal, packCostFrom, packQty, unitCostFromPack } from "../lib/decimal";
import { formatDateTime, formatMoney } from "../i18n/format";
import { newKey } from "../lib/uuid";

interface Row { key: string; ingredient_id: string; mode: "pack" | "qty"; pack_label: string; pack_count: string; pack_size: string; pack_cost: string; qty: string; unit_cost: string }
interface Head { supplier_id: string; supplier_invoice_no: string; purchased_on: string; payment_method: PayMethod; source: PaySource; notes: string }

const blank = (): Row => ({ key: newKey(), ingredient_id: "", mode: "pack", pack_label: "", pack_count: "", pack_size: "", pack_cost: "", qty: "", unit_cost: "" });

/** Derived values for a row: the server recomputes everything; these are previews only. */
const derive = (r: Row) => {
  const pack = r.mode === "pack";
  const qty = pack ? (isDecimal(r.pack_count, 3) && isDecimal(r.pack_size, 3) ? packQty(r.pack_count, r.pack_size) : "") : r.qty;
  const unit = pack ? (isDecimal(r.pack_cost, 4) && isDecimal(r.pack_size, 3) ? unitCostFromPack(r.pack_cost, r.pack_size) : "") : r.unit_cost;
  const total = isDecimal(qty, 3) && isDecimal(unit, 4) ? lineTotal(qty, unit) : "";
  return { qty, unit, total };
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
  const posted = purchase?.status === "posted";
  const ings = useQuery({ queryKey: ["ingredients", "active"], queryFn: () => api.all<Ingredient>("/ingredients", { is_active: true, ordering: "name" }) });
  const sups = useQuery({ queryKey: ["suppliers", "active"], queryFn: () => api.all<Supplier>("/suppliers", { is_active: true }) });
  const [head, setHead] = useState<Head>({
    supplier_id: purchase?.supplier?.id ?? "", supplier_invoice_no: purchase?.supplier_invoice_no ?? "",
    purchased_on: purchase?.purchased_on ?? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()),
    payment_method: purchase?.payment_method ?? "cash", source: purchase?.source ?? "external", notes: purchase?.notes ?? "",
  });
  const [rows, setRows] = useState<Row[]>(() =>
    purchase && purchase.items.length > 0
      ? purchase.items.map((i) => {
          const pack = i.pack_count !== null && i.pack_size !== null;
          return { key: newKey(), ingredient_id: i.ingredient_id, mode: pack ? "pack" : "qty", pack_label: i.pack_label, pack_count: i.pack_count ?? "", pack_size: i.pack_size ?? "",
            pack_cost: pack ? packCostFrom(i.unit_cost, i.pack_size!) : "", qty: i.qty, unit_cost: i.unit_cost };
        })
      : [blank()],
  );
  const [dirty, setDirty] = useState(purchase === null);
  const [clientErr, setClientErr] = useState("");
  const [confirmPost, setConfirmPost] = useState(false);

  const setH = <K extends keyof Head>(k: K, v: Head[K]) => { setDirty(true); setHead({ ...head, [k]: v }); };
  const setRow = (key: string, patch: Partial<Row>) => { setDirty(true); setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r))); };
  const total = rows.reduce((s, r) => { const d = derive(r); return d.total ? addMoney(s, d.total) : s; }, "0.00");

  const body = () => ({
    supplier_id: head.supplier_id || null, supplier_invoice_no: head.supplier_invoice_no.trim(), purchased_on: head.purchased_on,
    payment_method: head.source === "cash_drawer" ? "cash" : head.payment_method, source: head.source, notes: head.notes.trim(),
    items: rows.map((r) => {
      const d = derive(r);
      return r.mode === "pack"
        ? { ingredient_id: r.ingredient_id, pack_label: r.pack_label.trim(), pack_count: r.pack_count.trim(), pack_size: r.pack_size.trim(), unit_cost: d.unit }
        : { ingredient_id: r.ingredient_id, qty: r.qty.trim(), unit_cost: r.unit_cost.trim(), pack_label: "" };
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
      const d = derive(r);
      if (!r.ingredient_id || !d.qty || !d.unit || Number(d.qty) <= 0) return t("purchases.rowInvalid");
    }
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
        <PageHeader title={t("purchases.viewTitle")} subtitle={`${purchase.purchased_on} · ${purchase.supplier?.name ?? "—"}`} actions={<Link className="btn btn-outline" to="/admin/purchases">{t("orders.back")}</Link>} />
        <div className="card">
          <div className="alert-banner alert-success" style={{ marginBottom: 12 }}>{t("purchases.postedNote", { time: purchase.posted_at ? formatDateTime(purchase.posted_at, tz) : "", by: purchase.posted_by?.display_name ?? "" })}</div>
          <table className="erp-table">
            <thead><tr><th>{t("nav.ingredients")}</th><th className="num">{t("inventory.qty")}</th><th className="num">{t("purchases.unitCost")}</th><th className="num">{t("pos.total")}</th></tr></thead>
            <tbody>
              {purchase.items.map((i) => (
                <tr key={i.id}><td>{i.ingredient_name}{i.pack_count && <div className="form-hint">{i.pack_count} × {i.pack_size} {i.unit} {i.pack_label}</div>}</td>
                  <td className="num mono">{i.qty} {i.unit}</td><td className="num mono">{i.unit_cost}</td><td className="num">{i.line_total}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="totals" style={{ marginTop: 12 }}>
            <div className="totals-row"><span>{t("purchases.pay")}</span><span>{t(`expenses.sources.${purchase.source}`)} · {t(`expenses.methods.${purchase.payment_method}`)}</span></div>
            <div className="totals-row grand"><span>{t("pos.total")}</span><span>{formatMoney(purchase.total, cur)}</span></div>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={purchase ? t("purchases.editTitle") : t("purchases.newTitle")} actions={<>
        <Link className="btn btn-outline" to="/admin/purchases">{t("orders.back")}</Link>
        {purchase && <button className="btn btn-outline" disabled={del.isPending} onClick={() => window.confirm(t("purchases.deleteConfirm")) && del.mutate()}>{t("purchases.delete")}</button>}
        <button className="btn btn-outline" disabled={save.isPending || !dirty} onClick={submit}>{t("common.save")}</button>
        {purchase && <button className="btn btn-primary" disabled={dirty || save.isPending} onClick={() => setConfirmPost(true)}>{t("purchases.post")}</button>}
      </>} />
      <ErrorBanner error={save.error ?? del.error} />
      {clientErr && <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{clientErr}</div>}
      {purchase && dirty && <div className="alert-banner alert-neutral" style={{ marginBottom: 12 }}>{t("purchases.saveFirst")}</div>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="form-grid">
          <Field label={t("purchases.supplier")} error={err("supplier_id")}>
            <select className="form-select" value={head.supplier_id} onChange={(e) => setH("supplier_id", e.target.value)}>
              <option value="">—</option>{sups.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <TextField label={t("purchases.invoiceNo")} value={head.supplier_invoice_no} maxLength={60} onChange={(e) => setH("supplier_invoice_no", e.target.value)} error={err("supplier_invoice_no")} />
          <TextField label={t("common.date")} type="date" value={head.purchased_on} onChange={(e) => setH("purchased_on", e.target.value)} error={err("purchased_on")} />
          <Field label={t("purchases.source")} error={err("source")} hint={head.source === "cash_drawer" ? t("purchases.drawerNote") : undefined}>
            <select className="form-select" value={head.source} onChange={(e) => setH("source", e.target.value as PaySource)}>
              <option value="external">{t("expenses.sources.external")}</option><option value="cash_drawer">{t("expenses.sources.cash_drawer")}</option>
            </select>
          </Field>
          {head.source === "external" && (
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
            <thead><tr><th>{t("nav.ingredients")}</th><th>{t("purchases.entry")}</th><th className="num">{t("purchases.packCount")}</th><th className="num">{t("purchases.packSize")}</th><th className="num">{t("purchases.packCost")}</th><th className="num">{t("inventory.qty")}</th><th className="num">{t("purchases.unitCost")}</th><th className="num">{t("pos.total")}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const d = derive(r);
                const unit = ings.data?.find((i) => i.id === r.ingredient_id)?.base_unit ?? "";
                const pack = r.mode === "pack";
                return (
                  <tr key={r.key}>
                    <td><select aria-label={t("nav.ingredients")} className="form-select" value={r.ingredient_id} onChange={(e) => setRow(r.key, { ingredient_id: e.target.value })}>
                      <option value="">—</option>{ings.data?.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.base_unit})</option>)}</select></td>
                    <td><select aria-label={t("purchases.entry")} className="form-select" value={r.mode} onChange={(e) => setRow(r.key, { mode: e.target.value as Row["mode"] })}>
                      <option value="pack">{t("purchases.byPack")}</option><option value="qty">{t("purchases.byQty")}</option></select></td>
                    <td>{pack && <input aria-label={t("purchases.packCount")} className="form-input inline-input num" inputMode="decimal" value={r.pack_count} onChange={(e) => setRow(r.key, { pack_count: e.target.value })} />}</td>
                    <td>{pack && <input aria-label={t("purchases.packSize")} className="form-input inline-input num" inputMode="decimal" placeholder={unit} value={r.pack_size} onChange={(e) => setRow(r.key, { pack_size: e.target.value })} />}</td>
                    <td>{pack && <input aria-label={t("purchases.packCost")} className="form-input inline-input num" inputMode="decimal" value={r.pack_cost} onChange={(e) => setRow(r.key, { pack_cost: e.target.value })} />}</td>
                    <td className="num mono">{pack ? `${d.qty} ${unit}` : <input aria-label={t("inventory.qty")} className="form-input inline-input num" inputMode="decimal" value={r.qty} onChange={(e) => setRow(r.key, { qty: e.target.value })} />}</td>
                    <td className="num mono">{pack ? d.unit : <input aria-label={t("purchases.unitCost")} className="form-input inline-input num" inputMode="decimal" value={r.unit_cost} onChange={(e) => setRow(r.key, { unit_cost: e.target.value })} />}</td>
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
      {confirmPost && (
        <Modal title={t("purchases.postTitle")} onClose={() => setConfirmPost(false)} footer={<>
          <button className="btn btn-outline" onClick={() => setConfirmPost(false)}>{t("common.cancel")}</button>
          <button className="btn btn-primary" disabled={post.isPending} onClick={() => post.mutate()}>{post.error instanceof NetworkError ? t("pos.retry") : t("purchases.postConfirm")}</button>
        </>}>
          <p>{t("purchases.postWarning", { total: formatMoney(purchase!.total, cur) })}</p>
          {head.source === "cash_drawer" && <p className="form-hint">{t("purchases.drawerNote")}</p>}
          {post.error instanceof NetworkError ? <div className="alert-banner alert-warning" role="alert">{t("purchases.postUnsure")}</div> : <ErrorBanner error={post.error} />}
        </Modal>
      )}
    </>
  );
}
