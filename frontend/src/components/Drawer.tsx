import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LayerContext, newLayerId, popLayer, pushLayer, useShortcuts } from "../lib/shortcuts";

/** A slide-over panel from the end edge (mirrors in RTL). Like Modal it is its own shortcut layer:
 *  while open, the page behind ignores keys; Esc closes it. Popups opened inside stack above it. */
export function Drawer({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  const [layer] = useState(newLayerId);
  useEffect(() => { pushLayer(layer); return () => popLayer(layer); }, [layer]);
  useShortcuts({ close: () => onClose() }, layer);
  return (
    <LayerContext.Provider value={layer}>
      <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <aside className={`drawer${wide ? " drawer-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
          <div className="drawer-header">
            <h3>{title}</h3>
            <button className="icon-btn" onClick={onClose} aria-label={t("common.close")}>✕</button>
          </div>
          <div className="drawer-body">{children}</div>
        </aside>
      </div>
    </LayerContext.Provider>
  );
}
