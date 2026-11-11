import { useQuery } from "@tanstack/react-query";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api/client";
import type { AuditEvent, AuditMeta, User } from "../api/types";
import { actionKey, AREAS, areaOf, details, sentence, type Ctx } from "../audit/describe";
import { useAuth } from "../auth/AuthContext";
import { PageHeader } from "../components/PageHeader";
import { ListState, Pager } from "../components/Table";
import { formatDateTime } from "../i18n/format";

const FILTERS = ["action", "actor_id", "entity_type", "entity_id", "from", "to"] as const;
type Filters = Record<(typeof FILTERS)[number], string>;

/** Admin audit log (spec 10.6), written for non-technical readers (owner, 2026-11-11): each event
 *  is a translated sentence; opening a row shows labelled details and before → after changes.
 *  Filters live in the URL so record pages can link here ("History"). */
export function AuditLog() {
  const { t } = useTranslation();
  const { me } = useAuth();
  const tz = me?.settings.timezone ?? "UTC";
  const [params, setParams] = useSearchParams();
  const f = Object.fromEntries(FILTERS.map((k) => [k, params.get(k) ?? ""])) as Filters;
  const page = Number(params.get("page")) || 1;
  const [open, setOpen] = useState<string | null>(null);
  const set = (patch: Partial<Filters> & { page?: number }) => {
    const next = { ...f, page: 1, ...patch } as Record<string, string | number>;
    setParams(Object.fromEntries(Object.entries(next).filter(([, v]) => v !== "" && v !== 1).map(([k, v]) => [k, String(v)])));
  };
  const q = useQuery({
    queryKey: ["audit-events", f, page],
    queryFn: () => api.getWithMeta<AuditEvent[], AuditMeta>("/audit-events", { ...f, page }),
  });
  const users = useQuery({ queryKey: ["users", "all"], queryFn: () => api.all<User>("/users") });
  const meta = q.data?.meta;
  const ctx: Ctx = { t, currency: me?.settings.currency ?? "", names: meta?.names ?? {} };
  const actionName = (a: string) => t(`audit.actions.${actionKey(a)}`, { defaultValue: a });
  const history = f.entity_id ? q.data?.data[0]?.entity_label ?? meta?.names[f.entity_id] : null;
  return (
    <>
      <PageHeader title={t("audit.title")} subtitle={t("audit.subtitle")} />
      {f.entity_id && (
        <div className="alert-banner alert-neutral audit-history" role="status">
          <span>{t("audit.historyOf", { name: history ?? t("audit.thisRecord") })}</span>
          <button className="btn btn-outline btn-sm" onClick={() => set({ entity_type: "", entity_id: "" })}>{t("audit.showAll")}</button>
        </div>
      )}
      <div className="card">
        <div className="toolbar">
          <div className="form-group"><label className="form-label">{t("audit.what")}
            <select className="form-select" value={f.action} onChange={(e) => set({ action: e.target.value })}>
              <option value="">{t("common.all")}</option>
              {AREAS.map((area) => {
                const acts = (meta?.actions ?? []).filter((a) => areaOf(a) === area);
                return acts.length ? (
                  <optgroup key={area} label={t(`audit.areas.${area}`)}>
                    {acts.map((a) => <option key={a} value={a}>{actionName(a)}</option>)}
                  </optgroup>
                ) : null;
              })}
            </select></label></div>
          <div className="form-group"><label className="form-label">{t("audit.who")}
            <select className="form-select" value={f.actor_id} onChange={(e) => set({ actor_id: e.target.value })}>
              <option value="">{t("common.all")}</option>
              {users.data?.map((u) => <option key={u.id} value={u.id}>{u.display_name || u.username}</option>)}
            </select></label></div>
          <div className="form-group"><label className="form-label">{t("common.from")}
            <input type="date" className="form-input" value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} /></label></div>
          <div className="form-group"><label className="form-label">{t("common.to")}
            <input type="date" className="form-input" value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} /></label></div>
          <button className="btn btn-outline" onClick={() => setParams({})}>{t("audit.clear")}</button>
        </div>
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <div className="table-scroll">
            <table className="erp-table audit-table">
              <thead><tr><th>{t("audit.when")}</th><th>{t("audit.who")}</th><th>{t("audit.what")}</th><th>{t("audit.details")}</th><th /></tr></thead>
              <tbody>
                {q.data?.data.map((e) => {
                  const expanded = open === e.id;
                  const toggle = () => setOpen(expanded ? null : e.id);
                  return (
                    <Fragment key={e.id}>
                      <tr className="clickable" tabIndex={0} aria-expanded={expanded} onClick={toggle} onKeyDown={(k) => k.key === "Enter" && toggle()}>
                        <td className="audit-when">{formatDateTime(e.created_at, tz)}</td>
                        <td>{e.actor ? e.actor.display_name : t("audit.system")}</td>
                        <td><span className={`badge audit-area audit-area-${areaOf(e.action)}`}>{actionName(e.action)}</span></td>
                        <td className="audit-sentence">{sentence(e, ctx)}</td>
                        <td aria-hidden="true">{expanded ? "▲" : "▼"}</td>
                      </tr>
                      {expanded && (
                        <tr className="audit-detail-row"><td colSpan={5}>
                          <dl className="audit-details">
                            {details(e, ctx).map((d, i) => (
                              <div key={i} className="audit-detail">
                                <dt>{d.label}</dt>
                                <dd>{d.before !== undefined ? <><span className="audit-before">{d.before}</span> <span aria-hidden="true">{t("audit.arrow")}</span> <span className="audit-after">{d.after}</span></> : d.value}</dd>
                              </div>
                            ))}
                          </dl>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </ListState>
        <Pager meta={meta} page={page} onPage={(p) => set({ page: p })} />
      </div>
    </>
  );
}

/** "History" link for a record page (Admin only): the audit log filtered to that record. */
export function HistoryLink({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { t } = useTranslation();
  const { me } = useAuth();
  if (me?.user.role !== "admin") return null;
  return <Link className="btn btn-outline btn-sm" to={`/admin/audit?entity_type=${encodeURIComponent(entityType)}&entity_id=${entityId}`}>{t("audit.history")}</Link>;
}
