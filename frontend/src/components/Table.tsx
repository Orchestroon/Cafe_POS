import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { Page } from "../api/client";
import { Empty, ErrorBanner, Loading } from "./States";

export function Pager({ meta, page, onPage }: { meta?: Page<unknown>["meta"]; page: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  if (!meta) return null;
  const pages = Math.max(1, Math.ceil(meta.total_count / meta.page_size));
  return (
    <div className="pager">
      <span>{t("common.total", { count: meta.total_count })}</span>
      <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t("common.prev")}</button>
        {page} / {pages}
        <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t("common.next")}</button>
      </span>
    </div>
  );
}

/** Wraps a table with the loading / error / empty states every list needs. */
export function ListState({ loading, error, empty, children }: { loading: boolean; error: unknown; empty: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  if (loading) return <Loading />;
  if (error) return <ErrorBanner error={error} />;
  if (empty) return <Empty>{t("common.empty")}</Empty>;
  return <div className="erp-table-wrap table-scroll">{children}</div>;
}

export const StatusBadge = ({ active }: { active: boolean }) => {
  const { t } = useTranslation();
  return <span className={`badge ${active ? "badge-active" : "badge-off"}`}>{active ? t("common.active") : t("common.inactive")}</span>;
};
