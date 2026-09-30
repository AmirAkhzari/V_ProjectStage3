import { ApiClientError, errorCode } from "@/lib/apiError";

const TOKEN_KEY = "visitor:http:v1";

export type TokenBundle = {
  accessToken: string;
  refreshToken: string;
  user: { id: string; name: string; phone: string };
  selectedAddressId: string | null;
};

export function apiBase() {
  return (import.meta.env.VITE_API_BASE_URL || "http://localhost:8787/v1").replace(/\/$/, "");
}

/** HTTPS pages cannot reach a localhost HTTP API (mixed content / Failed to fetch). */
export function httpApiReachable(
  mode: string | undefined,
  baseUrl: string,
  locationProtocol: string,
) {
  if (mode !== "http") return false;
  if (locationProtocol !== "https:") return true;
  try {
    const url = new URL(baseUrl || "http://localhost:8787/v1");
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    return !(url.protocol === "http:" && local);
  } catch {
    return false;
  }
}

export function shouldUseHttpApi() {
  const protocol = typeof window === "undefined" ? "http:" : window.location.protocol;
  return httpApiReachable(import.meta.env.VITE_API_MODE, apiBase(), protocol);
}

export function readBundle(): TokenBundle | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? (JSON.parse(raw) as TokenBundle) : null;
  } catch {
    return null;
  }
}

export function writeBundle(bundle: TokenBundle | null) {
  if (!bundle) localStorage.removeItem(TOKEN_KEY);
  else localStorage.setItem(TOKEN_KEY, JSON.stringify(bundle));
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
    const res = await fetch(`${apiBase()}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: bundle.refreshToken }),
    });
    if (!res.ok) {
      writeBundle(null);
      return false;
    }
    const data = (await res.json()) as { accessToken: string; refreshToken: string };
    writeBundle({ ...bundle, accessToken: data.accessToken, refreshToken: data.refreshToken });
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
      throw new ApiClientError(errorMessage(data, `HTTP ${res.status}`), errorCode(data), res.status, data);
    }
    return data as T;
  };
  return run(false);
}
