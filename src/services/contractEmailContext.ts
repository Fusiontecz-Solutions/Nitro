import prisma from '../config/prismaClient';
import { resolveFunderProfile } from './funderProfileService';
import {
  DEFAULT_FUNDER_EMAIL_BRANDING,
  resolveFunderEmailBranding,
  type FunderEmailBranding,
} from './emailTemplates/funderEmailBranding';
import { resolveApplicationDisplayNumber } from '../utils/applicationDisplayNumber';

/**
 * Deal details shared by the contract status emails ("Contract Sent" to the
 * agent, "Signed Contract" on completion).
 */
export interface ContractEmailContext {
  applicationNumber: string;
  bookName: string;
  merchantName: string;
  fundedAmount: string;
  branding: FunderEmailBranding;
}

function formatUsd(value: unknown): string {
  const n = Number(value);
  if (value == null || value === '' || !Number.isFinite(n) || n <= 0) return '';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

export function formatContractEmailDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * The book (funder), merchant, amount and funder branding for a contract
 * email. Any lookup that fails leaves its field blank, so the caller falls back
 * to the contract label and the email still goes out.
 */
export async function loadContractEmailContext(applicationId: string): Promise<ContractEmailContext> {
  const context: ContractEmailContext = {
    applicationNumber: '',
    bookName: '',
    merchantName: '',
    fundedAmount: '',
    branding: DEFAULT_FUNDER_EMAIL_BRANDING,
  };
  if (!applicationId) return context;

  let funderName = '';
  let state: string | null = null;
  try {
    const [app, contract] = await Promise.all([
      prisma.application.findUnique({
        where: { id: applicationId },
        select: {
          applicationId: true,
          dealId: true,
          dealDisplayName: true,
          client: { select: { businessName: true } },
        },
      }),
      prisma.contract.findFirst({
        where: { applicationId },
        orderBy: { updatedAt: 'desc' },
        select: {
          funderName: true,
          state: true,
          legalName: true,
          doingBusinessAs: true,
          clientName: true,
          approvedAmount: true,
        },
      }),
    ]);
    context.applicationNumber = resolveApplicationDisplayNumber(app);
    context.merchantName =
      String(
        app?.client?.businessName ||
          contract?.legalName ||
          app?.dealDisplayName ||
          contract?.doingBusinessAs ||
          contract?.clientName ||
          '',
      ).trim();
    context.fundedAmount = formatUsd(contract?.approvedAmount);
    funderName = String(contract?.funderName || '').trim();
    state = contract?.state ?? null;
  } catch (err) {
    console.warn('[ContractEmail] could not read application details:', err);
  }

  context.bookName = funderName;
  if (funderName) {
    try {
      const profile = await resolveFunderProfile({ funderName, state });
      context.branding = resolveFunderEmailBranding(profile ?? { name: funderName });
      context.bookName = String(profile?.displayName || profile?.name || funderName).trim();
    } catch (err) {
      console.warn('[ContractEmail] could not read funder branding:', err);
      context.branding = resolveFunderEmailBranding({ name: funderName });
    }
  }
  return context;
}
