import prisma from '../../config/prismaClient';
import sendMail, { isOutboundSmtpConfigured } from '../../config/nodemailer';
import { resolveFunderMailSender } from '../funderProfileService';
import { formatContractEmailDate, loadContractEmailContext } from '../contractEmailContext';
import {
  buildSignedContractEmailSubject,
  renderSignedContractEmailHtml,
} from '../emailTemplates/contractStatusEmailHtml';
import type { MailSender } from '../mailSenderIdentity';
import { buildBrandLogoAttachments } from '../../constants/brand';
import { buildContractEnvelopePdfFilename } from '../../utils/contractEnvelopeEmailSubject';
import { createOutboundCommunication } from '../outboundCommunicationService';
import {
  sendTrackedContractEmail,
  type ContractEmailResendPayload,
  type ContractEmailRole,
} from '../contractEmailHistoryService';

type MailAttachment = {
  filename?: string | false;
  content?: Buffer | string;
  path?: string;
  cid?: string;
  contentType?: string;
  contentDisposition?: 'inline' | 'attachment';
};

/**
 * Completion notice for the contracts inbox.
 *
 * SignNow's own owner email is titled "Your documents are signed" for every
 * package it ever sends — that subject is baked into SignNow's template and the
 * API exposes no way to change it, so an inbox that receives many contracts a
 * day cannot tell one completion from the next without opening it. This sends a
 * parallel notice from the CRM titled "{Book}: {Merchant}: Signed Contract",
 * branded with the funder's letter logo, with the signed PDF attached.
 */

/**
 * Submissions inbox that files the signed contract. The signed copy lands here
 * rather than only in the SignNow account mailbox, which is the send-side
 * sender address and not where signed packages are filed.
 */
const DEFAULT_SIGNED_COPY_INBOX = 'subs@nitroadvance.com';

