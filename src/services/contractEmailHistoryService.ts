import { randomUUID } from 'crypto';
import prisma from '../config/prismaClient';
import type { MailSender } from './mailSenderIdentity';
import { createOutboundCommunication, storeSgMessageIdOnOutbound } from './outboundCommunicationService';
import { resolveSignedCopyParties } from './signnow/utils/signnow-signed-copy-parties';

/**
 * Every email a contract sent, one row per recipient, for the Contract tab's
 * "Email recipients" history.
 *
 * Contract emails go out from several places (SendGrid signing-portal invites,
 * SignNow group invites, CC and agent copies at send, the signed-contract
 * notice). Each path records its recipients here with the role they received
 * the email as, so the history can say who got what without re-deriving it.
 */

export const CONTRACT_EMAIL_SOURCE = 'contract_email';
const COMPLETION_NOTICE_SOURCE = 'signnow_completion_notice';

export type ContractEmailKind =
  | 'signing_invite'
  | 'signing_reminder'
  | 'cc_copy'
  | 'agent_sent_notice'
  | 'signed_copy';

export type ContractEmailRole =
  | 'SIGNER'
  | 'CC'
  | 'AGENT'
  | 'FUNDER_CC'
  | 'CONTRACTS_INBOX'
  | 'SENDER';

export type ContractEmailRecipient = {
  email: string;
  role: ContractEmailRole;
  /** e.g. the signer's template role ("Recipient 1"). */
  roleDetail?: string | null;
  name?: string | null;
};

const RECIPIENT_TYPE: Record<ContractEmailRole, string> = {
  SIGNER: 'MERCHANT',
  CC: 'OTHER',
  AGENT: 'ISO',
  FUNDER_CC: 'OTHER',
  CONTRACTS_INBOX: 'USER',
  SENDER: 'USER',
};

async function applicationIdForEnvelope(groupId: string): Promise<string | null> {
  const id = String(groupId || '').trim();
  if (!id) return null;
  const doc = await prisma.document.findFirst({
    where: { envelopeId: id },
    select: { applicationId: true },
  });
  return String(doc?.applicationId || '').trim() || null;
}

/**
 * Attachments a contract email carried, stored by kind so a resend can rebuild
 * them: the package PDF is fetched again (from its archive once signed) rather
 * than copied into the database.
 */
export type ContractEmailAttachmentKind = 'brand_logo' | 'contract_pdf';

/** What a resend needs besides the stored HTML body. */
export type ContractEmailResendPayload = {
  from?: MailSender | null;
  replyTo?: string | null;
  attachments: ContractEmailAttachmentKind[];
  pdfFilename?: string | null;
};

export type TrackedMailOptions = {
  to: string;
  subject: string;
  html: string;
  from?: MailSender;
  replyTo?: string;
  attachments?: Array<{
    filename?: string | false;
    content?: Buffer | string;
    path?: string;
    cid?: string;
    contentType?: string;
    contentDisposition?: 'inline' | 'attachment';
  }>;
  trackingId?: string;
  /** Deal / funder the email belongs to — picks the funder's provider (SendGrid or its Gmail). */
  applicationId?: string | null;
  funderName?: string | null;
  sendgridOnly?: boolean;
};

/**
 * "Contract Sent" notices (CC and agent copies, and their resends) go out only
 * through SendGrid with the funder's verified sender. Gmail rewrites the From
 * address to its own mailbox, so the funder's name arrived on a Nitro address.
 */
const SENDGRID_ONLY_KINDS: ReadonlySet<ContractEmailKind> = new Set(['cc_copy', 'agent_sent_notice']);

/**
 * Send one contract email to one recipient and record it, so SendGrid's event
 * webhook can update its status (the row id is sent as the `ocid` tracking arg)
 * and the history can show and resend exactly what went out.
 *
 * The row is written before the send because the id must ride on the message.
 * It starts as `sending` and becomes `sent` or `failed`; a webhook event that
 * arrives first wins over the `sent` stamp. A failed send still throws.
 */
