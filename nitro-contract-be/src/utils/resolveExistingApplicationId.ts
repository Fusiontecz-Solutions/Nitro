import prisma from '../config/prismaClient';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function collectApplicationRefCandidates(
  ref: unknown,
  into: string[] = [],
  depth = 0,
): string[] {
  if (depth > 4) return into;
  const raw = Array.isArray(ref) ? ref[0] : ref;
  if (raw == null) return into;
  if (typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of ['applicationId', 'application', '_id', 'id'] as const) {
      collectApplicationRefCandidates(obj[key], into, depth + 1);
    }
    return into;
  }
  const str = String(raw).trim();
  if (str && !into.includes(str)) into.push(str);
  return into;
}

async function lookupApplicationId(str: string): Promise<string | null> {
  if (!str) return null;

  if (UUID_RE.test(str)) {
    const byId = await prisma.application.findUnique({
      where: { id: str },
      select: { id: true },
    });
    if (byId) return byId.id;
  }

  if (/^\d+$/.test(str)) {
    const byNumeric = await prisma.application.findUnique({
      where: { applicationId: Number(str) },
      select: { id: true },
    });
    if (byNumeric) return byNumeric.id;
  }

  const byDealId = await prisma.application.findFirst({
    where: { dealId: { equals: str, mode: 'insensitive' } },
    select: { id: true },
    orderBy: { updatedAt: 'desc' },
  });
  return byDealId?.id ?? null;
}

export function coerceApplicationRef(ref: unknown): string {
  return collectApplicationRefCandidates(ref)[0] ?? '';
}

export async function resolveExistingApplicationId(
  ref: unknown,
): Promise<string | null> {
  const candidates = collectApplicationRefCandidates(ref);
  for (const str of candidates) {
    const found = await lookupApplicationId(str);
    if (found) return found;
  }
  return null;
}
