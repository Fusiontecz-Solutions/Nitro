import prisma from '../../../config/prismaClient';
import { isPersistedFunderProfileId, resolveFunderProfile } from '../../funderProfileService';
import { isWoodmereFunderProfile } from '../../../utils/funderProfileResolver';
import { extractSignNowTemplateId } from './signnow-client';

/**
 * Funder profile id for a SignNow package.
 *
 * The CRM only posts `funderProfileId` when its funder list has loaded a real
 * row; the background pre-warm and several send paths post just the name. The
 * agreement template used to be looked up by id alone, so a TIBERIAN FUNDING
 * package with no id was built from the Nitro Advance template while still
 * being named and emailed as Tiberian. Resolve the id from the posted name, and
 * from the contract's saved funder when the request names none.
 */
export async function resolveContractFunderProfileId(input: {
  funderProfileId?: string | null;
  funderName?: string | null;
  applicationId?: string | null;
  contractId?: number | null;
}): Promise<{ funderProfileId: string; funderName: string }> {
  const postedId = String(input.funderProfileId ?? '').trim();
  let funderName = String(input.funderName ?? '').trim();
  if (postedId && isPersistedFunderProfileId(postedId)) {
    return { funderProfileId: postedId, funderName };
  }

  if (!funderName) {
    const contractId = Number(input.contractId);
    const applicationId = String(input.applicationId ?? '').trim();
    const contract =
      Number.isFinite(contractId) && contractId > 0
        ? await prisma.contract.findUnique({
            where: { id: contractId },
            select: { funderName: true },
          })
        : applicationId
          ? await prisma.contract.findFirst({
              where: { applicationId },
              orderBy: { updatedAt: 'desc' },
              select: { funderName: true },
            })
          : null;
    funderName = String(contract?.funderName ?? '').trim();
  }
  if (!funderName) return { funderProfileId: '', funderName: '' };

  const profile = await resolveFunderProfile({ funderName });
  return { funderProfileId: String(profile?.id ?? '').trim(), funderName };
}

/**
 * A contract may only be built or sent for a funder profile that exists —
 * without one there is no way to know whose agreement the merchant signs.
 */
export function assertContractFunderResolved(resolved: {
  funderProfileId: string;
  funderName: string;
}): void {
  if (resolved.funderProfileId) return;
  throw new Error(
    resolved.funderName
      ? `Funder "${resolved.funderName}" was not found in Settings → Funders. Select a funder from the list before sending the contract.`
      : 'Select a funder before sending the contract.',
  );
}

/**
 * Agreement template for the selected funder. Falls back to the platform
 * (Nitro Advance) template only when the funder is the platform brand itself —
 * never for another funder, whose merchant would then sign Nitro Advance's
 * agreement.
 */
export function resolveFunderContractTemplateId(input: {
  funderRow?: { name?: string | null; signnowContractTemplateLink?: string | null } | null;
  requestedFunderName?: string | null;
  platformTemplateId: string;
}): string {
  if (!input.funderRow) {
    const name = String(input.requestedFunderName || '').trim();
    throw new Error(
      name
        ? `Funder "${name}" was not found in Settings → Funders, so its contract template cannot be loaded.`
        : 'Select a funder before sending the contract.',
    );
  }
  const funderTemplateId = extractSignNowTemplateId(input.funderRow.signnowContractTemplateLink);
  if (funderTemplateId) return funderTemplateId;

  const funderName = String(input.funderRow.name || '').trim();
  if (!isWoodmereFunderProfile({ name: funderName })) {
    throw new Error(
      `${funderName || 'This funder'} has no SignNow contract template. Add its template link in Settings → Funders before sending.`,
    );
  }
  return input.platformTemplateId;
}
