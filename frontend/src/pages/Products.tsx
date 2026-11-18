// Products & recipes (owner design, 2026-11-16): menu list on the left, one editor on the right
// (details, sizes, per-serving recipe, consumption preview, stock, modifier groups) and ONE save
// that writes everything in one transaction (PUT/POST /products/.../setup).
// All rules stay: prices and recipes per size, waste %, slots, "Track stock" (B3), modifiers.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { needsRecipe, type Balance, type Category, type Ingredient, type ModifierGroup, type Product, type ProductSetup, type RecipeWarning, type Unit } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { fieldError, isDecimal } from "../components/Form";
import { PageHeader } from "../components/PageHeader";
import { Kbd } from "../components/ShortcutsHelp";
import { ErrorBanner, Loading } from "../components/States";
import { formatMoney } from "../i18n/format";
import { addMoney, isDec, marginPct, perUnitQty, servingCost, subMoney, toUnits } from "../lib/decimal";
import { optionLines, optionPrice, withOption } from "../lib/optionCost";
import { useShortcuts } from "../lib/shortcuts";
import { gte, inLarge, readable, times, toBase, trim, unitsFor, validEntry, type EntryUnit } from "../lib/units";
import { confirmLeave, setUnsaved } from "../lib/unsaved";
import { HistoryLink } from "./AuditLog";

// ---- draft model ------------------------------------------------------------------------------
type PType = "made" | "stock" | "none" | "mixed";
interface Line { key: number; ingredient_id: string; qty: string; unit: EntryUnit; waste: string; slot: string; name?: string; base?: Unit }
interface Size { key: number; id?: string; label: string; sku: string; price: string; is_active: boolean; track_stock: boolean; lines: Line[]; warnings: RecipeWarning[] }
interface Draft { name: string; category_id: string; description: string; sort_order: number; is_active: boolean; sizes: Size[]; groups: string[] }

let seq = 0;
const newLine = (p: Partial<Line> = {}): Line => ({ key: ++seq, ingredient_id: "", qty: "", unit: "g", waste: "0", slot: "", ...p });
const newSize = (label: string): Size => ({ key: ++seq, label, sku: "", price: "", is_active: true, track_stock: true, lines: [], warnings: [] });

function fromSetup(p: ProductSetup): Draft {
  return {
    name: p.name, category_id: p.category_id, description: p.description, sort_order: p.sort_order, is_active: p.is_active,
    groups: p.modifier_groups.map((g) => g.group_id),
    sizes: p.variants.map((v) => ({
      key: ++seq, id: v.id, label: v.label, sku: v.sku ?? "", price: v.price, is_active: v.is_active, track_stock: v.track_stock,
      warnings: v.recipe.warnings,
      lines: v.recipe.lines.map((l) => newLine({ ingredient_id: l.ingredient_id, qty: trim(l.base_qty), unit: (l.unit ?? "g") as EntryUnit, waste: trim(l.waste_pct), slot: l.slot_key ?? "", name: l.ingredient_name, base: l.unit })),
    })),
  };
}

/** Waste as the server stores it: "5" → "5.00". */
const wasteStr = (w: string) => { const n = toUnits(w, 2); return `${n / 100n}.${String(n % 100n).padStart(2, "0")}`; };

/** What the server will store: used for the dirty check and the save body. */
function normalize(d: Draft) {
  return {
    product: { name: d.name.trim(), category_id: d.category_id, description: d.description, sort_order: d.sort_order, is_active: d.is_active },
    variants: d.sizes.map((s, i) => ({
      ...(s.id ? { id: s.id } : {}),
      label: s.label.trim(), sku: s.sku.trim() || null, price: s.price.trim(), sort_order: i, is_active: s.is_active, track_stock: s.track_stock,
      recipe: s.track_stock ? s.lines.map((l) => ({
        ingredient_id: l.ingredient_id,
        base_qty: validEntry(l.qty.trim(), l.unit) ? toBase(l.qty.trim(), l.unit) : l.qty.trim(),
        waste_pct: isDec(l.waste.trim() || "0", 2) ? wasteStr(l.waste.trim() || "0") : l.waste.trim(),
        slot_key: l.slot.trim() || null,
      })) : [],
    })),
    modifier_groups: d.groups.map((group_id, i) => ({ group_id, sort_order: i })),
  };
}

