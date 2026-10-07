import prisma from '../config/prismaClient';
import { createOutboundCommunication } from './outboundCommunicationService';
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
 * Record a contract email per recipient. Best-effort: a logging failure never
 * fails the send that already happened.
 */
export async function logContractEmails(input: {
  groupId: string;
  applicationId?: string | null;
  kind: ContractEmailKind;
  subject: string;
  recipients: ContractEmailRecipient[];
  provider?: 'sendgrid' | 'smtp' | 'signnow';
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
  status: string;
  groupId: string | null;
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
      email,
      role: 'SIGNER' as const,
      roleDetail: String(entry.role || '').trim() || null,
      name: String(entry.name || '').trim() || null,
      subject,
      status: 'sent',
      groupId,
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

/** Every contract email for the application, newest first. */
export async function listContractEmailHistory(applicationId: string): Promise<ContractEmailHistoryRow[]> {
  const rows = await prisma.outbound_communications.findMany({
    where: {
      applicationId,
      OR: [
        { metadata: { path: ['source'], equals: CONTRACT_EMAIL_SOURCE } },
        { metadata: { path: ['source'], equals: COMPLETION_NOTICE_SOURCE } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true, recipient: true, subject: true, status: true, metadata: true },
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
      out.push({
        id: row.id,
        sentAt,
        email: row.recipient,
        role: (String(meta.role || 'CC') as ContractEmailRole),
        roleDetail: String(meta.roleDetail || '').trim() || null,
        name: String(meta.recipientName || '').trim() || null,
        kind: (String(meta.kind || 'cc_copy') as ContractEmailKind),
        subject,
        status,
        groupId,
      });
      continue;
    }

    // A signed-copy notice is one row for all its recipients; split it per address.
    const recorded = asMeta(meta.partyRoles);
    const parties = asEmails(meta.partyEmails);
    const fallback =
      parties.some((e) => !recorded[lower(e)]) && groupId
        ? await currentPartyRoles(groupId, applicationId, partyCache)
        : new Map<string, ContractEmailRole>();
    const push = (email: string, role: ContractEmailRole, index: number) =>
      out.push({
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
