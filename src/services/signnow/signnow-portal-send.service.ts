import prisma from '../../config/prismaClient';
import { sendSendGridMail, isSendGridConfigured, getSendGridMailFrom } from '../../config/nodemailer';
import { resolveCrmFrontendBaseUrl } from '../../utils/crmFrontendUrl';
import { createSignNowApiClient } from './utils/signnow-client';
import { assertPackageWasPrefilledByReview, signNowService } from './signnow.service';
import {
  buildSigningPortalUrl,
  createSigningPortalToken,
  verifySigningPortalToken,
} from './utils/signnow-portal-token';
import { buildSigningPortalEmailHtml } from './utils/signnow-portal-email';

/**
 * CRM signing portal Ã¢â‚¬â€ contracts emailed by SendGrid instead of by SignNow.
 *
 * Mirrors the reference flow: the preparer's existing document-group embedded
 * invite is kept, and each merchant remints a signing session from that SAME
 * invite when they open their portal link. No merchant-specific embedded invite
 * is created, so the review/invite bookkeeping SignNow already holds stays intact.
 *
 * Sending therefore costs no SignNow call at all Ã¢â‚¬â€ only the link remint at the
 * moment a merchant actually opens the portal.
 */

export type PortalRecipient = {
  email: string;
  name?: string | null;
  /** SignNow signer identity, when it differs from the mailbox (+alias owners). */
  signNowEmail?: string | null;
  role?: string | null;
};

export type PortalSendResult = {
  envelopeId: string;
  recipientEmails: string[];
  sentAt: string;
  resent: boolean;
  ccPrefilledEmail?: { emailed: string[]; queued?: string[]; skippedReason?: string };
};

class BadRequest extends Error {
  status = 400;
}

