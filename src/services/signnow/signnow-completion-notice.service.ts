import prisma from '../../config/prismaClient';
import sendMail, { isOutboundSmtpConfigured } from '../../config/nodemailer';
import {
  buildBrandHeaderRowHtml,
  buildBrandHeaderStyles,
  buildBrandLogoAttachments,
} from '../../constants/brand';
import { buildContractEnvelopePdfFilename } from '../../utils/contractEnvelopeEmailSubject';
import { createOutboundCommunication } from '../outboundCommunicationService';

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
 * parallel notice from the CRM whose subject carries the contract label
 * ("{Funder} {Business} {$Amount}"), which is the name the team already uses to
 * identify a deal, plus the application number and the signed PDF.
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
 */
export function resolveSignNowCompletionNoticeRecipients(): string[] {
  const configured = String(process.env.SIGNNOW_COMPLETION_NOTICE_TO || '').trim();
  if (configured) return parseEmailList(configured);
  const inbox = String(process.env.SIGNNOW_SIGNED_COPY_TO || '').trim() || DEFAULT_SIGNED_COPY_INBOX;
  return parseEmailList([inbox, String(process.env.SIGNNOW_USERNAME || '').trim()].join(','));
}

/** `Signed — Tiberian Funding Acme LLC $25,000.00 (#10428)` */
export function buildSignNowCompletionNoticeSubject(
  contractLabel: string,
  applicationNumber?: string | null,
): string {
  const label = String(contractLabel || '').trim() || 'Contract';
  const appNo = String(applicationNumber || '').trim();
  return appNo ? `Signed — ${label} (#${appNo})` : `Signed — ${label}`;
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildSignNowCompletionNoticeHtml(options: {
  contractLabel: string;
  applicationNumber?: string | null;
  documentNames?: string[];
}): string {
  const label = escapeHtml(String(options.contractLabel || '').trim() || 'Contract');
  const appNo = String(options.applicationNumber || '').trim();
  const names = (options.documentNames || [])
    .map((name) => String(name || '').trim())
    .filter(Boolean);
  const documentsRow = names.length
    ? `<p style="margin: 0 0 8px;"><strong>Documents:</strong> ${escapeHtml(names.join(', '))}</p>`
    : '';
  return `<!DOCTYPE html>
<html>
<head>
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Contract Signed</title>
    ${buildBrandHeaderStyles()}
</head>
<body style="margin:0; padding:0; background:#f4f7f9; font-family: Arial, Helvetica, sans-serif;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%">
        <tr>
            <td style="padding: 20px 0;">
                <table align="center" border="0" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff; border:1px solid #e5e7eb;">
                    ${buildBrandHeaderRowHtml()}
                    <tr>
                        <td style="padding: 20px 24px 8px;">
                            <h2 style="margin:0; color:#111827; font-size:22px;">Contract Signed</h2>
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 0 24px 20px; color:#374151; font-size:14px; line-height:1.6;">
                            <p style="margin: 0 0 8px;"><strong>Contract:</strong> ${label}</p>
                            ${appNo ? `<p style="margin: 0 0 8px;"><strong>Application ID:</strong> #${escapeHtml(appNo)}</p>` : ''}
                            ${documentsRow}
                            <p style="margin: 12px 0 0;">Every signer has completed this package. The signed copy is attached.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>`;
}

export interface SendSignNowCompletionNoticeInput {
  groupId: string;
  applicationId?: string | null;
  /** "{Funder} {Business} {$Amount}" — the name the team identifies contracts by. */
  contractLabel: string;
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
   * Email only the CC list. Used when catching up a CC notice for a package
   * whose inbox copy already went out, so the submissions inbox is not sent a
   * duplicate.
   */
  ccOnly?: boolean;
}

export interface SignNowCompletionNoticeResult {
  emailed: string[];
  emailedCc: string[];
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
  const recipients = input.ccOnly ? [] : resolveSignNowCompletionNoticeRecipients();
  const ccRecipients = mergeEmailLists(
    [],
    parseEmailList((input.ccEmails || []).join(',')),
  ).filter((email) => !recipients.some((r) => r.toLowerCase() === email.toLowerCase()));
  if (!recipients.length && !ccRecipients.length) {
    return { emailed: [], emailedCc: [], ccReached: [], skippedReason: 'no_recipients' };
  }
  if (!isOutboundSmtpConfigured()) {
    console.warn('[SignNow] completion notice skipped: SMTP not configured.');
    return { emailed: [], emailedCc: [], ccReached: [], skippedReason: 'smtp_not_configured' };
  }

  const applicationId = String(input.applicationId || '').trim();
  let applicationNumber = '';
  if (applicationId) {
    try {
      const app = await prisma.application.findUnique({
        where: { id: applicationId },
        select: { applicationId: true },
      });
      applicationNumber = String(app?.applicationId || '').trim();
    } catch (err) {
      console.warn('[SignNow] completion notice could not read application number:', err);
    }
  }

  const contractLabel = String(input.contractLabel || '').trim() || 'Contract';
  const subject = buildSignNowCompletionNoticeSubject(contractLabel, applicationNumber);
  const html = buildSignNowCompletionNoticeHtml({
    contractLabel,
    applicationNumber,
    documentNames: input.documentNames,
  });
  const attachments: MailAttachment[] = [...buildBrandLogoAttachments()];
  if (input.pdf?.length) {
    attachments.push({
      filename: buildContractEnvelopePdfFilename(contractLabel),
      content: input.pdf,
      contentType: 'application/pdf',
    });
  }

  const deliver = async (list: string[]): Promise<string[]> => {
    const sent: string[] = [];
    for (const to of list) {
      try {
        await sendMail({ to, subject, html, attachments });
        sent.push(to);
      } catch (err) {
        console.error(`[SignNow] completion notice to ${to} failed:`, err);
      }
    }
    return sent;
  };

  const emailed = await deliver(recipients);
  const emailedCc = await deliver(ccRecipients);

  if (emailed.length || emailedCc.length) {
    console.info('[SignNow] completion notice sent', {
      groupId,
      subject,
      recipients: emailed,
      cc: emailedCc,
    });
    try {
      await createOutboundCommunication({
        applicationId: applicationId || null,
        channel: 'EMAIL',
        recipientType: 'USER',
        recipient: [...emailed, ...emailedCc].join(', '),
        subject,
        documentName: contractLabel,
        metadata: {
          source: 'signnow_completion_notice',
          groupId,
          recipients: emailed,
          ccEmails: emailedCc,
        },
      });
    } catch (err) {
      console.warn('[SignNow] completion notice mail log failed:', err);
    }
  }

  const ccReached = ccAddressesReached(input.ccEmails || [], [...emailed, ...emailedCc]);
  return { emailed, emailedCc, ccReached };
}
