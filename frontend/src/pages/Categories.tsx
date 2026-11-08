import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/client";
import type { Category } from "../api/types";
import { Check, fieldError, TextField } from "../components/Form";
import { Modal } from "../components/Modal";
import { PageHeader } from "../components/PageHeader";
import { ErrorBanner } from "../components/States";
import { ListState, StatusBadge } from "../components/Table";

export function Categories() {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<Partial<Category> | null>(null);
  const q = useQuery({ queryKey: ["categories"], queryFn: () => api.all<Category>("/categories", { ordering: "sort_order" }) });
  return (
    <>
      <PageHeader title={t("nav.categories")} actions={<button className="btn btn-primary" onClick={() => setEditing({ is_active: true, sort_order: 0 })}>{t("common.new")}</button>} />
      <div className="card">
        <ListState loading={q.isLoading} error={q.error} empty={q.data?.length === 0}>
          <table className="erp-table">
            <thead><tr><th>{t("common.name")}</th><th className="num">{t("common.sort")}</th><th>{t("common.status")}</th><th /></tr></thead>
            <tbody>
              {q.data?.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td><td className="num">{c.sort_order}</td><td><StatusBadge active={c.is_active} /></td>
                  <td><div className="row-actions"><button className="btn btn-outline btn-sm" onClick={() => setEditing(c)}>{t("common.edit")}</button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </ListState>
      </div>
      {editing && <CategoryForm initial={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function CategoryForm({ initial, onClose }: { initial: Partial<Category>; onClose: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [name, setName] = useState(initial.name ?? "");
  const [sort, setSort] = useState(String(initial.sort_order ?? 0));
  const [active, setActive] = useState(initial.is_active ?? true);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, sort_order: Number(sort) || 0, is_active: active };
      return initial.id ? api.patch(`/categories/${initial.id}`, body) : api.post("/categories", body);
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["categories"] }); onClose(); },
  });
  return (
    <Modal title={initial.id ? t("categories.edit") : t("categories.new")} onClose={onClose}
      footer={<><button className="btn btn-outline" onClick={onClose}>{t("common.cancel")}</button><button className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>{t("common.save")}</button></>}>
      <ErrorBanner error={save.error} />
      <TextField label={t("common.name")} value={name} onChange={(e) => setName(e.target.value)} error={fieldError(save.error, "name")} autoFocus />
      <TextField label={t("common.sort")} type="number" value={sort} onChange={(e) => setSort(e.target.value)} error={fieldError(save.error, "sort_order")} />
      <Check label={t("common.active")} checked={active} onChange={setActive} />
    </Modal>
  );
}
