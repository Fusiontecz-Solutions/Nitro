import prisma from '../../../config/prismaClient';
import { readContractAgentEmail } from '../../../utils/contractAgentEmail';

/**
 * Who on the deal itself gets the signed contract: the merchant signers, the
 * agent, and the CRM user who sent it.
 *
 * - Signers: the signing-portal queue stored on the contract for this envelope.
 *   A SignNow group invite already lists its signers in `completion_emails`, so
 *   an envelope without a portal queue adds none here.
 * - Sender: recorded on the portal queue at send time; otherwise the Document
 *   owner (the user who first linked the package to the deal).
 * - Agents: the agent emails saved in the contract send panel, else the
 *   application's referring agent, else its creator when that user is an AGENT.
 */
export type SignedCopyParties = {
  signerEmails: string[];
  senderEmail: string | null;
  agentEmails: string[];
};

const PORTAL_SIGNING_QUEUE_KEY = 'portalSigningQueue';

function cleanEmail(value: unknown): string {
  const email = String(value ?? '').trim();
  return email.includes('@') ? email : '';
}

export async function resolveSignedCopyParties(
  envelopeId: string,
  applicationId?: string | null,
): Promise<SignedCopyParties> {
  const id = String(envelopeId || '').trim();
  const empty: SignedCopyParties = { signerEmails: [], senderEmail: null, agentEmails: [] };
  if (!id) return empty;

  const document = await prisma.document.findUnique({
    where: { envelopeId: id },
    select: { applicationId: true, userId: true },
  });
  const appId = String(applicationId || document?.applicationId || '').trim();
  if (!appId) return empty;

  const [contract, agent, documentOwner] = await Promise.all([
    prisma.contract.findFirst({
      where: { applicationId: appId },
      select: { contractPrefillOverrides: true },
      orderBy: { updatedAt: 'desc' },
    }),
    readContractAgentEmail(appId),
    document?.userId != null
      ? prisma.user.findUnique({
          where: { userId: document.userId },
          select: { email: true },
        })
      : Promise.resolve(null),
  ]);

  const overrides = contract?.contractPrefillOverrides;
  const queue =
    overrides && typeof overrides === 'object' && !Array.isArray(overrides)
      ? ((overrides as Record<string, unknown>)[PORTAL_SIGNING_QUEUE_KEY] as
          | { envelopeId?: unknown; recipients?: unknown; senderEmail?: unknown }
          | undefined)
      : undefined;
  const queueMatches = Boolean(queue) && String(queue?.envelopeId || '').trim() === id;
  const signerEmails = queueMatches && Array.isArray(queue?.recipients)
    ? (queue!.recipients as Array<{ email?: unknown }>)
        .map((row) => cleanEmail(row?.email))
        .filter(Boolean)
    : [];

  const senderEmail =
    (queueMatches ? cleanEmail(queue?.senderEmail) : '') || cleanEmail(documentOwner?.email);

  const agentEmails = (agent.agentEmails ?? []).map(cleanEmail).filter(Boolean);

  return {
    signerEmails,
    senderEmail: senderEmail || null,
    agentEmails,
  };
}

/**
 * Lower-cased party address → the role it gets the signed copy as. A signer
 * who is also the agent or sender is recorded as the signer, matching the
 * order `signedCopyPartyEmails` lists them in.
 */
export function signedCopyPartyRoles(
  parties: SignedCopyParties,
): Record<string, 'SIGNER' | 'AGENT' | 'SENDER'> {
  const roles: Record<string, 'SIGNER' | 'AGENT' | 'SENDER'> = {};
  const add = (email: string | null, role: 'SIGNER' | 'AGENT' | 'SENDER') => {
    const key = cleanEmail(email).toLowerCase();
    if (key && !roles[key]) roles[key] = role;
  };
  for (const email of parties.signerEmails) add(email, 'SIGNER');
  for (const email of parties.agentEmails) add(email, 'AGENT');
  add(parties.senderEmail, 'SENDER');
  return roles;
}

/** Flat, de-duplicated list of every party address. */
export function signedCopyPartyEmails(parties: SignedCopyParties): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const email of [...parties.signerEmails, ...parties.agentEmails, parties.senderEmail]) {
    const value = cleanEmail(email);
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push(value);
  }
  return out;
}