export async function sendTrackedContractEmail(input: {
  groupId: string;
  applicationId?: string | null;
  kind: ContractEmailKind;
  recipient: ContractEmailRecipient;
  provider: 'gmail' | 'sendgrid' | 'smtp';
  mail: Omit<TrackedMailOptions, 'to' | 'trackingId'>;
  resend: ContractEmailResendPayload;
  send: (options: TrackedMailOptions) => Promise<unknown>;
  /** History row this send repeats, when it is a resend. */
  resendOf?: string | null;
}): Promise<void> {
  const to = String(input.recipient.email || '').trim();
  let trackingId: string | undefined = randomUUID();
  // The deal is also what routes the send to its funder's provider. Without it
  // the mailer treats this as no-funder mail and sends from the server Gmail
  // mailbox, which keeps the funder's display name but not its address.
  let applicationId: string | null = String(input.applicationId || '').trim() || null;
  const sendgridOnly = input.mail.sendgridOnly ?? SENDGRID_ONLY_KINDS.has(input.kind);
  const provider = sendgridOnly ? 'sendgrid' : input.provider;
  try {
    applicationId = applicationId || (await applicationIdForEnvelope(input.groupId));
    await createOutboundCommunication({
      id: trackingId,
      applicationId,
      channel: 'EMAIL',
      recipientType: RECIPIENT_TYPE[input.recipient.role],
      recipient: to,
      subject: input.mail.subject,
      body: input.mail.html,
      status: 'sending',
      metadata: {
        source: CONTRACT_EMAIL_SOURCE,
        kind: input.kind,
        role: input.recipient.role,
        roleDetail: input.recipient.roleDetail || null,
        recipientName: input.recipient.name || null,
        groupId: input.groupId,
        provider,
        resend: JSON.parse(JSON.stringify(input.resend)),
        ...(input.resendOf ? { resendOf: input.resendOf } : {}),
      },
    });
  } catch (err) {
    // Never block the email on its log row; it just goes out untracked.
    console.warn(`[contract-email] could not log ${input.kind} to ${to}:`, err);
    trackingId = undefined;
  }

  let result: unknown;
  try {
    result = await input.send({
      ...input.mail,
      to,
      applicationId: input.mail.applicationId ?? applicationId,
      ...(sendgridOnly ? { sendgridOnly: true } : {}),
      ...(trackingId ? { trackingId } : {}),
    });
  } catch (err) {
    if (trackingId) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.outbound_communications
        .update({
          where: { id: trackingId },
          data: { status: 'failed', metadata: await withMeta(trackingId, { error: message.slice(0, 500) }) },
        })
        .catch(() => undefined);
    }
    throw err;
  }

  if (!trackingId) return;
  await prisma.outbound_communications
    .updateMany({ where: { id: trackingId, status: 'sending' }, data: { status: 'sent' } })
    .catch(() => undefined);
  const messageId = String((result as { messageId?: unknown } | null)?.messageId || '').trim();
  if (messageId) await storeSgMessageIdOnOutbound(trackingId, messageId).catch(() => undefined);
}

async function withMeta(id: string, extra: Meta): Promise<object> {
  const row = await prisma.outbound_communications.findUnique({ where: { id }, select: { metadata: true } });
  return { ...asMeta(row?.metadata), ...extra };
}

/**
 * Record a contract email per recipient. Best-effort: a logging failure never
 * fails the send that already happened.
 */
export async function logContractEmails(input: {
  groupId: string;
  applicationId?: string | null;
  kind: ContractEmailKind;
  subject: string;
  recipients: ContractEmailRecipient[];
  provider?: 'gmail' | 'sendgrid' | 'smtp' | 'signnow';
}): Promise<void> {
  const recipients = input.recipients.filter((r) => String(r.email || '').includes('@'));
  if (!recipients.length) return;
  try {
    const applicationId =
      String(input.applicationId || '').trim() || (await applicationIdForEnvelope(input.groupId));
    await Promise.all(
      recipients.map((r) =>
        createOutboundCommunication({
          applicationId,
          channel: 'EMAIL',
          recipientType: RECIPIENT_TYPE[r.role],
          recipient: r.email.trim(),
          subject: input.subject,
          metadata: {
            source: CONTRACT_EMAIL_SOURCE,
            kind: input.kind,
            role: r.role,
            roleDetail: r.roleDetail || null,
            recipientName: r.name || null,
            groupId: input.groupId,
            provider: input.provider || null,
          },
        }),
      ),
    );
  } catch (err) {
    console.warn(`[contract-email] could not log ${input.kind} for ${input.groupId}:`, err);
  }
}

export type ContractEmailHistoryRow = {
  id: string;
  sentAt: string;
  email: string;
  role: ContractEmailRole;
  roleDetail: string | null;
  name: string | null;
  kind: ContractEmailKind;
  subject: string;
  /** Delivery status: SendGrid webhook state for tracked mail, else `sent` / `failed`. */
  status: string;
  groupId: string | null;
  /** `outbound_communications` id the row reads from, when it has one. */
  outboundId: string | null;
  provider: string | null;
  /** True when SendGrid events update this row's status. */
  tracked: boolean;
  /** True when the sent HTML is stored and can be viewed. */
  canView: boolean;
  /** True when the history can resend this email. */
  canResend: boolean;
  deliveredAt: string | null;
  openedAt: string | null;
  openCount: number;
  /** Bounce / drop reason or send error. */
  failureReason: string | null;
  resendOf: string | null;
};

