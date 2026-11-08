import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";

export function Home() {
  const { t } = useTranslation();
  const { me } = useAuth();
  return (
    <>
      <PageHeader title={t("home.welcome", { name: me?.user.display_name || me?.user.username })} subtitle={me?.organization.name} />
      {me?.user.role === "admin" ? (
        <div className="metrics-grid">
          {(["products", "categories", "ingredients", "inventory", "users", "settings"] as const).map((k) => (
            <Link key={k} to={`/admin/${k}`} className="metric-card" style={{ textDecoration: "none" }}>
              <div className="metric-title">{t(`nav.${k}`)}</div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="alert-banner alert-neutral">{t("home.baristaNote")}</div>
      )}
    </>
  );
}
