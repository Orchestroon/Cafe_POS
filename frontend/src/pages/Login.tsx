import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ErrorBanner } from "../components/States";
import { TextField } from "../components/Form";

export function Login() {
  const { t } = useTranslation();
  const { me, login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (me) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, password);
      nav((loc.state as { from?: string } | null)?.from ?? "/", { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <img src="/growl-logo.png" alt="Growl Tech" />
        <h1>{t("app.name")}</h1>
        <ErrorBanner error={error} />
        <TextField label={t("login.username")} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
        <TextField label={t("login.password")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>{busy ? t("common.loading") : t("login.submit")}</button>
      </form>
    </div>
  );
}
