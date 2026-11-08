// API client: CSRF, {data, meta} unwrapping, {error} parsing, 401 handling.
// Idempotency-Key generation arrives with Sprint 2 (checkout/refund/purchase post).
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: { fields?: Record<string, string[] | string> } = {},
  ) {
    super(message);
  }
}

export interface Page<T> {
  data: T[];
  meta: { page: number; page_size: number; total_count: number };
}

type Query = Record<string, string | number | boolean | undefined | null>;
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

const cookie = (name: string) =>
  document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];

export const qs = (q?: Query) => {
  const p = new URLSearchParams();
  Object.entries(q ?? {}).forEach(([k, v]) => v !== undefined && v !== null && v !== "" && p.set(k, String(v)));
  const s = p.toString();
  return s ? `?${s}` : "";
};

async function request<T>(method: string, path: string, body?: unknown, q?: Query): Promise<{ data: T; meta?: Page<T>["meta"] }> {
  const unsafe = method !== "GET";
  if (unsafe && !cookie("csrftoken")) await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
  const res = await fetch(`/api/v1${path}${qs(q)}`, {
    method,
    credentials: "same-origin",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(unsafe ? { "X-CSRFToken": cookie("csrftoken") ?? "" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    const err = new ApiError(e?.code ?? "UNKNOWN", e?.message ?? res.statusText, res.status, e?.details ?? {});
    if (res.status === 401 && path !== "/auth/login") onUnauthorized();
    throw err;
  }
  return { data: json?.data as T, meta: json?.meta };
}

export const api = {
  get: async <T>(path: string, q?: Query) => (await request<T>("GET", path, undefined, q)).data,
  list: async <T>(path: string, q?: Query) => {
    const r = await request<T[]>("GET", path, undefined, q);
    return { data: r.data, meta: r.meta! } as Page<T>;
  },
  /** Every page of a list (pickers). shortcut: fine up to a few thousand rows, then add server search. */
  all: async <T>(path: string, q?: Query) => {
    const out: T[] = [];
    for (let page = 1; ; page++) {
      const r = await api.list<T>(path, { ...q, page, page_size: 100 });
      out.push(...r.data);
      if (out.length >= r.meta.total_count || r.data.length === 0) return out;
    }
  },
  post: async <T>(path: string, body?: unknown) => (await request<T>("POST", path, body ?? {})).data,
  patch: async <T>(path: string, body: unknown) => (await request<T>("PATCH", path, body)).data,
  put: async <T>(path: string, body: unknown) => (await request<T>("PUT", path, body)).data,
};
