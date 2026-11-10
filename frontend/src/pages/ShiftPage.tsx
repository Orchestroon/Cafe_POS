import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Shift } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { CloseShiftDialog } from "../components/CloseShiftDialog";
import { ExpenseDialog } from "../components/ExpenseDialog";
import { PageHeader } from "../components/PageHeader";
import { ShiftSummary } from "../components/ShiftSummary";
import { ErrorBanner, Loading } from "../components/States";

/** /shift: my open shift (live totals), Pay from drawer, and the close flow. */
export function ShiftPage() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["shift", "current"], queryFn: () => api.get<Shift | null>("/shifts/current"), refetchInterval: 30000 });
  const [dlg, setDlg] = useState<"close" | "expense" | null>(null);
  if (q.isLoading) return <Loading />;
  const shift = q.data;
  return (
    <>
      <PageHeader title={t("nav.shift")} actions={me?.user.role === "admin" ? <Link className="btn btn-outline" to="/admin/shifts">{t("shift.allShifts")}</Link> : undefined} />
      <ErrorBanner error={q.error} />
      {!shift ? (
        <div className="card"><p>{t("shift.none")}</p><Link className="btn btn-primary" to="/pos" style={{ marginTop: 12 }}>{t("shift.goPos")}</Link></div>
      ) : (
        <>
          <ShiftSummary shift={shift} />
          <div className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
            <button className="btn btn-outline" onClick={() => setDlg("expense")}>{t("expenses.payFromDrawer")}</button>
            <button className="btn btn-primary" onClick={() => setDlg("close")}>{t("shift.closeShift")}</button>
          </div>
        </>
      )}
      {dlg === "close" && shift && <CloseShiftDialog shift={shift} onClose={() => setDlg(null)} onDone={(s) => nav(`/shift/${s.id}`)} />}
      {dlg === "expense" && <ExpenseDialog drawerOnly onClose={() => setDlg(null)} />}
    </>
  );
}
