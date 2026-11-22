export const MARKETPLACE_REQUIRES_PRO = "MARKETPLACE_REQUIRES_PRO";

export class ApiClientError extends Error {
  constructor(
    message: string,
    public code?: string,
    public status?: number,
    public payload?: unknown,
    public retryAfter?: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

export function errorCode(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  if ("code" in data && typeof (data as { code: unknown }).code === "string") {
    return (data as { code: string }).code;
  }
  if ("error" in data) {
    const err = (data as { error: unknown }).error;
    if (typeof err === "string") return err;
    if (err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string") {
      return (err as { code: string }).code;
    }
  }
  return undefined;
}

export function isMarketplaceRequiresPro(err: unknown) {
  if (!err) return false;
  if (err instanceof ApiClientError) return err.code === MARKETPLACE_REQUIRES_PRO || err.status === 403 && err.code === MARKETPLACE_REQUIRES_PRO;
  if (typeof err === "object" && "code" in err && (err as { code: unknown }).code === MARKETPLACE_REQUIRES_PRO) return true;
  return err instanceof Error && err.message.includes(MARKETPLACE_REQUIRES_PRO);
}

export function marketplaceRequiresPro() {
  return new ApiClientError("برای دسترسی به بازار به اشتراک پرو نیاز دارید", MARKETPLACE_REQUIRES_PRO, 403);
}
