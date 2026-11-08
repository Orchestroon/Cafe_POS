import { useTranslation } from "react-i18next";
import { ApiError } from "../api/client";

export function Loading() {
  const { t } = useTranslation();
  return <div className="centered-state" role="status">{t("common.loading")}</div>;
}

export function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => {
    if (e instanceof ApiError) return t(`errors.${e.code}`, { defaultValue: e.message });
    return t("errors.UNKNOWN");
  };
}

export function ErrorBanner({ error }: { error: unknown }) {
  const text = useErrorText();
  if (!error) return null;
  return <div className="alert-banner alert-warning" role="alert" style={{ marginBottom: 12 }}>{text(error)}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="centered-state">{children}</div>;
}
