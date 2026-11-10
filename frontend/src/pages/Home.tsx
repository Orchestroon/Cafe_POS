import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";

export function Home() {
  const { t } = useTranslation();
  const { me } = useAuth();
  if (me?.user.role === "barista") return <Navigate to="/pos" replace />;
  return (
    <>
      <PageHeader title={t("home.welcome", { name: me?.user.display_name || me?.user.username })} subtitle={me?.organization.name} />
      {me?.user.role === "admin" ? (
        <div className="metrics-grid">
          {(["pos", "orders"] as const).map((k) => (
            <Link key={k} to={`/${k}`} className="metric-card" style={{ textDecoration: "none" }}>
              <div className="metric-title">{t(`nav.${k}`)}</div>
            </Link>
          ))}
          {(["products", "modifiers", "categories", "ingredients", "inventory", "users", "settings"] as const).map((k) => (
            <Link key={k} to={`/admin/${k}`} className="metric-card" style={{ textDecoration: "none" }}>
              <div className="metric-title">{t(`nav.${k}`)}</div>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}
