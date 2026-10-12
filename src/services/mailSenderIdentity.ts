/**
 * Sender identity (email + display name) for every outbound CRM email.
 *
 * The SendGrid account is named "Nitro Advance", but it holds several verified
 * Single Sender identities (Nitro Advance, Tiberian Funding, Obsidian Capital
 * Group, ...). The From name must belong to the identity whose address is used,
 * so a name is never taken from the brand / account: it is either passed with
 * the sender, stored on the funder that owns the address, or paired with the
 * default address in `.env` (SENDGRID_FROM_EMAIL + SENDGRID_FROM_NAME).
 *
 * Kept free of other service imports so `config/nodemailer` can depend on it
 * without pulling the funder / PDF services into every mail send.
 */
import prisma from '../config/prismaClient';

export type MailSender = { email: string; name: string };

/** A sender address is known but no display name is configured for it. */
export class MissingSenderNameError extends Error {
  readonly senderEmail: string;

  constructor(senderEmail: string) {
    super(
      `No From name is configured for sender "${senderEmail}". Set "SendGrid From Name" on the ` +
        'funder that uses this address (Settings → Funders), or SENDGRID_FROM_NAME in .env when ' +
        'it is the default SENDGRID_FROM_EMAIL sender.',
    );
    this.name = 'MissingSenderNameError';
    this.senderEmail = senderEmail;
  }
}

/** Split `"Name" <email>` / `Name <email>` / `email` into its parts. */
export function parseMailSender(raw: string): { email: string; name: string | null } {
  const trimmed = String(raw || '').trim();
  const angle = trimmed.match(/^(.*)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
    return { email: angle[2].trim(), name: name || null };
  }
  return { email: trimmed, name: null };
}

function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/** Name explicitly paired with the `.env` default sender, if any. */
function envDefaultSenderName(): string | null {
  return (
    process.env.GMAIL_SENDER_NAME?.trim() ||
    process.env.SENDGRID_FROM_NAME?.trim() ||
    process.env.MAIL_FROM_NAME?.trim() ||
    null
  );
}

/**
 * Default From for general mail (SMTP relay or SendGrid).
 * `sendgridOnly` = contract-portal / payment sends, which must use the verified
 * SendGrid sender and never an SMTP login address left over in `.env`.
 */
export function resolveDefaultSenderRaw(options?: { sendgridOnly?: boolean }): string | undefined {
  // Gmail is the only transport now (SendGrid disabled): the Gmail sender mailbox is the default.
  const gmailSender = process.env.GMAIL_SENDER_EMAIL?.trim();
  if (options?.sendgridOnly) {
    return gmailSender || process.env.SENDGRID_FROM_EMAIL?.trim() || process.env.SENDGRID_AUTH_USER?.trim();
  }
  return (
    gmailSender ||
    process.env.SMTP_FROM?.trim() ||
    process.env.MAIL_FROM?.trim() ||
    process.env.SENDGRID_FROM_EMAIL?.trim() ||
    process.env.SENDGRID_AUTH_USER?.trim() ||
    process.env.SMTP_AUTH_USER?.trim()
  );
}

const DIRECTORY_TTL_MS = 60_000;
let directoryCache: { loadedAt: number; rows: Array<{ email: string; name: string | null }> } | null =
  null;

/** Call after a funder's sender fields change so the next send sees them. */
export function invalidateSenderDirectoryCache(): void {
  directoryCache = null;
}

async function loadSenderDirectory(): Promise<Array<{ email: string; name: string | null }>> {
  if (directoryCache && Date.now() - directoryCache.loadedAt < DIRECTORY_TTL_MS) {
    return directoryCache.rows;
  }
  const profiles = await prisma.funderProfile.findMany({
    where: { sendgridFromEmail: { not: null } },
    select: { sendgridFromEmail: true, sendgridFromName: true },
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }],
  });
  const rows = profiles.map((p) => ({
    email: String(p.sendgridFromEmail || '').trim(),
    name: p.sendgridFromName?.trim() || null,
  }));
  directoryCache = { loadedAt: Date.now(), rows };
  return rows;
}

/** Display name stored on the funder that owns this sender address. */
export async function lookupSenderNameByEmail(email: string): Promise<string | null> {
  const rows = await loadSenderDirectory();
  return rows.find((row) => row.name && sameEmail(row.email, email))?.name ?? null;
}

/**
 * Resolve the exact `{ email, name }` a message goes out as.
 * Throws {@link MissingSenderNameError} rather than inventing a name.
 */
export async function resolveMailSender(
  from?: string | MailSender | null,
  options?: { sendgridOnly?: boolean },
): Promise<MailSender> {
  let email: string;
  let name: string | null;
  if (from && typeof from === 'object') {
    email = String(from.email || '').trim();
    name = String(from.name || '').trim() || null;
  } else {
    const raw = (typeof from === 'string' && from.trim()) || resolveDefaultSenderRaw(options);
    if (!raw) {
      throw new Error(
        'No outbound sender is configured. Set SENDGRID_FROM_EMAIL and SENDGRID_FROM_NAME in .env.',
      );
    }
    ({ email, name } = parseMailSender(raw));
  }
  if (!email) throw new Error('Outbound sender email is empty.');
  if (name) return { email, name };

  const defaultRaw = resolveDefaultSenderRaw(options);
  const envName = envDefaultSenderName();
  if (envName && defaultRaw && sameEmail(parseMailSender(defaultRaw).email, email)) {
    return { email, name: envName };
  }

  const stored = await lookupSenderNameByEmail(email);
  if (stored) return { email, name: stored };

  throw new MissingSenderNameError(email);
}
