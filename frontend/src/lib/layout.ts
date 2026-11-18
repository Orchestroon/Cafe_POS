// Step 2: where each role lands and when the sidebar is hidden (UX only; the backend enforces).
export type Role = "admin" | "barista" | undefined;

/** A Barista never gets the sidebar; an Admin loses it on the POS so it gets the full tablet width. */
export const isBareLayout = (role: Role, pathname: string) =>
  role === "barista" || (role === "admin" && (pathname === "/pos" || pathname.startsWith("/pos/")));

/** After login: a Barista always starts on the POS; an Admin returns to where they were, else the overview. */
export const landingPath = (role: Role, from?: string) => (role === "barista" ? "/pos" : from ?? "/");
