import { describe, expect, it } from "vitest";
import en from "../i18n/en.json";
import { digitIndex, isTyping, matches, SHORTCUTS } from "./shortcuts";

const key = (code: string, mods: Partial<KeyboardEvent> = {}) => ({ code, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, ...mods }) as KeyboardEvent;

describe("keyboard shortcuts (B2)", () => {
  it("has unique ids per group and a label for each", () => {
    const seen = new Set(SHORTCUTS.map((s) => `${s.group}:${s.id}`));
    expect(seen.size).toBe(SHORTCUTS.length);
    const items = (en as { shortcuts: { items: Record<string, string> } }).shortcuts.items;
    for (const s of SHORTCUTS) expect(items[s.id], s.id).toBeTruthy();
  });
  it("never uses a key the browser keeps for itself", () => {
    const reserved = ["F1", "F3", "F5", "F6", "F7", "F10", "F11", "F12"];
    for (const s of SHORTCUTS) {
      const codes = Array.isArray(s.combo.code) ? s.combo.code : [s.combo.code];
      for (const c of codes) expect(reserved, `${s.id} uses ${c}`).not.toContain(c);
      if (s.combo.alt) expect(codes).not.toContain("KeyD"); // Alt+D = address bar
      if (s.combo.ctrl || s.combo.alt) expect(codes.some((c) => /^Digit/.test(c)), s.id).toBe(false); // tab switching
    }
  });
  it("matches by physical key and modifiers (same with the Arabic layout)", () => {
    const pay = SHORTCUTS.find((s) => s.id === "pay")!.combo;
    expect(matches(key("F2"), pay)).toBe(true);
    expect(matches(key("F2", { ctrlKey: true }), pay)).toBe(false);
    const goPos = SHORTCUTS.find((s) => s.id === "goPos")!.combo;
    expect(matches(key("KeyP", { altKey: true }), goPos)).toBe(true); // "ح" on the Arabic layout
    expect(matches(key("KeyP"), goPos)).toBe(false);
    const help = SHORTCUTS.find((s) => s.id === "help")!.combo;
    expect(matches(key("Slash", { shiftKey: true }), help)).toBe(true);
    expect(matches(key("Slash"), help)).toBe(false);
  });
  it("reads digits from the top row and the keypad", () => {
    expect(digitIndex(key("Digit1"))).toBe(0);
    expect(digitIndex(key("Numpad9"))).toBe(8);
    expect(digitIndex(key("Digit0"))).toBe(-1);
    expect(digitIndex(key("KeyA"))).toBe(-1);
  });
  it("knows when the user is typing", () => {
    expect(isTyping({ tagName: "INPUT", type: "text" } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: "INPUT", type: "checkbox" } as unknown as EventTarget)).toBe(false);
    expect(isTyping({ tagName: "TEXTAREA" } as unknown as EventTarget)).toBe(true);
    expect(isTyping({ tagName: "BUTTON" } as unknown as EventTarget)).toBe(false);
    expect(isTyping(null)).toBe(false);
  });
});