/** Product type from its sizes (D18: a bought item is one "pcs" ingredient × 1). */
function typeOf(sizes: Size[], ings: Map<string, Ingredient>): PType {
  if (sizes.length === 0) return "made";
  const t = sizes.map((s): PType => {
    if (!s.track_stock) return "none";
    const l = s.lines[0];
    const unit = l ? ings.get(l.ingredient_id)?.base_unit ?? l.base : undefined;
    return s.lines.length === 1 && unit === "pcs" && trim(l.qty) === "1" && trim(l.waste || "0") === "0" ? "stock" : "made";
  });
  return t.every((x) => x === t[0]) ? t[0] : "mixed";
}

// ---- page -------------------------------------------------------------------------------------
export function Products() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const [params, setParams] = useSearchParams();
  const selected = params.get("id"); // product id, "new", or null
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const products = useQuery({ queryKey: ["products", "all"], queryFn: () => api.all<Product>("/products", { ordering: "sort_order" }) });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api.all<Category>("/categories", { ordering: "sort_order" }) });
  const catName = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? "";
  const open = (id: string | null) => { if (confirmLeave()) setParams(id ? { id } : {}); };

  const needle = search.trim().toLowerCase();
  const list = (products.data ?? []).filter((p) => (!cat || p.category_id === cat) && (!needle || p.name.toLowerCase().includes(needle) || p.variants.some((v) => (v.sku ?? "").toLowerCase().includes(needle))));

  return (
    <>
      <PageHeader title={t("nav.products")} subtitle={t("products.subtitle")} actions={<button className="btn btn-primary" data-shortcut="new" onClick={() => open("new")}>{t("products.add")}<Kbd k="N" /></button>} />
      <div className={`pr-layout${selected ? " has-selection" : ""}`}>
        <aside className="card pr-list" aria-label={t("products.menu")}>
          <div className="pr-list-head"><h3>{t("products.menu")}</h3><span className="pr-count">{t("products.items", { count: products.data?.length ?? 0 })}</span></div>
          <input className="form-input" type="search" data-shortcut="search" placeholder={t("products.searchHint")} aria-label={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="form-select" aria-label={t("products.category")} value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">{t("products.allCategories")}</option>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <ErrorBanner error={products.error} />
          {products.isLoading ? <Loading /> : (
            <ul className="pr-items">
              {list.map((p) => <ProductItem key={p.id} p={p} cat={catName(p.category_id)} currency={cur} active={p.id === selected} onOpen={() => open(p.id)} />)}
              {list.length === 0 && <li className="form-hint pr-empty">{t("products.none")}</li>}
            </ul>
          )}
          <div className="pr-list-foot form-hint">{t("products.showing", { shown: list.length, total: products.data?.length ?? 0 })}</div>
          <div className="pr-note"><span aria-hidden="true">ⓘ</span> {t("products.note")}</div>
        </aside>
        <section className="pr-editor-wrap">
          {selected ? <EditorLoader key={selected} id={selected} categories={cats.data ?? []} onBack={() => open(null)} onSaved={(id) => setParams({ id })} />
            : <div className="card centered-state">{t("products.pick")}</div>}
        </section>
      </div>
    </>
  );
}

