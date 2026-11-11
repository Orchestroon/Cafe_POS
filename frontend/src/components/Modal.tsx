import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LayerContext, newLayerId, popLayer, pushLayer, useShortcuts, type Handlers } from "../lib/shortcuts";

/** A popup. It is its own shortcut layer: while open, page shortcuts behind it do not fire.
 *  Esc closes it; Ctrl+Enter presses its main (primary) footer button. */
export function Modal({ title, onClose, children, footer, shortcuts }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; shortcuts?: Handlers }) {
  const { t } = useTranslation();
  const [layer] = useState(newLayerId);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => { pushLayer(layer); return () => popLayer(layer); }, [layer]);
  useShortcuts({
    ...shortcuts,
    close: () => onClose(),
    save: () => box.current?.querySelector<HTMLButtonElement>(".modal-footer .btn-primary:not(:disabled)")?.click(),
  }, layer);
  return (
    <LayerContext.Provider value={layer}>
      <div className="modal-overlay" style={{ display: "flex" }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="modal-content" role="dialog" aria-modal="true" aria-label={title} ref={box}>
          <div className="modal-header">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>✕</button>
          </div>
          <div className="modal-body">{children}</div>
          {footer && <div className="modal-footer">{footer}</div>}
        </div>
      </div>
    </LayerContext.Provider>
  );
}
