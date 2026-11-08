// Minimal client for Sprint 0: unwraps the {data, meta} envelope and parses {error}.
// CSRF, 401 redirect and Idempotency-Key handling arrive with Sprint 1/2.
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/v1${path}`, { credentials: "same-origin" });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const e = body?.error;
    throw new ApiError(e?.code ?? "UNKNOWN", e?.message ?? res.statusText, res.status, e?.details);
  }
  return body.data as T;
}
