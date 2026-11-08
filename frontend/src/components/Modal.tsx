import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const { t } = useTranslation();
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-overlay" style={{ display: "flex" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}
