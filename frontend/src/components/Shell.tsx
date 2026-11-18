import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useAuth } from "../auth/AuthContext";
import { setLang } from "../i18n";
import { confirmLeave } from "../lib/unsaved";
import { isBareLayout } from "../lib/layout";
import { Alerts } from "./Alerts";
import { moveFocus, useShortcuts } from "../lib/shortcuts";
import { ShortcutsHelp } from "./ShortcutsHelp";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d={d} /></svg>
);
const ICONS = {
  home: "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  cup: "M17 8h1a4 4 0 1 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4Z",
  box: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z",
  tag: "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8zM7 7h.01",
  doc: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  menu: "M3 12h18M3 6h18M3 18h18",
  pos: "M3 3h18v14H3zM8 21h8M12 17v4",
  receipt: "M4 2v20l3-2 3 2 3-2 3 2 3-2V2l-3 2-3-2-3 2-3-2zM8 8h8M8 12h8",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  wallet: "M20 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 14h.01M4 7V5a2 2 0 0 1 2-2h12v4",
  truck: "M1 3h15v13H1zM16 8h4l3 3v5h-7zM5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  cart: "M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0",
  chart: "M18 20V10M12 20V4M6 20v-6",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  bell: "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0",
  help: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01",
};

type Section = "daily" | "menu" | "manage";
/** `match`: path prefixes that keep a merged page highlighted on all of its tabs and child routes. */
interface Item { to: string; label: string; short?: string; icon: keyof typeof ICONS; section: Section; admin?: boolean; mobile?: boolean; match?: string[] }
const SECTIONS: Section[] = ["daily", "menu", "manage"];
const isIn = (i: Item, path: string) => (i.match ?? [i.to]).some((m) => (m === "/" ? path === "/" : path === m || path.startsWith(`${m}/`)));

/** App shell (owner design, 2026-11-16): grouped sidebar, workspace card, help + alerts + date in
 *  the top bar. Growl theme. Every navigation asks the unsaved-changes guard first. */
