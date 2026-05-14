import crypto from 'crypto';
import prisma from '../config/prismaClient';

const sha256Hex = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const generateNonGuessableToken = () => crypto.randomBytes(32).toString('base64url');

let publicApprovalTokenTableExistsCache: boolean | null = null;

export async function isPublicPortalTokenTableReady(): Promise<boolean> {
  if (publicApprovalTokenTableExistsCache !== null) {
    return publicApprovalTokenTableExistsCache;
  }
  const rows = await prisma.$queryRaw<{ regclass: string | null }[]>`
    SELECT to_regclass('public."PublicApprovalToken"')::text AS regclass
  `;
  publicApprovalTokenTableExistsCache = Boolean(rows?.[0]?.regclass);
  return publicApprovalTokenTableExistsCache;
}

/**
 * Creates a row in PublicApprovalToken and returns the raw secret (shown once — e.g. in email links).
 * Same storage as approval share links; scoped access is enforced by which public page consumes the token.
 */
export async function createPublicPortalToken(
  applicationUuid: string,
  options?: { expiresInDays?: number },
): Promise<string | null> {
  if (!(await isPublicPortalTokenTableReady())) {
    return null;
  }

  let expiresAt: Date | undefined;
  if (
    typeof options?.expiresInDays === 'number' &&
    Number.isFinite(options.expiresInDays) &&
    options.expiresInDays > 0
  ) {
    expiresAt = new Date(Date.now() + options.expiresInDays * 24 * 60 * 60 * 1000);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const token = generateNonGuessableToken();
    const tokenHash = sha256Hex(token);
    try {
      await prisma.publicApprovalToken.create({
        data: {
          tokenHash,
          applicationId: applicationUuid,
          expiresAt: expiresAt ?? undefined,
        },
      });
      return token;
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'P2002') continue;
      throw err;
    }
  }
  return null;
}

export { sha256Hex };
