const TOKEN_KEY = "visitor-admin:http:v1";
const SCOPE_KEY = "visitor-admin:scope:v1";

export type AdminBundle = {
  accessToken: string;
  refreshToken: string;
  session: {
    token: string;
    staff: {
      id: string;
      name: string;
      phone: string;
      role: "super_admin" | "distributor_admin";
      roleLabel: string;
      distributorId?: string;
      lastLoginAt?: string;
      active: boolean;
    };
    permissions: string[];
  };
};

export function apiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787/v1").replace(/\/$/, "");
}

export function readBundle(): AdminBundle | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as AdminBundle) : null;
  } catch {
    return null;
  }
}

export function writeBundle(bundle: AdminBundle | null) {
  if (!bundle) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, JSON.stringify(bundle));
}

export function readScope(): string | null {
  return localStorage.getItem(SCOPE_KEY);
}

export function writeScope(id: string | null) {
  if (!id) localStorage.removeItem(SCOPE_KEY);
  else localStorage.setItem(SCOPE_KEY, id);
}

export function errorMessage(data: unknown, fallback = "خطای شبکه") {
  if (data && typeof data === "object" && "error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
      return (err as { message: string }).message;
    }
  }
  return fallback;
}

let refreshInflight: Promise<boolean> | null = null;

async function refreshTokens() {
  if (refreshInflight) return refreshInflight;
  refreshInflight = (async () => {
    const bundle = readBundle();
    if (!bundle?.refreshToken) return false;
    const res = await fetch(`${apiBase()}/admin/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: bundle.refreshToken }),
    });
    if (!res.ok) {
      writeBundle(null);
      return false;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    writeBundle({
      ...bundle,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      session: { ...bundle.session, token: data.accessToken },
    });
    return true;
  })().finally(() => {
    refreshInflight = null;
  });
  return refreshInflight;
}

export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown; idempotency?: boolean } = {}): Promise<T> {
  const { json, idempotency, headers: extra, ...rest } = init;
  const run = async (retried: boolean): Promise<T> => {
    const bundle = readBundle();
    const headers = new Headers(extra);
    if (json !== undefined) headers.set("Content-Type", "application/json");
    if (bundle?.accessToken) headers.set("Authorization", `Bearer ${bundle.accessToken}`);
    const scope = readScope();
    if (scope) headers.set("X-Scope-Distributor", scope);
    if (idempotency) headers.set("Idempotency-Key", crypto.randomUUID());
    const res = await fetch(`${apiBase()}${path}`, {
      ...rest,
      headers,
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
    if (res.status === 401 && !retried && bundle?.refreshToken) {
      const ok = await refreshTokens();
      if (ok) return run(true);
    }
    if (res.status === 204) return undefined as T;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(errorMessage(data, `HTTP ${res.status}`));
      (err as Error & { status?: number }).status = res.status;
      throw err;
    }
    return data as T;
  };
  return run(false);
}
