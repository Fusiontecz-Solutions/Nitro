import type { Application } from "@/types/applicationTypes";

/** Fallback when route has no id — same as deal pipeline dev default. */
export const DEFAULT_APPLICATION_UUID =
  "cfa6df58-c313-4e98-a679-ce098025c3b4";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isApplicationUuid(value: string): boolean {
  return UUID_REGEX.test(value.trim());
}

/** Resolve Prisma application UUID from payment route param (may be encoded). */
export function resolvePaymentDealApplicationId(
  paymentDealId: string | undefined,
): string {
  const raw = paymentDealId?.trim();
  if (!raw) return DEFAULT_APPLICATION_UUID;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    decoded = raw;
  }
  return isApplicationUuid(decoded) ? decoded : DEFAULT_APPLICATION_UUID;
}

export function applicationPrimaryKey(
  app: Application | null | undefined,
): string | null {
  if (!app) return null;
  const a = app as Application & { id?: string };
  const v = a.id ?? a._id;
  if (v == null || String(v).length === 0) return null;
  return String(v);
}
