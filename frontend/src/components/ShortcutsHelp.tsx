import { useTranslation } from "react-i18next";
import { SHORTCUTS, type Group } from "../lib/shortcuts";
import { Modal } from "./Modal";

const GROUPS: Group[] = ["global", "pos", "sheet", "payment", "lists", "forms"];

/** The `?` popup: every shortcut, grouped, straight from lib/shortcuts.ts. */
export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal title={t("shortcuts.title")} onClose={onClose}>
      <p className="form-hint" style={{ marginBottom: 12 }}>{t("shortcuts.intro")}</p>
      {GROUPS.map((g) => (
        <section key={g} style={{ marginBottom: 14 }}>
          <h4 style={{ marginBottom: 6 }}>{t(`shortcuts.groups.${g}`)}</h4>
          <table className="erp-table shortcuts-table">
            <tbody>
              {SHORTCUTS.filter((s) => s.group === g).map((s) => (
                <tr key={`${g}-${s.id}`}><td style={{ width: "40%" }}><kbd className="kbd" dir="ltr">{s.keys}</kbd></td><td>{t(`shortcuts.items.${s.id}`)}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </Modal>
  );
}

/** A small key hint inside a button, e.g. <Kbd id="pay" /> → "F2". Hidden on touch screens. */
export function Kbd({ k }: { k: string }) {
  return <kbd className="kbd kbd-hint" dir="ltr" aria-hidden="true">{k}</kbd>;
}
