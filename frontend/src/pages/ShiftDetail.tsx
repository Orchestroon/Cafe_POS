import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Shift } from "../api/types";
import { CloseShiftDialog } from "../components/CloseShiftDialog";
import { PageHeader } from "../components/PageHeader";
import { ShiftSummary } from "../components/ShiftSummary";
import { ErrorBanner, Loading } from "../components/States";

/** /shift/:id: a shift's detail and print-friendly report. Open shifts can be closed here (the
 * owner, or an Admin on someone else's). */
export function ShiftDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams();
  const q = useQuery({ queryKey: ["shift", id], queryFn: () => api.get<Shift>(`/shifts/${id}`) });
  const [closing, setClosing] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBanner error={q.error} />;
  const s = q.data;
  return (
    <>
      <PageHeader title={t("shift.report")} actions={<>
        <Link className="btn btn-outline no-print" to="/shift">{t("orders.back")}</Link>
        <button className="btn btn-outline no-print" onClick={() => window.print()}>{t("receipt.print")}</button>
        {s.status === "open" && <button className="btn btn-primary no-print" onClick={() => setClosing(true)}>{t("shift.closeShift")}</button>}
      </>} />
      <ShiftSummary shift={s} />
      {closing && <CloseShiftDialog shift={s} onClose={() => setClosing(false)} onDone={() => { setClosing(false); void q.refetch(); }} />}
    </>
  );
}
