import prisma from '../config/prismaClient';

/**
 * The agents on a deal, each emailed the contract package when it is sent and
 * the signed copy when it is signed.
 *
 * The addresses typed into the contract send panel (`Contract.agentEmail`,
 * stored comma-separated) win; without any, the application's referring agent,
 * else its creator when that user is an AGENT.
 */
export type ContractAgentEmail = {
  /** Every address the agent emails go to (empty when the deal has no agent). */
  agentEmails: string[];
  /** First of `agentEmails`, or null — kept for single-agent callers. */
  agentEmail: string | null;
  /** Values saved on the contract, if any. */
  savedAgentEmails: string[];
  source: 'contract' | 'referring_agent' | 'creator' | 'none';
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanEmail(value: unknown): string {
  const email = String(value ?? '').trim();
  return EMAIL_PATTERN.test(email) ? email : '';
}

export function isValidAgentEmail(value: unknown): boolean {
  return Boolean(cleanEmail(value));
}

/**
 * Split a list (array, or a comma / semicolon / whitespace separated string)
 * into trimmed, case-insensitively de-duplicated entries. Invalid entries are
 * kept so callers can reject them.
 */
export function splitAgentEmails(value: unknown): string[] {
  const parts = Array.isArray(value) ? value : String(value ?? '').split(/[,;\s]+/);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const email = String(part ?? '').trim();
    if (!email || seen.has(email.toLowerCase())) continue;
    seen.add(email.toLowerCase());
    out.push(email);
  }
  return out;
}

function withList(emails: string[], source: ContractAgentEmail['source'], saved: string[] = []): ContractAgentEmail {
  return { agentEmails: emails, agentEmail: emails[0] ?? null, savedAgentEmails: saved, source };
}

export async function readContractAgentEmail(
  applicationId: string | null | undefined,
): Promise<ContractAgentEmail> {
  const appId = String(applicationId || '').trim();
  const none = withList([], 'none');
  if (!appId) return none;

  const [contract, application] = await Promise.all([
    prisma.contract.findUnique({
      where: { applicationId: appId },
      select: { agentEmail: true },
    }),
    prisma.application.findUnique({
      where: { id: appId },
      select: {
        referringAgent: { select: { email: true } },
        createdBy: { select: { email: true, role: true } },
      },
    }),
  ]);

  const saved = splitAgentEmails(contract?.agentEmail).map(cleanEmail).filter(Boolean);
  if (saved.length) return withList(saved, 'contract', saved);

  const referring = cleanEmail(application?.referringAgent?.email);
  if (referring) return withList([referring], 'referring_agent');

  const creator = application?.createdBy;
  const creatorEmail =
    String(creator?.role || '').toUpperCase() === 'AGENT' ? cleanEmail(creator?.email) : '';
  if (creatorEmail) return withList([creatorEmail], 'creator');

  return none;
}

/**
 * Store (or clear, with an empty value) the agent emails on the deal's contract.
 * Accepts an array or a comma-separated string. Returns null when the
 * application has no contract row yet.
 */
export async function saveContractAgentEmail(
  applicationId: string,
  agentEmails: string | string[] | null | undefined,
): Promise<ContractAgentEmail | null> {
  const appId = String(applicationId || '').trim();
  const list = splitAgentEmails(agentEmails);
  const invalid = list.find((email) => !isValidAgentEmail(email));
  if (invalid) {
    throw Object.assign(new Error(`${invalid} is not a valid email address.`), { status: 400 });
  }
  const updated = await prisma.contract.updateMany({
    where: { applicationId: appId },
    data: { agentEmail: list.length ? list.join(',') : null },
  });
  if (!updated.count) return null;
  return readContractAgentEmail(appId);
}
