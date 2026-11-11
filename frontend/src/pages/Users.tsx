import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Role, User } from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { Field, fieldError, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { Kbd } from "../components/ShortcutsHelp";
import { ErrorBanner } from "../components/States";
import { ListState, Pager, StatusBadge } from "../components/Table";

type Dialog = { kind: "create" } | { kind: "edit" | "reset"; user: User } | null;

export function Users() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const q = useQuery({ queryKey: ["users", page, search], queryFn: () => api.list<User>("/users", { page, search }) });
  const toggle = useMutation({
    mutationFn: (u: User) => api.patch(`/users/${u.id}`, { is_active: !u.is_active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
  return (
    <>
      <PageHeader title={t("nav.users")} actions={<button className="btn btn-primary" data-shortcut="new" onClick={() => setDialog({ kind: "create" })}>{t("common.new")}<Kbd k="N" /></button>} />
      <div className="card">
        <ErrorBanner error={toggle.error} />
        <div className="toolbar"><div className="form-group"><label className="form-label">{t("common.search")}</label><input data-shortcut="search" className="form-input" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div></div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("users.username")}</th><th>{t("users.displayName")}</th><th>{t("users.role")}</th><th>{t("common.status")}</th><th /></tr></thead>
            <tbody>
              {q.data?.data.map((u) => (
                <tr key={u.id}>
                  <td>{u.username}</td><td>{u.display_name}</td><td>{t(`roles.${u.role}`)}</td><td><StatusBadge active={u.is_active} /></td>
                  <td><div className="row-actions">
                    <button className="btn btn-outline btn-sm" onClick={() => setDialog({ kind: "edit", user: u })}>{t("common.edit")}</button>
                    <button className="btn btn-outline btn-sm" onClick={() => setDialog({ kind: "reset", user: u })}>{t("users.resetPassword")}</button>
                    <button className="btn btn-outline btn-sm" disabled={toggle.isPending || (u.id === me?.user.id && u.is_active)} onClick={() => toggle.mutate(u)}>{u.is_active ? t("users.deactivate") : t("users.reactivate")}</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
        <Pager meta={q.data?.meta} page={page} onPage={setPage} />
      </div>
      {dialog?.kind === "create" && <CreateUser onClose={() => setDialog(null)} />}
      {dialog?.kind === "edit" && <EditUser user={dialog.user} onClose={() => setDialog(null)} />}
      {dialog?.kind === "reset" && <ResetPassword user={dialog.user} onClose={() => setDialog(null)} />}
    </>
  );
}

const RoleSelect = ({ value, onChange }: { value: Role; onChange: (r: Role) => void }) => {
  const { t } = useTranslation();
  return (
    <Field label={t("users.role")}>
      <select className="form-select" value={value} onChange={(e) => onChange(e.target.value as Role)}>
        <option value="barista">{t("roles.barista")}</option><option value="admin">{t("roles.admin")}</option>
      </select>
    </Field>
  );
};

function Footer({ onClose, onSave, busy }: { onClose: () => void; onSave: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return <><button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={busy} onClick={onSave}>{t("common.save")}</button></>;
}

function CreateUser({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ username: "", password: "", display_name: "", role: "barista" as Role });
  const save = useMutation({
    mutationFn: () => api.post("/users", f),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["users"] }); onClose(); },
  });
  return (
    <Modal title={t("users.new")} onClose={onClose} footer={<Footer onClose={onClose} onSave={() => save.mutate()} busy={save.isPending} />}>
      <ErrorBanner error={save.error} />
      <TextField label={t("users.username")} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} error={fieldError(save.error, "username")} autoComplete="off" autoFocus />
      <TextField label={t("users.displayName")} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} error={fieldError(save.error, "display_name")} />
      <TextField label={t("login.password")} type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} error={fieldError(save.error, "password") ?? fieldError(save.error, "non_field_errors")} autoComplete="new-password" />
      <RoleSelect value={f.role} onChange={(role) => setF({ ...f, role })} />
    </Modal>
  );
}

function EditUser({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [f, setF] = useState({ display_name: user.display_name, role: user.role, preferred_language: user.preferred_language });
  const save = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}`, f),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["users"] }); onClose(); },
  });
  return (
    <Modal title={`${t("common.edit")}: ${user.username}`} onClose={onClose} footer={<Footer onClose={onClose} onSave={() => save.mutate()} busy={save.isPending} />}>
      <ErrorBanner error={save.error} />
      <TextField label={t("users.displayName")} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
      <RoleSelect value={f.role} onChange={(role) => setF({ ...f, role })} />
      <Field label={t("users.language")}>
        <select className="form-select" value={f.preferred_language} onChange={(e) => setF({ ...f, preferred_language: e.target.value as "en" | "ar" })}>
          <option value="en">English</option><option value="ar">العربية</option>
        </select>
      </Field>
    </Modal>
  );
}

function ResetPassword({ user, onClose }: { user: User; onClose: () => void }) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const save = useMutation({ mutationFn: () => api.post(`/users/${user.id}/reset-password`, { password }), onSuccess: onClose });
  return (
    <Modal title={`${t("users.resetPassword")}: ${user.username}`} onClose={onClose} footer={<Footer onClose={onClose} onSave={() => save.mutate()} busy={save.isPending} />}>
      <ErrorBanner error={save.error} />
      <div className="alert-banner alert-neutral" style={{ marginBottom: 12 }}>{t("users.resetNote")}</div>
      <TextField label={t("users.newPassword")} type="password" value={password} onChange={(e) => setPassword(e.target.value)} error={fieldError(save.error, "password")} autoComplete="new-password" autoFocus />
    </Modal>
  );
}
