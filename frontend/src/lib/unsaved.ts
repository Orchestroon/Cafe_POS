// Unsaved-changes guard (Products & recipes editor). The app uses <BrowserRouter>, which has no
// navigation blocker, so the shell asks this guard before it navigates (menu, shortcuts), and the
// browser asks on reload / tab close.
let dirty = false;
let message = "";

export function setUnsaved(on: boolean, text = "") {
  dirty = on;
  message = text;
}

/** true = go on (nothing unsaved, or the user agreed to lose the changes). */
export function confirmLeave(): boolean {
  if (!dirty) return true;
  const ok = window.confirm(message);
  if (ok) dirty = false;
  return ok;
}

window.addEventListener("beforeunload", (e) => {
  if (dirty) e.preventDefault();
});
