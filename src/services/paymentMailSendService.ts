import { randomUUID } from 'crypto';
import type { Request } from 'express';
import type { PaymentMailLog } from '@prisma/client';
import prisma from '../config/prismaClient';
import { getSendGridMailFrom, sendSendGridMail } from '../config/nodemailer';
import type { AuthenticatedUser } from './applicationService';
import {
  assertApplicationMailLogAccess,
  formatPaymentMailLogApiRow,
  insertPaymentMailLogRecord,
  markPaymentMailLogFailed,
} from './paymentMailLogService';
import { recordCommunicationAudit } from './systemActivityLogService';
import { inferRecipientTypeFromCategory } from './outboundCommunicationService';

export interface SendPaymentTemplateMailInput {
  to: string;
  subject: string;
  body: string;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  applicationId: string;
  dealKey: string;
  templateName: string;
  category: string;
}

export type SendPaymentTemplateMailResult =
  | { ok: true; paymentMailLog: ReturnType<typeof formatPaymentMailLogApiRow>; sgMessageId?: string }
  | { ok: false; status: number; message: string };

function authUserFromRequest(req: Request): AuthenticatedUser | null {
  if (!req.user?.id) return null;
  return { id: req.user.id, role: req.user.role } as AuthenticatedUser;
}

async function storeSgMessageIdOnOutbound(outboundId: string, sgMessageId: string): Promise<void> {
  const existing = await prisma.outboundCommunication.findUnique({
    where: { id: outboundId },
    select: { metadata: true },
  });
  const prior =
    existing?.metadata && typeof existing.metadata === 'object' && !Array.isArray(existing.metadata)
      ? (existing.metadata as Record<string, unknown>)
      : {};
  await prisma.outboundCommunication.update({
    where: { id: outboundId },
    data: { metadata: { ...prior, sgMessageId } as object },
  });
}

/**
 * Send a payment letter/template with SendGrid delivery tracking (same `ocid`
 * pipeline as approval/offer emails). Creates the payment mail log + outbound
 * communication audit rows before sending so webhook events can match immediately.
 */
export async function sendTrackedPaymentTemplateMail(
  req: Request,
  input: SendPaymentTemplateMailInput,
): Promise<SendPaymentTemplateMailResult> {
  const authUser = authUserFromRequest(req);
  const access = await assertApplicationMailLogAccess(input.applicationId, authUser);

  if (!access.application) {
    return { ok: false, status: 404, message: 'Application not found' };
  }
  if (access.forbidden) {
    return { ok: false, status: 403, message: 'Forbidden: you do not have access to this application' };
  }

  const trackingId = randomUUID();
  let paymentLog: PaymentMailLog | null = null;

  try {
    paymentLog = await insertPaymentMailLogRecord(
      access.application.id,
      authUser,
      {
        dealKey: input.dealKey,
        templateName: input.templateName,
        category: input.category,
        recipient: input.to,
        subject: input.subject,
        body: input.body,
        status: 'sent',
      },
      req,
    );

    const summary = `Sent ${input.category} "${input.templateName}" to ${input.to}`;
    await recordCommunicationAudit(req, {
      outboundCommunicationId: trackingId,
      applicationId: access.application.id,
      channel: 'TEMPLATE',
      recipientType: inferRecipientTypeFromCategory(input.category),
      recipient: input.to,
      subject: input.subject,
      body: input.body,
      templateName: input.templateName,
      paymentMailLogId: paymentLog.id,
      actionType: 'PAYMENT_MAIL_SENT',
      actionDescription: summary,
      currentStatus: access.application.currentState ?? 'Unknown',
      metadata: {
        dealKey: input.dealKey,
        categoryLabel: input.category,
        recipient: input.to,
        status: 'sent',
      },
    });

    const result = await sendSendGridMail({
      to: input.to,
      subject: input.subject,
      html: input.body,
      cc: input.cc,
      bcc: input.bcc,
      replyTo: input.replyTo,
      from: getSendGridMailFrom(),
      trackingId,
      categories: ['payment-template'],
    });

    const sgMessageId =
      typeof (result as { messageId?: string })?.messageId === 'string'
        ? (result as { messageId: string }).messageId
        : undefined;

    if (sgMessageId) {
      await storeSgMessageIdOnOutbound(trackingId, sgMessageId);
    }

    return {
      ok: true,
      paymentMailLog: formatPaymentMailLogApiRow(paymentLog),
      sgMessageId,
    };
  } catch (err) {
    if (paymentLog) {
      await markPaymentMailLogFailed(paymentLog.id, {
        dealKey: input.dealKey,
        templateName: input.templateName,
        category: input.category,
        recipient: input.to,
        subject: input.subject,
      }).catch((markErr) => {
        console.error('[paymentMail] failed to mark mail log as failed:', markErr);
      });
    }
    throw err;
  }
}