function normalizeEmail(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Merchant signers only Ã¢â‚¬â€ the preparer is never a portal recipient. */
export function resolvePortalRecipients(
  roles: Array<{ signerEmail?: string; signerName?: string; signerRole?: string }>,
  preparerEmail?: string | null,
): PortalRecipient[] {
  const preparer = normalizeEmail(preparerEmail);
  const seen = new Set<string>();
  const out: PortalRecipient[] = [];
  for (const role of roles || []) {
    const email = normalizeEmail(role?.signerEmail);
    if (!email.includes('@') || seen.has(email)) continue;
    if (preparer && email === preparer) continue;
    seen.add(email);
    out.push({
      email,
      name: String(role?.signerName ?? '').trim() || null,
      role: String(role?.signerRole ?? '').trim() || null,
    });
  }
  return out;
}

/** `jane+recipient1@x.com` and `jane@x.com` are the same mailbox to SignNow aliasing. */
function emailAliasBase(value: unknown): string {
  const email = normalizeEmail(value);
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local.split('+')[0]}@${domain}`;
}

/** Every (inviteId, signer email) pair on the group's embedded invites. */
function collectInviteSigners(payload: any): Array<{ inviteId: string; email: string }> {
  const rows =
    (Array.isArray(payload?.data) && payload.data) ||
    (Array.isArray(payload?.invites) && payload.invites) ||
    (Array.isArray(payload) && payload) ||
    (payload && typeof payload === 'object' ? [payload] : []);
  const out: Array<{ inviteId: string; email: string }> = [];
  for (const row of rows) {
    const inviteId = String(row?.id || row?.unique_id || row?.invite_id || '').trim();
    if (!inviteId) continue;
    const signerGroups = Array.isArray(row?.signers)
      ? row.signers
      : Array.isArray(row?.invites)
        ? row.invites.flatMap((inner: any) =>
            Array.isArray(inner?.signers) ? inner.signers : [],
          )
        : [];
    for (const signer of signerGroups) {
      const email = normalizeEmail(signer?.email);
      if (email.includes('@')) out.push({ inviteId, email });
    }
  }
  return out;
}

function extractActiveEmbeddedInviteId(payload: any): string {
  const rows =
    (Array.isArray(payload?.data) && payload.data) ||
    (Array.isArray(payload?.invites) && payload.invites) ||
    (Array.isArray(payload) && payload) ||
    [];
  for (const row of rows) {
    const id = String(row?.id || row?.unique_id || row?.invite_id || '').trim();
    if (id) return id;
  }
  const single = String(payload?.id || payload?.unique_id || '').trim();
  return single;
}

/**
 * Remint a SignNow embedded signing URL for one signer on the existing invite.
 * Called when the merchant opens their portal link, so the SignNow session is
 * always fresh rather than minted at send time and expired by the time they click.
 */
export async function mintPortalSigningLink(input: {
  envelopeId: string;
  signerEmail: string;
}): Promise<string> {
  const envelopeId = String(input.envelopeId || '').trim();
  const email = normalizeEmail(input.signerEmail);
  if (!envelopeId || !email) {
    throw new BadRequest('Missing contract id or signer email.');
  }
  const client = await createSignNowApiClient();
  const invitesRes = await client.get(
    `/v2/document-groups/${envelopeId}/embedded-invites`,
    { validateStatus: () => true },
  );
  // A non-2xx here is not proof that the contract has no invite Ã¢â‚¬â€ SignNow also
  // answers 404/405 on this listing for some groups. Fall back to the group
  // payload's own invite id before telling the merchant to contact the funder.
  let inviteSigners = invitesRes.status >= 400 ? [] : collectInviteSigners(invitesRes.data);
  let inviteId = invitesRes.status >= 400 ? '' : extractActiveEmbeddedInviteId(invitesRes.data);
  if (!inviteId) {
    const groupRes = await client.get(`/v2/document-groups/${envelopeId}`, {
      validateStatus: () => true,
    });
    if (groupRes.status < 400) {
      const fromGroup =
        String(
          groupRes.data?.data?.invite_id ||
            groupRes.data?.invite_id ||
            groupRes.data?.data?.embedded_invite_id ||
            groupRes.data?.embedded_invite_id ||
            '',
        ).trim() || extractActiveEmbeddedInviteId(groupRes.data?.data ?? groupRes.data);
      if (fromGroup) {
        inviteId = fromGroup;
        if (!inviteSigners.length) {
          inviteSigners = collectInviteSigners(groupRes.data?.data ?? groupRes.data);
        }
      }
    }
  }
  if (!inviteId) {
    console.warn('[SignNow] portal link has no embedded invite', {
      envelopeId,
      invitesStatus: invitesRes.status,
    });
    throw new BadRequest('This contract has no active signing session. Contact your funder.');
  }

  // Signers sharing a mailbox are registered under `+role` aliases, so the
  // address in the portal link is often not the one SignNow knows.
  const base = emailAliasBase(email);
  const candidates = [
    email,
    ...inviteSigners
      .filter((row) => row.inviteId === inviteId && emailAliasBase(row.email) === base)
      .map((row) => row.email),
    ...inviteSigners
      .filter((row) => emailAliasBase(row.email) === base)
      .map((row) => row.email),
  ].filter((value, index, all) => value && all.indexOf(value) === index);

  // Bring the signer back to their portal page when SignNow finishes, so the
  // page can report completion and the next signer in line gets emailed.
  const returnUrl = (() => {
    const baseUrl = resolveCrmFrontendBaseUrl();
    if (!baseUrl) return '';
    try {
      const portal = new URL(
        buildSigningPortalUrl({
          baseUrl,
          envelopeId,
          email,
          token: createSigningPortalToken({ envelopeId, email }),
        }),
      );
      portal.searchParams.set('completed', '1');
      return portal.toString();
    } catch {
      return '';
    }
  })();

  let lastStatus = 0;
  for (const candidate of candidates) {
    const linkRes = await client.post(
      `/v2/document-groups/${envelopeId}/embedded-invites/${inviteId}/link`,
      {
        email: candidate,
        auth_method: 'none',
        link_expiration: 45,
        session_expiration: 60,
        ...(returnUrl
          ? {
              redirect_uri: returnUrl,
              close_redirect_uri: returnUrl,
              decline_redirect_uri: returnUrl,
              redirect_target: 'self',
            }
          : {}),
      },
      { validateStatus: () => true },
    );
    const url = String(
      linkRes.data?.data?.link || linkRes.data?.link || linkRes.data?.url || '',
    ).trim();
    if (linkRes.status < 400 && url) return url;
    lastStatus = linkRes.status;
  }
  console.warn('[SignNow] portal link mint failed', {
    envelopeId,
    inviteId,
    candidates,
    lastStatus,
  });
  throw new BadRequest('Could not open the signing session. Ask your funder to resend the link.');
}

/** Verify a portal link and return the signer it belongs to. */
export async function verifyPortalAccess(input: {
  envelopeId: string;
  email: string;
  token: string;
}): Promise<{ envelopeId: string; email: string }> {
  const envelopeId = String(input.envelopeId || '').trim();
  const email = normalizeEmail(input.email);
  const verification = verifySigningPortalToken({
    token: input.token,
    envelopeId,
    email,
  });
  if (!verification.valid) {
    const err = new BadRequest(
      verification.reason === 'expired'
        ? 'This signing link has expired. Ask your funder to resend it.'
        : 'This signing link is not valid.',
    );
    err.status = 401;
    throw err;
  }
  const document = await prisma.document.findUnique({
    where: { envelopeId },
    select: { status: true },
  });
  if (!document) {
    throw new BadRequest('This contract is no longer available.');
  }
  const status = String(document.status || '').toLowerCase();
  if (['voided', 'declined', 'cancelled'].includes(status)) {
    throw new BadRequest('This contract is no longer open for signing.');
  }
  return { envelopeId, email };
}

/** Key under `Contract.contractPrefillOverrides` holding the sequential send queue. */
export const PORTAL_SIGNING_QUEUE_KEY = 'portalSigningQueue';

export type PortalQueueEntry = {
  email: string;
  name: string | null;
  role: string | null;
  /** ISO timestamp of the SendGrid invite; null while the signer is still waiting. */
  emailedAt: string | null;
  /** ISO timestamp once SignNow reports this signer finished. */
  completedAt: string | null;
};

type PortalQueue = {
  envelopeId: string;
  contractLabel: string;
  /** "{Funder} {Deal name} {$Amount}" Ã¢â‚¬â€ the actual email subject sent to signers. */
  emailSubject: string;
  funderName: string | null;
  replyToEmail: string | null;
  startedAt: string;
  recipients: PortalQueueEntry[];
};

/** Move Contract + Application to Contract Sent after a signing-portal send. */
async function syncPortalSendWorkflow(envelopeId: string): Promise<void> {
  try {
    const document = await prisma.document.findUnique({
      where: { envelopeId },
      select: { applicationId: true },
    });
    const applicationId = String(document?.applicationId || '').trim();
    if (!applicationId) return;

    await prisma.contract.updateMany({
      where: { applicationId },
      data: { status: 'SENT' as any },
    });

    const { syncApplicationWorkflowFromContractEnvelopeStatus } = await import(
      '../contractApplicationWorkflowSync'
    );
    await syncApplicationWorkflowFromContractEnvelopeStatus(prisma, applicationId, 'sent', {
      source: 'signnow.sendContractViaPortal',
      contractStatusNew: 'SENT',
    });
  } catch (err) {
    console.warn('[SignNow] portal send workflow sync skipped', err);
  }
}

async function findContractForEnvelope(
  envelopeId: string,
): Promise<{ id: number; overrides: Record<string, unknown> } | null> {
  const document = await prisma.document.findUnique({
    where: { envelopeId },
    select: { applicationId: true },
  });
  if (!document?.applicationId) return null;
  const contract = await prisma.contract.findFirst({
    where: { applicationId: document.applicationId },
    select: { id: true, contractPrefillOverrides: true },
    orderBy: { updatedAt: 'desc' },
  });
  if (!contract) return null;
  const raw = contract.contractPrefillOverrides;
  const overrides =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? ({ ...(raw as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  return { id: contract.id, overrides };
}

function readQueue(overrides: Record<string, unknown>, envelopeId: string): PortalQueue | null {
  const raw = overrides[PORTAL_SIGNING_QUEUE_KEY];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const queue = raw as Partial<PortalQueue>;
  if (String(queue.envelopeId || '').trim() !== envelopeId) return null;
  if (!Array.isArray(queue.recipients) || !queue.recipients.length) return null;
  const contractLabel = String(queue.contractLabel || '').trim() || 'Your funding agreement';
  return {
    envelopeId,
    contractLabel,
    emailSubject: String(queue.emailSubject || '').trim() || contractLabel,
    funderName: queue.funderName ? String(queue.funderName) : null,
    replyToEmail: queue.replyToEmail ? String(queue.replyToEmail) : null,
    startedAt: String(queue.startedAt || new Date().toISOString()),
    recipients: queue.recipients.map((row) => ({
      email: normalizeEmail((row as PortalQueueEntry)?.email),
      name: (row as PortalQueueEntry)?.name ?? null,
      role: (row as PortalQueueEntry)?.role ?? null,
      emailedAt: (row as PortalQueueEntry)?.emailedAt ?? null,
      completedAt: (row as PortalQueueEntry)?.completedAt ?? null,
    })),
  };
}

async function saveQueue(
  contractId: number,
  overrides: Record<string, unknown>,
  queue: PortalQueue,
): Promise<void> {
  await prisma.contract.update({
    where: { id: contractId },
    data: {
      contractPrefillOverrides: {
        ...overrides,
        [PORTAL_SIGNING_QUEUE_KEY]: queue,
      } as any,
    },
  });
}

async function emailPortalInvite(input: {
  envelopeId: string;
  recipient: PortalQueueEntry;
  contractLabel: string;
  emailSubject: string;
  funderName: string | null;
  replyToEmail: string | null;
}): Promise<void> {
  const baseUrl = resolveCrmFrontendBaseUrl();
  if (!baseUrl) {
    throw new BadRequest('No CRM frontend URL is configured for signing-portal links.');
  }
  const email = normalizeEmail(input.recipient.email);
  const token = createSigningPortalToken({ envelopeId: input.envelopeId, email });
  const signingLink = buildSigningPortalUrl({
    baseUrl,
    envelopeId: input.envelopeId,
    email,
    token,
  });
  const from = getSendGridMailFrom();
  await sendSendGridMail({
    to: email,
    from,
    subject: input.emailSubject || input.contractLabel,
    html: buildSigningPortalEmailHtml({
      recipientName: input.recipient.name || null,
      contractLabel: input.contractLabel,
      funderName: input.funderName || null,
      senderEmail: input.replyToEmail || from,
      signingLink,
    }),
    ...(input.replyToEmail ? { replyTo: input.replyToEmail } : {}),
  });
}

type SignerFinishState = 'finished' | 'pending';

/**
 * Finish state of every signer on the group's embedded invites, keyed by
 * `emailAliasBase`, from one SignNow read. `null` when SignNow returned
 * nothing usable — which is also what a completed group can look like, since
 * SignNow may close the embedded invites once everyone signed.
 */
async function readSignerFinishStates(
  envelopeId: string,
): Promise<Map<string, SignerFinishState> | null> {
  const done = new Set(['fulfilled', 'completed', 'signed', 'finished', 'done']);
  const client = await createSignNowApiClient();
  const res = await client.get(`/v2/document-groups/${envelopeId}/embedded-invites`, {
    validateStatus: () => true,
  });
  if (res.status >= 400) return null;
  const rows =
    (Array.isArray(res.data?.data) && res.data.data) ||
    (Array.isArray(res.data?.invites) && res.data.invites) ||
    (Array.isArray(res.data) && res.data) ||
    [];
  const states = new Map<string, SignerFinishState>();
  const walk = (signer: any) => {
    if (!signer || typeof signer !== 'object') return;
    const base = emailAliasBase(signer.email);
    if (!base) return;
    const status = String(signer.status || signer.state || signer.invite_status || '')
      .trim()
      .toLowerCase();
    const docs = Array.isArray(signer.documents) ? signer.documents : [];
    const docsDone =
      docs.length > 0 &&
      docs.every((doc: any) => done.has(String(doc?.status || '').trim().toLowerCase()));
    // One open invite for the signer (or any +alias of theirs) keeps them pending.
    if (!(done.has(status) || docsDone)) states.set(base, 'pending');
    else if (!states.has(base)) states.set(base, 'finished');
  };
  for (const row of rows) {
    for (const signer of Array.isArray(row?.signers) ? row.signers : []) walk(signer);
    for (const inner of Array.isArray(row?.invites) ? row.invites : []) {
      for (const signer of Array.isArray(inner?.signers) ? inner.signers : []) walk(signer);
    }
  }
  return states.size ? states : null;
}

export type PortalQueueAdvanceResult = {
  advanced: boolean;
  emailed: string | null;
  done: boolean;
  queued?: false;
  /**
   * Emailed signers SignNow has not confirmed as finished: `pending` while
   * their invite is still open, `unknown` when SignNow no longer lists it.
   */
  waitingOn?: Array<{ email: string; state: 'pending' | 'unknown' }>;
};

/**
 * Record which merchants have finished and email anyone who was never reached.
 * Safe to call repeatedly (portal open, status sync, webhook).
 *
 * Merchants are emailed together and sign in parallel, so every emailed signer
 * is checked — not only the first one in the list — and nobody already emailed
 * is emailed again. A signer whose invite email failed is sent once everyone
 * ahead of them has finished, which also keeps older sequential queues (one
 * signer emailed at a time) working.
 *
 * `readSignNow: false` (verified-webhook mode) makes no SignNow call at all: it
 * only emails signers who were never reached and leaves finish tracking to the
 * webhook.
 */
export async function advancePortalSigningQueue(
  envelopeId: string,
  options: { readSignNow?: boolean } = {},
): Promise<PortalQueueAdvanceResult> {
  const readSignNow = options.readSignNow !== false;
  const id = String(envelopeId || '').trim();
  if (!id) return { advanced: false, emailed: null, done: false, queued: false };
  const contract = await findContractForEnvelope(id);
  if (!contract) return { advanced: false, emailed: null, done: false, queued: false };
  const queue = readQueue(contract.overrides, id);
  if (!queue) return { advanced: false, emailed: null, done: false, queued: false };

  let states: Map<string, SignerFinishState> | null | undefined;
  let changed = false;
  let blocked = false;
  const waitingOn: NonNullable<PortalQueueAdvanceResult['waitingOn']> = [];

  for (const row of queue.recipients) {
    if (row.completedAt) continue;
    if (!row.emailedAt) {
      if (blocked) continue;
      await emailPortalInvite({
        envelopeId: id,
        recipient: row,
        contractLabel: queue.contractLabel,
        emailSubject: queue.emailSubject,
        funderName: queue.funderName,
        replyToEmail: queue.replyToEmail,
      });
      row.emailedAt = new Date().toISOString();
      await saveQueue(contract.id, contract.overrides, queue);
      console.info('[SignNow] portal signing queue advanced', { envelopeId: id, emailed: row.email });
      return { advanced: true, emailed: row.email, done: false };
    }
    if (!readSignNow) {
      // Finish state is the webhook's job; keep looking for anyone unreached.
      waitingOn.push({ email: row.email, state: 'unknown' });
      continue;
    }
    // One SignNow read covers every signer on this pass.
    if (states === undefined) states = await readSignerFinishStates(id);
    const state = states?.get(emailAliasBase(row.email));
    if (state === 'finished') {
      row.completedAt = new Date().toISOString();
      changed = true;
      continue;
    }
    blocked = true;
    waitingOn.push({ email: row.email, state: state === 'pending' ? 'pending' : 'unknown' });
  }

  if (changed) await saveQueue(contract.id, contract.overrides, queue);
  if (!waitingOn.length) {
    if (changed) console.info('[SignNow] portal signing queue complete', { envelopeId: id });
    return { advanced: changed, emailed: null, done: true };
  }
  return { advanced: changed, emailed: null, done: false, waitingOn };
}

/**
 * SignNow settles a signature a few seconds after the signer is redirected back,
 * so the first read can still report the signer (or the group) as pending.
 */
const PORTAL_FINISH_SYNC_DELAYS_MS = [0, 5_000, 10_000, 20_000, 30_000];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Mirror a signer's portal finish onto the CRM as soon as they return.
 *
 * SignNow's event webhook cannot reach a CRM that is not publicly reachable,
 * and the Contract tab only syncs on demand, so the deal sat on Contract Sent
 * after the last merchant signed. The portal redirect is a signal the CRM gets
 * regardless: it records the finish and, once nobody is left, reads the group
 * status — which persists Contract Signed, pushes the realtime update and sends
 * the signed copy to the CC list. Bounded retries cover SignNow's settling
 * delay; nothing here polls.
 *
 * `finishedEmail` is the signer who just returned. While some *other* signer's
 * invite is still open the contract cannot be complete, so the sync stops at
 * once — that signer's own return runs it again. When SignNow no longer lists
 * an invite at all (it may close them on completion), the group status decides.
 */
export async function syncPortalEnvelopeAfterSignerFinished(
  envelopeId: string,
  delaysMs: number[] = PORTAL_FINISH_SYNC_DELAYS_MS,
  finishedEmail?: string,
): Promise<{ queue: PortalQueueAdvanceResult; status: string | null }> {
  const id = String(envelopeId || '').trim();
  let queue: PortalQueueAdvanceResult = { advanced: false, emailed: null, done: false };
  if (!id) return { queue, status: null };
  const finishedBase = finishedEmail ? emailAliasBase(finishedEmail) : '';

  const readTerminalGroupStatus = async (): Promise<string | null> => {
    const document = await prisma.document.findUnique({
      where: { envelopeId: id },
      select: { applicationId: true },
    });
    const result = await signNowService.getGroupStatus(
      id,
      document?.applicationId ? String(document.applicationId) : undefined,
    );
    return result.status === 'completed' || result.status === 'voided' ? result.status : null;
  };

  for (const delay of delaysMs) {
    if (delay > 0) await wait(delay);
    queue = await advancePortalSigningQueue(id);
    // No signing queue (sent before queues existed), or every signer finished.
    if (queue.queued === false || queue.done) {
      const status = await readTerminalGroupStatus();
      if (status) return { queue, status };
      continue;
    }
    // A signer who had never been reached was just emailed.
    if (queue.emailed) return { queue, status: null };

    const waiting = queue.waitingOn ?? [];
    const anotherSignerStillOpen =
      Boolean(finishedBase) &&
      waiting.some((row) => row.state === 'pending' && emailAliasBase(row.email) !== finishedBase);
    if (anotherSignerStillOpen) return { queue, status: null };

    if (waiting.some((row) => row.state === 'unknown')) {
      const status = await readTerminalGroupStatus();
      if (status) return { queue, status };
    }
    // Otherwise SignNow has not registered this signer's finish yet.
  }
  return { queue, status: null };
}

/**
 * Email each merchant a signing-portal link via SendGrid.
 * Marks the contract portal-sent so status sync does not read the preparer's
 * embedded invite as an unfinished owner review and revert it to draft.
 */
export async function sendContractViaPortal(input: {
  envelopeId: string;
  recipients: PortalRecipient[];
  contractLabel: string;
  funderName?: string | null;
  replyToEmail?: string | null;
  /** Current CRM values, built by the same payload builder the SignNow send uses. */
  prefillFields?: Array<{ id: string; value: string }>;
  roles?: Array<{ roleName?: string; name?: string; email?: string }>;
  /** Copy-only recipients (never a signer) Ã¢â‚¬â€ emailed the contract package once merchants are sent. */
  ccEmails?: string[];
  /** Live "$25 wire fee" checkbox from the contract modal. */
  includeWireFee?: unknown;
}): Promise<PortalSendResult> {
  const envelopeId = String(input.envelopeId || '').trim();
  if (!envelopeId) throw new BadRequest('Missing contract id.');
  if (!isSendGridConfigured()) {
    const err = new BadRequest(
      'SendGrid is not configured. Set SENDGRID_API_KEY and SENDGRID_FROM_EMAIL on the server.',
    );
    err.status = 503;
    throw err;
  }
  const recipients = (input.recipients || []).filter((r) => normalizeEmail(r.email).includes('@'));
  if (!recipients.length) {
    throw new BadRequest('No merchant signer email to send the contract to.');
  }
  if (!resolveCrmFrontendBaseUrl()) {
    throw new BadRequest('No CRM frontend URL is configured for signing-portal links.');
  }

  const existing = await prisma.document.findUnique({
    where: { envelopeId },
    select: { portalSentAt: true, sentAt: true, applicationId: true, prefillFingerprint: true },
  });
  const resent = Boolean(existing?.portalSentAt || existing?.sentAt);
  // Same guard as the SignNow invite send: an unprefilled package goes out blank.
  if (!resent) assertPackageWasPrefilledByReview(existing?.prefillFingerprint);

  // "{Selected funder} {Deal name} {$Amount}" Ã¢â‚¬â€ same subject format the SignNow
  // group-invite send uses, so a portal send for e.g. Obsidian reads
  // "Obsidian <deal name> $<amount>" instead of the generic contract label.
  // A CRM read, independent of the SignNow publish below Ã¢â‚¬â€ run alongside it.
  const emailSubjectPromise = signNowService.resolveInviteEmailSubject({
    title: input.contractLabel,
    applicationId: existing?.applicationId || undefined,
    prefillFields: input.prefillFields,
    funderName: input.funderName,
    fallbackGroupName: input.contractLabel,
  });

  const sentAt = new Date();
  /**
   * Hand the documents to the merchants before anyone is emailed. The portal
   * reuses the embedded invite minted during Owner review, where every field is
   * still Owner-assigned, so without this the merchant opens a contract showing
   * only signature and initial widgets. `sendEnvelope` does the same publish
   * before a SignNow group invite Ã¢â‚¬â€ that is why the SignNow send showed the
   * reference, landlord and bank-portal fields and the portal send did not.
   */
  let emailSubject: string;
  try {
    const [published, subject] = await Promise.all([
      signNowService.publishGroupFieldsToMerchant(envelopeId, {
        keepParty2: recipients.length > 1,
        prefillFields: input.prefillFields,
        roles: input.roles as never,
        includeWireFee: input.includeWireFee,
      }),
      emailSubjectPromise,
    ]);
    emailSubject = subject;
    if (published.failed.length) {
      // A document whose publish failed still carries Owner-only values, so the
      // merchant would open it blank. Emailing it is the empty-contract send.
      const reason = Object.values(published.errors).find(Boolean) || '';
      throw new Error(
        `publish failed for ${published.failed.length} of ${published.documentCount} documents` +
          (reason ? `: ${reason.slice(0, 200)}` : ''),
      );
    }
  } catch (publishError) {
    // Emailing a contract whose fields are still Owner-only is worse than a
    // failed send: the merchant signs an incomplete document.
    console.error('[SignNow] merchant field publish failed; portal send aborted', {
      envelopeId,
      error: publishError instanceof Error ? publishError.message : String(publishError),
    });
    throw new BadRequest(
      'Could not prepare the contract fields for the merchant. Nothing was emailed. ' +
        'Run Review in SignNow again, then send Ã¢â‚¬â€ the signing session was cleared ' +
        'while the fields were being published.',
    );
  }

  // All merchants are emailed at once and sign in parallel; the embedded invite
  // gives them the same signing order so nobody waits on anybody else.
  const queue = {
    envelopeId,
    contractLabel: input.contractLabel,
    emailSubject,
    funderName: input.funderName || null,
    replyToEmail: input.replyToEmail || null,
    startedAt: sentAt.toISOString(),
    recipients: recipients.map((recipient) => ({
      email: normalizeEmail(recipient.email),
      name: recipient.name || null,
      role: recipient.role || null,
      emailedAt: null as string | null,
      completedAt: null as string | null,
    })),
  };

  const recipientEmails: string[] = [];
  const failedEmails: string[] = [];
  // Every merchant gets their own message, so there is no reason to wait for
  // one SendGrid round trip before starting the next.
  const outcomes = await Promise.allSettled(
    queue.recipients.map((recipient) =>
      emailPortalInvite({
        envelopeId,
        recipient,
        contractLabel: queue.contractLabel,
        emailSubject: queue.emailSubject,
        funderName: queue.funderName,
        replyToEmail: queue.replyToEmail,
      }),
    ),
  );
  outcomes.forEach((outcome, index) => {
    const recipient = queue.recipients[index];
    if (outcome.status === 'fulfilled') {
      recipient.emailedAt = sentAt.toISOString();
      recipientEmails.push(recipient.email);
      return;
    }
    // Leave emailedAt null so advancePortalSigningQueue retries this signer.
    failedEmails.push(recipient.email);
    const emailError = outcome.reason;
    console.warn('[SignNow] portal invite email failed; will retry on queue advance', {
      envelopeId,
      email: recipient.email,
      error: emailError instanceof Error ? emailError.message : String(emailError),
    });
  });
  if (!recipientEmails.length) {
    throw new BadRequest('Could not email the signing-portal link to any signer.');
  }

  const contract = await findContractForEnvelope(envelopeId);
  if (contract) {
    await saveQueue(contract.id, contract.overrides, queue);
  } else {
    console.warn('[SignNow] no contract row to store the portal signing queue', { envelopeId });
  }

  await prisma.document.updateMany({
    where: { envelopeId },
    data: { status: 'sent', sentAt, portalSentAt: sentAt },
  });

  /**
   * A portal send is a real send, so Contract and Application must move to
   * Contract Sent exactly as `markGroupSent` does for a SignNow email invite.
   * Without this the deal sat on Contract Generated forever, and the lazy
   * completion repair never ran either because it only self-heals deals whose
   * queue already looks like it is awaiting signature.
   */
  await syncPortalSendWorkflow(envelopeId);

  // CC copies (package PDF download + SendGrid) are delivered after the
  // response; only the CC list itself is stored before returning.
  const ccPrefilledEmail = await signNowService
    .queueCcRecipientsOnSend(
      envelopeId,
      input.ccEmails,
      recipientEmails,
      input.contractLabel,
    )
    .catch((err) => {
      console.warn('[SignNow] portal CC email failed:', err);
      return { emailed: [] as string[], queued: [] as string[], skippedReason: 'error' };
    });

  console.info('[SignNow] contract emailed via signing portal', {
    envelopeId,
    recipientEmails,
    failedEmails,
    resent,
  });

  return {
    envelopeId,
    recipientEmails,
    sentAt: sentAt.toISOString(),
    resent,
    ccPrefilledEmail,
  };
}
