import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

export function Forbidden() {
  const { t } = useTranslation();
  return (
    <div className="centered-state">
      <h2>403</h2>
      <p>{t("errors.PERMISSION_DENIED")}</p>
      <Link to="/" className="btn btn-outline" style={{ marginTop: 12 }}>{t("nav.home")}</Link>
    </div>
  );
}
