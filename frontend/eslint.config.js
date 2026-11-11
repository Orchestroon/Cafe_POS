import js from "@eslint/js";
import i18next from "eslint-plugin-i18next";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  // Sprint 4 i18n coverage: no user-visible text typed straight into JSX (spec 5.8). Text goes
  // through t(); symbols, numbers and technical attributes are allowed.
  {
    files: ["src/**/*.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", {
        mode: "jsx-text-only",
        "jsx-attributes": { include: ["title", "placeholder", "aria-label", "alt", "label"] },
        // Symbols and separators, and language names (always shown in their own language).
        words: { exclude: ["[0-9!-/:-@[-`{-~ ✓✕▲▼…—–·×←→↑↓+−?]+", "EN", "عربي", "English", "العربية"] },
      }],
    },
  },
);