type Meta = Record<string, unknown>;

function asMeta(value: unknown): Meta {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Meta) : {};
}

function asEmails(value: unknown): string[] {
  return Array.isArray(value) ? value.map((e) => String(e || '').trim()).filter((e) => e.includes('@')) : [];
}

const lower = (e: string) => e.trim().toLowerCase();

/**
 * Roles of the deal parties on a signed-copy notice logged before party roles
 * were recorded on it, read from who those parties are now.
 */
async function currentPartyRoles(
  groupId: string,
  applicationId: string,
  cache: Map<string, Promise<Map<string, ContractEmailRole>>>,
): Promise<Map<string, ContractEmailRole>> {
  const key = groupId;
  let pending = cache.get(key);
  if (!pending) {
    pending = resolveSignedCopyParties(groupId, applicationId)
      .then((parties) => {
        const roles = new Map<string, ContractEmailRole>();
        if (parties.senderEmail) roles.set(lower(parties.senderEmail), 'SENDER');
        for (const e of parties.agentEmails) roles.set(lower(e), 'AGENT');
        for (const e of parties.signerEmails) roles.set(lower(e), 'SIGNER');
        return roles;
      })
      .catch(() => new Map<string, ContractEmailRole>());
    cache.set(key, pending);
  }
  return pending;
}

/** Fields a row without its own tracked outbound record carries. */
const UNTRACKED = {
  outboundId: null,
  provider: null,
  tracked: false,
  canView: false,
  canResend: false,
  deliveredAt: null,
  openedAt: null,
  openCount: 0,
  failureReason: null,
  resendOf: null,
};

const isSigningKind = (kind: ContractEmailKind) =>
  kind === 'signing_invite' || kind === 'signing_reminder';

/**
 * Signing-portal invites sent before invites were logged, read back from the
 * portal queue stored on the contract (its `emailedAt` / `remindedAt` stamps).
 */
async function unloggedPortalInvites(
  applicationId: string,
  logged: ContractEmailHistoryRow[],
): Promise<ContractEmailHistoryRow[]> {
  const contract = await prisma.contract.findFirst({
    where: { applicationId },
    orderBy: { updatedAt: 'desc' },
    select: { contractPrefillOverrides: true },
  });
  const queue = asMeta(asMeta(contract?.contractPrefillOverrides).portalSigningQueue);
  const groupId = String(queue.envelopeId || '').trim();
  if (!groupId || !Array.isArray(queue.recipients)) return [];
  const subject = String(queue.emailSubject || queue.contractLabel || '').trim();
  const hasLogged = (email: string, kind: ContractEmailKind) =>
    logged.some((r) => r.groupId === groupId && r.kind === kind && lower(r.email) === lower(email));
  const rows: ContractEmailHistoryRow[] = [];
  for (const raw of queue.recipients) {
    const entry = asMeta(raw);
    const email = String(entry.email || '').trim();
    if (!email.includes('@')) continue;
    const base = {
      ...UNTRACKED,
      email,
      role: 'SIGNER' as const,
      roleDetail: String(entry.role || '').trim() || null,
      name: String(entry.name || '').trim() || null,
      subject,
      status: 'sent',
      groupId,
      // The portal mints a fresh link for the signer, so it can always be resent.
      provider: 'gmail',
      canResend: true,
    };
    const emailedAt = String(entry.emailedAt || '').trim();
    if (emailedAt && !hasLogged(email, 'signing_invite')) {
      rows.push({ ...base, id: `queue-invite-${email}`, sentAt: emailedAt, kind: 'signing_invite' });
    }
    const remindedAt = String(entry.remindedAt || '').trim();
    if (remindedAt && !hasLogged(email, 'signing_reminder')) {
      rows.push({ ...base, id: `queue-reminder-${email}`, sentAt: remindedAt, kind: 'signing_reminder' });
    }
  }
  return rows;
}

const contractEmailRows = (applicationId: string) => ({
  applicationId,
  OR: [
    { metadata: { path: ['source'], equals: CONTRACT_EMAIL_SOURCE } },
    { metadata: { path: ['source'], equals: COMPLETION_NOTICE_SOURCE } },
  ],
});

