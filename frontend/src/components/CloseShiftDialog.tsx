import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Shift } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { isDecimal, TextField } from "./Form";
import { Modal } from "./Modal";
import { ErrorBanner } from "./States";

/** Close a shift with the counted cash. The server computes expected cash and the difference. */
export function CloseShiftDialog({ shift, onClose, onDone }: { shift: Shift; onClose: () => void; onDone: (s: Shift) => void }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [cash, setCash] = useState("");
  const [note, setNote] = useState("");
  const [clientErr, setClientErr] = useState("");
  const own = shift.user.id === me?.user.id;
  const close = useMutation({
    mutationFn: () => api.post<Shift>(`/shifts/${shift.id}/close`, { actual_closing_cash: cash.trim(), note: note.trim() }),
    onSuccess: (s) => {
      void qc.invalidateQueries({ queryKey: ["shift"] });
      void qc.invalidateQueries({ queryKey: ["shifts"] });
      onDone(s);
    },
  });
  const submit = () => (isDecimal(cash, 2) ? (setClientErr(""), close.mutate()) : setClientErr(t("pos.cashInvalid")));
  return (
    <Modal title={t("shift.closeTitle")} onClose={onClose} footer={<>
      <button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button>
      <button className="btn btn-primary" disabled={close.isPending} onClick={submit}>{t("shift.closeShift")}</button>
    </>}>
      <p className="form-hint" style={{ marginBottom: 10 }}>{own ? t("shift.closeText") : t("shift.closeOther", { name: shift.user.display_name })}</p>
      <ErrorBanner error={close.error} />
      <TextField label={t("shift.actualCash")} inputMode="decimal" autoFocus value={cash} onChange={(e) => setCash(e.target.value)} error={clientErr} />
      <TextField label={t("shift.note")} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
