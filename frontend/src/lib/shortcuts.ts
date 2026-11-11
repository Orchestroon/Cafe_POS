// B2 keyboard shortcuts: the ONE place that lists every shortcut (owner reviews this file).
//
// Rules
// - Keys are matched by their physical position (`KeyboardEvent.code`), so they work the same
//   with the Arabic keyboard layout.
// - While typing in a field, only shortcuts marked `inInput` fire (Esc, Ctrl+Enter, F-keys).
// - When a popup is open, only that popup's shortcuts fire (the page behind it is ignored).
// - Avoided on purpose (browser keys): Alt+D, F1, F3, F5, F6, F7, F10, F11, F12, Ctrl+digits,
//   Alt+digits.
import { createContext, useContext, useEffect, useRef } from "react";

export interface Combo { code: string | string[]; alt?: boolean; ctrl?: boolean; shift?: boolean }
export interface Shortcut { id: string; group: Group; keys: string; combo: Combo; inInput?: boolean }
export type Group = "global" | "pos" | "sheet" | "payment" | "lists" | "forms";

const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"].flatMap((d) => [`Digit${d}`, `Numpad${d}`]);

export const SHORTCUTS: Shortcut[] = [
  // Everywhere
  { id: "help", group: "global", keys: "?", combo: { code: "Slash", shift: true } },
  { id: "goPos", group: "global", keys: "Alt+P", combo: { code: "KeyP", alt: true }, inInput: true },
  { id: "goOrders", group: "global", keys: "Alt+O", combo: { code: "KeyO", alt: true }, inInput: true },
  { id: "goShift", group: "global", keys: "Alt+S", combo: { code: "KeyS", alt: true }, inInput: true },
  { id: "goHome", group: "global", keys: "Alt+H", combo: { code: "KeyH", alt: true }, inInput: true },
  { id: "search", group: "global", keys: "/", combo: { code: "Slash" } },
  { id: "close", group: "global", keys: "Esc", combo: { code: "Escape" }, inInput: true },
  // POS screen
  { id: "pay", group: "pos", keys: "F2", combo: { code: "F2" }, inInput: true },
  { id: "openShift", group: "pos", keys: "F4", combo: { code: "F4" }, inInput: true },
  { id: "allCategories", group: "pos", keys: "0", combo: { code: ["Digit0", "Numpad0"] } },
  { id: "category", group: "pos", keys: "1 – 9", combo: { code: DIGITS } },
  { id: "moveProduct", group: "pos", keys: "← ↑ → ↓", combo: { code: ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"] } },
  { id: "addProduct", group: "pos", keys: "Enter", combo: { code: ["Enter", "NumpadEnter"] } },
  { id: "qtyUp", group: "pos", keys: "+", combo: { code: ["Equal", "NumpadAdd"] } },
  { id: "qtyDown", group: "pos", keys: "−", combo: { code: ["Minus", "NumpadSubtract"] } },
  { id: "removeLast", group: "pos", keys: "Delete", combo: { code: "Delete" } },
  { id: "clearCart", group: "pos", keys: "Ctrl+Backspace", combo: { code: "Backspace", ctrl: true } },
  // Product popup (size and options)
  { id: "size", group: "sheet", keys: "1 – 9", combo: { code: DIGITS } },
  { id: "addToCart", group: "sheet", keys: "Enter", combo: { code: ["Enter", "NumpadEnter"] }, inInput: true },
  // Payment popup
  { id: "nextMethod", group: "payment", keys: "F8", combo: { code: "F8" }, inInput: true },
  { id: "confirmPay", group: "payment", keys: "Enter", combo: { code: ["Enter", "NumpadEnter"] }, inInput: true },
  // Lists and admin pages
  { id: "rows", group: "lists", keys: "↑ ↓  Enter", combo: { code: ["ArrowUp", "ArrowDown"] } },
  { id: "new", group: "lists", keys: "N", combo: { code: "KeyN" } },
  { id: "print", group: "lists", keys: "Ctrl+P", combo: { code: "KeyP", ctrl: true }, inInput: true },
  // Forms and popups
  { id: "save", group: "forms", keys: "Ctrl+Enter", combo: { code: ["Enter", "NumpadEnter"], ctrl: true }, inInput: true },
];

const BY_ID = Object.fromEntries(SHORTCUTS.map((s) => [s.id, s]));
export const keysOf = (id: string) => BY_ID[id]?.keys ?? "";

export function matches(e: KeyboardEvent, c: Combo) {
  const codes = Array.isArray(c.code) ? c.code : [c.code];
  return codes.includes(e.code) && !!c.alt === e.altKey && !!c.ctrl === (e.ctrlKey || e.metaKey) && (c.shift === undefined || c.shift === e.shiftKey);
}

export function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el?.tagName) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  return !["checkbox", "radio", "button", "submit"].includes((el as HTMLInputElement).type);
}

// ---- popup layers: only the top layer's shortcuts fire -------------------------------------
let layers: number[] = [];
let nextLayer = 1;
export const newLayerId = () => nextLayer++;
export function pushLayer(id: number) { layers = [...layers, id]; }
export function popLayer(id: number) { layers = layers.filter((l) => l !== id); }
export const topLayer = () => layers[layers.length - 1] ?? 0;

/** The layer a component belongs to: 0 = the page, else the popup (Modal) it is rendered in. */
export const LayerContext = createContext(0);
export const useLayer = () => useContext(LayerContext);

/** Return `false` to decline (the key then keeps its normal browser behaviour). */
export type Handlers = Partial<Record<string, ((e: KeyboardEvent) => void | boolean) | undefined>>;

/**
 * Register shortcut handlers by id. `layer` is 0 for the page, or the popup's layer id.
 * A handler that runs prevents the browser default unless it returns `false`; `undefined` disables.
 */
export function useShortcuts(handlers: Handlers, layerOverride?: number) {
  const ctxLayer = useLayer();
  const layer = layerOverride ?? ctxLayer;
  const ref = useRef(handlers);
  useEffect(() => { ref.current = handlers; }); // latest handlers, without re-registering
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.repeat && !e.code.startsWith("Arrow"))) return;
      if (topLayer() !== layer) return;
      for (const [id, fn] of Object.entries(ref.current)) {
        const s = BY_ID[id];
        if (!fn || !s || !matches(e, s.combo)) continue;
        if (isTyping(e.target) && !s.inInput) continue;
        if (fn(e) === false) continue; // the handler declined (e.g. nothing to act on)
        e.preventDefault();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [layer]);
}

/** Digit 1–9 pressed (top row or keypad) → 0-based index, else -1. */
export const digitIndex = (e: KeyboardEvent) => {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) - 1 : -1;
};

/** Move focus between sibling elements laid out in a grid (product tiles) or a list (rows). */
export function moveFocus(items: HTMLElement[], current: Element | null, code: string) {
  if (items.length === 0) return;
  const i = items.findIndex((el) => el === current);
  if (i < 0) { items[0].focus(); return; }
  const rtl = document.documentElement.dir === "rtl";
  const perRow = Math.max(1, items.filter((el) => el.offsetTop === items[0].offsetTop).length);
  let j = i;
  if (code === "ArrowRight") j = i + (rtl ? -1 : 1);
  else if (code === "ArrowLeft") j = i + (rtl ? 1 : -1);
  else if (code === "ArrowDown") j = i + perRow;
  else if (code === "ArrowUp") j = i - perRow;
  items[Math.min(items.length - 1, Math.max(0, j))].focus();
}