/** Every contract email for the application, newest first. */
export async function listContractEmailHistory(applicationId: string): Promise<ContractEmailHistoryRow[]> {
  const rows = await prisma.outbound_communications.findMany({
    where: contractEmailRows(applicationId),
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, recipient: true, subject: true, status: true, metadata: true, body: true },
  });

  const partyCache = new Map<string, Promise<Map<string, ContractEmailRole>>>();
  const out: ContractEmailHistoryRow[] = [];
  for (const row of rows) {
    const meta = asMeta(row.metadata);
    const sentAt = row.createdAt.toISOString();
    const subject = String(row.subject || '');
    const status = String(row.status || 'sent');
    const groupId = String(meta.groupId || '').trim() || null;

    if (meta.source === CONTRACT_EMAIL_SOURCE) {
      const kind = String(meta.kind || 'cc_copy') as ContractEmailKind;
      const provider = String(meta.provider || '').trim() || null;
      const tracking = asMeta(meta.tracking);
      const hasPayload = Boolean(row.body) && Boolean(meta.resend);
      out.push({
        id: row.id,
        sentAt,
        email: row.recipient,
        role: (String(meta.role || 'CC') as ContractEmailRole),
        roleDetail: String(meta.roleDetail || '').trim() || null,
        name: String(meta.recipientName || '').trim() || null,
        kind,
        subject,
        status,
        groupId,
        outboundId: row.id,
        provider,
        tracked: hasPayload,
        canView: Boolean(row.body),
        // A portal signing link is re-minted on resend; anything else needs the
        // stored HTML. SignNow's own invites are resent from SignNow.
        // Portal invites were sent by SendGrid before the Gmail switch; both are re-mintable.
        canResend: isSigningKind(kind) ? provider === 'gmail' || provider === 'sendgrid' : hasPayload,
        deliveredAt: String(tracking.deliveredAt || '') || null,
        openedAt: String(tracking.openedAt || '') || null,
        openCount: Number(tracking.openCount) || 0,
        failureReason: String(tracking.bounceReason || meta.error || '').trim() || null,
        resendOf: String(meta.resendOf || '').trim() || null,
      });
      continue;
    }

    // Signed-copy notices now also log one tracked row per recipient.
    if (meta.perRecipientLogged) continue;

    // A signed-copy notice is one row for all its recipients; split it per address.
    const recorded = asMeta(meta.partyRoles);
    const parties = asEmails(meta.partyEmails);
    const fallback =
      parties.some((e) => !recorded[lower(e)]) && groupId
        ? await currentPartyRoles(groupId, applicationId, partyCache)
        : new Map<string, ContractEmailRole>();
    const push = (email: string, role: ContractEmailRole, index: number) =>
      out.push({
        ...UNTRACKED,
        id: `${row.id}-${index}`,
        sentAt,
        email,
        role,
        roleDetail: null,
        name: null,
        kind: 'signed_copy',
        subject,
        status,
        groupId,
      });
    let i = 0;
    for (const e of asEmails(meta.recipients)) push(e, 'CONTRACTS_INBOX', i++);
    for (const e of asEmails(meta.ccEmails)) push(e, 'FUNDER_CC', i++);
    for (const e of parties) {
      const role =
        (recorded[lower(e)] as ContractEmailRole | undefined) || fallback.get(lower(e)) || 'SIGNER';
      push(e, role, i++);
    }
  }

  try {
    out.push(...(await unloggedPortalInvites(applicationId, out)));
  } catch (err) {
    console.warn('[contract-email] portal queue history unavailable:', err);
  }

  return out.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
}

export type ContractEmailContent = {
  id: string;
  email: string;
  subject: string;
  sentAt: string;
  status: string;
  from: string | null;
  html: string;
  attachments: string[];
};

/** The stored email behind a history row, for the history's View action. */
export async function getContractEmailContent(
  applicationId: string,
  outboundId: string,
): Promise<ContractEmailContent | null> {
  const row = await prisma.outbound_communications.findFirst({
    where: { id: outboundId, ...contractEmailRows(applicationId) },
    select: { id: true, createdAt: true, recipient: true, subject: true, status: true, metadata: true, body: true },
  });
  if (!row?.body) return null;
  const resend = asMeta(asMeta(row.metadata).resend);
  const from = asMeta(resend.from);
  const fromEmail = String(from.email || '').trim();
  const fromName = String(from.name || '').trim();
  const kinds = Array.isArray(resend.attachments) ? resend.attachments.map(String) : [];
  return {
    id: row.id,
    email: row.recipient,
    subject: String(row.subject || ''),
    sentAt: row.createdAt.toISOString(),
    status: String(row.status || 'sent'),
    from: fromEmail ? (fromName ? `${fromName} <${fromEmail}>` : fromEmail) : null,
    html: row.body,
    attachments: kinds.includes('contract_pdf')
      ? [String(resend.pdfFilename || '').trim() || 'Contract package (PDF)']
      : [],
  };
}