function ProductItem({ p, cat, currency, active, onOpen }: { p: Product; cat: string; currency: string; active: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const sizes = p.variants.filter((v) => v.is_active);
  const prices = sizes.map((v) => v.price).sort((a, b) => Number(toUnits(a) - toUnits(b)));
  const missing = sizes.some(needsRecipe);
  const untracked = sizes.length > 0 && sizes.every((v) => !v.track_stock);
  const status = missing ? t("products.noRecipe") : untracked ? t("products.notTracked") : t("products.recipeLinked");
  return (
    <li>
      <button className={`pr-item${active ? " active" : ""}`} aria-current={active || undefined} onClick={onOpen}>
        <span className="pr-item-top">
          <span className="pr-item-name">{p.name}</span>
          <span className="pr-item-price">{prices.length === 0 ? "—" : prices.length > 1 ? t("pos.from", { price: formatMoney(prices[0], currency) }) : formatMoney(prices[0], currency)}</span>
        </span>
        <span className="pr-item-sub">
          {cat}{sizes.length > 1 ? ` · ${t("products.sizesCount", { count: sizes.length })}` : ""} · <span className={missing ? "pr-bad" : ""}>{status}</span>
          {!p.is_active && <span className="badge badge-off" style={{ marginInlineStart: 6 }}>{t("common.inactive")}</span>}
        </span>
      </button>
    </li>
  );
}

function EditorLoader({ id, categories, onBack, onSaved }: { id: string; categories: Category[]; onBack: () => void; onSaved: (id: string) => void }) {
  const { t } = useTranslation();
  const setup = useQuery({ queryKey: ["product-setup", id], enabled: id !== "new", queryFn: () => api.get<ProductSetup>(`/products/${id}/setup`) });
  const ings = useQuery({ queryKey: ["ingredients", "all"], queryFn: () => api.all<Ingredient>("/ingredients", { ordering: "name" }) });
  const groups = useQuery({ queryKey: ["modifier-groups"], queryFn: () => api.all<ModifierGroup>("/modifier-groups", { ordering: "sort_order" }) });
  const balances = useQuery({ queryKey: ["balances", "all"], queryFn: () => api.all<Balance>("/inventory/balances") });
  if (setup.error) return <div className="card"><ErrorBanner error={setup.error} /></div>;
  if ((id !== "new" && !setup.data) || !ings.data || !groups.data) return <div className="card"><Loading /></div>;
  const initial: Draft = setup.data ? fromSetup(setup.data) : { name: "", category_id: categories.find((c) => c.is_active)?.id ?? "", description: "", sort_order: 0, is_active: true, sizes: [newSize(t("products.defaultSize"))], groups: [] };
  return <Editor id={id} initial={initial} ingredients={ings.data} groups={groups.data} balances={balances.data ?? []} categories={categories} onBack={onBack} onSaved={onSaved} />;
}

// ---- editor -----------------------------------------------------------------------------------
function Editor({ id, initial, ingredients, groups, balances, categories, onBack, onSaved }: {
  id: string; initial: Draft; ingredients: Ingredient[]; groups: ModifierGroup[]; balances: Balance[]; categories: Category[]; onBack: () => void; onSaved: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const cur = me?.settings.currency ?? "";
  const qc = useQueryClient();
  const [base, setBase] = useState(initial); // last saved state
  const [d, setD] = useState(initial);
  const [tab, setTab] = useState(0);
  const [clientErr, setClientErr] = useState("");
  const [saved, setSaved] = useState(false);
  const ings = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const dirty = id === "new" || JSON.stringify(normalize(d)) !== JSON.stringify(normalize(base));
  useEffect(() => { setUnsaved(dirty, t("products.unsavedConfirm")); return () => setUnsaved(false); }, [dirty, t]);

  const size: Size | undefined = d.sizes[Math.min(tab, d.sizes.length - 1)];
  const ptype = typeOf(d.sizes, ings);
  const set = (patch: Partial<Draft>) => { setSaved(false); setD((cur) => ({ ...cur, ...patch })); };
  const setSize = (patch: Partial<Size>) => size && set({ sizes: d.sizes.map((s) => (s.key === size.key ? { ...s, ...patch } : s)) });
  const setLine = (key: number, patch: Partial<Line>) => size && setSize({ lines: size.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) });

  const applyType = (v: PType) => {
    if (v === "mixed") return;
    set({ sizes: d.sizes.map((s) => {
      if (v === "none") return { ...s, track_stock: false, lines: [] };
      if (v === "stock") {
        const keep = s.lines.length === 1 && ings.get(s.lines[0].ingredient_id)?.base_unit === "pcs" ? s.lines[0].ingredient_id : "";
        return { ...s, track_stock: true, lines: [newLine({ ingredient_id: keep, qty: "1", unit: "pcs", base: "pcs", waste: "0" })] };
      }
      return { ...s, track_stock: true, lines: s.lines.filter((l) => l.ingredient_id) };
    }) });
  };

  const save = useMutation({
    mutationFn: () => {
      const body = normalize(d);
      return id === "new" ? api.post<ProductSetup>("/products/setup", body) : api.put<ProductSetup>(`/products/${id}/setup`, body);
    },
    onSuccess: (p) => {
      const next = fromSetup(p);
      setBase(next); setD(next); setSaved(true); setUnsaved(false);
      qc.setQueryData(["product-setup", p.id], p);
      for (const k of ["products", "product", "recipe", "modifier-groups", "pos-products"]) void qc.invalidateQueries({ queryKey: [k] });
      if (id === "new") onSaved(p.id);
    },
    onError: (e) => {
      const vi = e instanceof ApiError ? (e.details as { variant_index?: number }).variant_index : undefined;
      if (typeof vi === "number") setTab(vi); // show the size the error belongs to
    },
  });

  const submit = () => {
    setSaved(false);
    if (!d.name.trim()) return setClientErr(t("products.nameRequired"));
    if (!d.category_id) return setClientErr(t("products.categoryRequired"));
    for (const [i, s] of d.sizes.entries()) {
      const fail = (msg: string) => { setTab(i); setClientErr(msg); };
      if (!s.label.trim()) return fail(t("products.labelRequired"));
      if (!isDecimal(s.price, 2)) return fail(t("products.priceInvalid"));
      if (!s.track_stock) continue;
      for (const l of s.lines) {
        if (!l.ingredient_id) return fail(t("recipe.pickIngredient"));
        if (!validEntry(l.qty.trim(), l.unit)) return fail(t("recipe.qtyInvalid"));
        if (!isDec(l.waste.trim() || "0", 2) || toUnits(l.waste.trim() || "0", 2) > 10000n) return fail(t("recipe.wasteInvalid"));
        if (l.slot && !/^[-a-zA-Z0-9_]+$/.test(l.slot.trim())) return fail(t("recipe.slotInvalid"));
      }
    }
    setClientErr("");
    save.mutate();
  };
  const discard = () => { setD(base); setClientErr(""); setTab(0); save.reset(); };
  useShortcuts({ save: () => (dirty && !save.isPending ? submit() : false) });

  const err = save.error;
  const errDetails = err instanceof ApiError ? (err.details as { part?: string; variant_index?: number; fields?: Record<string, unknown>; lines?: { index: number; problems: string[] }[] }) : undefined;
  const sizeErr = errDetails?.variant_index === tab ? errDetails : undefined;
  const lineProblems = sizeErr?.lines ?? [];
  const productField = (f: string) => (errDetails?.part === "product" ? fieldError(err, f) : undefined);
  const sizeField = (f: string) => { const v = sizeErr?.fields?.[f]; return Array.isArray(v) ? v.join(" ") : (v as string | undefined); };
  const activeCats = categories.filter((c) => c.is_active || c.id === d.category_id);

  // Live slot check: a linked "replace" group needs its slot in this size's recipe.
  const slotWarnings = size && size.track_stock && ptype !== "stock"
    ? groups.filter((g) => d.groups.includes(g.id) && g.mode === "replace" && g.replacement_slot && !size.lines.some((l) => l.slot.trim() === g.replacement_slot))
    : [];

  return (
    <div className="pr-editor">
      <button className="btn btn-outline btn-sm pr-back" onClick={onBack}>{t("orders.back")}</button>

      {/* Details and sizes */}
      <div className="card">
        <div className="pr-card-head">
          <div><h3>{d.name || t("products.new")}</h3><p className="form-hint">{t("products.editHint")}</p></div>
          <div className="pr-head-actions">
            {id !== "new" && <HistoryLink entityType="catalog.product" entityId={id} />}
            <span className={`badge ${d.is_active ? "badge-active" : "badge-off"}`}>{d.is_active ? t("products.activeAtPos") : t("products.hiddenAtPos")}</span>
          </div>
        </div>
        <div className="pr-grid-3">
          <label className="form-label">{t("products.name")}<input className="form-input" value={d.name} onChange={(e) => set({ name: e.target.value })} />{productField("name") && <span className="field-error" role="alert">{productField("name")}</span>}</label>
          <label className="form-label">{t("products.category")}
            <select className="form-select" value={d.category_id} onChange={(e) => set({ category_id: e.target.value })}>
              {!d.category_id && <option value="">—</option>}
              {activeCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>{productField("category_id") && <span className="field-error" role="alert">{productField("category_id")}</span>}</label>
          <label className="form-label">{t("products.type")}
            <select className="form-select" value={ptype} onChange={(e) => applyType(e.target.value as PType)}>
              <option value="made">{t("products.types.made")}</option>
              <option value="stock">{t("products.types.stock")}</option>
              <option value="none">{t("products.types.none")}</option>
              {ptype === "mixed" && <option value="mixed" disabled>{t("products.types.mixed")}</option>}
            </select>
            <span className="form-hint">{t(`products.typeHints.${ptype}`)}</span></label>
        </div>
        <div className="pr-grid-desc">
          <label className="form-label">{t("products.description")}<textarea className="form-input" rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} /></label>
          <label className="check-row"><input type="checkbox" checked={d.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> {t("products.showAtPos")}</label>
        </div>

        <h4 className="pr-subtitle">{t("products.sizes")}</h4>
        <div className="pr-sizes" role="tablist" aria-label={t("products.sizes")}>
          {d.sizes.map((s, i) => (
            <button key={s.key} role="tab" aria-selected={i === tab} className={`pr-size-tab${i === tab ? " active" : ""}${!s.is_active ? " off" : ""}`} onClick={() => setTab(i)}>
              <span>{s.label || t("products.newSize")}</span>
              <span className="pr-size-price">{isDecimal(s.price, 2) ? formatMoney(s.price, cur) : "—"}</span>
              {s.track_stock && s.lines.length === 0 && <span className="pr-dot" title={t("products.noRecipeHint")} aria-label={t("products.noRecipe")} />}
            </button>
          ))}
          <button className="pr-size-tab add" onClick={() => { set({ sizes: [...d.sizes, { ...newSize(""), track_stock: ptype !== "none" }] }); setTab(d.sizes.length); }}>{t("products.addSizeTab")}</button>
        </div>
        {size && (
          <div className="pr-grid-4">
            <label className="form-label">{t("products.label")}<input className="form-input" value={size.label} onChange={(e) => setSize({ label: e.target.value })} />{sizeField("label") && <span className="field-error" role="alert">{sizeField("label")}</span>}</label>
            <label className="form-label">{t("products.salePrice")} ({cur})<input className="form-input num" inputMode="decimal" value={size.price} onChange={(e) => setSize({ price: e.target.value })} />{sizeField("price") && <span className="field-error" role="alert">{sizeField("price")}</span>}</label>
            <label className="form-label">{t("products.code")}<input className="form-input mono" value={size.sku} onChange={(e) => setSize({ sku: e.target.value })} />{sizeField("sku") && <span className="field-error" role="alert">{sizeField("sku")}</span>}</label>
            <label className="check-row pr-check"><input type="checkbox" checked={size.is_active} onChange={(e) => setSize({ is_active: e.target.checked })} /> {t("products.sizeActive")}</label>
          </div>
        )}
      </div>

      {/* Recipe of the selected size */}
      {size && (
        <div className="card">
          <div className="pr-card-head"><h3>{t("products.recipeTitle")}</h3><span className="pr-accent">{t("products.perServing", { size: size.label || t("products.newSize") })}</span></div>
          {ptype === "mixed" && <div className="alert-banner alert-neutral" style={{ marginBottom: 10 }}>{t("products.mixedHint")}</div>}
          {!size.track_stock ? (
            <p className="form-hint">{t("products.untrackedSize")}</p>
          ) : ptype === "stock" ? (
            <StockItemLine size={size} ingredients={ingredients} onPick={(ingredient_id) => setSize({ lines: [newLine({ ingredient_id, qty: "1", unit: "pcs", base: "pcs", waste: "0" })] })} />
          ) : (
            <RecipeLines size={size} ings={ings} ingredients={ingredients} problems={lineProblems} setLine={setLine}
              onRemove={(key) => setSize({ lines: size.lines.filter((l) => l.key !== key) })}
              onAdd={() => setSize({ lines: [...size.lines, newLine()] })} />
          )}
          {size.track_stock && (size.lines.length === 0 || (ptype === "stock" && !size.lines[0]?.ingredient_id)) && <div className="alert-banner alert-warning" role="status" style={{ marginTop: 10 }}>{t("products.noRecipeHint")}</div>}
          {slotWarnings.map((g) => <div key={g.id} className="alert-banner alert-warning" role="alert" style={{ marginTop: 8 }}>{t("recipe.slotMissing", { group: g.name, slot: g.replacement_slot })}</div>)}
          <div className="alert-banner alert-success pr-info"><span aria-hidden="true">✓</span> {t("products.recipeInfo")}</div>
        </div>
      )}

      {/* Consumption preview and stock */}
      {size && size.track_stock && size.lines.some((l) => l.ingredient_id) && <PreviewAndStock size={size} ings={ings} balances={balances} productName={d.name} groups={groups.filter((g) => d.groups.includes(g.id) && g.is_active)} />}

      {/* Modifier groups */}
      <div className="card">
        <div className="pr-card-head"><h3>{t("products.modifierGroups")}</h3></div>
        {groups.length === 0 ? <p className="form-hint">{t("products.noGroups")}</p> : (
          <div className="pr-groups">
            {groups.map((g) => (
              <label key={g.id} className="check-row">
                <input type="checkbox" checked={d.groups.includes(g.id)} onChange={(e) => set({ groups: e.target.checked ? [...d.groups, g.id] : d.groups.filter((x) => x !== g.id) })} />
                {" "}{g.name} · {t(`modifiers.modes.${g.mode}`)}{g.is_active ? "" : ` (${t("common.inactive")})`}
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Save bar */}
      <div className="pr-savebar">
        <div className="pr-save-msg">
          {clientErr && <div className="field-error" role="alert">{clientErr}</div>}
          {err && !clientErr && <ErrorBanner error={err} />}
          {saved && !dirty && <span className="pr-saved" role="status">✓ {t("products.saved")}</span>}
          {!saved && !clientErr && !err && <span className="form-hint">{dirty ? t("products.unsaved") : t("products.noChanges")}</span>}
        </div>
        <button className="btn btn-outline" disabled={!dirty || save.isPending || id === "new"} onClick={discard}>{t("products.discard")}</button>
        <button className="btn btn-primary" disabled={!dirty || save.isPending} onClick={submit}>✓ {t("products.save")}<Kbd k="Ctrl+Enter" /></button>
      </div>
    </div>
  );
}

function RecipeLines({ size, ings, ingredients, problems, setLine, onRemove, onAdd }: {
  size: Size; ings: Map<string, Ingredient>; ingredients: Ingredient[]; problems: { index: number; problems: string[] }[];
  setLine: (key: number, p: Partial<Line>) => void; onRemove: (key: number) => void; onAdd: () => void;
}) {
  const { t } = useTranslation();
  const [more, setMore] = useState<number | null>(null);
  return (
    <>
      {size.lines.length > 0 && <div className="pr-recipe-head" aria-hidden="true"><span>{t("products.stockIngredient")}</span><span>{t("products.quantity")}</span><span>{t("products.unit")}</span><span>{t("products.deduction")}</span><span /></div>}
      {size.lines.map((l, idx) => {
        const ing = ings.get(l.ingredient_id);
        const baseUnit = ing?.base_unit ?? l.base ?? "g";
        const ok = !!l.ingredient_id && validEntry(l.qty.trim(), l.unit) && isDec(l.waste.trim() || "0", 2);
        const per = ok ? perUnitQty(toBase(l.qty.trim(), l.unit), l.waste.trim() || "0") : "";
        const bad = problems.find((p) => p.index === idx);
        return (
          <div key={l.key} className="pr-line">
            <div className="pr-line-row">
              <select aria-label={t("recipe.ingredient")} className="form-select" value={l.ingredient_id} onChange={(e) => { const u = ings.get(e.target.value)?.base_unit ?? "g"; setLine(l.key, { ingredient_id: e.target.value, unit: u, base: u }); }}>
                <option value="">{t("products.pickIngredient")}</option>
                {!ing && l.ingredient_id && <option value={l.ingredient_id}>{l.name} ({t("common.inactive")})</option>}
                {ingredients.filter((i) => i.is_active || i.id === l.ingredient_id).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              <input aria-label={t("products.quantity")} className="form-input num" inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
              <select aria-label={t("products.unit")} className="form-select" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value as EntryUnit })}>
                {unitsFor(baseUnit).map((u) => <option key={u} value={u}>{t(`units.${u}`)}</option>)}
              </select>
              <div className="pr-deduct">
                {per ? <><strong>{trim(per)} {t(`units.${baseUnit}`)}</strong>
                  <span className="form-hint">{baseUnit !== "pcs" ? `= ${inLarge(per)} ${t(`units.${baseUnit === "g" ? "kg" : "L"}`)}` : ""}{toUnits(l.waste.trim() || "0", 2) > 0n ? ` · ${t("products.inclWaste", { pct: trim(l.waste.trim()) })}` : ""}</span></> : <span className="form-hint">—</span>}
              </div>
              <div className="pr-line-actions">
                <button className="icon-btn" aria-label={t("products.moreOptions")} aria-expanded={more === l.key} onClick={() => setMore(more === l.key ? null : l.key)}>⋯</button>
                <button className="icon-btn" aria-label={t("common.remove")} onClick={() => onRemove(l.key)}>✕</button>
              </div>
            </div>
            <div className="pr-line-meta form-hint">
              {ing ? t("products.stockUnit", { unit: t(`units.${ing.base_unit}`) }) : ""}
              {l.slot.trim() ? ` · ${t("recipe.slot")}: ${l.slot.trim()}` : ""}
            </div>
            {more === l.key && (
              <div className="pr-line-more">
                <label className="form-label">{t("recipe.waste")}<input className="form-input num" inputMode="decimal" value={l.waste} onChange={(e) => setLine(l.key, { waste: e.target.value })} /></label>
                <label className="form-label">{t("recipe.slot")}<input className="form-input" value={l.slot} onChange={(e) => setLine(l.key, { slot: e.target.value })} /><span className="form-hint">{t("products.slotHint")}</span></label>
              </div>
            )}
            {bad && <div className="field-error" role="alert">{bad.problems.map((p) => t(`recipe.problems.${p}`, { defaultValue: p })).join(", ")}</div>}
          </div>
        );
      })}
      <button className="btn btn-outline pr-add-line" onClick={onAdd}>{t("products.addIngredient")}</button>
    </>
  );
}

function StockItemLine({ size, ingredients, onPick }: { size: Size; ingredients: Ingredient[]; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const pcs = ingredients.filter((i) => i.base_unit === "pcs" && (i.is_active || i.id === size.lines[0]?.ingredient_id));
  return (
    <label className="form-label">{t("products.stockItemPick")}
      <select className="form-select" value={size.lines[0]?.ingredient_id ?? ""} onChange={(e) => onPick(e.target.value)}>
        <option value="">{t("products.pickIngredient")}</option>
        {pcs.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
      <span className="form-hint">{t("products.stockItemHint")}</span>
    </label>
  );
}

function PreviewAndStock({ size, ings, balances, productName, groups }: { size: Size; ings: Map<string, Ingredient>; balances: Balance[]; productName: string; groups: ModifierGroup[] }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const [n, setN] = useState(1);
  const bal = new Map(balances.map((b) => [b.ingredient_id, b]));
  const rows = size.lines.filter((l) => l.ingredient_id && validEntry(l.qty.trim(), l.unit) && isDec(l.waste.trim() || "0", 2)).map((l) => {
    const unit = (ings.get(l.ingredient_id)?.base_unit ?? l.base ?? "g") as Unit;
    const one = perUnitQty(toBase(l.qty.trim(), l.unit), l.waste.trim() || "0");
    const need = times(one, n);
    const have = bal.get(l.ingredient_id)?.qty;
    return { key: l.key, name: ings.get(l.ingredient_id)?.name ?? l.name ?? "", unit, one, need, have, enough: have !== undefined && gte(have, need), unitCost: bal.get(l.ingredient_id)?.unit_cost ?? null, slot: l.slot.trim() };
  });
  // Cost per serving at today's average cost, and the margin on this size's price.
  const base = rows.map((r) => ({ qty: r.one, unitCost: r.unitCost, slot: r.slot }));
  const cost = servingCost(base);
  const s = me?.settings;
  const taxIn = s?.tax_enabled && s.prices_include_tax ? s.tax_rate : null;
  const margin = cost !== null && isDec(size.price, 2) ? marginPct(size.price, cost, taxIn) : null;
  // Sprint 5 P6: what each linked option adds to the cost and the price, and the margin with it.
  const ucOf = (id: string) => bal.get(id)?.unit_cost ?? null;
  const options = groups.flatMap((g) => g.options.filter((o) => o.is_active).map((o) => {
    const c = servingCost(withOption(base, g, optionLines(o, size.id, ucOf)));
    const price = optionPrice(o, size.id);
    const full = isDec(size.price, 2) ? addMoney(size.price, price) : null;
    return { id: o.id, name: `${g.name}: ${o.label}`, extraCost: c !== null && cost !== null ? subMoney(c, cost) : null, price, margin: c !== null && full ? marginPct(full, c, taxIn) : null };
  }));
  const noCost = rows.filter((r) => r.unitCost === null).map((r) => r.name);
  const show = (q: string, u: Unit) => { const r = readable(q, u); return `${r.qty} ${t(`units.${r.unit}`)}`; };
  const allEnough = rows.length > 0 && rows.every((r) => r.enough);
  return (
    <>
      <div className="pr-grid-2">
        <div className="card">
          <div className="pr-card-head"><h3>{t("products.preview")}</h3></div>
          <div className="pr-servings">
            <span className="form-hint">{t("products.servings", { name: productName || t("products.new") })}</span>
            <div className="pr-stepper">
              <button className="btn btn-outline btn-sm" aria-label={t("pos.decrease")} disabled={n <= 1} onClick={() => setN(n - 1)}>−</button>
              <strong aria-live="polite">{n}</strong>
              <button className="btn btn-outline btn-sm" aria-label={t("pos.increase")} disabled={n >= 99} onClick={() => setN(n + 1)}>+</button>
            </div>
          </div>
          {rows.map((r) => <div key={r.key} className="pr-kv"><strong>{r.name}</strong><strong className="mono">{show(r.need, r.unit)}</strong></div>)}
          <p className="form-hint">{t("products.previewNote")}</p>
          <div className="pr-kv pr-cost"><span>{t("products.costPerServing")}</span><strong>{cost === null ? "—" : formatMoney(cost, s?.currency ?? "")}</strong></div>
          {margin !== null && <div className="pr-kv"><span>{t("products.margin")}</span><strong className={margin.startsWith("-") ? "pr-bad" : ""}>{margin}%</strong></div>}
          {noCost.length > 0 && <p className="form-hint">{t("products.noCost", { names: noCost.join(t("audit.listSep")) })}</p>}
          {cost !== null && <p className="form-hint">{t("products.costNote")}</p>}
          {options.length > 0 && (
            <div className="table-scroll" style={{ marginTop: 8 }}>
              <table className="erp-table">
                <thead><tr><th>{t("products.optionCosts")}</th><th className="num">{t("products.extraCost")}</th><th className="num">{t("products.extraPrice")}</th><th className="num">{t("products.margin")}</th></tr></thead>
                <tbody>{options.map((o) => (
                  <tr key={o.id}><td>{o.name}</td>
                    <td className="num mono">{o.extraCost === null ? "—" : formatMoney(o.extraCost, s?.currency ?? "")}</td>
                    <td className="num mono">{formatMoney(o.price, s?.currency ?? "")}</td>
                    <td className={`num${o.margin?.startsWith("-") ? " pr-bad" : ""}`}>{o.margin === null ? "—" : `${o.margin}%`}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className="card">
          <div className="pr-card-head"><h3>{t("products.stock")}</h3><span className="pr-accent">{t("products.mainLocation")}</span></div>
          {rows.map((r) => (
            <div key={r.key} className="pr-kv">
              <span>{r.name}</span>
              <span className={r.have !== undefined && toUnits(r.have, 3) < 0n ? "pr-bad" : ""}>{r.have === undefined ? "—" : t("products.available", { qty: show(r.have, r.unit) })}</span>
            </div>
          ))}
          <span className={`badge ${allEnough ? "badge-active" : "badge-lowstock"}`} role="status">{allEnough ? t("products.enough") : t("products.notEnough")}</span>
        </div>
      </div>
      <div className="alert-banner alert-warning pr-stock-rule">
        <strong>⚠ {t("products.stockRuleTitle")}</strong>
        <div>{t("products.stockRule")}</div>
        <div className="pr-stock-links"><Link to="/admin/purchases/new">{t("products.addPurchase")} ↗</Link><Link to="/admin/inventory">{t("products.adjustStock")} ↗</Link></div>
      </div>
    </>
  );
}
