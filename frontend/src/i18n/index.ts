import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import ar from "./ar.json";
import en from "./en.json";

const KEY = "lang";
export const readLang = () => {
  try {
    return localStorage.getItem(KEY) === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
};

// ar.json is a skeleton (empty values) and falls back to English.
i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: readLang(),
  fallbackLng: "en",
  returnEmptyString: false,
  interpolation: { escapeValue: false },
});

/** Keeps <html lang dir> in sync with the active language. */
const applyDir = (lng: string) => {
  document.documentElement.lang = lng;
  document.documentElement.dir = lng === "ar" ? "rtl" : "ltr";
};
applyDir(i18n.language);
i18n.on("languageChanged", applyDir);

export function setLang(lng: "en" | "ar") {
  try {
    localStorage.setItem(KEY, lng);
  } catch {
    /* storage may be unavailable; the choice just won't persist */
  }
  void i18n.changeLanguage(lng);
}

export default i18n;