export function Shell(): ReactNode {
  const { t, i18n } = useTranslation();
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const navigate = useNavigate();
  const nav = (to: string) => { if (confirmLeave()) navigate(to); };
  const isAdmin = me?.user.role === "admin";
  // Step 2: no sidebar for a Barista, nor for an Admin on the POS (full tablet width).
  const bare = isBareLayout(me?.user.role, loc.pathname);
  const onPos = loc.pathname === "/pos";
  const tz = me?.settings.timezone ?? "UTC";

  const items: Item[] = [
    { to: "/", label: t("nav.home"), icon: "home", section: "daily" },
    { to: "/pos", label: t("nav.pos"), short: t("nav.short.pos"), icon: "pos", section: "daily", mobile: true },
    { to: "/orders", label: t("nav.orders"), short: t("nav.short.orders"), icon: "receipt", section: "daily", mobile: true },
    { to: "/expenses", label: t("nav.expenses"), icon: "wallet", section: "daily" },
    { to: "/admin/products", label: t("nav.menuRecipes"), short: t("nav.short.products"), icon: "cup", section: "menu", admin: true, mobile: true, match: ["/admin/products", "/admin/modifiers", "/admin/categories", "/admin/promotions"] },
    { to: "/admin/inventory", label: t("nav.inventory"), short: t("nav.short.inventory"), icon: "box", section: "menu", admin: true, mobile: true },
    { to: "/admin/purchases", label: t("nav.buying"), icon: "cart", section: "menu", admin: true, match: ["/admin/purchases", "/admin/suppliers"] },
    { to: "/admin/shifts", label: t("nav.shifts"), icon: "clock", section: "manage", admin: true },
    { to: "/admin/reports", label: t("nav.reports"), icon: "chart", section: "manage", admin: true },
    { to: "/admin/audit", label: t("nav.audit"), icon: "doc", section: "manage", admin: true },
    { to: "/admin/users", label: t("nav.users"), icon: "users", section: "manage", admin: true },
    { to: "/admin/settings", label: t("nav.settings"), icon: "gear", section: "manage", admin: true },
  ].filter((i) => !i.admin || isAdmin) as Item[];
  const current = items.find((i) => isIn(i, loc.pathname));
  const initials = (me?.user.display_name || me?.user.username || "?").slice(0, 2).toUpperCase();
  const go = () => setOpen(false);
  const [help, setHelp] = useState(false);
  const city = tz.split("/").pop()?.replace(/_/g, " ") ?? tz;
  const today = new Intl.DateTimeFormat(i18n.language === "ar" ? "ar-EG" : "en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date());

  // B2: shortcuts that work on every page (the page's own ones are registered by the page).
  const click = (sel: string) => {
    const el = document.querySelector<HTMLElement>(`.view-container ${sel}`);
    if (!el || (el as HTMLButtonElement).disabled) return false;
    el.click();
  };
  useShortcuts({
    help: () => setHelp(true),
    goPos: () => nav("/pos"),
    // On the POS these two open the Orders and Shift drawers (the page registers them).
    goOrders: () => (onPos ? false : nav("/orders")),
    goShift: () => (onPos ? false : nav("/pos")),
    goHome: () => (isAdmin ? nav("/") : false),
    search: () => {
      const el = document.querySelector<HTMLInputElement>('.view-container [data-shortcut="search"]');
      if (!el) return false;
      el.focus();
      el.select();
    },
    new: () => click('[data-shortcut="new"]'),
    rows: (e) => {
      // Lists with focusable rows (Orders, Audit log): ↓ starts, ↑/↓ move, Enter opens.
      const rows = [...document.querySelectorAll<HTMLElement>(".view-container tbody tr[tabindex]")];
      const active = document.activeElement;
      if (rows.length === 0) return false;
      if (!rows.includes(active as HTMLElement) && !(active === document.body && e.code === "ArrowDown")) return false;
      moveFocus(rows, active, e.code);
    },
  });

  return (
    <div id="app" className={`${open && !bare ? "sidebar-open" : ""}${bare ? " no-sidebar" : ""}`.trim()}>
      {!bare && <aside className="sidebar">
        <div className="brand-header">
          <div className="brand-logo-icon"><img src="/growl-logo.png" alt="Growl Tech" style={{ width: 140, height: "auto", display: "block" }} /></div>
          <div className="brand-text"><span>{t("app.tagline")}</span></div>
          <button className="sidebar-close-btn" onClick={go} aria-label={t("common.close")}>✕</button>
        </div>
        <div className="workspace-selector">
          <div>
            <div className="workspace-label">{t("nav.workspace")}</div>
            <div className="workspace-title">{me?.organization.name}</div>
            <div className="workspace-sub">{t("nav.branch", { city })}</div>
          </div>
        </div>
        <nav className="nav-scroll" aria-label={t("nav.menu")}>
          {SECTIONS.map((sec) => {
            const list = items.filter((i) => i.section === sec);
            if (list.length === 0) return null;
            return (
              <div key={sec} className="nav-group">
                {(isAdmin || sec !== "daily") && <div className="nav-section-title">{t(`nav.sections.${sec}`)}</div>}
                <ul className="nav-menu">
                  {list.map((i) => (
                    <li className="nav-item" key={i.to}>
                      <NavLink to={i.to} end={i.to === "/"} className={`nav-link${current?.to === i.to ? " active" : ""}`} onClick={(e) => { if (!confirmLeave()) e.preventDefault(); else go(); }}>
                        {icon(ICONS[i.icon])}<span>{i.label}</span>
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-help">
            <div className="sidebar-help-title">{t("nav.needHand")}</div>
            <button className="sidebar-help-link" onClick={() => setHelp(true)}>{t("nav.openShortcuts")} ↗</button>
          </div>
          <div className="user-profile-badge">
            <div className="avatar-circle">{initials}</div>
            <div className="user-meta">
              <div className="name">{me?.user.display_name || me?.user.username}</div>
              <div className="role">{t(`roles.${me?.user.role}`)}</div>
            </div>
          </div>
          <div className="sidebar-user-actions">
            <button className="btn btn-outline btn-sm" onClick={() => { if (confirmLeave()) void logout().then(() => navigate("/login")); }}>{t("nav.logout")}</button>
          </div>
        </div>
      </aside>}
      {!bare && <div className="sidebar-backdrop" onClick={go} />}
      <main className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            {!bare && <button className="mobile-menu-btn" onClick={() => setOpen(true)} aria-label={t("nav.menu")}>{icon(ICONS.menu)}</button>}
            {bare && <img className="top-logo" src="/growl-logo.png" alt="Growl Tech" />}
            {isAdmin && onPos && <button className="btn btn-outline btn-sm" onClick={() => nav("/")}>{t("nav.backToDashboard")}</button>}
            {!bare && <div className="breadcrumbs"><span>{t("nav.workspace")}</span><span>/</span><span className="current">{current?.label}</span></div>}
          </div>
          <div className="top-bar-right">
            <span className="top-date">{today}</span>
            <button className="top-icon-btn" onClick={() => setHelp(true)} aria-label={t("shortcuts.title")} title={t("shortcuts.hint")}>{icon(ICONS.help)}</button>
            {isAdmin && <Alerts icon={icon(ICONS.bell)} onGo={(to) => nav(to)} />}
            <button className="lang-btn" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{i18n.language === "ar" ? "EN" : "عربي"}</button>
            {bare && (
              <>
                <div className="top-user" title={t(`roles.${me?.user.role}`)}>
                  <div className="avatar-circle">{initials}</div>
                  <span className="top-user-name">{me?.user.display_name || me?.user.username}</span>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => { if (confirmLeave()) void logout().then(() => navigate("/login")); }}>{t("nav.logout")}</button>
              </>
            )}
          </div>
        </header>
        <section className="view-container"><Outlet /></section>
        {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      </main>
      {!bare && (
        <nav className="mobile-bottom-nav">
          {items.filter((i) => i.mobile).map((i) => (
            <button key={i.to} className={`mobile-nav-btn${current?.to === i.to ? " active" : ""}`} onClick={() => nav(i.to)}>
              {icon(ICONS[i.icon])}<span>{i.short ?? i.label}</span>
            </button>
          ))}
          <button className="mobile-nav-btn" onClick={() => setOpen(true)}>{icon(ICONS.menu)}<span>{t("nav.menu")}</span></button>
        </nav>
      )}
    </div>
  );
}
