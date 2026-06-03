import type { Request } from 'express';
import prisma from '../config/prismaClient';
import type { AuthenticatedUser } from './applicationService';

export type CommunicationChannel = 'EMAIL' | 'TEMPLATE' | 'DOCUMENT';
export type CommunicationRecipientType = 'ISO' | 'CLIENT' | 'MERCHANT' | 'USER' | 'OTHER';

export interface CreateOutboundCommunicationInput {
  applicationId?: string | null;
  channel: CommunicationChannel;
  recipientType?: CommunicationRecipientType | string | null;
  recipient: string;
  subject?: string | null;
  body?: string | null;
  templateName?: string | null;
  documentName?: string | null;
  contractId?: string | null;
  status?: string;
  metadata?: Record<string, unknown>;
  user?: AuthenticatedUser | null;
}

export function inferRecipientTypeFromCategory(category: string): CommunicationRecipientType {
  const c = category.toLowerCase();
  if (c.includes('iso')) return 'ISO';
  if (c.includes('merchant')) return 'MERCHANT';
  if (c.includes('client')) return 'CLIENT';
  return 'OTHER';
}

export function formatRecipientList(to: string | string[] | undefined): string {
  if (!to) return '—';
  if (Array.isArray(to)) return to.filter(Boolean).join(', ');
  return String(to);
}

export async function createOutboundCommunication(input: CreateOutboundCommunicationInput) {
  const {
    applicationId,
    channel,
    recipientType,
    recipient,
    subject,
    body,
    templateName,
    documentName,
    contractId,
    status = 'sent',
    metadata,
    user,
  } = input;

  return prisma.outboundCommunication.create({
    data: {
      applicationId: applicationId ?? null,
      channel,
      recipientType: recipientType ? String(recipientType).toUpperCase() : null,
      recipient,
      subject: subject ?? null,
      body: body?.trim() ? body : null,
      templateName: templateName ?? null,
      documentName: documentName ?? null,
      contractId: contractId ?? null,
      status,
      metadata: metadata ? (metadata as object) : undefined,
      createdById: user?.id ?? null,
    },
  });
}

export async function getOutboundCommunicationById(id: string) {
  return prisma.outboundCommunication.findUnique({
    where: { id },
    include: {
      createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
      application: { select: { id: true, applicationId: true, dealDisplayName: true } },
    },
  });
}

declare global {
  namespace Express {
    interface Request {
      __activityLogged?: boolean;
    }
  }
}

export function markActivityLogged(req: Request): void {
  req.__activityLogged = true;
}
