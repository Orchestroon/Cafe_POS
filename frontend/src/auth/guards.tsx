import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { Forbidden } from "../pages/Forbidden";
import { Loading } from "../components/States";

// UX only: the backend enforces every permission.
export function RequireAuth() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <Loading />;
  if (!me) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

export function RequireAdmin() {
  const { me } = useAuth();
  return me?.user.role === "admin" ? <Outlet /> : <Forbidden />;
}
