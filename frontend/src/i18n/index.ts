import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./ar.json";
import en from "./en.json";

// ar.json is a skeleton (empty values) and falls back to English.
i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: "en",
  fallbackLng: "en",
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

export default i18n;
