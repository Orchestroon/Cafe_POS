import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiGet } from "./api/client";

// Sprint 0 placeholder: proves the /api proxy, react-query and i18n are wired. Real shell is Sprint 1.
export default function App() {
  const { t } = useTranslation();
  const health = useQuery({ queryKey: ["health"], queryFn: () => apiGet<{ status: string; db: string }>("/health") });

  return (
    <main style={{ padding: 24, fontFamily: "system-ui" }}>
      <h1>{t("app.name")}</h1>
      <h2>{t("health.title")}</h2>
      <p role="status">
        {health.isLoading ? t("health.loading") : health.isError ? t("health.error") : t("health.ok")}
      </p>
    </main>
  );
}
