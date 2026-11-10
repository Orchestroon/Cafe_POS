import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Category, CheckoutResult, Product, Quote, Shift, StockWarning } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { isDecimal } from "../components/Form";
import { Modal } from "../components/Modal";
import { ErrorBanner, Loading } from "../components/States";
import { formatDateTime, formatMoney } from "../i18n/format";
import { loadCart, saveCart, sellableProducts, toApiItems, type CartLine } from "../pos/cart";
import { PaymentDialog, type Payments } from "../pos/PaymentDialog";
import { ProductSheet, Stepper } from "../pos/ProductSheet";
import { useCheckout } from "../pos/useCheckout";

export function Pos() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const nav = useNavigate();
  const currency = me?.settings.currency ?? "";
  const tz = me?.settings.timezone ?? "UTC";

  const shift = useQuery({ queryKey: ["shift", "current"], queryFn: () => api.get<Shift | null>("/shifts/current") });
  const products = useQuery({ queryKey: ["pos-products"], queryFn: () => api.all<Product>("/products", { ordering: "sort_order" }) });
  const cats = useQuery({ queryKey: ["pos-categories"], queryFn: () => api.all<Category>("/categories", { ordering: "sort_order" }) });

  const userId = me?.user.id ?? "";
  const [cart, setCart] = useState<CartLine[]>(() => loadCart(userId));
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState("");
  const [sheet, setSheet] = useState<{ product: Product; line?: CartLine } | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  useEffect(() => saveCart(userId, cart), [userId, cart]);
  const { phase, start, retry, busy, reset } = useCheckout(userId, () => { setCart([]); setCartOpen(false); });

  // Quote: debounced ~300 ms after every cart change; the screen shows server totals only.
  const items = useMemo(() => toApiItems(cart), [cart]);
  const itemsKey = JSON.stringify(items);
  const [qKey, setQKey] = useState(itemsKey);
  useEffect(() => {
    const id = setTimeout(() => setQKey(itemsKey), 300);
    return () => clearTimeout(id);
  }, [itemsKey]);
  const quote = useQuery({
    queryKey: ["quote", qKey],
    enabled: cart.length > 0,
    placeholderData: keepPreviousData,
    queryFn: () => api.post<Quote>("/orders/quote", { items: JSON.parse(qKey) }),
  });
  const q = cart.length > 0 ? quote.data : undefined;
  const fresh = cart.length > 0 && qKey === itemsKey && !quote.isFetching && !quote.isError && !!q;

  const confirmPayment = (payments: Payments) => {
    if (!q || !fresh) return; // only ever pay the total the server just quoted
    setPayOpen(false);
    start({ items, payments, expected_total: q.total });
  };

  // ---- cart editing ---------------------------------------------------------------------------
  const upsert = (line: CartLine) => {
    setCart((c) => (c.some((x) => x.id === line.id) ? c.map((x) => (x.id === line.id ? line : x)) : [...c, line]));
    setSheet(null);
  };
  const setQty = (id: string, n: number) => setCart(cart.map((l) => (l.id === id ? { ...l, quantity: n } : l)));
  const productOf = (id: string) => products.data?.find((p) => p.id === id);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const open = new Set((cats.data ?? []).filter((c) => c.is_active).map((c) => c.id));
    return sellableProducts(products.data ?? []).filter((p) => open.has(p.category_id) && (!cat || p.category_id === cat) && (!needle || p.name.toLowerCase().includes(needle)));
  }, [products.data, cats.data, search, cat]);
  const activeCats = (cats.data ?? []).filter((c) => c.is_active);

  // While a sale is unresolved the cart is frozen: no new sale, no edits (spec 10.2 rule 3).
  const selling = !!shift.data && !busy;
  const canPay = selling && fresh && cart.length > 0;
  const lineTotal = (i: number) => (fresh && q?.items[i] ? formatMoney(q.items[i].line_total, currency) : "…");
  const count = cart.reduce((n, l) => n + l.quantity, 0);

  if (shift.isLoading || products.isLoading) return <Loading />;
  if (phase.kind === "done") return <Success result={phase.result} currency={currency} onPrint={() => nav(`/orders/${phase.result.order_id}/receipt`)} onNew={reset} />;

  return (
    <>
      <ErrorBanner error={shift.error ?? products.error} />
      <ShiftBar shift={shift.data ?? null} tz={tz} currency={currency} />
      {phase.kind === "unconfirmed" && (
        <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>
          {t("pos.unconfirmed")} <button className="btn btn-primary btn-sm" onClick={retry}>{t("pos.retry")}</button>
        </div>
      )}
      {phase.kind === "error" && <ErrorBanner error={phase.error} />}

      <div className="pos-layout">
        <section className="pos-products" aria-label={t("pos.products")}>
          <div className="pos-toolbar">
            <input className="form-input" type="search" placeholder={t("common.search")} aria-label={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="cat-tabs" role="tablist">
              <button role="tab" aria-selected={cat === ""} className={`cat-tab${cat === "" ? " active" : ""}`} onClick={() => setCat("")}>{t("common.all")}</button>
              {activeCats.map((c) => <button key={c.id} role="tab" aria-selected={cat === c.id} className={`cat-tab${cat === c.id ? " active" : ""}`} onClick={() => setCat(c.id)}>{c.name}</button>)}
            </div>
          </div>
          {visible.length === 0 ? <div className="centered-state">{t("pos.noProducts")}</div> : (
            <div className="product-grid">
              {visible.map((p) => {
                const prices = p.variants.filter((v) => v.is_active).map((v) => v.price);
                return (
                  <button key={p.id} className="product-tile" disabled={!selling} onClick={() => setSheet({ product: p })}>
                    <span className="product-name">{p.name}</span>
                    <span className="product-price">{prices.length > 1 ? t("pos.from", { price: formatMoney(prices[0], currency) }) : formatMoney(prices[0], currency)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        <aside className={`pos-cart${cartOpen ? " open" : ""}`} aria-label={t("pos.cart")}>
          <div className="pos-cart-head">
            <h3>{t("pos.cart")}</h3>
            <button className="icon-btn pos-cart-close" onClick={() => setCartOpen(false)} aria-label={t("common.close")}>✕</button>
          </div>
          <div className="pos-cart-lines">
            {cart.length === 0 && <div className="centered-state">{t("pos.cartEmpty")}</div>}
            {cart.map((l, i) => {
              const p = productOf(l.productId);
              const labels = p?.modifier_groups.flatMap((g) => g.options).filter((o) => l.optionIds.includes(o.id)).map((o) => o.label) ?? [];
              return (
                <div className="cart-line" key={l.id}>
                  <div className="cart-line-main">
                    <div className="cart-line-name">{l.productName} · {l.variantLabel}</div>
                    {labels.length > 0 && <div className="cart-line-mods">{labels.join(", ")}</div>}
                    <div className="cart-line-actions">
                      <Stepper value={l.quantity} disabled={!selling} onChange={(n) => setQty(l.id, n)} />
                      {p && <button className="btn btn-outline btn-sm" disabled={!selling} onClick={() => setSheet({ product: p, line: l })}>{t("common.edit")}</button>}
                      <button className="btn btn-outline btn-sm" disabled={!selling} onClick={() => setCart(cart.filter((x) => x.id !== l.id))}>{t("common.remove")}</button>
                    </div>
                  </div>
                  <div className="cart-line-total">{lineTotal(i)}</div>
                </div>
              );
            })}
          </div>
          <div className="pos-cart-foot">
            {quote.isError && <ErrorBanner error={quote.error} />}
            {q && q.stock_warnings.length > 0 && <StockBanner warnings={q.stock_warnings} />}
            <div className="totals">
              <div className="totals-row"><span>{t("pos.subtotal")}</span><span>{q && fresh ? formatMoney(q.subtotal, currency) : "…"}</span></div>
              {q && fresh && q.tax.enabled && <div className="totals-row"><span>{q.tax.label} {q.tax.rate}%{q.tax.inclusive ? ` (${t("pos.included")})` : ""}</span><span>{formatMoney(q.tax_total, currency)}</span></div>}
              <div className="totals-row grand"><span>{t("pos.total")}</span><span>{q && fresh ? formatMoney(q.total, currency) : "…"}</span></div>
            </div>
            <button className="btn btn-primary btn-block" disabled={!canPay} onClick={() => setPayOpen(true)}>{t("pos.pay")}</button>
            {cart.length > 0 && <button className="btn btn-ghost btn-block" disabled={!selling} onClick={() => setCart([])}>{t("pos.clear")}</button>}
          </div>
        </aside>
      </div>

      <div className="pos-cartbar">
        <button className="btn btn-primary btn-block" onClick={() => setCartOpen(true)}>
          {t("pos.viewCart", { count })} · {q && fresh ? formatMoney(q.total, currency) : "…"}
        </button>
      </div>

      {shift.data === null && <OpenShift currency={currency} />}
      {sheet && <ProductSheet product={sheet.product} line={sheet.line} currency={currency} onAdd={upsert} onClose={() => setSheet(null)} />}
      {payOpen && q && fresh && <PaymentDialog total={q.total} currency={currency} onConfirm={confirmPayment} onClose={() => setPayOpen(false)} />}
      {phase.kind === "checking" && <Modal title={t("pos.checking")} onClose={() => undefined}><div className="centered-state" role="status">{t("pos.checkingText")}</div></Modal>}
      {phase.kind === "priceChanged" && (
        <Modal title={t("pos.priceChanged")} onClose={reset} footer={<button className="btn btn-primary" disabled={!fresh} onClick={() => { reset(); setPayOpen(true); }}>{fresh ? t("pos.reviewPayment") : t("common.loading")}</button>}>
          <p>{t("pos.priceChangedText")}</p>
          <div className="pay-total"><span>{t("pos.oldTotal")}</span><strong>{formatMoney(phase.oldTotal, currency)}</strong></div>
          <div className="pay-total"><span>{t("pos.newTotal")}</span><strong>{formatMoney(phase.serverTotal, currency)}</strong></div>
        </Modal>
      )}
    </>
  );
}

function ShiftBar({ shift, tz, currency }: { shift: Shift | null; tz: string; currency: string }) {
  const { t } = useTranslation();
  if (!shift) return <div className="shift-bar off">{t("pos.noShift")}</div>;
  return (
    <div className="shift-bar">
      <span className="badge badge-active">{t("pos.shiftOpen")}</span>
      <span>{t("pos.since", { time: formatDateTime(shift.opened_at, tz) })}</span>
      <span>{t("pos.orders", { count: shift.totals.orders_count })}</span>
      <span>{t("pos.expectedCash")}: {formatMoney(shift.totals.expected_cash, currency)}</span>
      <Link to="/shift" style={{ marginInlineStart: "auto" }}>{t("pos.manageShift")}</Link>
    </div>
  );
}

function OpenShift({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [cash, setCash] = useState("0.00");
  const [clientErr, setClientErr] = useState("");
  const open = useMutation({
    mutationFn: () => api.post<Shift>("/shifts/open", { opening_cash: cash.trim() }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["shift"] }),
  });
  const submit = () => (isDecimal(cash, 2) ? (setClientErr(""), open.mutate()) : setClientErr(t("pos.cashInvalid")));
  return (
    <Modal title={t("pos.openShift")} onClose={() => undefined} footer={<button className="btn btn-primary" disabled={open.isPending} onClick={submit}>{t("pos.openShift")}</button>}>
      <p className="form-hint" style={{ marginBottom: 10 }}>{t("pos.openShiftText")}</p>
      <ErrorBanner error={open.error} />
      <div className="form-group">
        <label className="form-label">{t("pos.openingCash")} ({currency})<input className="form-input" inputMode="decimal" autoFocus value={cash} onChange={(e) => setCash(e.target.value)} /></label>
        {clientErr && <div className="field-error" role="alert">{clientErr}</div>}
      </div>
    </Modal>
  );
}

export function StockBanner({ warnings }: { warnings: StockWarning[] }) {
  const { t } = useTranslation();
  return (
    <div className="alert-banner alert-warning" role="status" style={{ marginBottom: 10 }}>
      <strong>{t("pos.lowStock")}</strong>
      <ul style={{ margin: "4px 0 0", paddingInlineStart: 18 }}>
        {warnings.map((w) => <li key={w.ingredient_id}>{t("pos.stockLine", { name: w.ingredient_name, required: w.required, available: w.available, unit: w.unit })}</li>)}
      </ul>
    </div>
  );
}

function Success({ result, currency, onPrint, onNew }: { result: CheckoutResult; currency: string; onPrint: () => void; onNew: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="card pos-success">
      <div className="success-mark" aria-hidden="true">✓</div>
      <h2>{t("pos.sold")}</h2>
      <div className="pay-total"><span>{t("pos.invoice")}</span><strong className="mono">{result.invoice_no}</strong></div>
      <div className="pay-total"><span>{t("pos.total")}</span><strong>{formatMoney(result.total, currency)}</strong></div>
      <div className="pay-total"><span>{t("pos.change")}</span><strong>{formatMoney(result.change_due, currency)}</strong></div>
      {result.stock_warnings.length > 0 && <StockBanner warnings={result.stock_warnings} />}
      <div className="success-actions">
        <button className="btn btn-primary" onClick={onPrint}>{t("pos.printReceipt")}</button>
        <button className="btn btn-outline" onClick={onNew}>{t("pos.newOrder")}</button>
      </div>
    </div>
  );
}