function parseEmailList(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(raw || '').split(/[;,]/)) {
    const email = part.trim();
    if (!email || !email.includes('@')) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/** Dedupe `extra` into `base`, case-insensitively, preserving order. */
function mergeEmailLists(base: string[], extra: string[]): string[] {
  const seen = new Set(base.map((e) => e.toLowerCase()));
  const out = [...base];
  for (const email of extra) {
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * Recipients of the signed copy.
 *
 * `SIGNNOW_COMPLETION_NOTICE_TO` overrides the list outright. Otherwise the
 * signed package goes to the submissions inbox and to the SignNow account
 * owner, so the address the contract was sent from keeps its own copy.
 *
 * `funderInbox` is the contract funder's own signed-copy address (its CC). When
 * the funder has one, the platform submissions inbox is that funder's only — an
 * Obsidian contract is filed at Obsidian's subs@, never Nitro's.
 */
export function resolveSignNowCompletionNoticeRecipients(funderInbox: string[] = []): string[] {
  const configured = String(process.env.SIGNNOW_COMPLETION_NOTICE_TO || '').trim();
  if (configured) return parseEmailList(configured);
  const inbox = String(process.env.SIGNNOW_SIGNED_COPY_TO || '').trim() || DEFAULT_SIGNED_COPY_INBOX;
  const funderKeys = new Set(funderInbox.map((e) => String(e || '').trim().toLowerCase()));
  const inboxes = parseEmailList(inbox).filter(
    (email) => !funderKeys.size || funderKeys.has(email.toLowerCase()),
  );
  return parseEmailList([...inboxes, String(process.env.SIGNNOW_USERNAME || '').trim()].join(','));
}

export interface SendSignNowCompletionNoticeInput {
  groupId: string;
  applicationId?: string | null;
  /** "{Funder} {Business} {$Amount}" — the name the team identifies contracts by. */
  contractLabel: string;
  /** Overrides the funder (book) read from the application's contract. */
  bookName?: string | null;
  /** Overrides the merchant name read from the application. */
  merchantName?: string | null;
  /** Merged signed package. Omitted when the download failed; the notice still goes out. */
  pdf?: Buffer | null;
  documentNames?: string[];
  /**
   * Addresses CC'd when the contract was sent. They received the unsigned
   * package at send time, so they are told here that it is now fully signed and
   * get the signed copy alongside the submissions inbox.
   */
  ccEmails?: string[] | null;
  /**
   * The people on the deal itself — the merchant signers, the agent and the CRM
   * user who sent the contract. A portal send gets no SignNow completion email,
   * so without this nobody who signed or sent the contract got the signed copy.
   * Skipped on a `ccOnly` catch-up, which must not email them twice.
   */
  partyEmails?: string[] | null;
  /** Lower-cased party address → SIGNER / AGENT / SENDER, kept on the mail log for the email history. */
  partyRoles?: Record<string, string> | null;
  /**
   * Email only the CC list. Used when catching up a CC notice for a package
   * whose inbox copy already went out, so the submissions inbox is not sent a
   * duplicate.
   */
  ccOnly?: boolean;
}

export interface SignNowCompletionNoticeResult {
  emailed: string[];
  emailedCc: string[];
  /** Signers, agent and sender reached (see `partyEmails`). */
  emailedParties?: string[];
  /**
   * CC addresses that received the notice, whether as a CC or because they are
   * also on the inbox list (e.g. subs@ CC'd on the send). This is what the
   * "Signed copy sent to CC" checkbox is recorded from.
   */
  ccReached: string[];
  skippedReason?: string;
}

/** The entries of `ccEmails` that appear (case-insensitively) in `delivered`. */
export function ccAddressesReached(ccEmails: string[], delivered: string[]): string[] {
  const got = new Set(delivered.map((e) => String(e || '').trim().toLowerCase()));
  return parseEmailList(ccEmails.join(',')).filter((e) => got.has(e.toLowerCase()));
}

/**
 * The earliest logged completion notice for this envelope, if any, and which of
 * `ccEmails` it reached. Lets a notice sent before delivery was recorded on the
 * Document be recognised instead of being sent a second time.
 */
export async function findLoggedSignNowCompletionNotice(
  groupId: string,
  ccEmails: string[],
): Promise<{ sentAt: Date; ccReached: string[] } | null> {
  const id = String(groupId || '').trim();
  if (!id) return null;
  const rows = await prisma.outbound_communications.findMany({
    where: {
      AND: [
        { metadata: { path: ['source'], equals: 'signnow_completion_notice' } },
        { metadata: { path: ['groupId'], equals: id } },
      ],
    },
    select: { createdAt: true, metadata: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) return null;
  const delivered: string[] = [];
  for (const row of rows) {
    const meta = (row.metadata || {}) as { recipients?: unknown; ccEmails?: unknown };
    for (const list of [meta.recipients, meta.ccEmails]) {
      if (Array.isArray(list)) delivered.push(...list.map((e) => String(e || '')));
    }
  }
  const ccReached = ccAddressesReached(ccEmails, delivered);
  const firstReaching = rows.find((row) => {
    const meta = (row.metadata || {}) as { recipients?: unknown; ccEmails?: unknown };
    const lists = [meta.recipients, meta.ccEmails].filter(Array.isArray) as unknown[][];
    return ccAddressesReached(ccReached, lists.flat().map((e) => String(e || ''))).length > 0;
  });
  return { sentAt: (firstReaching || rows[0]).createdAt, ccReached };
}

export async function sendSignNowCompletionNotice(
  input: SendSignNowCompletionNoticeInput,
): Promise<SignNowCompletionNoticeResult> {
  const groupId = String(input.groupId || '').trim();
  const recipients = input.ccOnly
    ? []
    : resolveSignNowCompletionNoticeRecipients(input.ccEmails || []);
  const ccRecipients = mergeEmailLists(
    [],
    parseEmailList((input.ccEmails || []).join(',')),
  ).filter((email) => !recipients.some((r) => r.toLowerCase() === email.toLowerCase()));
  const partyRecipients = input.ccOnly
    ? []
    : parseEmailList((input.partyEmails || []).join(',')).filter(
        (email) =>
          ![...recipients, ...ccRecipients].some((r) => r.toLowerCase() === email.toLowerCase()),
      );
  if (!recipients.length && !ccRecipients.length && !partyRecipients.length) {
    return { emailed: [], emailedCc: [], ccReached: [], skippedReason: 'no_recipients' };
  }
  if (!isOutboundSmtpConfigured()) {
    console.warn('[SignNow] completion notice skipped: SMTP not configured.');
    return { emailed: [], emailedCc: [], ccReached: [], skippedReason: 'smtp_not_configured' };
  }

  const applicationId = String(input.applicationId || '').trim();
  const context = await loadContractEmailContext(applicationId);
  const contractLabel = String(input.contractLabel || '').trim() || 'Contract';
  const bookName = String(input.bookName || '').trim() || context.bookName;
  const merchantName = String(input.merchantName || '').trim() || context.merchantName;
  // Without a book or merchant the subject falls back to the contract label.
  const subject = buildSignedContractEmailSubject(
    bookName,
    bookName || merchantName ? merchantName : contractLabel,
  );
  const pdfFilename = buildContractEnvelopePdfFilename(contractLabel);
  const { branding } = context;
  const html = renderSignedContractEmailHtml({
    bookName: bookName || contractLabel,
    merchantName: merchantName || contractLabel,
    applicationId: context.applicationNumber,
    fundedAmount: context.fundedAmount,
    signedDate: formatContractEmailDate(new Date()),
    documentNames: input.documentNames,
    attachmentName: input.pdf?.length ? pdfFilename : null,
    companyName: branding.companyName,
    logoSrc: branding.logoSrc,
    brandPrimary: branding.accentDark,
    brandAccent: branding.accentLight,
  });
  // The Nitro Advance logo is inlined by CID; a funder logo is a hosted URL.
  const attachments: MailAttachment[] = branding.logoSrc.startsWith('cid:')
    ? [...buildBrandLogoAttachments()]
    : [];
  if (input.pdf?.length) {
    attachments.push({
      filename: pdfFilename,
      content: input.pdf,
      contentType: 'application/pdf',
    });
  }

  // Sent as the contract's funder (its stored sender identity), else the .env default.
  // A funder sender without a name fails each send loudly instead of borrowing one.
  let from: MailSender | undefined;
  let senderError: unknown = null;
  try {
    from = (await resolveFunderMailSender({ applicationId })) ?? undefined;
  } catch (err) {
    senderError = err;
  }

  const resend: ContractEmailResendPayload = {
    from: from ?? null,
    attachments: [
      ...(branding.logoSrc.startsWith('cid:') ? (['brand_logo'] as const) : []),
      ...(input.pdf?.length ? (['contract_pdf'] as const) : []),
    ],
    pdfFilename,
  };
  const deliver = async (
    list: string[],
    roleFor: (email: string) => ContractEmailRole,
  ): Promise<string[]> => {
    const sent: string[] = [];
    for (const to of list) {
      try {
        if (senderError) throw senderError;
        // One tracked row per recipient, so the email history shows its
        // delivery status and can resend it.
        await sendTrackedContractEmail({
          groupId,
          applicationId: applicationId || null,
          kind: 'signed_copy',
          recipient: { email: to, role: roleFor(to) },
          provider: 'smtp',
          mail: { subject, html, attachments, from },
          resend,
          send: sendMail,
        });
        sent.push(to);
      } catch (err) {
        console.error(`[SignNow] completion notice to ${to} failed:`, err);
      }
    }
    return sent;
  };

  const partyRole = (email: string): ContractEmailRole => {
    const role = String(input.partyRoles?.[email.toLowerCase()] || '').toUpperCase();
    return role === 'AGENT' || role === 'SENDER' ? role : 'SIGNER';
  };
  const emailed = await deliver(recipients, () => 'CONTRACTS_INBOX');
  const emailedCc = await deliver(ccRecipients, () => 'FUNDER_CC');
  const emailedParties = await deliver(partyRecipients, partyRole);

  if (emailed.length || emailedCc.length || emailedParties.length) {
    console.info('[SignNow] completion notice sent', {
      groupId,
      subject,
      recipients: emailed,
      cc: emailedCc,
      parties: emailedParties,
    });
    try {
      await createOutboundCommunication({
        applicationId: applicationId || null,
        channel: 'EMAIL',
        recipientType: 'USER',
        recipient: [...emailed, ...emailedCc, ...emailedParties].join(', '),
        subject,
        documentName: contractLabel,
        metadata: {
          source: 'signnow_completion_notice',
          groupId,
          recipients: emailed,
          ccEmails: emailedCc,
          partyEmails: emailedParties,
          ...(input.partyRoles ? { partyRoles: input.partyRoles } : {}),
          // The email history reads the per-recipient rows instead of this one.
          perRecipientLogged: true,
        },
      });
    } catch (err) {
      console.warn('[SignNow] completion notice mail log failed:', err);
    }
  }

  const ccReached = ccAddressesReached(input.ccEmails || [], [...emailed, ...emailedCc]);
  return { emailed, emailedCc, emailedParties, ccReached };
}
