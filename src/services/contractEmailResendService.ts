import prisma from '../config/prismaClient';
import sendMail from '../config/nodemailer';
import { buildBrandLogoAttachments } from '../constants/brand';
import {
  listContractEmailHistory,
  sendTrackedContractEmail,
  type ContractEmailRecipient,
  type ContractEmailResendPayload,
  type TrackedMailOptions,
} from './contractEmailHistoryService';
import { signNowService } from './signnow/signnow.service';
import { resendPortalSignerLink } from './signnow/signnow-portal-send.service';

/**
 * "Resend" on one row of the contract email history.
 *
 * A signing-portal invite gets a fresh portal link (the original one expires).
 * Every other email is sent again exactly as stored, its attachments rebuilt:
 * the package PDF is fetched again, which is served from its archive once the
 * contract is signed. SignNow's own invites are not ours to resend.
 */

export class ContractEmailResendError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

type Meta = Record<string, unknown>;

const asMeta = (value: unknown): Meta =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Meta) : {};

export async function resendContractEmail(
  applicationId: string,
  rowId: string,
): Promise<{ email: string }> {
  // History rows can be synthetic (split signed-copy notices, portal queue
  // stamps), so the row is found the way the history lists it.
  const history = await listContractEmailHistory(applicationId);
  const row = history.find((r) => r.id === rowId);
  if (!row) throw new ContractEmailResendError('That email is no longer in the history.', 404);
  if (!row.canResend) {
    throw new ContractEmailResendError(
      row.provider === 'signnow'
        ? 'SignNow sent this invite. Use Resend on the contract instead.'
        : 'This email was sent before resending was available, so its content was not kept.',
      409,
    );
  }

  if (row.kind === 'signing_invite' || row.kind === 'signing_reminder') {
    if (!row.groupId) throw new ContractEmailResendError('This invite has no contract to resend.', 409);
    try {
      await resendPortalSignerLink(row.groupId, row.email);
    } catch (err) {
      const status = Number((err as { status?: unknown })?.status) || 500;
      throw new ContractEmailResendError((err as Error)?.message || 'Could not resend the signing link.', status);
    }
    return { email: row.email };
  }

  const stored = await prisma.outbound_communications.findUnique({
    where: { id: String(row.outboundId) },
    select: { body: true, subject: true, metadata: true },
  });
  const payload = asMeta(asMeta(stored?.metadata).resend) as Partial<ContractEmailResendPayload>;
  if (!stored?.body) {
    throw new ContractEmailResendError('The content of this email was not kept.', 409);
  }

  const attachments: NonNullable<TrackedMailOptions['attachments']> = [];
  const kinds = Array.isArray(payload.attachments) ? payload.attachments : [];
  if (kinds.includes('brand_logo')) attachments.push(...buildBrandLogoAttachments());
  if (kinds.includes('contract_pdf')) {
    if (!row.groupId) throw new ContractEmailResendError('This email has no contract package to attach.', 409);
    let pdf: Buffer;
    try {
      pdf = await signNowService.downloadGroupPdf(row.groupId, { applicationId });
    } catch (err) {
      console.warn(`[contract-email] resend could not load the package PDF for ${row.groupId}:`, err);
      throw new ContractEmailResendError('Could not load the contract PDF to attach. Try again shortly.', 502);
    }
    attachments.push({
      filename: String(payload.pdfFilename || '').trim() || 'Contract.pdf',
      content: pdf,
      contentType: 'application/pdf',
    });
  }

  const from = payload.from && payload.from.email ? payload.from : undefined;
  const recipient: ContractEmailRecipient = {
    email: row.email,
    role: row.role,
    roleDetail: row.roleDetail,
    name: row.name,
  };
  try {
    await sendTrackedContractEmail({
      groupId: String(row.groupId || ''),
      applicationId,
      kind: row.kind,
      recipient,
      provider: 'smtp',
      mail: {
        subject: String(stored.subject || row.subject),
        html: stored.body,
        ...(from ? { from } : {}),
        ...(payload.replyTo ? { replyTo: payload.replyTo } : {}),
        ...(attachments.length ? { attachments } : {}),
      },
      resend: {
        from: from ?? null,
        replyTo: payload.replyTo ?? null,
        attachments: kinds,
        pdfFilename: payload.pdfFilename ?? null,
      },
      send: sendMail,
      resendOf: row.id,
    });
  } catch (err) {
    throw new ContractEmailResendError(`Could not resend the email. ${(err as Error)?.message || ''}`.trim(), 502);
  }
  return { email: row.email };
}
