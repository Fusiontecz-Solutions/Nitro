import type { Request } from 'express';
import type { PaymentMailLogStatus } from '@prisma/client';
import prisma from '../config/prismaClient';
import { resolveAuditLogUserId } from '../middleware/authMiddleware';
import type { AuthenticatedUser } from './applicationService';
import { createApplicationActivityLog } from './applicationActivityLogService';
import { inferRecipientTypeFromCategory } from './outboundCommunicationService';

const STATUS_MAP: Record<string, PaymentMailLogStatus> = {
  queued: 'QUEUED',
  sent: 'SENT',
  failed: 'FAILED',
};

export function toPrismaMailLogStatus(status: string): PaymentMailLogStatus | null {
  const key = status.toLowerCase();
  return STATUS_MAP[key] ?? null;
}

export function fromPrismaMailLogStatus(status: PaymentMailLogStatus): 'queued' | 'sent' | 'failed' {
  switch (status) {
    case 'SENT':
      return 'sent';
    case 'FAILED':
      return 'failed';
    default:
      return 'queued';
  }
}

export interface CreatePaymentMailLogInput {
  dealKey: string;
  templateName: string;
  category: string;
  recipient: string;
  subject: string;
  body?: string | null;
  status: 'queued' | 'sent' | 'failed';
}

async function assertApplicationMailLogAccess(applicationId: string, user: AuthenticatedUser | null) {
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: {
      id: true,
      currentState: true,
      referringAgentId: true,
      createdById: true,
    },
  });

  if (!application) {
    return { ok: false as const, forbidden: false as const, application: null };
  }

  const role = (user?.role ?? '').toString().trim().toUpperCase().replace(/-/g, '_');
  const isElevated = ['ADMIN', 'SUPER_ADMIN', 'UNDERWRITER', 'FINAL_UNDERWRITER', 'ACCOUNTANT', 'ACCOUNTS', 'OPERATIONS'].includes(
    role,
  );
  const isAgent = role === 'AGENT';

  if (
    !user ||
    (!isElevated && !(isAgent && (application.referringAgentId === user.id || application.createdById === user.id)))
  ) {
    return { ok: false as const, forbidden: true as const, application };
  }

  return { ok: true as const, forbidden: false as const, application };
}

export async function createPaymentMailLog(
  applicationId: string,
  user: AuthenticatedUser | null,
  input: CreatePaymentMailLogInput,
  req?: Request | null,
) {
  const access = await assertApplicationMailLogAccess(applicationId, user);
  if (!access.application) {
    return { forbidden: false, notFound: true, log: null };
  }
  if (access.forbidden) {
    return { forbidden: true, notFound: false, log: null };
  }

  const prismaStatus = toPrismaMailLogStatus(input.status);
  if (!prismaStatus) {
    return { forbidden: false, notFound: false, log: null, badRequest: true as const };
  }

  const createdById = await resolveAuditLogUserId(req, { user, applicationId });

  const log = await prisma.paymentMailLog.create({
    data: {
      applicationId,
      dealKey: input.dealKey,
      templateName: input.templateName,
      category: input.category,
      recipient: input.recipient,
      subject: input.subject,
      body: input.body?.trim() ? input.body : null,
      status: prismaStatus,
      createdById,
    },
  });

  const summary =
    prismaStatus === 'SENT'
      ? `Sent ${input.category} "${input.templateName}" to ${input.recipient}`
      : prismaStatus === 'FAILED'
        ? `Failed to send ${input.category} "${input.templateName}" to ${input.recipient}`
        : `Queued ${input.category} "${input.templateName}" to ${input.recipient}`;

  await createApplicationActivityLog({
    applicationId,
    user,
    req,
    actionType:
      prismaStatus === 'SENT'
        ? 'PAYMENT_MAIL_SENT'
        : prismaStatus === 'FAILED'
          ? 'PAYMENT_MAIL_FAILED'
          : 'PAYMENT_MAIL_QUEUED',
    actionDescription: summary,
    previousStatus: null,
    currentStatus: access.application.currentState ?? 'Unknown',
    metadata: {
      category: 'COMMUNICATION',
      channel: 'TEMPLATE',
      recipientType: inferRecipientTypeFromCategory(input.category),
      recipientName: input.recipient,
      paymentMailLogId: log.id,
      viewType: 'payment_mail',
      templateName: input.templateName,
      categoryLabel: input.category,
      recipient: input.recipient,
      subject: input.subject,
      status: input.status,
    },
  });

  return { forbidden: false, notFound: false, log };
}

export async function listPaymentMailLogs(applicationId: string, user: AuthenticatedUser | null) {
  const access = await assertApplicationMailLogAccess(applicationId, user);
  if (!access.application) {
    return { forbidden: false, notFound: true, logs: [] as const };
  }
  if (access.forbidden) {
    return { forbidden: true, notFound: false, logs: [] as const };
  }

  const logs = await prisma.paymentMailLog.findMany({
    where: { applicationId: access.application.id },
    orderBy: { createdAt: 'desc' },
  });

  return { forbidden: false, notFound: false, logs };
}
