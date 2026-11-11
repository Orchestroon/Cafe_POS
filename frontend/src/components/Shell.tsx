import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { setLang } from "../i18n";
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
};

interface Item { to: string; label: string; icon: keyof typeof ICONS; admin?: boolean; mobile?: boolean }

export function Shell(): ReactNode {
  const { t, i18n } = useTranslation();
  const { me, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const isAdmin = me?.user.role === "admin";

  const items: Item[] = [
    { to: "/", label: t("nav.home"), icon: "home" },
    { to: "/pos", label: t("nav.pos"), icon: "pos", mobile: true },
    { to: "/orders", label: t("nav.orders"), icon: "receipt", mobile: true },
    { to: "/shift", label: t("nav.shift"), icon: "clock", mobile: !isAdmin },
    { to: "/expenses", label: t("nav.expenses"), icon: "wallet" },
    { to: "/admin/products", label: t("nav.products"), icon: "cup", admin: true, mobile: true },
    { to: "/admin/modifiers", label: t("nav.modifiers"), icon: "sliders", admin: true },
    { to: "/admin/categories", label: t("nav.categories"), icon: "tag", admin: true },
    { to: "/admin/ingredients", label: t("nav.ingredients"), icon: "doc", admin: true },
    { to: "/admin/inventory", label: t("nav.inventory"), icon: "box", admin: true, mobile: true },
    { to: "/admin/suppliers", label: t("nav.suppliers"), icon: "truck", admin: true },
    { to: "/admin/purchases", label: t("nav.purchases"), icon: "cart", admin: true },
    { to: "/admin/shifts", label: t("nav.shifts"), icon: "clock", admin: true },
    { to: "/admin/reports", label: t("nav.reports"), icon: "chart", admin: true },
    { to: "/admin/audit", label: t("nav.audit"), icon: "doc", admin: true },
    { to: "/admin/users", label: t("nav.users"), icon: "users", admin: true },
    { to: "/admin/settings", label: t("nav.settings"), icon: "gear", admin: true },
  ].filter((i) => !i.admin || isAdmin) as Item[];
  const current = items.find((i) => (i.to === "/" ? loc.pathname === "/" : loc.pathname.startsWith(i.to)));
  const initials = (me?.user.display_name || me?.user.username || "?").slice(0, 2).toUpperCase();
  const go = () => setOpen(false);
  const [help, setHelp] = useState(false);

  // B2: shortcuts that work on every page (the page's own ones are registered by the page).
  const click = (sel: string) => {
    const el = document.querySelector<HTMLElement>(`.view-container ${sel}`);
    if (!el || (el as HTMLButtonElement).disabled) return false;
    el.click();
  };
  useShortcuts({
    help: () => setHelp(true),
    goPos: () => nav("/pos"),
    goOrders: () => nav("/orders"),
    goShift: () => nav("/shift"),
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
    <div id="app" className={open ? "sidebar-open" : ""}>
      <aside className="sidebar">
        <div className="brand-header">
          <div className="brand-logo-icon"><img src="/growl-logo.png" alt="Growl Tech" style={{ width: 140, height: "auto", display: "block" }} /></div>
          <div className="brand-text"><span>{t("app.tagline")}</span></div>
          <button className="sidebar-close-btn" onClick={go} aria-label={t("common.close")}>✕</button>
        </div>
        <div className="workspace-selector">
          <div>
            <div className="workspace-label">{t("nav.workspace")}</div>
            <div className="workspace-title">{me?.organization.name}</div>
          </div>
        </div>
        <ul className="nav-menu">
          {items.map((i) => (
            <li className="nav-item" key={i.to}>
              <NavLink to={i.to} end={i.to === "/"} className={({ isActive }) => `nav-link${isActive ? " active" : ""}`} onClick={go}>
                {icon(ICONS[i.icon])}<span>{i.label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <div className="user-profile-badge">
            <div className="avatar-circle">{initials}</div>
            <div className="user-meta">
              <div className="name">{me?.user.display_name || me?.user.username}</div>
              <div className="role">{t(`roles.${me?.user.role}`)}</div>
            </div>
          </div>
          <div className="sidebar-user-actions">
            <button className="btn btn-outline btn-sm" onClick={() => void logout().then(() => nav("/login"))}>{t("nav.logout")}</button>
          </div>
        </div>
      </aside>
      <div className="sidebar-backdrop" onClick={go} />
      <main className="main-content">
        <header className="top-bar">
          <div className="top-bar-left">
            <button className="mobile-menu-btn" onClick={() => setOpen(true)} aria-label={t("nav.menu")}>{icon(ICONS.menu)}</button>
            <div className="breadcrumbs"><span>{t("nav.workspace")}</span><span>/</span><span className="current">{current?.label}</span></div>
          </div>
          <div className="top-bar-right">
            <button className="lang-btn kbd-btn" onClick={() => setHelp(true)} aria-label={t("shortcuts.title")} title={t("shortcuts.hint")}>?</button>
            <button className="lang-btn" onClick={() => setLang(i18n.language === "ar" ? "en" : "ar")}>{i18n.language === "ar" ? "EN" : "عربي"}</button>
          </div>
        </header>
        <section className="view-container"><Outlet /></section>
        {help && <ShortcutsHelp onClose={() => setHelp(false)} />}
      </main>
      <nav className="mobile-bottom-nav">
        {items.filter((i) => i.mobile).map((i) => (
          <button key={i.to} className={`mobile-nav-btn${current?.to === i.to ? " active" : ""}`} onClick={() => nav(i.to)}>
            {icon(ICONS[i.icon])}<span>{i.label}</span>
          </button>
        ))}
        <button className="mobile-nav-btn" onClick={() => setOpen(true)}>{icon(ICONS.menu)}<span>{t("nav.menu")}</span></button>
      </nav>
    </div>
  );
}
