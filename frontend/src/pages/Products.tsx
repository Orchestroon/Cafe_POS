import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Category, Product, Variant } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Check, Field, fieldError, isDecimal, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ErrorBanner } from "../components/States";
import { ListState, Pager, StatusBadge } from "../components/Table";
import { formatMoney } from "../i18n/format";

export function Products() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [editId, setEditId] = useState<string | "new" | null>(null);
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.all<Category>("/categories", { ordering: "sort_order" }) });
  const q = useQuery({ queryKey: ["products", page, search, cat], queryFn: () => api.list<Product>("/products", { page, search, category_id: cat }) });
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? "";
  const cur = me?.settings.currency ?? "";
  return (
    <>
      <PageHeader title={t("nav.products")} actions={<button className="btn btn-primary" onClick={() => setEditId("new")}>{t("common.new")}</button>} />
      <div className="card">
        <div className="toolbar">
          <div className="form-group"><label className="form-label">{t("common.search")}</label><input className="form-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
          <div className="form-group"><label className="form-label">{t("products.category")}</label>
            <select className="form-select" value={cat} onChange={(e) => { setCat(e.target.value); setPage(1); }}>
              <option value="">{t("common.all")}</option>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></div>
        </div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("common.name")}</th><th>{t("products.category")}</th><th>{t("products.sizes")}</th><th>{t("common.status")}</th><th /></tr></thead>
            <tbody>
              {q.data?.data.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td><td>{catName(p.category_id)}</td>
                  <td>{p.variants.map((v) => <span key={v.id} className={`badge ${v.is_active ? "badge-active" : "badge-off"}`} style={{ marginInlineEnd: 4 }}>{v.label} · {formatMoney(v.price, cur)}</span>)}</td>
                  <td><StatusBadge active={p.is_active} /></td>
                  <td><div className="row-actions"><button className="btn btn-outline btn-sm" onClick={() => setEditId(p.id)}>{t("common.edit")}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
        <Pager meta={q.data?.meta} page={page} onPage={setPage} />
      </div>
      {editId && <ProductEditor id={editId} categories={cats.data ?? []} onClose={() => setEditId(null)} />}
    </>
  );
}

function ProductEditor({ id, categories, onClose }: { id: string | "new"; categories: Category[]; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["product", id], enabled: id !== "new", queryFn: () => api.get<Product>(`/products/${id}`) });
  const [productId, setProductId] = useState<string | null>(id === "new" ? null : id);
  if (id !== "new" && existing.isLoading) return <Modal title={t("products.edit")} onClose={onClose}><div className="centered-state">{t("common.loading")}</div></Modal>;
  return (
    <Modal title={productId ? t("products.edit") : t("products.new")} onClose={onClose}>
      <ProductFields key={productId ?? "new"} product={existing.data} categories={categories} onSaved={(p) => { setProductId(p.id); void qc.invalidateQueries({ queryKey: ["products"] }); void qc.invalidateQueries({ queryKey: ["product", p.id] }); }} />
      {productId ? <Variants productId={productId} /> : <p className="form-hint">{t("products.saveFirst")}</p>}
    </Modal>
  );
}

function ProductFields({ product, categories, onSaved }: { product?: Product; categories: Category[]; onSaved: (p: Product) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    name: product?.name ?? "", category_id: product?.category_id ?? categories[0]?.id ?? "",
    description: product?.description ?? "", sort_order: String(product?.sort_order ?? 0), is_active: product?.is_active ?? true,
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, sort_order: Number(f.sort_order) || 0 };
      return product ? api.patch<Product>(`/products/${product.id}`, body) : api.post<Product>("/products", body);
    },
    onSuccess: onSaved,
  });
  const set = (k: string, v: string | boolean) => setF({ ...f, [k]: v });
  return (
    <>
      <ErrorBanner error={save.error} />
      <div className="form-grid">
        <TextField label={t("common.name")} value={f.name} onChange={(e) => set("name", e.target.value)} error={fieldError(save.error, "name")} />
        <Field label={t("products.category")} error={fieldError(save.error, "category_id")}>
          <select className="form-select" value={f.category_id} onChange={(e) => set("category_id", e.target.value)}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_active ? "" : ` (${t("common.inactive")})`}</option>)}
          </select>
        </Field>
      </div>
      <Field label={t("products.description")}><textarea className="form-input" value={f.description} onChange={(e) => set("description", e.target.value)} /></Field>
      <div className="form-grid">
        <TextField label={t("common.sort")} type="number" value={f.sort_order} onChange={(e) => set("sort_order", e.target.value)} />
        <Check label={t("common.active")} checked={f.is_active} onChange={(v) => set("is_active", v)} />
      </div>
      <button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{t("common.save")}</button>
    </>
  );
}

function Variants({ productId }: { productId: string }) {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["product", productId], queryFn: () => api.get<Product>(`/products/${productId}`) });
  const blank: Variant = { id: "", label: "", sku: "", price: "", sort_order: 0, is_active: true };
  return (
    <div style={{ marginTop: 20 }}>
      <h4 style={{ marginBottom: 8 }}>{t("products.sizes")}</h4>
      <div className="table-scroll">
        <table className="erp-table">
          <thead><tr><th>{t("products.label")}</th><th>{t("products.sku")}</th><th className="num">{t("products.price")}</th><th>{t("common.sort")}</th><th>{t("common.active")}</th><th /></tr></thead>
          <tbody>
            {q.data?.variants.map((v) => <VariantRow key={`${v.id}:${v.price}:${v.label}:${v.is_active}`} productId={productId} v={v} />)}
            <VariantRow key={`new:${q.data?.variants.length}`} productId={productId} v={blank} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VariantRow({ productId, v }: { productId: string; v: Variant }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ label: v.label, sku: v.sku ?? "", price: v.price, sort_order: String(v.sort_order), is_active: v.is_active });
  const [clientErr, setClientErr] = useState("");
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, sort_order: Number(f.sort_order) || 0 };
      return v.id ? api.patch(`/variants/${v.id}`, body) : api.post(`/products/${productId}/variants`, body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["product", productId] }); void qc.invalidateQueries({ queryKey: ["products"] }); },
  });
  const submit = () => {
    if (!f.label.trim()) return setClientErr(t("products.labelRequired"));
    if (!isDecimal(f.price, 2)) return setClientErr(t("products.priceInvalid"));
    setClientErr("");
    save.mutate();
  };
  const err = clientErr || (save.error ? (fieldError(save.error, "label") ?? fieldError(save.error, "price") ?? fieldError(save.error, "sku") ?? (save.error as Error).message) : "");
  return (
    <>
      <tr>
        <td><input aria-label={t("products.label")} className="form-input inline-input" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} /></td>
        <td><input aria-label={t("products.sku")} className="form-input inline-input" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></td>
        <td><input aria-label={t("products.price")} className="form-input inline-input num" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></td>
        <td><input aria-label={t("common.sort")} type="number" className="form-input inline-input" value={f.sort_order} onChange={(e) => setF({ ...f, sort_order: e.target.value })} /></td>
        <td><input aria-label={t("common.active")} type="checkbox" checked={f.is_active} onChange={(e) => setF({ ...f, is_active: e.target.checked })} /></td>
        <td><button className="btn btn-outline btn-sm" disabled={save.isPending} onClick={submit}>{v.id ? t("common.save") : t("products.addSize")}</button></td>
      </tr>
      {err && <tr><td colSpan={6}><div className="field-error" role="alert">{err}</div></td></tr>}
    </>
  );
}
