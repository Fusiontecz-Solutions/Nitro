import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import prisma from '../../config/prismaClient';
import { resolveDocumentOwnerNumericUserId } from '../../middleware/authMiddleware';
import { resolveSignedNoticeFunderCcEmails } from '../../utils/contractCcDefaults';
import {
  archiveMainContractEnvelopeToHistory,
  persistMainContractSendPackage,
  updateArchivedContractSendHistoryStatus,
} from '../docusign/utils/contract-send-history';
import {
  isStandaloneAchEnvelope,
  updateAchAuthorizationDocuSignStatus,
} from '../docusign/utils/ach-authorization-docusign';
import {
  isStandalonePackageEnvelope,
  linkStandalonePackageEnvelopeToContract,
  updateStandalonePackageDocuSignStatus,
} from '../docusign/utils/standalone-package-docusign';
import {
  archiveSignedEnvelopePdf,
  fetchStoredSignedPdfBuffer,
  clearUnfinishedSentArchive,
  getStoredEnvelopePdfArchive,
  isDocumentFullySignedStatus,
  isSignedPhaseArchiveUrl,
  type EnvelopePdfArchivePhase,
} from '../docusign/utils/archive-signed-envelope-pdf';
import {
  resolveSignNowCompletionNoticeRecipients,
  sendSignNowCompletionNotice,
  findLoggedSignNowCompletionNotice,
} from './signnow-completion-notice.service';
import {
  buildContractEnvelopeEmailSubject,
  ensureSubjectAmountHasDollarSign,
  buildContractEnvelopePdfFilename,
  extractContractEmailContextFromPrefill,
  normalizeContractCcEmailSubject,
} from '../../utils/contractEnvelopeEmailSubject';
import sendMail, { isOutboundSmtpConfigured } from '../../config/nodemailer';
import { resolveEnvelopeMailSender } from '../funderProfileService';
import {
  createSignNowApiClient,
  extractSignNowTemplateId,
  isSignNowConfigured,
  isSignNowDailyLimitError,
  isSignNowEnvelopeId,
  isTransientSignNowFailure,
  SIGNNOW_DAILY_LIMIT_MESSAGE,
  SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID,
  sleepSignNow,
} from './utils/signnow-client';
import {
  countSignNowDb,
  countSignNowPoll,
  countSignNowRetry,
  createSignNowTimingContext,
  getSignNowTiming,
  logSignNowTiming,
  measureSignNowStep,
  runWithSignNowTiming,
} from './utils/signnow-timing';
import {
  claimSignNowInviteSend,
  getSignNowInviteSend,
  listSignNowInviteSendsForApplication,
  logSignNowSend,
  markSignNowInviteFailed,
  markSignNowInviteSent,
} from './utils/signnow-invite-send';
import { postGroupInviteSafely } from './utils/signnow-groupinvite-post';
import { resolveSignNowGroupStatus } from './utils/signnow-group-status';
import {
  decryptField,
  decryptSensitiveField,
  isEncrypted,
} from '../../utils/fieldEncryption';
import { readBankFieldsFromPrefill } from '../bankFieldSync';
import {
  digitsOnlyPhone,
  digitsOnlySsn,
  formatSsn,
  formatUsPhone,
  isPhoneFieldName,
  isSsnFieldName,
  type SigningWidgetInfo,
} from '../../utils/contactFormat';
import {
  buildSignNowDocumentPrefillTexts,
  canonicalizeSignNowFieldName,
  currentSignNowUsDate,
  expandSignNowPrefillForUnguidedPut,
  formatSignNowPrefillValue,
  isDedicatedExhibitCRequiredField,
  isDedicatedContractP22RequiredField,
  isExhibitCDocumentName,
  isMerchantRequiredSignerField,
  usesAddendumFillableFont,
  type SignNowPrefillOptions,
  isMonthlyFeeDocumentName,
  isMonthlyFeeForcedBlankField,
  isRemittanceStartDateField,
  isSupplementalSignNowDocumentName,
  resolveSignNowPrefillValue,
  shouldSkipSignNowPrefill,
  signNowPrefillOptionsForDocument,
} from './utils/signnow-field-map';
import {
  applyContractFillableFont,
  applySignNowSignatureFieldFont,
  collectCommittedSignNowTexts,
  copySignNowTemplateStyle,
  dropBakedTextsAlreadyStamped,
  hasSignNowSignatureFieldFont,
  clearExhibitCCopyLabels,
  nameExhibitCCopyFieldsForReview,
  mergeCommittedSignNowTexts,
  parseSignNowPrefillValidationField,
  sanitizeSignNowPutFields,
  signNowPrefillTextPayload,
  splitPrefillPutPayload,
  stripExhibitCCopyFieldName,
  withoutSignNowSignatureFieldFont,
  type CommittedSignNowText,
} from './utils/signnow-prefill-put';
import {
  countSignNowDocumentFields,
  isEmptySignNowFieldsError,
  signNowOriginDocumentId,
} from './utils/signnow-document-fields';
import {
  getSignNowDisclosureTemplates,
  exhibitCInstanceIndexFromDocumentName,
  isExhibitCAddendumRow,
  resolveSignNowSupplementalTemplateByDocumentName,
  resolveSignNowAddendaFromRefs,
  resolveSignNowAddendumTemplate,
  signNowExhibitCTemplateId,
  type SignNowAddendumTemplate,
} from './utils/signnow-addendum-templates';
import {
  buildSignNowDocumentTabValues,
  parseDocumentTemplatePrefillBlob,
  pickSignNowDocumentTabValues,
  type SignNowDocumentTabValues,
} from './utils/signnow-document-tab-values';
import { EXHIBIT_C_ENTITIES_PREFILL_KEY } from '../contractKycPrefillMapper';
import {
  loadOfferDerivedValuesForContract,
  persistIncludeWireFeePreference,
  resolveIncludeWireFee,
  readIncludeWireFeeFromOverrides,
  resolveOfferDerivedContractValues,
  type ContractOfferPrefillSource,
} from '../contractOfferValueSync';
import {
  alignDisclosureWireFeeWithTotalFees,
  buildOfferPrefillOverrides,
} from './utils/signnow-offer-values';
import {
  dropZeroDisclosurePlaceholders,
  layerContractPrefillDefaults,
} from './utils/signnow-disclosure-values';
import {
  buildSignNowPackageFingerprint,
  embeddedReviewRolesForDocument,
  liveSignNowGroupMatchesPackage,
  signNowDocumentMatchesSupplemental,
  signNowPackageFingerprintsEqual,
} from './utils/signnow-package-fingerprint';
import {
  buildSignNowPrefillFingerprint,
  resolveSignNowPrefillReuse,
  resolveSignNowPrewarmLink,
  SIGNNOW_PRISTINE_PREFILL_FINGERPRINT,
} from './utils/signnow-prefill-fingerprint';
import {
  collectSignedRoleNames,
  resolveSignNowReviewStatus,
} from './utils/signnow-review-status';
import {
  readSignNowReviewSession,
  recordSignNowReviewCompleted,
  recordSignNowReviewStarted,
} from './utils/signnow-review-session';
import {
  isPortalSendInFlight,
  waitForPortalSendToSettle,
} from './utils/signnow-portal-send-inflight';
import {
  claimSignNowGroupForReview,
  isSignNowGroupClaimedByReview,
} from './utils/signnow-review-group-claims';
import {
  describeIncompleteReviewPrefill,
  incompleteReviewPrefillDocuments,
  missingReviewPrefillFields,
  requiredReviewPrefillFields,
  reviewPrefillIsComplete,
  type SignNowReviewPrefillCheck,
} from './utils/signnow-review-prefill-check';
import {
  invalidateStoredTemplateDocument,
  readStoredTemplateDocument,
  writeStoredTemplateDocument,
} from './utils/signnow-template-store';
import {
  invalidateStoredTemplatePdf,
  resolveTemplatePdf,
} from './utils/signnow-template-pdf-archive';
import {
  orderSignNowGroupDocuments,
  sameSignNowDocumentOrder,
  signNowDocumentIdsInOrder,
  sortSignNowSupplementalsForPackage,
} from './utils/signnow-document-order';

type SignerRoleInput = {
  roleName?: string;
  signerRole?: string;
  signerName?: string;
  signerEmail?: string;
  signerOrder?: number;
  roleIndex?: number;
};

type PrefillField = { id?: string; value?: string };

type ExhibitCEntityPrefillRow = {
  clientLegalName?: string;
  clientName?: string;
  accountHolderName?: string;
  accountHolderDba?: string;
  accountHolderAddress?: string;
  accountHolderCity?: string;
  accountHolderState?: string;
  accountHolderZip?: string;
  bankName?: string;
  bankAccount?: string;
  bankRouting?: string;
  bankPortal?: string;
  bankUsername?: string;
  bankPassword?: string;
  securityQa1?: string;
  securityQa2?: string;
  agreementDate?: string;
};

function pickEntityField(row: Record<string, unknown>, ...keys: string[]): string {
  const wanted = new Set(keys.map((k) => k.toLowerCase()));
  for (const [key, value] of Object.entries(row)) {
    if (!wanted.has(key.toLowerCase())) continue;
    const v = String(value ?? '').trim();
    if (v) return v;
  }
  return '';
}

function normalizeExhibitCEntityRow(row: Record<string, unknown>): ExhibitCEntityPrefillRow {
  return {
    clientLegalName: pickEntityField(row, 'clientLegalName', 'client_legal_name', 'legalName'),
    clientName: pickEntityField(row, 'clientName', 'client_name', 'guarantorName'),
    accountHolderName: pickEntityField(row, 'accountHolderName', 'account_holder_name'),
    accountHolderDba: pickEntityField(row, 'accountHolderDba', 'account_holder_dba'),
    accountHolderAddress: pickEntityField(row, 'accountHolderAddress', 'account_holder_address'),
    accountHolderCity: pickEntityField(row, 'accountHolderCity', 'account_holder_city'),
    accountHolderState: pickEntityField(row, 'accountHolderState', 'account_holder_state'),
    accountHolderZip: pickEntityField(row, 'accountHolderZip', 'account_holder_zip'),
    bankName: pickEntityField(row, 'bankName', 'bank_name'),
    bankAccount: pickEntityField(row, 'bankAccount', 'bank_account'),
    bankRouting: pickEntityField(row, 'bankRouting', 'bank_routing'),
    bankPortal: pickEntityField(row, 'bankPortal', 'bank_portal'),
    bankUsername: pickEntityField(row, 'bankUsername', 'bank_username'),
    bankPassword: pickEntityField(row, 'bankPassword', 'bank_password'),
    securityQa1: pickEntityField(row, 'securityQa1', 'security_qa1'),
    securityQa2: pickEntityField(row, 'securityQa2', 'security_qa2'),
    agreementDate: pickEntityField(row, 'agreementDate', 'agreement_date'),
  };
}

function parseExhibitCEntitiesForPrefill(raw: unknown): ExhibitCEntityPrefillRow[] {
  if (raw == null) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return [];
    try {
      parsed = JSON.parse(s);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => normalizeExhibitCEntityRow(row as Record<string, unknown>));
}

function entityFromExhibitCTabs(tabs: Record<string, string>): ExhibitCEntityPrefillRow {
  const str = (...keys: string[]) => {
    for (const key of keys) {
      const v = String(tabs[key] ?? '').trim();
      if (v) return v;
    }
    return '';
  };
  return {
    agreementDate: str('agreement_date_p1', 'agreement_date'),
    clientLegalName: str('client_legal_name_p1', 'client_legal_name', 'legal_name'),
    clientName: str('client_name_p1', 'client_name'),
    accountHolderName: str(
      'ach_account_holder_name_p1',
      'ach_account_holder_name',
      'ach_authorization_account_holder_name',
    ),
    accountHolderDba: str('ach_account_holder_dba_p1', 'ach_account_holder_dba', 'doing_business_as'),
    accountHolderAddress: str('ach_account_holder_address_p1', 'ach_account_holder_address'),
    bankName: str('ach_bank_name_p1', 'ach_bank_name', 'authorization_client_bank_name'),
    bankAccount: str('ach_bank_account_p1', 'ach_bank_account', 'authorization_client_bank_account'),
    bankRouting: str('ach_bank_routing_p1', 'ach_bank_routing', 'authorization_client_bank_routing'),
    bankPortal: str('ach_bank_portal_p1', 'ach_bank_portal'),
    bankUsername: str('ach_username_p1', 'ach_username'),
    bankPassword: str('ach_password_p1', 'ach_password'),
    securityQa1: str('ach_security_q1_p1', 'ach_security_q1'),
    securityQa2: str('ach_security_q2_p1', 'ach_security_q2'),
  };
}

function mergeExhibitCEntityRows(
  primary: ExhibitCEntityPrefillRow | undefined,
  fallback: ExhibitCEntityPrefillRow | undefined,
): ExhibitCEntityPrefillRow {
  const keys: (keyof ExhibitCEntityPrefillRow)[] = [
    'clientLegalName',
    'clientName',
    'accountHolderName',
    'accountHolderDba',
    'accountHolderAddress',
    'accountHolderCity',
    'accountHolderState',
    'accountHolderZip',
    'bankName',
    'bankAccount',
    'bankRouting',
    'bankPortal',
    'bankUsername',
    'bankPassword',
    'securityQa1',
    'securityQa2',
    'agreementDate',
  ];
  const out: ExhibitCEntityPrefillRow = {};
  for (const key of keys) {
    const value = String(primary?.[key] ?? '').trim() || String(fallback?.[key] ?? '').trim();
    if (value) out[key] = value;
  }
  return out;
}

const EXHIBIT_C_PREFILL_KEYS = [
  'client_legal_name',
  'client_legal_name_p1',
  'legal_name',
  'business_legal_name',
  'client_name',
  'client_name_p1',
  'owner1_guarantor_name',
  'merchant_contact_name',
  'merchant_name',
  'customer_name',
  'authorization_client_name',
  'authorization_client_signer_name',
  'ach_account_holder_name',
  'ach_account_holder_name_p1',
  'ach_authorization_account_holder_name',
  'ach_account_holder_dba',
  'ach_account_holder_dba_p1',
  'doing_business_as',
  'ach_account_holder_address',
  'ach_account_holder_address_p1',
  'business_address',
  'business_address_contract',
  'ach_bank_name',
  'ach_bank_name_p1',
  'ach_authorization_account_holder_bank_name',
  'authorization_client_bank_name',
  'bank_name',
  'ach_bank_account',
  'ach_bank_account_p1',
  'ach_authorization_account_holder_bank_account_number',
  'authorization_client_bank_account',
  'account_number',
  'ach_bank_routing',
  'ach_bank_routing_p1',
  'ach_authorization_account_holder_bank_routing_number',
  'authorization_client_bank_routing',
  'routing_number',
  'ach_bank_portal',
  'ach_bank_portal_p1',
  'ach_authorization_bank_portal_website',
  'ach_username',
  'ach_username_p1',
  'ach_authorization_username',
  'ach_password',
  'ach_password_p1',
  'ach_authorization_password',
  'ach_security_q1',
  'ach_security_q1_p1',
  'ach_security_q2',
  'ach_security_q2_p1',
  'agreement_date',
  'agreement_date_p1',
] as const;

function blankExhibitCPrefillKeys(
  values: Record<string, string>,
): Record<string, string> {
  const out = { ...values };
  for (const key of EXHIBIT_C_PREFILL_KEYS) {
    out[key] = '';
  }
  // Also blank any leftover ACH / holder keys that alias into Exhibit C fields.
  for (const key of Object.keys(out)) {
    const n = key.toLowerCase();
    if (
      n.includes('ach_') ||
      n.includes('authorization_client_bank') ||
      n.includes('account_holder') ||
      n === 'legal_name' ||
      n === 'client_name' ||
      n === 'client_legal_name' ||
      n.includes('guarantor_name') ||
      n.includes('doing_business') ||
      // The page's "Account Holder Business Address" composes the business
      // street with these; another entity's copy must not borrow the merchant's.
      /^(?:security_)?business_address_(?:city|state|zip)$/.test(n)
    ) {
      out[key] = '';
    }
  }
  return out;
}

function overlayExhibitCEntityOntoSignNowValues(
  values: Record<string, string>,
  entity: ExhibitCEntityPrefillRow | undefined,
  options?: { blankSharedFieldsFirst?: boolean; isolateFromMainCrm?: boolean },
): Record<string, string> {
  // Extra copies: keep non-Exhibit keys (app id, dates) but blank shared ACH /
  // merchant aliases so sibling CRM text cannot leak. Never start from {}.
  const out = options?.isolateFromMainCrm || options?.blankSharedFieldsFirst
    ? blankExhibitCPrefillKeys({ ...values })
    : { ...values };
  const set = (target: Record<string, string>, keys: string[], value: unknown) => {
    const v = String(value ?? '').trim();
    if (!v) return;
    for (const key of keys) target[key] = v;
  };
  const merchantLegal =
    String(values.client_legal_name || '').trim() ||
    String(values.client_legal_name_p1 || '').trim() ||
    String(values.legal_name || '').trim() ||
    String(values.business_legal_name || '').trim();
  if (entity) {
    set(out, ['client_name', 'client_name_p1', 'owner1_guarantor_name', 'merchant_contact_name'], entity.clientName);
    set(
      out,
      [
        'ach_account_holder_name',
        'ach_account_holder_name_p1',
        'ach_authorization_account_holder_name',
      ],
      entity.accountHolderName || entity.clientLegalName,
    );
    set(
      out,
      ['ach_account_holder_dba', 'ach_account_holder_dba_p1', 'doing_business_as'],
      entity.accountHolderDba,
    );
    set(
      out,
      [
        'ach_account_holder_address',
        'ach_account_holder_address_p1',
        'business_address',
        'business_address_contract',
      ],
      entity.accountHolderAddress,
    );
    // City/state/zip travel with the entity's own street, never on their own.
    if (String(entity.accountHolderAddress ?? '').trim()) {
      set(out, ['business_address_city'], entity.accountHolderCity);
      set(out, ['business_address_state'], entity.accountHolderState);
      set(out, ['business_address_zip'], entity.accountHolderZip);
    }
    set(
      out,
      [
        'ach_bank_name',
        'ach_bank_name_p1',
        'ach_authorization_account_holder_bank_name',
        'authorization_client_bank_name',
        'bank_name',
      ],
      entity.bankName,
    );
    set(
      out,
      [
        'ach_bank_account',
        'ach_bank_account_p1',
        'ach_authorization_account_holder_bank_account_number',
        'authorization_client_bank_account',
        'account_number',
      ],
      entity.bankAccount,
    );
    set(
      out,
      [
        'ach_bank_routing',
        'ach_bank_routing_p1',
        'ach_authorization_account_holder_bank_routing_number',
        'authorization_client_bank_routing',
        'routing_number',
      ],
      entity.bankRouting,
    );
    set(out, ['ach_bank_portal', 'ach_bank_portal_p1', 'ach_authorization_bank_portal_website'], entity.bankPortal);
    set(out, ['ach_username', 'ach_username_p1', 'ach_authorization_username'], entity.bankUsername);
    set(out, ['ach_password', 'ach_password_p1', 'ach_authorization_password'], entity.bankPassword);
    set(out, ['ach_security_q1', 'ach_security_q1_p1'], entity.securityQa1);
    set(out, ['ach_security_q2', 'ach_security_q2_p1'], entity.securityQa2);
  }
  // A copy isolated for its own entity names that entity, never the deal's
  // merchant — writing `merchantLegal` back here is what put the main
  // application's legal name on every other entity's Exhibit C.
  set(
    out,
    ['client_legal_name', 'client_legal_name_p1', 'legal_name', 'business_legal_name'],
    options?.isolateFromMainCrm
      ? String(entity?.clientLegalName || entity?.accountHolderName || '').trim()
      : merchantLegal,
  );
  const date =
    String(values.agreement_date || values.agreement_date_p1 || '').trim() ||
    currentSignNowUsDate();
  out.agreement_date = date;
  out.agreement_date_p1 = date;
  return out;
}

/** Slot i = payload entity i, backfilled from Exhibit C mapping tab i. */
function mergeExhibitCEntitySources(
  payloadEntitiesRaw: unknown,
  mappingEntities: readonly ExhibitCEntityPrefillRow[],
): ExhibitCEntityPrefillRow[] {
  const payloadEntities = parseExhibitCEntitiesForPrefill(payloadEntitiesRaw);
  const maxSlots = Math.max(payloadEntities.length, mappingEntities.length);
  const out: ExhibitCEntityPrefillRow[] = [];
  for (let i = 0; i < maxSlots; i += 1) {
    out[i] = mergeExhibitCEntityRows(payloadEntities[i], mappingEntities[i]);
  }
  return out;
}

/**
 * One entity per Exhibit C copy, with what the CRM has *saved* first.
 *
 * Order per field: the contract's stored `exhibitCEntities`, then that copy's
 * own saved mapping tab, then the list the browser posted. The posted list is
 * built from whatever contract the screen loaded, so it can predate the copy's
 * latest save — and it used to win, while a request without a contract id
 * never read the saved copy at all. Either way `Exhibit C (2)` reached SignNow
 * with no entity and was filled from the package values (Exhibit C #1's bank,
 * the Monthly Fee holder), which is exactly what Review showed.
 */
export function resolveExhibitCEntities(args: {
  storedEntitiesRaw?: unknown;
  mappingEntities?: readonly ExhibitCEntityPrefillRow[];
  payloadEntitiesRaw?: unknown;
}): ExhibitCEntityPrefillRow[] {
  const stored = mergeExhibitCEntitySources(args.storedEntitiesRaw, args.mappingEntities ?? []);
  const payload = parseExhibitCEntitiesForPrefill(args.payloadEntitiesRaw);
  const maxSlots = Math.max(stored.length, payload.length);
  const out: ExhibitCEntityPrefillRow[] = [];
  for (let i = 0; i < maxSlots; i += 1) {
    out[i] = mergeExhibitCEntityRows(stored[i], payload[i]);
  }
  return out;
}

/** `contractPrefillOverrides.exhibitCEntities`, when the overrides are an object. */
function storedExhibitCEntitiesRaw(overrides: unknown): unknown {
  return overrides && typeof overrides === 'object' && !Array.isArray(overrides)
    ? (overrides as Record<string, unknown>)[EXHIBIT_C_ENTITIES_PREFILL_KEY]
    : undefined;
}

/**
 * One entity row per Exhibit C copy, in send order, merged from the places the
 * CRM keeps them (see `resolveExhibitCEntities` for the order).
 */
function buildExhibitCEntitiesForPrefill(
  values: Record<string, string>,
  overrides: unknown,
  mappingRows: unknown,
): ExhibitCEntityPrefillRow[] {
  const blob = parseDocumentTemplatePrefillBlob(overrides);
  const mappingEntities = (Array.isArray(mappingRows) ? mappingRows : [])
    .filter((row: any) =>
      isExhibitCAddendumRow({
        layoutKey: row?.template?.layoutKey,
        name: row?.template?.name,
      }),
    )
    .map((row: any) => entityFromExhibitCTabs(blob[String(row?.id || '')] ?? {}));
  return resolveExhibitCEntities({
    storedEntitiesRaw: storedExhibitCEntitiesRaw(overrides),
    mappingEntities,
    payloadEntitiesRaw: values[EXHIBIT_C_ENTITIES_PREFILL_KEY],
  });
}

/**
 * Does this slot describe a business of its own?
 *
 * The agreement date is deliberately not counted: `entityFromExhibitCTabs`
 * picks one up from any saved mapping tab, and a slot that carries nothing but
 * a date names no entity — treating it as one is what turned an otherwise
 * untouched Exhibit C copy into a page with a date and nothing else.
 */
export function exhibitCEntityRowHasData(
  entity: ExhibitCEntityPrefillRow | undefined,
): boolean {
  if (!entity) return false;
  return Object.entries(entity).some(
    ([key, value]) => key !== 'agreementDate' && String(value ?? '').trim() !== '',
  );
}

/**
 * The values ONE document in the package should be prefilled with.
 *
 * Every Exhibit C copy shares the same field map, so the only thing that tells
 * `Exhibit C` from `Exhibit C (2)` is its position in the send order. Baking the
 * package-wide `values` onto both copies is what made the two copies render
 * identically in SignNow even though the CRM held different entities for them.
 * Non-Exhibit documents are returned untouched.
 */
export function exhibitCDocumentPrefillValues(
  values: Record<string, string>,
  entities: readonly ExhibitCEntityPrefillRow[],
  documentName: unknown,
): { values: Record<string, string>; entityIndex: number | null; isolated: boolean } {
  const entityIndex = exhibitCInstanceIndexFromDocumentName(documentName);
  if (entityIndex == null) return { values, entityIndex, isolated: false };
  const entity = entities[entityIndex];
  /**
   * Isolation is what a second *entity* needs, not what a second *copy* needs.
   *
   * A copy whose slot names its own business must not inherit the main CRM
   * merchant/ACH values — an unset key there stays blank rather than falling
   * back to the primary merchant, so one entity's page can never carry
   * another's bank or holder details.
   *
   * A copy with no entity of its own is simply another Exhibit C for this
   * deal's merchant. Isolating it blanked every holder/bank/merchant key and
   * put nothing back, which is why `Exhibit C (2)` and `(3)` reached SignNow
   * showing only the agreement date while the merchant still had to sign them.
   * Those copies are filled from the package values, exactly like the first.
   */
  const isolatedExtra = entityIndex > 0 && exhibitCEntityRowHasData(entity);
  /**
   * A copy that is not its own entity is the deal's merchant, so its "Account
   * Holder Business Address" is the deal's business address. The CRM mirrors
   * the ACH holder address — Owner 1's home, from the driver's-licence KYC —
   * into that slot, and overlaying it rewrote `business_address` with the
   * guarantor's street and city. Only a separate entity brings its own address.
   */
  const overlayEntity =
    entity && !isolatedExtra
      ? {
          ...entity,
          accountHolderAddress: '',
          accountHolderCity: '',
          accountHolderState: '',
          accountHolderZip: '',
        }
      : entity;
  return {
    values: overlayExhibitCEntityOntoSignNowValues(
      values,
      overlayEntity,
      isolatedExtra ? { isolateFromMainCrm: true } : { blankSharedFieldsFirst: false },
    ),
    entityIndex,
    isolated: isolatedExtra,
  };
}

/**
 * The values ONE document in the package is prefilled with, from both sources
 * the CRM holds: the package-wide map (plus each Exhibit C copy's own entity),
 * and the document's own tab in the contract prefill editor.
 *
 * The tab wins. It is the only place a value that exists on exactly one
 * document can be entered — the Flex Addendum's installment table, the PayOff
 * Addendum's amounts, Exhibit A's extra sellers — and nothing in the
 * package-wide map can supply those, so before this they reached SignNow as
 * empty boxes however carefully they had been filled in.
 */
export function signNowDocumentPrefillValues(
  values: Record<string, string>,
  entities: readonly ExhibitCEntityPrefillRow[],
  documentName: unknown,
  documentTabValues: readonly SignNowDocumentTabValues[] = [],
): { values: Record<string, string>; entityIndex: number | null; isolated: boolean } {
  const base = exhibitCDocumentPrefillValues(values, entities, documentName);
  const tabs = pickSignNowDocumentTabValues(
    documentTabValues as SignNowDocumentTabValues[],
    documentName,
  );
  // A tab saved under the other "$25 wire fee" choice must not undo the
  // contract's TOTAL FEES on the disclosure (see the helper).
  if (!tabs) return { ...base, values: alignDisclosureWireFeeWithTotalFees(base.values) };
  // A disclosure tab saved from a calculation that ran without inputs holds
  // 0.00 placeholders; they must not bury the deal's real amounts.
  return {
    ...base,
    values: alignDisclosureWireFeeWithTotalFees({
      ...base.values,
      ...dropZeroDisclosurePlaceholders(tabs, base.values),
    }),
  };
}

type SignNowDocumentRef = {
  id: string;
  document_name?: string;
  name?: string;
  roles?: string[];
  listedRoles?: string[];
  remainingRoles?: string[];
  fulfilledRoles?: string[];
  remote?: any;
  /** Fillable widgets the last hydrate saw on this document (never page text). */
  fieldCount?: number;
  /** Template document this copy was made from, for rebuilding a field-less copy. */
  originDocumentId?: string;
};

/** What one document's Owner-review prefill is written from. */
type ReviewPrefillPlan = {
  documentId: string;
  documentName: string;
  values: Record<string, string>;
  remote?: any;
  keepParty2: boolean;
  ignoreExistingFieldValues: boolean;
};

type ReviewPrefillOutcome = {
  plan: ReviewPrefillPlan;
  applied: number;
  attempted: number;
  matched: number;
  written: string[];
  plannedFieldNames: string[];
};

type ReviewPrefillReadBack = {
  outcome: ReviewPrefillOutcome;
  check: SignNowReviewPrefillCheck;
  remote: any;
};

/**
 * Longest a package PDF read waits on a running portal send. The CRM gives the
 * request 120s, and the download itself still has to fit in after the wait.
 */
const PORTAL_SEND_PDF_WAIT_MS = 90_000;

/** Read-back rounds before Review gives up instead of opening a half-filled package. */
const REVIEW_PREFILL_CHECK_ROUNDS = 3;
/** Grows per round: SignNow can take a few seconds to attach a fresh copy's widgets. */
const REVIEW_PREFILL_RETRY_PAUSE_MS = 900;

function extractEmail(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && 'email' in (value as object)) {
    return String((value as { email?: unknown }).email || '').trim();
  }
  return '';
}

function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function uniqueEmails(values: unknown[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values || []) {
    const email = extractEmail(raw);
    if (!email || !looksLikeEmail(email)) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * The request's own "$25 wire fee" preference is newer than the contract row it
 * is saved onto, so it wins whenever the screen sends one. Review, Send and the
 * portal publish all go through here so an unchecked box cannot come back as
 * $25 in TOTAL FEES on any of them.
 */
function withRequestWireFeePreference(
  source: ContractOfferPrefillSource,
  includeWireFee: unknown,
): ContractOfferPrefillSource {
  if (includeWireFee === undefined || includeWireFee === null) return source;
  if (String(includeWireFee).trim() === '') return source;
  return { ...source, includeWireFee: resolveIncludeWireFee(includeWireFee) };
}

function prefillRecord(fields?: PrefillField[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields || []) {
    const id = String(field.id || '').trim();
    let value = String(field.value ?? '').trim();
    if (!id || !value) continue;
    if (isEncrypted(value)) {
      try {
        value = String(decryptField(value) ?? '').trim();
      } catch {
        continue;
      }
    }
    if (!value || isEncrypted(value)) continue;
    out[id] = value;
  }
  applyCurrentRemittanceStartDate(out);
  return out;
}

/** Page-3 remittance start must be agreement date / today, not the SignNow widget default. */
function applyCurrentRemittanceStartDate(values: Record<string, string>): void {
  const date =
    String(values.agreement_date || '').trim() ||
    String(values.signature_date || '').trim() ||
    String(values.disclosure_date || '').trim() ||
    currentSignNowUsDate();
  values.agreement_date = String(values.agreement_date || '').trim() || date;
  values.agreement_date_p1 = String(values.agreement_date_p1 || '').trim() || date;
  values.signature_date = String(values.signature_date || '').trim() || date;
  values.disclosure_date = String(values.disclosure_date || '').trim() || date;
  values.remittance_start_date = date;
}

function applyMerchantSignerPrefill(
  values: Record<string, string>,
  signers: Array<{ name: string; email: string; roleName: string }>,
) {
  const nitroStyle = usesNitroApproverRoles(signers.map((s) => s.roleName));
  const merchants = signers.filter(
    (s) => !isPreparerRole(s.roleName, nitroStyle) && !isInternalSignNowRole(s.roleName),
  );
  const owner2 = merchants[1];
  if (!owner2) return;
  if (sameEmail(owner2.email, merchants[0]?.email)) return;
  values.owner2_guarantor_name = values.owner2_guarantor_name || owner2.name;
  values.owner2_email = values.owner2_email || owner2.email;
  values.guaranty_owner2_name = values.guaranty_owner2_name || owner2.name;
  values.guaranty_guarantor2_name = values.guaranty_guarantor2_name || owner2.name;
}

function parseSignNowFieldAttrs(field: { json_attributes?: unknown }): Record<string, any> {
  let attrs = field?.json_attributes;
  if (typeof attrs === 'string') {
    try {
      attrs = JSON.parse(attrs);
    } catch {
      attrs = {};
    }
  }
  return attrs && typeof attrs === 'object' ? (attrs as Record<string, any>) : {};
}

const SIGN_FIELD_TYPES = new Set(['signature', 'initials', 'stamp']);

function signNowFieldType(field: any, container?: string): string {
  const attrs = parseSignNowFieldAttrs(field);
  const raw = String(
    field?.type || attrs.type || attrs.field_type || field?.field_type || '',
  )
    .toLowerCase()
    .trim();
  if (raw) {
    if (raw === 'radio button' || raw === 'radio') return 'radiobutton';
    if (raw === 'checkmark' || raw === 'check') return 'checkbox';
    return raw;
  }
  const name = String(attrs.name || field?.name || field?.field_name || '').toLowerCase();
  if (name.startsWith('signature_') || name.startsWith('sig_')) return 'signature';
  if (name.startsWith('initial_') || name.startsWith('initials_')) return 'initials';
  if (container === 'signatures') return 'signature';
  if (container === 'initials') return 'initials';
  if (container === 'checks') return 'checkbox';
  if (container === 'texts' || container === 'fillable_fields') return 'text';
  return '';
}

function isCompletedSignElement(field: any): boolean {
  const data = String(field?.data || field?.json_attributes?.data || '').trim();
  return data.length > 80;
}

function signNowFieldKey(field: any, container?: string): string {
  const attrs = parseSignNowFieldAttrs(field);
  const id = String(field?.id || field?.unique_id || attrs.id || '').trim();
  if (id) return `id:${id}`;
  const type = signNowFieldType(field, container);
  const name = String(attrs.name || field?.name || field?.field_name || '').trim();
  const page = Number(attrs.page_number ?? field?.page_number ?? 0);
  const x = Number(attrs.x ?? field?.x ?? 0);
  const y = Number(attrs.y ?? field?.y ?? 0);
  return `${type}:${name}:${page}:${x}:${y}`;
}

function signNowDocumentPageCount(remote: any): number {
  const fromMeta = Number(
    remote?.page_count ?? remote?.pages_amount ?? remote?.document_pages ?? 0,
  );
  const fromPages = Array.isArray(remote?.pages) ? remote.pages.length : 0;
  const meta = Number.isFinite(fromMeta) && fromMeta > 0 ? Math.floor(fromMeta) : 0;
  // Prefer the larger count — a stale page_count of 1 would drop agreement page-1+ fields.
  return Math.max(meta, fromPages);
}

function fieldsOnExistingPages(
  fields: Record<string, unknown>[],
  pageCount: number,
): Record<string, unknown>[] {
  if (!pageCount) return fields;
  return fields.filter((field) => {
    const page = Number(field.page_number);
    const dedicated = isDedicatedExhibitCRequiredField(String(field.name || ''));
    if (!Number.isFinite(page)) {
      if (dedicated) {
        field.page_number = 0;
        return true;
      }
      return false;
    }
    if (page >= 0 && page < pageCount) return true;
    // Exhibit C / some templates store page 1 on a 1-page document (1-based).
    if (page >= 1 && page <= pageCount) {
      field.page_number = page - 1;
      return true;
    }
    if (dedicated) {
      field.page_number = Math.max(0, pageCount - 1);
      return true;
    }
    return false;
  });
}

/**
 * SignNow fillable fields often carry their assignment as `role_id` only, with
 * the human role name living in the document's `roles` / `field_invites` list.
 * `toSignNowPutField` drops any field it cannot assign a role to, and because
 * the merchant publish PUTs the whole field set, a dropped field is *deleted*
 * from the document. That is how the page-22 reference / landlord / emergency
 * widgets and the Exhibit C bank-portal slots disappeared from the signer's
 * copy and came back as bare underlines.
 */
function collectSignNowRoleNamesById(remote: any): Map<string, string> {
  const byId = new Map<string, string>();
  const buckets = [
    remote?.roles,
    remote?.document_roles,
    remote?.signing_roles,
    remote?.field_invites,
    remote?.routing_details?.roles,
  ];
  for (const rows of buckets) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const name = String(
        row.name || row.role || row.role_name || row.signer_role || '',
      ).trim();
      if (!name) continue;
      for (const key of ['unique_id', 'id', 'role_id', 'signer_role_id'] as const) {
        const id = String((row as any)[key] || '').trim();
        if (id && !byId.has(id)) byId.set(id, name);
      }
    }
  }
  return byId;
}

function toSignNowPutField(
  field: any,
  container?: string,
  options?: { defaultRole?: string; maxSize?: number; roleById?: Map<string, string> },
): Record<string, unknown> | null {
  const attrs = parseSignNowFieldAttrs(field);
  const type = signNowFieldType(field, container);
  if (!type || type === 'attachment') return null;
  if (SIGN_FIELD_TYPES.has(type) && isCompletedSignElement(field)) return null;
  const name = String(attrs.name || field?.name || field?.field_name || '').trim();
  const roleFromId = (): string => {
    const map = options?.roleById;
    if (!map || !map.size) return '';
    for (const key of ['role_id', 'signer_role_id', 'roleId'] as const) {
      const id = String((field as any)?.[key] ?? (attrs as any)?.[key] ?? '').trim();
      const hit = id ? map.get(id) : '';
      if (hit) return hit;
    }
    return '';
  };
  const role =
    String(field?.role || field?.signer || attrs.role || '').trim() ||
    roleFromId() ||
    String(options?.defaultRole || '').trim() ||
    (isDedicatedExhibitCRequiredField(name) || isDedicatedContractP22RequiredField(name)
      ? 'Recipient 1'
      : '');
  if (!role) return null;
  const page_number = Number(attrs.page_number ?? field?.page_number ?? 0);
  const x = Number(attrs.x ?? field?.x ?? 0);
  const y = Number(attrs.y ?? field?.y ?? 0);
  const width = Number(attrs.width ?? field?.width ?? (SIGN_FIELD_TYPES.has(type) ? 120 : 12));
  const height = Number(attrs.height ?? field?.height ?? (SIGN_FIELD_TYPES.has(type) ? 34 : 12));
  if (!Number.isFinite(page_number) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const required = Boolean(attrs.required ?? field?.required ?? SIGN_FIELD_TYPES.has(type));
  const id = String(field?.id || field?.unique_id || attrs.id || '').trim();
  const row: Record<string, unknown> = {
    type,
    role,
    page_number,
    x,
    y,
    width: width > 0 ? width : 12,
    height: height > 0 ? height : 12,
    required,
  };
  if (id) row.id = id;
  if (name) row.name = name;
  if (SIGN_FIELD_TYPES.has(type)) {
    // Every field PUT (Review, merchant send, template restores) is built here.
    applySignNowSignatureFieldFont(row);
  } else {
    copySignNowTemplateStyle(row, { ...attrs, ...field });
    const value = String(
      field?.data || attrs.data || attrs.prefilled_text || field?.prefilled_text || '',
    ).trim();
    if (value && !/^enter text$/i.test(value)) {
      row.prefilled_text = value;
      if (attrs.lock_to_sign_prefill === true || field?.lock_to_sign_prefill === true) {
        row.lock_to_sign_prefill = true;
      }
    }
  }
  const radios = attrs.radio || field?.radio;
  if (type === 'radiobutton' && Array.isArray(radios) && radios.length) {
    row.radio = radios;
  }
  const enumerationOptions = attrs.enumeration_options || field?.enumeration_options;
  if (type === 'enumeration' && Array.isArray(enumerationOptions) && enumerationOptions.length) {
    row.enumeration_options = enumerationOptions;
  }
  return row;
}

/**
 * The template face is read through a 24h cache, so the snapshot it overlays can
 * be older than the template itself. Copying `height`/`width` from a stale
 * snapshot shrinks a box the funder has since enlarged in SignNow back to its
 * old size — that is what clipped the Owner address on the Tiberian agreement
 * (cached w=184 h=13 over a live w=201 h=67 widget) while Nitro, whose snapshot
 * happened to be refetched after the same edit, rendered fine.
 *
 * The live document is copied from the template when the group is created, so a
 * live box BIGGER than the snapshot can only mean the template grew since the
 * snapshot was taken. Those boxes are left alone and reported back, so the
 * caller can drop the stale snapshot and refetch on the next publish.
 */
export function overlayTemplateFieldFace(
  fields: Record<string, unknown>[],
  templateFields: Record<string, unknown>[],
): { staleBoxes: number } {
  const byName = new Map<string, Record<string, unknown>>();
  for (const field of templateFields) {
    const name = String(field.name || '').trim().toLowerCase();
    if (name && !byName.has(name)) byName.set(name, field);
  }
  let staleBoxes = 0;
  for (const field of fields) {
    if (SIGN_FIELD_TYPES.has(String(field.type || ''))) continue;
    const src = byName.get(String(field.name || '').trim().toLowerCase());
    if (!src) continue;
    if (isDedicatedExhibitCRequiredField(String(field.name || ''))) continue;
    for (const key of ['font', 'font_size', 'size'] as const) {
      if (src[key] != null && src[key] !== '') field[key] = src[key];
    }
    for (const key of ['height', 'width'] as const) {
      if (src[key] == null || src[key] === '') continue;
      const fromTemplate = Number(src[key]) || 0;
      const onDocument = Number(field[key]) || 0;
      if (onDocument > fromTemplate) {
        staleBoxes += 1;
        continue;
      }
      field[key] = src[key];
    }
  }
  return { staleBoxes };
}

/** Copy page-20 / Exhibit C bank widgets from the template when a live copy dropped them. */
/**
 * Put back any signer widget the live document has lost.
 *
 * This used to restore only the hardcoded merchant-required ACH names. That was
 * not enough once a document had been published by the older code, which
 * deleted every blank signer widget it could not classify: the publish rebuilds
 * from the *live* document, so a field deleted once could never come back and
 * the signer kept seeing bare underlines no matter how the publish was fixed.
 * Existing packages therefore stayed broken while only brand-new ones healed.
 *
 * Restoring from the template is safe because a field already present is left
 * alone, CRM/Owner-held widgets are skipped, and signature/initial widgets are
 * handled by their own restore just above the call site.
 */
/**
 * `restoreAllTextFields` is for a re-publish of a fully CRM-driven document
 * (Exhibit C): the first publish baked its Owner-role values into page text and
 * deleted the widgets, and SignNow keeps no field name on a committed text, so
 * without the template layout back there is nothing left to resolve the current
 * values onto — the old stamp would be all the document could show.
 */
/**
 * A template widget whose box lands on a spot the live document already has a
 * widget for is a duplicate, whatever the two are called.
 *
 * Exhibit C is the case that forced this. `resolveExhibitCDocumentId` returns
 * one Exhibit C document for every funder — Nitro's, whose widgets all carry
 * real names. The Obsidian copy of the same page ships with SignNow's default
 * `Text Field 1` … `Text Field 11` and nothing else, so the restore below saw
 * `ach_bank_portal_p1` / `ach_username_p1` / `ach_password_p1` /
 * `ach_security_q1_p1` / `ach_security_q2_p1` / `ach_account_holder_name_p1`
 * "missing" and stacked a second box on top of the numbered widget already
 * sitting there. That is the row of stray "Optional" boxes the merchant saw
 * beside the Account Holder and bank lines.
 */
const RESTORE_SPOT_TOLERANCE = 8;

function occupiesSameSignNowSpot(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  if ((Number(a.page_number) || 0) !== (Number(b.page_number) || 0)) return false;
  return (
    Math.abs((Number(a.x) || 0) - (Number(b.x) || 0)) <= RESTORE_SPOT_TOLERANCE &&
    Math.abs((Number(a.y) || 0) - (Number(b.y) || 0)) <= RESTORE_SPOT_TOLERANCE
  );
}

function mergeMissingSignerFieldsFromTemplate(
  fields: Record<string, unknown>[],
  templateFields: Record<string, unknown>[],
  options?: SignNowPrefillOptions & { restoreAllTextFields?: boolean },
): Record<string, unknown>[] {
  const present = new Set<string>();
  for (const field of fields) {
    const name = String(field.name || '').trim().toLowerCase();
    if (name) present.add(name);
  }
  const nitroStyle = usesNitroApproverRoles(
    templateFields.map((field) => String(field.role || '')),
  );
  const extra: Record<string, unknown>[] = [];
  for (const field of templateFields) {
    if (SIGN_FIELD_TYPES.has(String(field.type || ''))) continue;
    const rawName = String(field.name || '');
    const role = String(field.role || '').trim();
    const whitelisted = isMerchantRequiredSignerField(
      rawName,
      Number(field.page_number),
      options,
    );
    // A blank slot the template assigned to a signer is the merchant's to fill.
    const signerOwned =
      Boolean(role) && !/^owner$/i.test(role) && !isPreparerRole(role, nitroStyle);
    if (!whitelisted && !signerOwned && !options?.restoreAllTextFields) continue;
    const name = rawName.trim().toLowerCase();
    if (name && present.has(name)) continue;
    if (fields.some((live) => occupiesSameSignNowSpot(live, field))) continue;
    if (name) present.add(name);
    const copy = { ...field };
    delete copy.id;
    extra.push(copy);
  }
  return extra.length ? [...fields, ...extra] : fields;
}

function collectSignNowPutFields(
  remote: any,
  options?: { defaultRole?: string; maxSize?: number; skipCommittedTexts?: boolean },
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const roleById = collectSignNowRoleNamesById(remote);
  // A field dropped here is deleted from the document by the merchant publish,
  // so make that visible instead of letting widgets vanish silently.
  const droppedNoRole: string[] = [];
  /**
   * SignNow strips the field name off a committed text element, so a stamp from
   * an earlier publish cannot be re-resolved against the current CRM values — it
   * would ride along here carrying its stale `data` and be stamped a second time.
   * A baking publish handles those elements explicitly (clear + rewrite through
   * `mergeCommittedSignNowTexts`), so it leaves them out of the field list.
   */
  const containers = (
    options?.skipCommittedTexts
      ? ['fields', 'fillable_fields', 'signatures', 'initials', 'checks']
      : ['fields', 'fillable_fields', 'texts', 'signatures', 'initials', 'checks']
  ) as readonly string[];
  for (const container of containers) {
    const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
    for (const field of rows) {
      if (!field || typeof field !== 'object') continue;
      const key = signNowFieldKey(field, container);
      if (seen.has(key)) continue;
      const put = toSignNowPutField(field, container, { ...options, roleById });
      if (!put) {
        const type = signNowFieldType(field, container);
        if (type && type !== 'attachment' && !isCompletedSignElement(field)) {
          const label = String(
            field?.name || field?.field_name || parseSignNowFieldAttrs(field).name || '',
          ).trim();
          if (label) droppedNoRole.push(label);
        }
        continue;
      }
      seen.add(key);
      out.push(put);
    }
  }
  if (droppedNoRole.length) {
    console.warn('[SignNow] fields dropped with no resolvable role', {
      count: droppedNoRole.length,
      knownRoles: [...new Set(roleById.values())],
      sample: droppedNoRole.slice(0, 15),
    });
  }
  return out;
}

/**
 * Strip the document's own values for every widget this send can already fill
 * from the CRM map.
 *
 * `collectExistingSignNowFieldValues` keys what is already on the page by the
 * widget's OWN name (`business_address_p1`, `total_fees_p2`), and
 * `resolveSignNowPrefillValue` tries the widget name before any CRM alias — so
 * layering the CRM values on top of that map does not actually let them win.
 * Anything already stamped on a widget outranked the value the CRM sent for it,
 * which is why a package that had been pre-warmed opened in Review still showing
 * the warm's placeholder amounts (`0.00`, `OWNER`) and kept a $25 wire fee that
 * had since been switched off: the second Review only looked right because the
 * changed values had by then forced a rebuild from the template.
 *
 * The document stays the layer UNDERNEATH — merchant-typed references, bank
 * portal credentials and anything else the CRM has no value for are untouched —
 * it just no longer shadows a value the CRM did send.
 */
function existingValuesBeneathCrmValues(
  existing: Record<string, string>,
  fieldNames: string[],
  values: Record<string, string>,
  prefillOpts?: ReturnType<typeof signNowPrefillOptionsForDocument>,
): Record<string, string> {
  if (!Object.keys(existing).length) return existing;
  const out = { ...existing };
  for (const name of fieldNames) {
    if (shouldSkipSignNowPrefill(name, prefillOpts)) continue;
    if (!formatSignNowPrefillValue(resolveSignNowPrefillValue(name, values, prefillOpts))) {
      continue;
    }
    delete out[name];
    const canon = canonicalizeSignNowFieldName(name);
    if (canon) delete out[canon];
  }
  return out;
}

function countPutFieldTypes(fields: Record<string, unknown>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const field of fields) {
    const type = String(field.type || 'unknown');
    counts[type] = (counts[type] || 0) + 1;
  }
  return counts;
}

/**
 * Values already on the document, used as the layer under this send's CRM values.
 *
 * `skipCommittedTexts` drops the `texts` container: those are the stamps an
 * earlier publish baked onto the page, they carry no live field name, and on a
 * resend they are exactly the pre-edit values that must not survive. A merchant
 * publish rewrites `texts` wholesale, so it reads only the real widgets.
 */
function collectExistingSignNowFieldValues(
  remote: any,
  options?: { skipCommittedTexts?: boolean },
): Record<string, string> {
  const out: Record<string, string> = {};
  const skipType = new Set(['signature', 'initials', 'checkmark', 'checkbox', 'radiobutton', 'attachment']);
  const containers = (
    options?.skipCommittedTexts
      ? ['fields', 'fillable_fields']
      : ['texts', 'fields', 'fillable_fields']
  ) as readonly string[];
  for (const container of containers) {
    const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
    for (const field of rows) {
      if (!field || typeof field !== 'object') continue;
      const type = String(field.type || '').toLowerCase();
      if (type && skipType.has(type)) continue;
      const attrs = parseSignNowFieldAttrs(field);
      const name = String(
        attrs.name || field.name || field.field_name || attrs.label || field.label || '',
      ).trim();
      const value = String(
        field.data ||
          field.prefilled_text ||
          attrs.data ||
          attrs.prefilled_text ||
          '',
      ).trim();
      if (!name || !value || /^enter text$/i.test(value)) continue;
      // Date widgets keep the day they were placed on the template. Do not let
      // that default shadow CRM agreement_date / today's remittance start.
      if (
        type === 'date' ||
        type === 'datepicker' ||
        type === 'datetime' ||
        isRemittanceStartDateField(name)
      ) {
        continue;
      }
      out[name] = value;
      const canon = canonicalizeSignNowFieldName(name);
      if (canon && !out[canon]) out[canon] = value;
    }
  }
  return out;
}

function orderedSigners(roles: SignerRoleInput[]): Array<{
  name: string;
  email: string;
  roleName: string;
}> {
  const sorted = [...roles].sort(
    (a, b) =>
      Number(a.signerOrder ?? a.roleIndex ?? 99) - Number(b.signerOrder ?? b.roleIndex ?? 99),
  );
  return sorted
    .map((role, idx) => {
      const email = String(role.signerEmail || '').trim();
      const name =
        String(role.signerName || '').trim() ||
        (email ? email.split('@')[0] : '') ||
        `Signer ${idx + 1}`;
      return {
        email,
        name,
        roleName:
          String(role.roleName || role.signerRole || '').trim() || `Signer ${idx + 1}`,
      };
    })
    .filter((s) => s.email);
}

function isInternalSignNowRole(roleName: string): boolean {
  return /nitro|lender|funder|company|witness|countersign/i.test(String(roleName || ''));
}

function isEditorOnlyRole(roleName: string): boolean {
  const role = String(roleName || '').toLowerCase().trim();
  return role === 'me' || role.includes('fill out');
}

/**
 * Nitro templates: Approver / Owner (data) + Recipient 1/2 (merchants).
 * Katan templates: Recipient 1 (preparer) + Recipient 2/3 (merchants).
 */
function usesNitroApproverRoles(_templateRoles?: string[]): boolean {
  // This CRM is Nitro Advance: Owner/Approver = sender, Recipient 1/2 = merchants.
  // After field reassignment Owner can drop off the field list — still Nitro, not Katan.
  return true;
}

function isPreparerRole(roleName: string, nitroStyle = false): boolean {
  const role = String(roleName || '').toLowerCase().trim();
  if (nitroStyle) {
    return (
      role === 'approver' ||
      role === 'owner' ||
      role === 'me' ||
      role.includes('fill out') ||
      role.includes('preparer') ||
      role.includes('sender') ||
      role.includes('verifier')
    );
  }
  return (
    role.includes('recipient 1') ||
    role.includes('preparer') ||
    role.includes('sender') ||
    role.includes('verifier') ||
    role === 'approver' ||
    role === 'r1'
  );
}

function isOwner2Role(roleName: string, nitroStyle = false): boolean {
  const role = String(roleName || '').toLowerCase().trim();
  if (nitroStyle) {
    return (
      role.includes('recipient 2') ||
      role.includes('owner 2') ||
      role.includes('signer 2') ||
      role.includes('secondary signer') ||
      /^role\s*2$/.test(role) ||
      role === 'r2'
    );
  }
  return (
    role.includes('recipient 3') ||
    role.includes('owner 2') ||
    role.includes('signer 2') ||
    role.includes('secondary signer') ||
    /^role\s*2$/.test(role) ||
    role === 'r3'
  );
}

function isOwner1Role(roleName: string, nitroStyle = false): boolean {
  const role = String(roleName || '').toLowerCase().trim();
  if (nitroStyle) {
    return (
      role.includes('recipient 1') ||
      role.includes('owner 1') ||
      role.includes('signer 1') ||
      role.includes('primary signer') ||
      /^role\s*1$/.test(role) ||
      role === 'r1'
    );
  }
  return (
    role.includes('recipient 2') ||
    role.includes('owner 1') ||
    role.includes('signer 1') ||
    role.includes('primary signer') ||
    /^role\s*1$/.test(role) ||
    role === 'r2' ||
    role.includes('owner') ||
    role.includes('signer') ||
    role.includes('merchant') ||
    role.includes('guarantor')
  );
}

function uniqueRoleNames(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const name = String(raw || '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** SignNow sometimes returns "Recipient2" while templates use "Recipient 2". */
function normalizeRoleKey(role: string): string {
  return String(role || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function sameSignNowRole(a: string, b: string): boolean {
  return normalizeRoleKey(a) === normalizeRoleKey(b);
}

function resolvePreparerIdentity(): { name: string; email: string } | null {
  const email = String(process.env.SIGNNOW_USERNAME || '').trim();
  if (!email.includes('@')) return null;
  return { name: 'Nitro Advance', email };
}

function uniqueEmailAlias(email: string, usedEmails: string[], tag: string): string {
  let next = email;
  if (usedEmails.includes(next.toLowerCase())) {
    const [local, domain] = email.split('@');
    const slug = String(tag || 'role').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'role';
    next = `${local}+${slug}@${domain}`;
  }
  usedEmails.push(next.toLowerCase());
  return next;
}

function sameEmail(a?: string, b?: string): boolean {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function distinctSecondMerchant(
  signers: Array<{ name: string; email: string }>,
): { name: string; email: string } | null {
  const primary = signers[0];
  for (let i = 1; i < signers.length; i += 1) {
    const row = signers[i];
    if (row?.email && !sameEmail(row.email, primary?.email)) return row;
  }
  return null;
}

function signNowFieldRoleName(field: any): string {
  const attrs = parseSignNowFieldAttrs(field);
  return String(
    field?.role || field?.signer || attrs.role || attrs.role_name || attrs.signer || '',
  ).trim();
}

function collectSignWidgetRoles(remote: any): string[] {
  const roles: string[] = [];
  for (const fieldType of ['signatures', 'initials'] as const) {
    const fields = remote?.[fieldType];
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const name = signNowFieldRoleName(field);
      if (name) roles.push(name);
    }
  }
  return uniqueRoleNames(roles).filter((role) => !isEditorOnlyRole(role));
}

function collectListedDocumentRoles(remote: any): string[] {
  const roles: string[] = [];
  const buckets = [
    remote?.roles,
    remote?.document_roles,
    remote?.signing_roles,
    remote?.field_invites,
    remote?.routing_details?.roles,
  ];
  for (const rolesRaw of buckets) {
    if (!Array.isArray(rolesRaw)) continue;
    for (const role of rolesRaw) {
      if (typeof role === 'string' && role.trim()) {
        roles.push(role.trim());
        continue;
      }
      if (role && typeof role === 'object') {
        const name = String(
          role.name || role.role || role.role_name || role.signer_role || '',
        ).trim();
        if (name) roles.push(name);
      }
    }
  }
  return uniqueRoleNames(roles).filter((role) => !isEditorOnlyRole(role));
}

/** Roles that actually have fields on this document (group lists can union roles). */
function collectFieldAssignedRoles(remote: any): string[] {
  const roles: string[] = [];
  for (const fieldType of ['signatures', 'initials', 'texts', 'fields', 'fillable_fields'] as const) {
    const fields = remote?.[fieldType];
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      const name = signNowFieldRoleName(field);
      if (name) roles.push(name);
    }
  }
  return uniqueRoleNames(roles).filter((role) => !isEditorOnlyRole(role));
}

function collectDocumentRoles(remote: any): string[] {
  const fromFields = collectFieldAssignedRoles(remote);
  if (fromFields.length) return fromFields;
  return collectListedDocumentRoles(remote);
}

/** Roles that still have unsigned fields — excludes fulfilled Owner after embedded review. */
function collectRemainingInviteRoles(remote: any): string[] {
  const roles: string[] = [];
  const signedTypes = new Set(['signatures', 'initials']);
  for (const fieldType of ['signatures', 'initials', 'texts', 'fields', 'fillable_fields'] as const) {
    const fields = remote?.[fieldType];
    if (!Array.isArray(fields)) continue;
    for (const field of fields) {
      if (!field || typeof field !== 'object') continue;
      if (signedTypes.has(fieldType)) {
        const signed = Boolean(
          field.data ||
            field.signature_id ||
            field.json_attributes?.data ||
            field.json_attributes?.signature_id,
        );
        if (signed) continue;
      }
      const name = signNowFieldRoleName(field);
      if (name) roles.push(name);
    }
  }
  return uniqueRoleNames(roles).filter((role) => !isEditorOnlyRole(role));
}

function parseMissingInviteRole(detail: string): { role: string; documentId: string } | null {
  const match = String(detail || '').match(
    /Role\s+(.+?)\s+on document\s+([a-f0-9]+)\s+was not specified/i,
  );
  if (!match) return null;
  return { role: match[1].trim(), documentId: match[2].trim() };
}

/** SignNow: "Role name Owner is not found on document <id>" (sometimes "foundon" / "Recipient2"). */
function parseUnknownInviteRole(detail: string): { role: string; documentId: string } | null {
  const match = String(detail || '').match(
    /Role(?: name)?\s+(.+?)\s+is not found\s*on document\s+([a-f0-9]+)/i,
  );
  if (!match) return null;
  return { role: match[1].trim(), documentId: match[2].trim() };
}

/** SignNow (public origin) cannot redirect an iframe to localhost — Chrome blocks it. */
function isPrivateNetworkUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') {
      return true;
    }
    if (host.endsWith('.local') || host.endsWith('.internal')) return true;
    if (/^(10|127)\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(host)) return true;
    return false;
  } catch {
    return true;
  }
}

function collectFulfilledRoleNames(remote: any): string[] {
  const names: string[] = [];
  const invites = Array.isArray(remote?.field_invites) ? remote.field_invites : [];
  for (const invite of invites) {
    if (!invite || typeof invite !== 'object') continue;
    const status = String(invite.status || invite.field_status || '').toLowerCase();
    if (!['fulfilled', 'completed', 'signed', 'finished'].includes(status)) continue;
    const name = String(invite.role || invite.role_name || invite.signer_role || '').trim();
    if (name) names.push(name);
  }
  for (const container of ['signatures', 'initials'] as const) {
    const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
    for (const field of rows) {
      if (!field || typeof field !== 'object') continue;
      const signed = Boolean(
        field.data ||
          field.signature_id ||
          field.json_attributes?.data ||
          field.json_attributes?.signature_id,
      );
      if (!signed) continue;
      const name = signNowFieldRoleName(field);
      if (name) names.push(name);
    }
  }
  return uniqueRoleNames(names);
}

function collectFulfilledFromEmbeddedInvites(payload: unknown): string[] {
  const names: string[] = [];
  const root = (payload || {}) as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown> | unknown[];
  const invites = Array.isArray(data)
    ? data
    : Array.isArray((data as { invites?: unknown[] }).invites)
      ? ((data as { invites: unknown[] }).invites)
      : [];
  const walkSigner = (signer: any) => {
    if (!signer || typeof signer !== 'object') return;
    const status = String(signer.status || signer.state || signer.invite_status || '').toLowerCase();
    const done = ['fulfilled', 'completed', 'signed', 'finished', 'done'].includes(status);
    const docs = Array.isArray(signer.documents) ? signer.documents : [];
    for (const doc of docs) {
      const docStatus = String(doc?.status || '').toLowerCase();
      const role = String(doc?.role || doc?.role_name || '').trim();
      if (role && (done || ['fulfilled', 'completed', 'signed', 'finished'].includes(docStatus))) {
        names.push(role);
      }
    }
    const role = String(signer.role || signer.role_name || '').trim();
    if (role && done) names.push(role);
  };
  for (const invite of invites) {
    if (!invite || typeof invite !== 'object') continue;
    const row = invite as Record<string, unknown>;
    const signers = Array.isArray(row.signers) ? row.signers : [];
    signers.forEach(walkSigner);
  }
  return uniqueRoleNames(names);
}

/**
 * Nitro: Approver/Owner → CRM sender; Recipient 1 → merchant 1; Recipient 2 → merchant 2.
 * Katan: Recipient 1 → CRM preparer; Recipient 2/3 → merchants.
 */
function fillSignersForTemplateRoles(
  templateRoles: string[],
  crmSigners: Array<{ name: string; email: string; roleName: string }>,
  options?: { includeSameEmailOwner2?: boolean },
): Array<{ name: string; email: string; roleName: string; preparer?: boolean }> {
  const usableRoles = uniqueRoleNames(templateRoles).filter((role) => !isEditorOnlyRole(role));
  if (!usableRoles.length) return crmSigners;
  const nitroStyle = usesNitroApproverRoles(templateRoles);
  const byRole = new Map(
    crmSigners.map((s) => [s.roleName.trim().toLowerCase(), s] as const),
  );
  const unused = [...crmSigners];
  const primary = crmSigners[0];
  const preparer = resolvePreparerIdentity();
  const out: Array<{ name: string; email: string; roleName: string; preparer?: boolean }> = [];

  const orderedRoles = [...usableRoles].sort((a, b) => {
    const rank = (role: string) => {
      const r = role.toLowerCase().trim();
      if (r === 'owner') return 0;
      if (r === 'approver') return 1;
      if (isPreparerRole(role, nitroStyle) || isInternalSignNowRole(role)) return 2;
      return 3;
    };
    return rank(a) - rank(b);
  });

  for (const role of orderedRoles) {
    const key = role.toLowerCase();
    const asPreparer = isPreparerRole(role, nitroStyle) || isInternalSignNowRole(role);
    const mapped = byRole.get(key);
    if (mapped && !asPreparer) {
      if (
        isOwner2Role(role, nitroStyle) &&
        sameEmail(mapped.email, primary?.email) &&
        !options?.includeSameEmailOwner2
      ) {
        continue;
      }
      out.push({ ...mapped, roleName: role, preparer: false });
      continue;
    }
    if (asPreparer && preparer) {
      out.push({ ...preparer, roleName: role, preparer: true });
      continue;
    }
    if (isOwner2Role(role, nitroStyle)) {
      const second = distinctSecondMerchant(crmSigners);
      if (second) {
        out.push({ ...second, roleName: role });
      } else if (options?.includeSameEmailOwner2 && primary) {
        out.push({ ...primary, roleName: role });
      }
      continue;
    }
    if (isOwner1Role(role, nitroStyle) && primary) {
      out.push({ ...primary, roleName: role });
      continue;
    }
    const nextUnused = unused.shift();
    if (nextUnused && !out.some((s) => s.roleName.toLowerCase() === role.toLowerCase())) {
      out.push({ ...nextUnused, roleName: role });
      continue;
    }
    if (primary) {
      out.push({ ...primary, roleName: role });
    }
  }
  return out.length ? out : crmSigners;
}


function hasActiveEmbeddedInvites(payload: unknown): boolean {
  const root = (payload || {}) as Record<string, unknown>;
  const data = (root.data ?? root) as Record<string, unknown> | unknown[];
  const invites = Array.isArray(data)
    ? data
    : Array.isArray((data as { invites?: unknown[] }).invites)
      ? (data as { invites: unknown[] }).invites
      : [];
  const inactive = new Set(['canceled', 'cancelled', 'voided', 'expired', 'declined', 'deleted']);
  return invites.some((invite) => {
    if (!invite || typeof invite !== 'object') return false;
    const row = invite as Record<string, unknown>;
    const status = String(row.status || row.state || row.invite_status || '').toLowerCase();
    return !inactive.has(status);
  });
}

/**
 * Pauses before re-trying a merchant publish / send bake that SignNow refused.
 * Emailing a document whose values never committed sends the merchant a blank
 * contract, so a refusal is retried and, if it persists, fails the send.
 */
const SIGNNOW_PUBLISH_RETRY_PAUSES_MS = [2_000, 5_000] as const;

/**
 * Refuse to send a package no Review ever prefilled.
 *
 * The background pre-warm links an empty copy with this marker; a Review build
 * replaces it with the real value fingerprint. A package still carrying the
 * marker at send time was reviewed empty — sending it emails the merchant a
 * blank contract, on every funder — so nothing is sent and the user is told to
 * run Review again (which adopts the same copy and prefills it).
 */
export function assertPackageWasPrefilledByReview(prefillFingerprint: string | null | undefined): void {
  if (String(prefillFingerprint || '').trim() !== SIGNNOW_PRISTINE_PREFILL_FINGERPRINT) return;
  throw new BadRequestException(
    'This SignNow package was opened for review before the contract values were filled in, ' +
      'so nothing was sent. Click Review in SignNow again — the values are filled in first — ' +
      'then Finish and send.',
  );
}

/** Tag a review redirect with the outcome that triggered it (finish / close / decline). */
function withReviewRedirectEvent(url: string, event: 'finish' | 'close' | 'decline'): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.set('event', event);
    return parsed.toString();
  } catch {
    return url;
  }
}

let cachedAgreementDocumentId = '';
const cachedAgreementDocumentIdByTemplate = new Map<string, string>();
/**
 * Optional hot layer in front of the durable archive.
 *
 * Correctness no longer depends on it: the DB + Cloudinary archive
 * (`signnow-template-pdf-archive`) is the source of truth for blank template
 * PDFs, and a cold process simply reads from Cloudinary instead of SignNow.
 * Keeping the buffers in memory only saves the Cloudinary round trip.
 */
/** In-flight signed-package downloads, keyed by document-group id. */
const groupPdfInflight = new Map<string, Promise<Buffer>>();
const cachedAgreementPdfByTemplate = new Map<string, { buffer: Buffer; at: number }>();
const cachedAddendumPdf = new Map<string, { buffer: Buffer; at: number }>();
/** Blank template PDFs change rarely — keep them warm so View Contract is instant. */
const AGREEMENT_PDF_TTL_MS = 6 * 60 * 60 * 1000;
/**
 * Origin template documents fetched for the prefill field-face overlay.
 *
 * Every Review re-fetched the full agreement template (a 22-page document with
 * hundreds of widgets) once for the agreement, plus once more for *each* Exhibit C
 * copy — the same template document, refetched N times inside one request. The
 * payload only changes when someone edits the template in SignNow, so a short TTL
 * plus in-flight dedupe removes those calls without changing any field logic.
 */
const templateDocumentCache = new Map<string, { data: any; at: number }>();
const templateDocumentInflight = new Map<string, Promise<any>>();
const TEMPLATE_DOCUMENT_TTL_MS = 10 * 60 * 1000;
/**
 * Minutes an embedded review link (and its session) stays usable. SignNow caps
 * both at 45, and it rejects a `session_expiration` that outlives the link, so
 * one value feeds both fields.
 */
const SIGNNOW_EMBED_LINK_EXPIRATION_MINUTES = 45;
const DRAFT_GROUP_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const draftGroupCache = new Map<
  string,
  {
    groupId: string;
    documents: SignNowDocumentRef[];
    fingerprint: string;
    ownerRolesPrepared: boolean;
    at: number;
  }
>();
const draftGroupInflight = new Map<
  string,
  Promise<{
    groupId: string;
    documents: SignNowDocumentRef[];
    reusedExisting: boolean;
    ownerRolesPrepared: boolean;
  }>
>();
const signNowGroupWriteLocks = new Map<string, Promise<void>>();
const addendumOriginIdCache = new Map<string, string>();
const groupTemplateRowCache = new Map<string, { row: any; at: number }>();
const GROUP_TEMPLATE_ROW_TTL_MS = 30 * 60 * 1000;
/** Coalesces the concurrent origin-template lookups one prefill pass makes. */
const groupTemplateRowInflight = new Map<string, Promise<any | null>>();
let groupTemplateListCache: { at: number; rows: any[] } | null = null;

/** CC-notice catch-ups in flight, per envelope, so concurrent reads send once. */
const ccNoticeCatchUpInflight = new Set<string>();
/** Last catch-up attempt per envelope; a failed send is retried after the cooldown. */
const ccNoticeCatchUpAttempts = new Map<string, number>();
const CC_NOTICE_RETRY_MS = 10 * 60 * 1000;

export class SignNowService {
  isEnabled(): boolean {
    return isSignNowConfigured();
  }

  /**
   * Blank Agreement PDF from a SignNow document-group template (for CRM preview).
   *
   * Served from the durable archive (DB row → Cloudinary). SignNow is contacted
   * only when nothing has been archived for this template yet, or when the
   * caller explicitly asks for a refresh after the template was repointed.
   */
  async downloadAgreementPdf(
    templateId?: string | null,
    options?: { forceRefresh?: boolean },
  ): Promise<Buffer> {
    const resolvedTemplateId =
      extractSignNowTemplateId(templateId) || SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID;
    if (!resolvedTemplateId) {
      throw new BadRequestException(
        'No SignNow main contract template id was provided.',
      );
    }
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();
    const cached = cachedAgreementPdfByTemplate.get(resolvedTemplateId);
    if (!forceRefresh && cached && now - cached.at < AGREEMENT_PDF_TTL_MS) {
      return cached.buffer;
    }

    const buffer = await resolveTemplatePdf({
      identity: {
        signnowTemplateId: resolvedTemplateId,
        name: 'Agreement',
        type: 'contract',
      },
      forceRefresh,
      fetchFromSignNow: async () => {
        const client = await createSignNowApiClient();
        const documentId = await this.resolveAgreementDocumentId(
          client,
          resolvedTemplateId,
        );
        const pdf = await this.downloadDocumentPdfBuffer(client, documentId, 'Agreement');
        return { pdf, originDocumentId: documentId };
      },
    });

    cachedAgreementPdfByTemplate.set(resolvedTemplateId, { buffer, at: Date.now() });
    return buffer;
  }

  /**
   * Blank addendum / disclosure / exhibit PDF from a SignNow document-group
   * template (CRM picker preview). Same archive-first path as the agreement —
   * nothing here is specific to a template type.
   */
  async downloadGroupTemplatePdf(
    layoutKeyOrId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<Buffer> {
    const def = resolveSignNowAddendumTemplate(layoutKeyOrId);
    if (!def?.templateId) {
      throw new BadRequestException(`Unknown SignNow addendum "${layoutKeyOrId}"`);
    }
    const forceRefresh = options?.forceRefresh === true;
    const now = Date.now();
    const cached = cachedAddendumPdf.get(def.layoutKey);
    if (!forceRefresh && cached && now - cached.at < AGREEMENT_PDF_TTL_MS) {
      return cached.buffer;
    }

    const buffer = await resolveTemplatePdf({
      identity: {
        signnowTemplateId: def.templateId,
        layoutKey: def.layoutKey,
        name: def.name,
        type: def.type,
      },
      forceRefresh,
      fetchFromSignNow: async () => {
        const client = await createSignNowApiClient();
        const documentId = await this.resolveGroupTemplateOriginDocumentId(
          client,
          def.templateId,
        );
        const pdf = await this.downloadDocumentPdfBuffer(client, documentId, def.name);
        return { pdf, originDocumentId: documentId };
      },
    });

    cachedAddendumPdf.set(def.layoutKey, { buffer, at: Date.now() });
    return buffer;
  }

  /**
   * Forget a template's archived PDF (and the hot copies of it) so the next
   * preview re-fetches from SignNow once. Call when a template link is
   * repointed in Settings → Funders.
   */
  async invalidateTemplatePdf(templateIdOrLink: string): Promise<void> {
    const resolved = extractSignNowTemplateId(templateIdOrLink) ||
      resolveSignNowAddendumTemplate(templateIdOrLink)?.templateId ||
      '';
    if (!resolved) return;
    await invalidateStoredTemplatePdf(resolved);
    cachedAgreementPdfByTemplate.delete(resolved);
    for (const [key, ] of cachedAddendumPdf) {
      const def = resolveSignNowAddendumTemplate(key);
      if (def?.templateId?.toLowerCase() === resolved.toLowerCase()) {
        cachedAddendumPdf.delete(key);
      }
    }
  }

  private async resolveAgreementDocumentId(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    templateId?: string | null,
  ): Promise<string> {
    const resolvedTemplateId =
      extractSignNowTemplateId(templateId) || SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID;
    if (!resolvedTemplateId) {
      throw new BadRequestException(
        'No SignNow main contract template id is configured.',
      );
    }
    if (resolvedTemplateId === SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID && cachedAgreementDocumentId) {
      return cachedAgreementDocumentId;
    }
    const cached = cachedAgreementDocumentIdByTemplate.get(resolvedTemplateId);
    if (cached) return cached;
    const origin = await this.resolveGroupTemplateOriginDocumentId(
      client,
      resolvedTemplateId,
    );
    cachedAgreementDocumentIdByTemplate.set(resolvedTemplateId, origin);
    if (resolvedTemplateId === SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID) {
      cachedAgreementDocumentId = origin;
    }
    return origin;
  }

  /**
   * GET an origin template document, deduped across the request and cached briefly.
   * Returns the response body, or null when SignNow refused it.
   */
  private async fetchTemplateDocumentCached(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    templateId: string,
  ): Promise<any | null> {
    const id = String(templateId || '').trim();
    if (!id) return null;
    const cached = templateDocumentCache.get(id);
    if (cached && Date.now() - cached.at < TEMPLATE_DOCUMENT_TTL_MS) {
      logSignNowTiming('template-origin-field-overlay-get', 0, {
        documentId: id,
        cached: true,
      });
      return cached.data;
    }
    const inflight = templateDocumentInflight.get(id);
    if (inflight) {
      logSignNowTiming('template-origin-field-overlay-get', 0, {
        documentId: id,
        coalesced: true,
      });
      return inflight;
    }
    const started = Date.now();
    let fromStore = false;
    const work = (async () => {
      // Persisted copy first: the in-process cache is cold on every restart and
      // on each additional instance, but the template itself rarely changes.
      const stored = await readStoredTemplateDocument(id);
      if (stored) {
        fromStore = true;
        templateDocumentCache.set(id, { data: stored, at: Date.now() });
        return stored;
      }
      const res = await client.get(`/document/${id}`, { validateStatus: () => true });
      if (res.status >= 400) return null;
      templateDocumentCache.set(id, { data: res.data, at: Date.now() });
      // Write-through is best-effort and must not delay the caller.
      void writeStoredTemplateDocument(id, res.data);
      return res.data;
    })()
      .finally(() => {
        templateDocumentInflight.delete(id);
        logSignNowTiming('template-origin-field-overlay-get', Date.now() - started, {
          documentId: id,
          cached: false,
          fromStore,
        });
      });
    templateDocumentInflight.set(id, work);
    return work;
  }

  /**
   * Drop both layers of the template-face cache for one template: the durable
   * row and this process's copy. Called when a live document turns out to carry
   * a widget box the cached snapshot does not know about, which means the
   * template was edited after the snapshot was taken.
   */
  private async invalidateTemplateDocumentCache(templateId: string): Promise<void> {
    const id = String(templateId || '').trim();
    if (!id) return;
    templateDocumentCache.delete(id);
    await invalidateStoredTemplateDocument(id);
  }

  private async resolveExhibitCDocumentId(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
  ): Promise<string> {
    const templateId = signNowExhibitCTemplateId();
    if (!templateId) {
      throw new BadRequestException('No SignNow Exhibit C template id is configured.');
    }
    const cached = addendumOriginIdCache.get(templateId);
    if (cached) return cached;
    const origin =
      (await this.resolveGroupTemplateOriginDocumentId(client, templateId)) || templateId;
    addendumOriginIdCache.set(templateId, origin);
    return origin;
  }

  /**
   * Origin document of the template a supplemental (addendum / disclosure) in a
   * live group was copied from, resolved by its document name.
   *
   * Returns '' when the name matches no configured template — the caller then
   * simply skips the restore, exactly as it did before this existed.
   */
  private async resolveSupplementalOriginDocumentId(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documentName: string,
  ): Promise<string> {
    const match = await resolveSignNowSupplementalTemplateByDocumentName(documentName);
    const templateId = String(match?.templateId || '').trim();
    if (!templateId) {
      console.info('[SignNow] no template matched supplemental document name', {
        documentName,
      });
      return '';
    }
    const cached = addendumOriginIdCache.get(templateId);
    if (cached) return cached;
    try {
      const origin =
        (await this.resolveGroupTemplateOriginDocumentId(client, templateId)) ||
        templateId;
      addendumOriginIdCache.set(templateId, origin);
      return origin;
    } catch (err) {
      console.warn('[SignNow] could not resolve supplemental origin document', {
        documentName,
        templateId,
        error: err instanceof Error ? err.message : String(err),
      });
      return '';
    }
  }

  async createContractFromGroupTemplate(
    userId: string,
    options: {
      roles: SignerRoleInput[];
      prefillFields?: PrefillField[];
      applicationId?: string;
      contractId?: number;
      ccEmails?: string[];
      title?: string;
      autoSend?: boolean;
      returnUrl?: string;
      skipApplicationEnvelopeLink?: boolean;
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
      supplementalDocumentRefs?: string[];
      funderName?: string | null;
      funderProfileId?: string | null;
      timingRequestId?: string;
      /**
       * Live "$25 wire fee" preference from the contract modal. It is a deal-level
       * toggle rather than a document field, so it cannot ride along in
       * `prefillFields`; without it the money re-sync below reads the contract row,
       * which still says "on" until the prefill editor has been saved, and the fee
       * is silently re-added to TOTAL FEES and NET AMOUNT on every document.
       */
      includeWireFee?: unknown;
      /** Copy/attach the document group only — no prefill, invite, or review URL. */
      structureOnly?: boolean;
    },
  ): Promise<{
    success: boolean;
    provider: string;
    documentId: string;
    envelopeId: string;
    sendUrl: string | null;
    embeddedEditorUrl: string | null;
    embeddedInviteUrl: string | null;
    message: string;
    data: Record<string, unknown>;
  }> {
    if (!getSignNowTiming()) {
      const requestId = String(options.timingRequestId || '').trim() || randomUUID();
      const ctx = createSignNowTimingContext(requestId);
      return runWithSignNowTiming(ctx, async () => {
        logSignNowTiming('request-start', 0);
        let failed = false;
        try {
          return await this.createContractFromGroupTemplate(userId, options);
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          const timing = getSignNowTiming();
          if (timing) {
            logSignNowTiming('total-backend', Date.now() - timing.startedAt, {
              signNowApiCalls: timing.signNowApiCalls,
              databaseQueries: timing.databaseQueries,
              retries: timing.retries,
              pollingAttempts: timing.pollingAttempts,
              draftReuseSkipped: timing.draftReuseSkipped,
              draftReuseSkipReason: timing.draftReuseSkipReason,
              disclosureEnabled: timing.disclosureEnabled,
              monthlyFeeEnabled: timing.monthlyFeeEnabled,
              documentCount: timing.documentCount,
              failed,
            });
          }
        }
      });
    }
    if (!this.isEnabled()) {
      throw new BadRequestException('SignNow is not configured');
    }
    const structureOnly = options.structureOnly === true;
    const signers = orderedSigners(options.roles || []);
    if (!structureOnly && !signers.length) {
      throw new BadRequestException('At least one signer with an email is required');
    }

    const includeMainContract = options.sendPackage?.includeMainContract !== false;
    const funderProfileId = String(options.funderProfileId || '').trim();
    // The OAuth/token handshake and the funder read touch different systems —
    // start both before awaiting either.
    const [client, funderRow] = await Promise.all([
      createSignNowApiClient(),
      funderProfileId
        ? measureSignNowStep('funder-profile-query', undefined, async () => {
            countSignNowDb();
            return prisma.funderProfile.findUnique({
              where: { id: funderProfileId },
              select: {
                id: true,
                name: true,
                signnowContractTemplateLink: true,
                signnowAddendumTemplates: true,
                signnowDisclosureTemplates: true,
              },
            });
          })
        : Promise.resolve(null),
    ]);
    /**
     * The group name is what SignNow prints at the top of every signer's view.
     * It used to be built from the payload alone, and the pre-warm posts that
     * before the CRM has loaded, so every funder's package came out named after
     * the first signer with a zero amount ("Obsidian Capital Group MARY IRVIN
     * 0.00"). It now resolves exactly like the invite subject — the business and
     * the live offer from the CRM — so the header matches the email.
     */
    const appIdForName = String(options.applicationId || '').trim();
    const groupName = appIdForName
      ? await this.resolveInviteEmailSubject({
          title: options.title,
          applicationId: appIdForName,
          prefillFields: options.prefillFields,
          funderName: funderRow?.name || options.funderName,
        })
      : ensureSubjectAmountHasDollarSign(String(options.title || '').trim()) ||
        (() => {
          const fromPrefill = extractContractEmailContextFromPrefill(options.prefillFields);
          return buildContractEnvelopeEmailSubject(
            fromPrefill.businessName || 'Contract',
            fromPrefill.offerAmount,
            funderRow?.name || options.funderName || fromPrefill.funderName,
          );
        })();
    const funderContractTemplateId = extractSignNowTemplateId(
      funderRow?.signnowContractTemplateLink,
    );
    const resolvedContractTemplateId =
      funderContractTemplateId || SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID;
    if (!resolvedContractTemplateId) {
      throw new BadRequestException(
        'Could not load the SignNow agreement. Check SignNow credentials on the server.',
      );
    }
    const supplementals = resolveSignNowAddendaFromRefs(
      options.supplementalDocumentRefs,
      funderRow,
    );
    // Addenda in the request refs always attach. The disclosure checkbox is the
    // only sendPackage flag that should drop a resolved supplemental.
    const selected = supplementals.filter((row) => {
      if (row.type === 'disclosure') {
        return options.sendPackage?.includeDisclosure !== false;
      }
      return true;
    });
    // Create Contract defaults to including the state disclosure. If the funder
    // has no Settings disclosure row, still attach the platform template.
    if (
      options.sendPackage?.includeDisclosure !== false &&
      !selected.some((row) => row.type === 'disclosure')
    ) {
      const platformDisclosure = getSignNowDisclosureTemplates()[0];
      if (platformDisclosure) {
        selected.push(platformDisclosure);
        console.info('[SignNow] attaching platform state disclosure', {
          layoutKey: platformDisclosure.layoutKey,
          templateId: platformDisclosure.templateId,
        });
      }
    }
    // Disclosure → Contract → Addendums. Sorting here (not at attach time) keeps
    // the package fingerprint, the copy order, and the live group order aligned.
    const toAttach = sortSignNowSupplementalsForPackage(selected);
    console.info('[SignNow] package extras', {
      refs: options.supplementalDocumentRefs || [],
      sendPackage: options.sendPackage || null,
      resolved: toAttach.map((row) => ({
        name: row.name,
        type: row.type,
        layoutKey: row.layoutKey,
        templateId: row.templateId,
      })),
    });

    const appId = String(options.applicationId || '').trim();
    const wantsMonthlyFee = toAttach.some((row) => row.layoutKey === 'monthly_fee');
    const wantsDisclosure = toAttach.some((row) => row.type === 'disclosure');
    const packageFingerprint = buildSignNowPackageFingerprint({
      includeMainContract,
      contractTemplateId: resolvedContractTemplateId,
      extraTemplateIds: toAttach.map((row) => row.templateId),
    });
    const timing = getSignNowTiming();
    if (timing) {
      timing.disclosureEnabled = wantsDisclosure;
      timing.monthlyFeeEnabled = wantsMonthlyFee;
    }

    // Built before the group is ensured: reuse of an existing draft group is
    // gated on these values, not just on the package structure.
    const values = prefillRecord(options.prefillFields);
    if (options.applicationId && !values.application_id) {
      values.application_id = options.applicationId;
      values.case_id = options.applicationId;
    }
    // The offer is what defines the deal, so its amounts are layered OVER the payload:
    // the CRM screen can still post values it cached against a superseded offer, which
    // is how the ACH addendums kept carrying old amounts while the recalculated
    // disclosure showed the new ones. Both now follow the same source.
    /**
     * The CRM screen's payload is a snapshot of whatever that screen had loaded,
     * and it is the only thing Review used to publish. Every document but Exhibit C
     * hid a thin payload, because a document that is not an isolated Exhibit C copy
     * merges what is already on its widgets; the Exhibit C copies, which do not,
     * were left with the bare agreement date. Reading the contract's own stored
     * values underneath the payload is what `sendEnvelope` and the merchant publish
     * already do — Review now agrees with them, so an addendum cannot go out empty
     * just because the screen posted less than the deal holds.
     */
    const payloadKeyCount = Object.keys(values).length;
    if (appId || options.contractId) {
      const { defaults } = await this.loadContractPrefillDefaults(
        '',
        appId,
        Number(options.contractId) || undefined,
      );
      layerContractPrefillDefaults(values, defaults);
    }
    const liveOffer = await loadOfferDerivedValuesForContract({
      contractId: options.contractId,
      applicationId: options.applicationId,
    });
    // The request's own wire-fee preference is newer than the contract row it was
    // saved onto, so it wins whenever the screen sends one.
    const offerSource = withRequestWireFeePreference(liveOffer, options.includeWireFee);
    Object.assign(values, buildOfferPrefillOverrides(offerSource, values));
    // Send and the portal publish bake from the contract row, so the review's
    // wire-fee choice has to live there too or they print TOTAL FEES $25 apart.
    await persistIncludeWireFeePreference(
      { contractId: options.contractId, applicationId: options.applicationId },
      options.includeWireFee,
    );
    /**
     * Both reads above swallow their own failures and return nothing, so a
     * package could go out carrying only what the field resolver invents from an
     * empty map (the agreement date, `OWNER`, `0.00`) with nothing in the log to
     * say so — which is what an "everything is blank in Review" report looks
     * like from the server side. Say it plainly instead.
     */
    if (Object.keys(values).length <= payloadKeyCount) {
      console.warn('[SignNow] no CRM prefill values resolved for this package', {
        applicationId: appId || null,
        contractId: options.contractId ?? null,
        payloadFields: options.prefillFields?.length ?? 0,
        liveOffer: Boolean(liveOffer?.values),
      });
    }
    applyMerchantSignerPrefill(values, signers);
    const prefillFingerprint = buildSignNowPrefillFingerprint({
      packageFingerprint,
      values,
    });

    const contractIdNum = Number(options.contractId);
    // Exhibit C mapping rows survive on the contract after a workflow that no
    // longer attaches Exhibit C. Only spread them into entity slots when this
    // package really has one, so yesterday's Exhibit C bank/holder values
    // cannot seed today's documents. The read itself is unconditional: every
    // other addendum's own prefill tab lives in the same blob, and skipping the
    // read is what left the Flex / PayOff / Exhibit A tabs unread on any
    // package that happened not to carry an Exhibit C.
    const packageHasExhibitC = toAttach.some((row) =>
      isExhibitCAddendumRow({
        layoutKey: row.layoutKey,
        name: row.name,
        templateId: row.templateId,
      }),
    );
    // Started here, awaited after the group is ready: this CRM read needs
    // nothing from SignNow, so it should not sit behind the group copy.
    //
    // The CRM's background pre-warm posts no contract id and no prefill fields,
    // so this read used to be skipped for it: the warm then had no Exhibit C
    // entities and seeded `Exhibit C (2)` with the package values (the Monthly
    // Fee holder, the first bank), which is what Review showed. Resolve the
    // contract from the application instead, as the send path already does.
    const contractPrefillReadPromise =
      (Number.isFinite(contractIdNum) && contractIdNum > 0) || appId
        ? measureSignNowStep(
            'contract-mapping-query',
            { contractId: contractIdNum || null, applicationId: appId || null },
            async () => {
              countSignNowDb();
              const contractId =
                Number.isFinite(contractIdNum) && contractIdNum > 0
                  ? contractIdNum
                  : (
                      await prisma.contract.findFirst({
                        where: { applicationId: appId },
                        orderBy: { updatedAt: 'desc' },
                        select: { id: true },
                      })
                    )?.id;
              if (!contractId) return [null, []] as const;
              return Promise.all([
                prisma.contract.findUnique({
                  where: { id: contractId },
                  select: { contractPrefillOverrides: true },
                }),
                (prisma as any).contractDocumentTemplateMapping.findMany({
                  where: { contractId },
                  include: { template: true },
                  orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
                }),
              ]);
            },
          )
        : null;

    const ensured = await measureSignNowStep(
      'ensure-review-group',
      { extras: toAttach.length, includeMainContract },
      () => this.ensureReviewDocumentGroup(client, {
      appId,
      groupName,
      includeMainContract,
      resolvedContractTemplateId,
      toAttach,
      funderProfileId: funderRow?.id || null,
      funderName: funderRow?.name || options.funderName || null,
      packageFingerprint,
      prefillFingerprint,
      allowReuse: options.autoSend !== true,
      }),
    );
    let groupId = ensured.groupId;
    let documents = ensured.documents;
    const reusedExisting = ensured.reusedExisting;
    // Claimed before any other await, so a warm still on its way to the write
    // lock for this group cannot seed it over this request's values.
    if (!structureOnly) claimSignNowGroupForReview(groupId);

    let storedExhibitCEntities: unknown;
    let exhibitCMappingEntities: ExhibitCEntityPrefillRow[] = [];
    let documentTabValues: SignNowDocumentTabValues[] = [];
    if (contractPrefillReadPromise) {
      const [contractRow, mappingRows] = await contractPrefillReadPromise;
      const overrides = contractRow?.contractPrefillOverrides;
      storedExhibitCEntities = storedExhibitCEntitiesRaw(overrides);
      documentTabValues = buildSignNowDocumentTabValues(mappingRows, overrides);
      if (packageHasExhibitC) {
        const blob = parseDocumentTemplatePrefillBlob(overrides);
        const exhibitMappings = (Array.isArray(mappingRows) ? mappingRows : []).filter(
          (row: { template?: { layoutKey?: string | null; name?: string | null } | null }) =>
            isExhibitCAddendumRow({
              layoutKey: row.template?.layoutKey,
              name: row.template?.name,
            }),
        );
        exhibitCMappingEntities = exhibitMappings.map(
          (row: { id?: string }) => entityFromExhibitCTabs(blob[String(row.id || '')] ?? {}),
        );
      }
    }
    const exhibitCEntities = resolveExhibitCEntities({
      storedEntitiesRaw: storedExhibitCEntities,
      mappingEntities: exhibitCMappingEntities,
      payloadEntitiesRaw: values[EXHIBIT_C_ENTITIES_PREFILL_KEY],
    });

    if (!groupId || !documents.length) {
      throw new BadRequestException(
        'SignNow did not return a contract group to review. Try Review in SignNow again.',
      );
    }

    if (timing) timing.documentCount = documents.length;
    const skipMainLink =
      options.skipApplicationEnvelopeLink === true || !includeMainContract;
    const runCrmPersist = async () => {
      if (!appId) return;
      countSignNowDb();
      if (skipMainLink) {
        await linkStandalonePackageEnvelopeToContract(
          appId,
          groupId,
          options.autoSend === true ? 'sent' : 'draft',
          Number.isFinite(contractIdNum) && contractIdNum > 0 ? contractIdNum : undefined,
          {
            includeMainContract: false,
            includeAddendum: Boolean(
              options.sendPackage?.includeAddendum ??
                toAttach.some((row) => row.type !== 'disclosure'),
            ),
            includeDisclosure: Boolean(
              options.sendPackage?.includeDisclosure ??
                toAttach.some((row) => row.type === 'disclosure'),
            ),
          },
        );
        return;
      }
      await Promise.all([
        this.linkGroupToApplication(userId, appId, groupId, prefillFingerprint),
        persistMainContractSendPackage(
          appId,
          groupId,
          options.sendPackage ?? { includeMainContract: true },
          Number.isFinite(contractIdNum) && contractIdNum > 0 ? contractIdNum : undefined,
          {
            funderName: options.funderName,
            funderProfileId: options.funderProfileId,
          },
        ),
      ]);
    };

    if (structureOnly) {
      /**
       * Park the warmed group for the Review click to adopt, and nothing more:
       * no send-package row, no workflow transition. Awaited rather than
       * deferred because a pre-warm is a background request whose latency
       * nobody is waiting on, and Review finds this group through this row —
       * deferring the write leaves a window where Review sees no group and
       * copies a second one against SignNow's daily limit.
       */
      if (appId && !skipMainLink) {
        /**
         * Never let a warm overwrite a live document. The link upsert clears
         * `sentAt`/`completedAt`/`signedPdfUrl` to open a fresh draft, which is
         * right when the user clicked Review and wrong when a background warm
         * fires against a contract that is already out for signature or signed.
         * Warming still helps those cases — the group stays in the in-process
         * draft cache — it just does not touch CRM state.
         */
        const liveDoc = await prisma.document
          .findUnique({
            where: { applicationId: appId },
            select: { status: true, envelopeId: true, prefillFingerprint: true },
          })
          .catch(() => null);
        /**
         * Nor a draft whose Owner review is already finished: relinking would
         * swap the reviewed package for an empty warm copy, and the CRM would
         * drop from "Send via SignNow" back to "Review in SignNow".
         */
        const liveReview = liveDoc?.envelopeId
          ? await readSignNowReviewSession(liveDoc.envelopeId).catch(() => null)
          : null;
        const reviewFinished = Boolean(liveReview?.completedAt);
        const linkDecision = resolveSignNowPrewarmLink({
          live: liveDoc,
          warmGroupId: groupId,
          reviewFinished,
        });
        if (linkDecision.link) {
          // Compare-and-set against what was just read: a Review that adopted
          // this group between the read and the write has already stored the
          // real fingerprint, and the warm must not replace it with pristine.
          await this.linkGroupToApplication(
            userId,
            appId,
            groupId,
            SIGNNOW_PRISTINE_PREFILL_FINGERPRINT,
            {
              skipWorkflowSync: true,
              onlyIfUnchangedFrom: liveDoc
                ? {
                    envelopeId: liveDoc.envelopeId,
                    prefillFingerprint: liveDoc.prefillFingerprint ?? null,
                  }
                : 'absent',
            },
          ).catch((err) => {
            console.warn(
              '[SignNow] pre-warm group link failed',
              err instanceof Error ? err.message : String(err),
            );
          });
        } else {
          console.info('[SignNow] pre-warm not linked', {
            applicationId: appId,
            status: String(liveDoc?.status || '').toLowerCase(),
            reason: linkDecision.reason,
          });
        }
      }
      const rolesReady =
        ensured.ownerRolesPrepared ||
        (await this.withSignNowGroupWriteLock(groupId, () =>
          // Checked inside the lock: a Review that adopted this group meanwhile
          // has written (or is queued to write) the live values, and seeding
          // now would put back the contract row's wire fee over them.
          isSignNowGroupClaimedByReview(groupId)
            ? Promise.resolve(false)
            : this.prepareOwnerReviewFieldRoles(
            client,
            documents,
            appId,
            groupId,
            packageFingerprint,
            /**
             * The warm writes the deal, not just the roles. It already holds the
             * full server-side map — the contract's own values under the live
             * offer — and used to throw it away and prefill with `{}`, which
             * writes only what the resolver can invent with no inputs at all:
             * the agreement date, `OWNER`, `0.00`. A package that was warmed and
             * then reviewed therefore opened with the contract and every
             * addendum blank whenever Review's own prefill did not land on top
             * (a thin screen payload, a Review request that never reached the
             * server, a reused warm). Seeding the warm with the same values
             * Review would publish makes the documents carry the deal from the
             * moment they are copied, on every funder.
             */
            values,
            documentTabValues,
            exhibitCEntities,
          ),
        ));
      logSignNowTiming('structure-only-ready', 0, {
        reusedDraft: reusedExisting,
        ownerRolesPrepared: rolesReady,
        fingerprint: packageFingerprint,
      });
      return {
        success: true,
        provider: 'signnow',
        documentId: groupId,
        envelopeId: groupId,
        sendUrl: null,
        embeddedEditorUrl: null,
        embeddedInviteUrl: null,
        message: 'SignNow draft group prepared.',
        data: {
          prefillFieldCount: 0,
          prefillTabsApplied: 0,
          prefillTabsAttempted: 0,
          envelopeStatus: 'created',
          autoSend: false,
          structureOnly: true,
          reusedDraft: reusedExisting,
          ownerRolesPrepared: rolesReady,
          nextStep: 'Review will prefill this prepared group and open SignNow.',
        },
      };
    }

    // Reused drafts often already have an Owner embedded invite. SignNow then
    // rejects prefill with "Document has been already sent to a signer".
    if (reusedExisting) {
      const cleanupStarted = Date.now();
      try {
        await this.deleteEmbeddedInvites(client, groupId, documents);
        const alreadyHydrated = documents.every((d) => Boolean(d.remote));
        const hydrated = alreadyHydrated
          ? documents
          : await this.hydrateDocumentRoles(client, documents, { skipIfHydrated: true });
        documents = hydrated;
        await this.cancelPendingFieldInvites(client, hydrated);
        logSignNowTiming('reused-draft-invite-cleanup', Date.now() - cleanupStarted, {
          documents: documents.length,
        });
        console.info('[SignNow] cleared prior review invites before re-prefill', {
          groupId,
          documents: documents.length,
        });
      } catch (err) {
        console.warn(
          '[SignNow] could not clear prior invites before prefill',
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    const autoSend = options.autoSend === true;
    let envelopeStatus: 'created' | 'sent' = 'created';
    let sendUrl: string | null = null;
    let applied = 0;
    let attempted = 0;
    if (autoSend) {
      const [prefillStats] = await Promise.all([
        this.withSignNowGroupWriteLock(groupId, () =>
          this.prefillDocumentsForReview(
            client,
            documents,
            values,
            signers,
            exhibitCEntities,
            documentTabValues,
          ),
        ),
        runCrmPersist(),
      ]);
      applied = prefillStats.applied;
      attempted = prefillStats.attempted;
      console.info('[SignNow] prefill summary', {
        groupId,
        crmPrefillKeys: Object.keys(values).length,
        applied,
        attempted,
      });
      await this.sendEmailGroupInviteOnce(client, groupId, documents, signers, groupName, {
        applicationId: appId || undefined,
        ccEmails: options.ccEmails,
      });
      envelopeStatus = 'sent';
      if (appId && !skipMainLink) {
        await this.markGroupSent(appId, groupId);
      }
    } else {
      // Prefill agreement + addenda + disclosures BEFORE minting the review link.
      // Once an embedded invite exists, SignNow rejects edits with
      // "Document has been already sent to a signer" — which left addenda empty.
      this.scheduleCrmPersist(runCrmPersist);
      const prefillStats = await measureSignNowStep(
        'prefill-documents-total',
        { documents: documents.length },
        () =>
          this.withSignNowGroupWriteLock(groupId, () =>
            this.prefillDocumentsForReview(
              client,
              documents,
              values,
              signers,
              exhibitCEntities,
              documentTabValues,
            ),
          ),
      );
      applied = prefillStats.applied;
      attempted = prefillStats.attempted;
      /**
       * Nothing opens until the documents are read back complete. A write that
       * returned 200 is not proof: a copy planned from a snapshot taken before
       * SignNow attached all of its widgets leaves those widgets blank, and that
       * is the first-click Review with empty Disclosure / Contract / Addendum
       * fields that a second click then filled. Throws — so no link is minted —
       * when the package still is not complete after the retries.
       */
      const verified = await measureSignNowStep(
        'review-prefill-verify',
        { documents: prefillStats.outcomes.length },
        () =>
          this.withSignNowGroupWriteLock(groupId, () =>
            this.ensureReviewPrefillComplete(client, groupId, prefillStats.outcomes, {
              // A reused draft can legitimately hold a field-less document: a
              // merchant publish bakes a document's values into page text.
              requireFields: !reusedExisting,
            }),
          ),
      );
      /**
       * The values are on the documents now, so the row must say so before the
       * user can reach Send. The deferred persist above also writes this, but it
       * is fire-and-forget: if it lagged or failed, a group adopted from a warm
       * kept the pristine marker and Send refused a fully prefilled package.
       */
      if (appId && !skipMainLink) {
        await prisma.document
          .updateMany({
            where: { applicationId: appId, envelopeId: groupId },
            data: { prefillFingerprint },
          })
          .catch((err) =>
            console.warn(
              '[SignNow] could not record prefill fingerprint before review',
              err instanceof Error ? err.message : String(err),
            ),
          );
        countSignNowDb();
      }
      const embedded = await measureSignNowStep(
        'review-url-generation',
        { groupId },
        () =>
          this.getSenderViewUrl(groupId, {
        returnUrl: options.returnUrl,
        documentId: this.pickEditorDocumentId(documents),
            roles: options.roles,
            client,
            documents,
          }),
      );
      sendUrl = embedded.url;
      console.info('[SignNow] prefill summary', {
        groupId,
        reusedDraft: reusedExisting,
        crmPrefillKeys: Object.keys(values).length,
        applied,
        attempted,
        documentsPrefillBeforeMint: documents.length,
        verifyRounds: verified.rounds,
        documentsRepaired: verified.repaired,
      });
    }

    return {
      success: true,
      provider: 'signnow',
      documentId: groupId,
      envelopeId: groupId,
      sendUrl,
      embeddedEditorUrl: sendUrl,
      embeddedInviteUrl: sendUrl,
      message:
        envelopeStatus === 'sent'
          ? 'Contract sent via SignNow; signing email delivered to the signer.'
          : 'Contract created in SignNow.',
      data: {
        prefillFieldCount: options.prefillFields?.length ?? 0,
        prefillTabsApplied: applied,
        prefillTabsAttempted: attempted,
        prefillVerified: !autoSend,
        envelopeStatus,
        autoSend,
        envelopeSigners: signers.map((s) => ({
          roleName: s.roleName,
          email: s.email,
          name: s.name,
        })),
        nextStep:
          envelopeStatus === 'sent'
            ? 'Signers were emailed by SignNow. Stay in the CRM — no SignNow login is required.'
            : 'Review the prefilled contract in SignNow, then click Finish.',
      },
    };
  }

  /**
   * Mint a short-lived document-group embedded-invite URL for the CRM Review iframe.
   * Same path as katan-clone: POST /v2/document-groups/{id}/embedded-invites then /link.
   */
  async getSenderViewUrl(
    groupId: string,
    returnUrlOrOptions?:
      | string
      | {
          returnUrl?: string;
          documentId?: string;
          roles?: SignerRoleInput[];
          client?: Awaited<ReturnType<typeof createSignNowApiClient>>;
          documents?: SignNowDocumentRef[];
        },
  ): Promise<{
    url: string;
    embeddedEditorUrl: string;
    embeddedInviteUrl: string;
    editorDocumentId: string;
  }> {
    const options =
      typeof returnUrlOrOptions === 'string'
        ? { returnUrl: returnUrlOrOptions }
        : returnUrlOrOptions || {};
    const id = String(groupId || '').trim();
    if (!id) throw new BadRequestException('Missing SignNow document group id');
    const client = options.client || (await createSignNowApiClient());
    const documentId =
      String(options.documentId || '').trim() ||
      this.pickEditorDocumentId(options.documents || []) ||
      (await this.resolveGroupDocumentId(client, id));
    if (!documentId) {
      throw new BadRequestException('SignNow group has no document for embedded signing');
    }
    const redirect = this.resolveEmbeddedCompleteUrl(options.returnUrl, id);
    const reviewStartedAt = new Date();
    const url = await this.mintEmbeddedSigningLink(client, {
      documentId,
      groupId: id,
      redirect,
      roles: options.roles,
      documents: options.documents,
    });
    // Every mint opens a fresh Owner review: a Finish from an earlier link on a
    // reused group must not count, and the CRM reads this row back after a
    // refresh or a lost tab instead of trusting browser memory.
    await recordSignNowReviewStarted(id, reviewStartedAt).catch((err) =>
      console.warn(`[SignNow] could not record review start for ${id}:`, err),
    );
    try {
      const parsed = new URL(url);
      console.info('[SignNow] minted embedded-invite review link', {
        host: parsed.host,
        path: parsed.pathname,
        hasQuery: Boolean(parsed.search),
        documentId,
      });
    } catch {
      /* ignore */
    }
    return { url, embeddedEditorUrl: url, embeddedInviteUrl: url, editorDocumentId: documentId };
  }

  private resolveEmbeddedCompleteUrl(returnUrl?: string, groupId?: string): string {
    const candidates = [
      String(returnUrl || '').trim(),
      `${String(process.env.FRONTEND_URL || '').trim().replace(/\/$/, '')}/embedded-complete`,
    ];
    for (const url of candidates) {
      // The review runs in its own top-level tab now, not a SignNow iframe, so a
      // localhost CRM is reachable: the browser, not SignNow, follows the
      // redirect. Skipping it there is what left local testing with no Finish
      // signal at all. An env-configured private URL is still skipped.
      if (!url || !/^https?:\/\//i.test(url)) continue;
      if (url !== candidates[0] && isPrivateNetworkUrl(url)) continue;
      // The completion page confirms the Finish with the backend on its own, so
      // it survives a CRM tab that was refreshed or closed during the review.
      const id = String(groupId || '').trim();
      if (!id) return url;
      try {
        const parsed = new URL(url);
        parsed.searchParams.set('envelopeId', id);
        return parsed.toString();
      } catch {
        return url;
      }
    }
    console.info('[SignNow] omitting Finish redirect (localhost is blocked inside the SignNow iframe)');
    return '';
  }

  private extractEmbeddedLink(payload: unknown): string {
    const root = payload as Record<string, unknown> | null;
    const data = (root?.data ?? root) as Record<string, unknown> | null;
    const nested = (data?.data ?? null) as Record<string, unknown> | null;
    return String(
      data?.link ||
        data?.url ||
        nested?.link ||
        nested?.url ||
        (root as { link?: string } | null)?.link ||
        (root as { url?: string } | null)?.url ||
        '',
    ).trim();
  }

  private signNowErrorDetail(res: { status: number; data?: any }): string {
    const data = res.data;
    const first = data?.errors?.[0];
    const nested =
      (typeof first === 'string' ? first : first?.message) ||
      data?.error ||
      data?.message ||
      '';
    const asText =
      typeof nested === 'string' ? nested : JSON.stringify(nested || {});
    if (asText && asText !== '{}' && asText !== 'null') {
      return asText.slice(0, 500);
    }
    return JSON.stringify(data || {}).slice(0, 320) || `HTTP ${res.status}`;
  }

  private async resolveGroupDocumentId(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
  ): Promise<string> {
    const groupRes = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
    const documents = this.normalizeGroupDocuments(groupRes.data?.documents);
    return this.pickEditorDocumentId(documents);
  }

  private pickEditorDocumentId(documents: SignNowDocumentRef[]): string {
    const agreement = documents.find((d) =>
      /agreement/i.test(String(d.document_name || d.name || '')),
    );
    return String(agreement?.id || documents[0]?.id || '').trim();
  }

  private splitReviewPrefillDocuments(documents: SignNowDocumentRef[]): {
    main: SignNowDocumentRef[];
    extras: SignNowDocumentRef[];
  } {
    const editorId = this.pickEditorDocumentId(documents);
    const main = documents.filter((d) => d.id === editorId);
    const extras = documents.filter((d) => d.id !== editorId);
    return {
      main: main.length ? main : documents.slice(0, 1),
      extras: main.length ? extras : documents.slice(1),
    };
  }

  private splitPersonName(fullName: string, email: string): { first_name: string; last_name: string } {
    const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
    const fallback = email.split('@')[0] || 'Signer';
    const first_name = parts[0] || fallback;
    const last_name = parts.slice(1).join(' ') || first_name;
    return { first_name, last_name };
  }

  private extractEmbeddedInviteId(payload: unknown): string {
    const root = payload as Record<string, unknown> | null;
    const data = (root?.data ?? root) as Record<string, unknown> | unknown[] | null;
    if (Array.isArray(data)) {
      return String((data[0] as { id?: string } | undefined)?.id || '').trim();
    }
    if (data && typeof data === 'object') {
      const id = String(
        (data as { id?: string; unique_id?: string }).id ||
          (data as { unique_id?: string }).unique_id ||
          '',
      ).trim();
      if (id) return id;
      const invites = (data as { invites?: Array<{ id?: string }> }).invites;
      if (Array.isArray(invites) && invites[0]?.id) return String(invites[0].id).trim();
    }
    return String((root as { id?: string } | null)?.id || '').trim();
  }

  private async mintEmbeddedSigningLink(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    options: {
      documentId: string;
      groupId: string;
      redirect: string;
      roles?: SignerRoleInput[];
      documents?: SignNowDocumentRef[];
    },
  ): Promise<string> {
    const groupUrl = await this.mintGroupEmbeddedInviteLink(client, options);
    if (groupUrl) return groupUrl;

    throw new BadRequestException(
      'Could not mint a SignNow review link. SignNow still reports a missing role on one of the attached documents. Click Review in SignNow again after the package finishes loading.',
    );
  }

  private async mintDocumentEmbeddedInviteLink(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    options: {
      documentId: string;
      redirect: string;
      roles?: SignerRoleInput[];
    },
  ): Promise<string> {
    const docRes = await client.get(`/document/${options.documentId}`, { validateStatus: () => true });
    if (docRes.status >= 400) {
      console.warn('[SignNow] document get failed', this.signNowErrorDetail(docRes));
      return '';
    }
    const templateRoles = Array.isArray(docRes.data?.roles) ? docRes.data.roles : [];
    const crmSigners = orderedSigners(options.roles || []);
    const roleNames = uniqueRoleNames(
      templateRoles.map((r: any) => String(r?.name || r?.role || r?.role_name || '').trim()),
    );
    const inviteSigners = fillSignersForTemplateRoles(roleNames, crmSigners, {
      includeSameEmailOwner2: true,
    });
    if (!inviteSigners.length) return '';
    const nitroStyle = usesNitroApproverRoles(roleNames);
    const embedSigners = inviteSigners;

    const buildInvites = (source: typeof embedSigners) =>
      templateRoles
        .map((role: any, idx: number) => {
          const roleName = String(role?.name || role?.role || role?.role_name || '').trim();
          const roleId = String(role?.unique_id || role?.id || role?.role_id || '').trim();
          if (!roleId) return null;
          if (
            source !== inviteSigners &&
            !source.some((s) => s.roleName.toLowerCase() === roleName.toLowerCase())
          ) {
            return null;
          }
          const signer =
            source.find((s) => s.roleName.toLowerCase() === roleName.toLowerCase()) || source[0];
          const { first_name, last_name } = this.splitPersonName(signer.name, signer.email);
          const row: Record<string, unknown> = {
            email: signer.email,
            role_id: roleId,
            order: Number(role?.signing_order || idx + 1) || idx + 1,
            auth_method: 'none',
            first_name,
            last_name,
          };
          if (options.redirect) {
            row.redirect_uri = options.redirect;
            row.decline_redirect_uri = options.redirect;
            row.redirect_target = 'self';
          }
          return row;
        })
        .filter(Boolean) as Record<string, unknown>[];

    let invites = buildInvites(embedSigners);
    if (!invites.length) return '';

    await client.delete(`/v2/documents/${options.documentId}/embedded-invites`, {
      validateStatus: () => true,
    });
    let createRes = await client.post(
      `/v2/documents/${options.documentId}/embedded-invites`,
      { invites },
      { validateStatus: () => true },
    );
    if (createRes.status >= 400 && embedSigners !== inviteSigners) {
      console.warn(
        '[SignNow] Owner-only document embedded-invite failed; retrying with all roles',
        this.signNowErrorDetail(createRes),
      );
      invites = buildInvites(inviteSigners);
      if (invites.length) {
        await client.delete(`/v2/documents/${options.documentId}/embedded-invites`, {
          validateStatus: () => true,
        });
        createRes = await client.post(
          `/v2/documents/${options.documentId}/embedded-invites`,
          { invites },
          { validateStatus: () => true },
        );
      }
    }
    let inviteId = this.extractEmbeddedInviteId(createRes.data);
    if (createRes.status >= 400 || !inviteId) {
      const existing = await client.get(`/v2/documents/${options.documentId}/embedded-invites`, {
        validateStatus: () => true,
      });
      inviteId = this.extractEmbeddedInviteId(existing.data);
    }
    if (!inviteId) {
      console.warn('[SignNow] document embedded-invite create failed', this.signNowErrorDetail(createRes));
      return '';
    }

    const emails = uniqueEmails([
      String(process.env.SIGNNOW_USERNAME || ''),
      inviteSigners.find((s) => s.preparer)?.email || '',
      inviteSigners[0]?.email || '',
    ]);
    const linkBodies: Array<Record<string, unknown>> = [
      { auth_method: 'none', link_expiration: 45 },
      ...emails.map((email) => ({
        email,
        auth_method: 'none',
        link_expiration: 45,
      })),
    ];
    for (const body of linkBodies) {
      const linkRes = await client.post(
        `/v2/documents/${options.documentId}/embedded-invites/${inviteId}/link`,
        body,
        { validateStatus: () => true },
      );
      const url = this.extractEmbeddedLink(linkRes.data);
      if (linkRes.status < 400 && url) return url;
      console.warn('[SignNow] document embedded-invite link failed', this.signNowErrorDetail(linkRes));
    }
    return '';
  }

  private async mintGroupEmbeddedInviteLink(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    options: {
      documentId: string;
      groupId: string;
      redirect: string;
      roles?: SignerRoleInput[];
      documents?: SignNowDocumentRef[];
      /**
       * Create the embedded invite but mint no link (returns ''). The portal
       * send wants the invite only: a link minted here is never opened, and
       * SignNow flags its signer "Invite Expired" once its 45 minutes pass.
       */
      inviteOnly?: boolean;
    },
  ): Promise<string> {
    let inviteRedirect = String(options.redirect || '').trim();
    let documents = (options.documents || []).filter((d) => String(d.id || '').trim());
    if (!documents.length) {
      const groupRes = await client.get(`/documentgroup/${options.groupId}`, {
        validateStatus: () => true,
      });
      documents = this.normalizeGroupDocuments(groupRes.data?.documents);
    }
    // Group listings often carry incomplete/wrong role unions. Only skip a GET when
    // we already hydrated from /document/{id} (listedRoles / remainingRoles / remote).
    // `requireFields` keeps the wait going while a freshly copied document is
    // readable but still has no widgets: posting the invite in that window is
    // what SignNow rejects with "must contain fields".
    documents = await this.waitForDocumentsReady(client, documents, 6, {
      requireFields: true,
    });
    /**
     * Only when NOTHING in the group has fields is the package itself broken —
     * a single field-less document is normal once a merchant publish has baked
     * that document's values into page text, and SignNow's rule is group-wide.
     */
    if (documents.length && documents.every((d) => !(d.fieldCount ?? 0))) {
      console.warn('[SignNow] no document in the group carries fields — restoring from templates', {
        groupId: options.groupId,
        documents: documents.length,
      });
      documents = await this.restoreFieldsFromOriginTemplate(client, documents);
    }
    const missingRoles = documents.filter(
      (d) => !(d.roles || []).length && !(d.listedRoles || []).length && !d.remote,
    );
    if (missingRoles.length) {
      const hydrated = await this.hydrateDocumentRoles(client, missingRoles, {
        skipIfHydrated: true,
      });
      const byId = new Map(hydrated.map((d) => [d.id, d]));
      documents = documents.map((d) => byId.get(d.id) || d);
    }
    const documentId = options.documentId || this.pickEditorDocumentId(documents);
    if (!documentId) {
      throw new BadRequestException(
        'Could not mint a SignNow review link. The contract package has no documents in SignNow yet — wait for the upload to finish, then click Review in SignNow again.',
      );
    }

    const existingRoles = uniqueRoleNames(documents.flatMap((d) => d.roles || []));
    const templateRoles = uniqueRoleNames([
      'Owner',
      ...existingRoles,
      'Recipient 1',
      'Recipient 2',
    ]);
    const inviteSigners = fillSignersForTemplateRoles(
      templateRoles,
      orderedSigners(options.roles || []),
      { includeSameEmailOwner2: true },
    );
    if (!inviteSigners.length) {
      throw new BadRequestException(
        'Could not mint a SignNow review link. No signer could be matched to the template roles — check the signer names and emails on the deal.',
      );
    }
    const nitroStyle = usesNitroApproverRoles(templateRoles);
    const reviewSigners = inviteSigners.filter(
      (s) => s.preparer || isPreparerRole(s.roleName, nitroStyle),
    );
    const embedSigners = inviteSigners;
    const ownerRole =
      reviewSigners.find((s) => /^owner$/i.test(s.roleName))?.roleName ||
      reviewSigners[0]?.roleName ||
      'Owner';
    console.info('[SignNow] review role assignment', {
      nitroStyle,
      templateRoles,
      reviewLinkFor: [ownerRole],
      embedRoles: embedSigners.map((s) => s.roleName),
      signers: inviteSigners.map((s) => ({
        role: s.roleName,
        email: s.email,
        preparer: Boolean(s.preparer),
      })),
    });

    type InviteDoc = { id: string; role: string; action: 'sign' };
    type EmbedSigner = (typeof embedSigners)[number];
    const extraAssignments: InviteDoc[] = [];
    const skippedAssignments = new Set<string>();
    const exactRoleByDoc = new Map<string, string>();
    const assignmentKey = (docId: string, role: string) =>
      `${docId}:${role.trim().toLowerCase()}`;

    const buildSigners = (source: EmbedSigner[]) => {
      const buckets: Array<{
        email: string;
        tag: string;
        documents: InviteDoc[];
      }> = [];
      const pushDoc = (signer: EmbedSigner, doc: InviteDoc) => {
        if (!doc.id || skippedAssignments.has(assignmentKey(doc.id, doc.role))) return;
        /**
         * SignNow rejects the whole invite with "Document id with role must be
         * unique" if one (document, role) pair appears twice, even under two
         * different signers. That happens when a dropped CRM role sends the
         * preparer to a fallback role the merchant already holds on that
         * document. The pair is invalid either way, so keep the first claim
         * rather than letting the create fail and strand the group with no
         * embedded invites at all.
         */
        const claimedElsewhere = buckets.some((bucket) =>
          bucket.documents.some(
            (d) => d.id === doc.id && sameSignNowRole(d.role, doc.role),
          ),
        );
        if (claimedElsewhere) {
          const mine = buckets.find((bucket) =>
            bucket.documents.some(
              (d) => d.id === doc.id && sameSignNowRole(d.role, doc.role),
            ),
          );
          const tagForSigner = signer.preparer
            ? 'preparer'
            : doc.role.replace(/[^a-z0-9]/gi, '').toLowerCase();
          if (mine && mine.tag !== tagForSigner) {
            console.warn('[SignNow] skipping duplicate embedded (document, role)', {
              documentId: doc.id,
              role: doc.role,
              heldBy: mine.tag,
              requestedBy: tagForSigner,
            });
            return;
          }
        }
        // Bucket by the DOCUMENT role, not the signer's own role name: one CRM
        // signer often covers Recipient 1 and Recipient 2, and keying on the
        // signer collapsed both onto one bucket where the second role was
        // dropped ("Role Recipient 2 … was not specified").
        const tag = signer.preparer
          ? 'preparer'
          : doc.role.replace(/[^a-z0-9]/gi, '').toLowerCase() ||
            signer.roleName.replace(/[^a-z0-9]/gi, '').toLowerCase() ||
            'signer';
        // One bucket per role — not per email. Recipient 1 and Recipient 2 often
        // share a CRM email; SignNow still requires unique document ids per signer.
        const existing = buckets.find((bucket) => bucket.tag === tag);
        if (existing) {
          const sameDoc = existing.documents.find((d) => d.id === doc.id);
          if (sameDoc) {
            if (
              sameDoc.role !== doc.role &&
              sameDoc.role.toLowerCase() === doc.role.toLowerCase()
            ) {
              sameDoc.role = doc.role;
            }
            return;
          }
          existing.documents.push(doc);
          return;
        }
        buckets.push({
          email: signer.email,
          tag,
          documents: [doc],
        });
      };
      const signerForRole = (role: string): EmbedSigner | undefined => {
        const exact = source.find((s) => s.roleName.toLowerCase() === role.toLowerCase());
        if (exact) return exact;
        if (/^owner$/i.test(role) || isPreparerRole(role, nitroStyle)) {
          return source.find((s) => s.preparer) || source[0];
        }
        // A merchant role (Recipient 1/2) must not fall back to the preparer:
        // pushDoc buckets by tag, so the preparer bucket already holds this
        // document under the Owner role and the assignment would be dropped —
        // SignNow then rejects the invite with "Role … was not specified".
        return source.find((s) => !s.preparer) || source[0];
      };

      for (const doc of documents) {
        // Use the document's exact role spelling. Group listings often omit roles
        // (or use "Owner" while the PDF has "owner"), which SignNow then rejects.
        const listed = embeddedReviewRolesForDocument(doc);
        const isAgreement = /agreement/i.test(String(doc.document_name || doc.name || ''));
        const ownerLike =
          listed.find((role) => /^owner$/i.test(role) || isPreparerRole(role, nitroStyle)) ||
          '';
        // Include Recipient 2 on the first embedded invite whenever the PDF
        // lists that role. Filtering it out caused a 4.7s delete/recreate repair.
        const merchantRoles = listed.length ? listed : ['Recipient 1'];
        const assign = uniqueRoleNames([
          ...(ownerLike ? [ownerLike] : isAgreement ? [ownerRole] : []),
          ...merchantRoles,
        ]);
        for (const role of assign) {
          const exact = exactRoleByDoc.get(assignmentKey(doc.id, role)) || role;
          const signer = signerForRole(exact);
          if (!signer) continue;
          pushDoc(signer, { id: doc.id, role: exact, action: 'sign' });
        }
        // Owner Review must include every package document. If this extra has no
        // Owner widgets, still put it on the preparer using a role that exists.
        const preparerSigner =
          source.find((s) => s.preparer) ||
          source.find((s) => isPreparerRole(s.roleName, nitroStyle));
        if (preparerSigner) {
          const onPreparer = buckets
            .find((bucket) => bucket.tag === 'preparer')
            ?.documents.some((d) => d.id === doc.id);
          if (!onPreparer) {
            const fallbackRole =
              listed.find(
                (role) => !skippedAssignments.has(assignmentKey(doc.id, role)),
              ) ||
              ownerLike ||
              listed[0] ||
              'Recipient 1';
            pushDoc(preparerSigner, {
              id: doc.id,
              role: fallbackRole,
              action: 'sign',
            });
          }
        }
      }
      for (const extra of extraAssignments) {
        const signer = signerForRole(extra.role);
        if (signer) pushDoc(signer, extra);
      }
      const usedEmails: string[] = [];
      const orderedBuckets = [...buckets].sort((a, b) => {
        if (a.tag === 'preparer' && b.tag !== 'preparer') return -1;
        if (b.tag === 'preparer' && a.tag !== 'preparer') return 1;
        return 0;
      });
      return orderedBuckets.map((bucket, idx) => {
        const { first_name, last_name } = this.splitPersonName(
          inviteSigners.find((s) => s.email.toLowerCase() === bucket.email.toLowerCase())?.name ||
            bucket.email,
          bucket.email,
        );
        const email =
          bucket.tag === 'preparer'
            ? (() => {
                usedEmails.push(bucket.email.toLowerCase());
                return bucket.email;
              })()
            : uniqueEmailAlias(bucket.email, usedEmails, bucket.tag);
        /**
         * The preparer signs first; every merchant shares the next slot so they
         * can sign in parallel. A distinct order per merchant made SignNow hold
         * each signer until the one before them finished, which is what left
         * Recipient 2 on "Waiting For Others" with no way to open the document.
         */
        const row: Record<string, unknown> = {
          email,
          order: bucket.tag === 'preparer' ? 1 : 2,
          auth_method: 'none',
          first_name,
          last_name,
          documents: bucket.documents,
        };
        if (inviteRedirect) {
          // One URL per outcome: only a Finish may mark the review complete.
          // Sharing one URL is what made a Close look exactly like a Finish.
          row.redirect_uri = withReviewRedirectEvent(inviteRedirect, 'finish');
          row.close_redirect_uri = withReviewRedirectEvent(inviteRedirect, 'close');
          row.decline_redirect_uri = withReviewRedirectEvent(inviteRedirect, 'decline');
          row.redirect_target = 'self';
        }
        return row;
      });
    };

    const postEmbedded = async (source: EmbedSigner[]) => {
      const signers = buildSigners(source);
      const payload = {
        invites: [
          {
            order: 1,
            auth_method: 'none',
            signers,
          },
        ],
        expiration_days: 30,
      };
      console.info('[SignNow] embedded-invite payload', {
        groupId: options.groupId,
        signers: signers.map((s) => ({
          email: s.email,
          order: s.order,
          documents: (s.documents as InviteDoc[]).map((d) => {
            const named = documents.find((doc) => doc.id === d.id);
            return {
              id: d.id.slice(0, 8),
              role: d.role,
              name: named?.document_name || named?.name || '',
            };
          }),
        })),
      });
      const deleteStarted = Date.now();
      await client.delete(`/v2/document-groups/${options.groupId}/embedded-invites`, {
        validateStatus: () => true,
      });
      logSignNowTiming('embedded-invite-delete', Date.now() - deleteStarted, {
        documentCount: documents.length,
      });
      const createStarted = Date.now();
      const res = await client.post(
        `/v2/document-groups/${options.groupId}/embedded-invites`,
        payload,
        { validateStatus: () => true },
      );
      logSignNowTiming('embedded-invite-create', Date.now() - createStarted, {
        documentCount: documents.length,
      });
      return { res, signers };
    };

    let created = await postEmbedded(embedSigners);
    if (
      inviteRedirect &&
      created.res.status >= 400 &&
      /redirect|url|uri/i.test(this.signNowErrorDetail(created.res))
    ) {
      // A redirect SignNow will not accept must not cost the review itself:
      // mint without it and let the CRM's "I've clicked Finish" cover the gap.
      console.warn('[SignNow] review redirect rejected; minting without it', {
        groupId: options.groupId,
        detail: this.signNowErrorDetail(created.res),
      });
      inviteRedirect = '';
      created = await postEmbedded(embedSigners);
    }
    let inviteId = this.extractEmbeddedInviteId(created.res.data);
    // One SignNow error = one missing/unknown role on one document. A full
    // agreement + addenda package needs enough retries to cover every role.
    const maxRoleRetries = Math.max(24, documents.length * 4);
    let emptyFieldsRetries = 0;
    let lastRoleRepairDetail = '';
    for (
      let attempt = 0;
      attempt < maxRoleRetries && (created.res.status >= 400 || !inviteId);
      attempt += 1
    ) {
      const detail = this.signNowErrorDetail(created.res);
      const emptyFields = isEmptySignNowFieldsError(detail);
      /**
       * Identical error twice in a row means the repair changed nothing —
       * keep retrying and the merchant just waits for 24 round trips. The
       * empty-fields wait is exempt: it repeats the same error by design while
       * the copy finishes, and letting this guard cut it short is what reduced
       * three paced retries to a single one and failed the reviewer.
       */
      if (detail && detail === lastRoleRepairDetail && !emptyFields) {
        console.warn('[SignNow] embedded-invite repair made no progress', { detail });
        break;
      }
      lastRoleRepairDetail = detail;
      const unknown = parseUnknownInviteRole(detail);
      const omitted = parseMissingInviteRole(detail);
      if (unknown) {
        const unknownKey = assignmentKey(unknown.documentId, unknown.role);
        skippedAssignments.add(unknownKey);
        // Drop any earlier repair for the same doc+role, otherwise the two
        // branches fight each other on every retry.
        for (let i = extraAssignments.length - 1; i >= 0; i -= 1) {
          if (assignmentKey(extraAssignments[i].id, extraAssignments[i].role) === unknownKey) {
            extraAssignments.splice(i, 1);
          }
        }
        console.warn('[SignNow] dropping unknown embedded role', unknown);
      } else if (omitted) {
        const omittedKey = assignmentKey(omitted.documentId, omitted.role);
        // SignNow sometimes first reports a role as "not found" and then, once
        // it is omitted, as "was not specified". Without clearing the skip the
        // repair below is dropped by pushDoc and every retry repeats verbatim
        // until the loop gives up ("Role Recipient 1 … was not specified").
        skippedAssignments.delete(omittedKey);
        exactRoleByDoc.set(omittedKey, omitted.role);
        if (
          !extraAssignments.some(
            (row) => assignmentKey(row.id, row.role) === omittedKey,
          )
        ) {
          extraAssignments.push({
            id: omitted.documentId,
            role: omitted.role,
            action: 'sign',
          });
        }
        const doc = documents.find((d) => d.id === omitted.documentId);
        if (doc) {
          doc.roles = uniqueRoleNames([
            omitted.role,
            ...(doc.roles || []).filter(
              (role) => role.toLowerCase() !== omitted.role.toLowerCase(),
            ),
          ]);
        }
        if (!embedSigners.some((s) => s.roleName.toLowerCase() === omitted.role.toLowerCase())) {
          const fallback =
            inviteSigners.find((s) => s.preparer || isPreparerRole(s.roleName, nitroStyle)) ||
            inviteSigners[0];
          if (fallback) {
            // Keep `preparer` false so this role forms its own signer bucket;
            // reusing the preparer tag put the document back in a bucket that
            // already had it and the role was silently dropped again.
            embedSigners.push({
              ...fallback,
              roleName: omitted.role,
              preparer: false,
            });
          }
        }
        console.warn('[SignNow] adding omitted embedded role', omitted);
      } else if (emptyFields && emptyFieldsRetries < 4) {
        emptyFieldsRetries += 1;
        // The copy can take several seconds to attach its widgets, so the wait
        // grows instead of giving up after ~4s of polling.
        await sleepSignNow(1_000 * emptyFieldsRetries);
        documents = await this.waitForDocumentsReady(client, documents, 4, {
          requireFields: true,
        });
        // Still empty after a paced wait: the copy is broken, not slow. Put its
        // widgets back from the template it came from before the next post.
        if (emptyFieldsRetries >= 2 && documents.some((d) => !(d.fieldCount ?? 0))) {
          documents = await this.restoreFieldsFromOriginTemplate(client, documents);
        }
        console.warn('[SignNow] retrying embedded invite after empty-fields error', {
          attempt: emptyFieldsRetries,
          docsWithRoles: documents.filter((d) => (d.roles || []).length).length,
          docsWithoutFields: documents.filter((d) => !(d.fieldCount ?? 0)).length,
          totalDocs: documents.length,
        });
      } else {
        break;
      }
      countSignNowRetry();
      const repairStarted = Date.now();
      created = await postEmbedded(embedSigners);
      inviteId = this.extractEmbeddedInviteId(created.res.data);
      logSignNowTiming('embedded-invite-role-repair', Date.now() - repairStarted, {
        attempt: attempt + 1,
        documentCount: documents.length,
      });
    }
    if (created.res.status >= 400 || !inviteId) {
      /**
       * The create can fail because this group already carries an embedded
       * invite — a second Review click on the same draft, or a repair posted
       * after SignNow had accepted the first one. That invite is perfectly
       * usable, so read it back before giving up on the review.
       */
      const existing = await client.get(
        `/v2/document-groups/${options.groupId}/embedded-invites`,
        { validateStatus: () => true },
      );
      inviteId = this.extractEmbeddedInviteId(existing.data);
      if (inviteId) {
        console.warn('[SignNow] reusing the existing embedded invite on this group', {
          groupId: options.groupId,
          createDetail: this.signNowErrorDetail(created.res),
        });
      }
    }
    if (!inviteId) {
      const detail = this.signNowErrorDetail(created.res);
      console.warn('[SignNow] group embedded-invite create failed', detail);
      const fieldless = documents
        .filter((d) => !(d.fieldCount ?? 0))
        .map((d) => d.document_name || d.name || d.id);
      throw new BadRequestException(
        isEmptySignNowFieldsError(detail)
          ? 'Could not mint a SignNow review link. SignNow reports no fillable fields on the package' +
            (fieldless.length ? ` (${fieldless.join(', ')})` : '') +
            ' — the documents are still copying or the funder template lost its widgets. Wait a moment and click Review in SignNow again.'
          : detail
            ? `Could not mint a SignNow review link. ${detail}`
            : 'Could not mint a SignNow review link. SignNow still reports a missing role on one of the attached documents.',
      );
    }
    if (options.inviteOnly) return '';

    const preparer = resolvePreparerIdentity();
    const merchantEmails = new Set(
      inviteSigners
        .filter((s) => !s.preparer && !isPreparerRole(s.roleName, nitroStyle))
        .map((s) => s.email.trim().toLowerCase()),
    );
    const payloadEmails = created.signers.map((s) => String(s.email || '').trim());
    const emails = uniqueEmails([
      preparer?.email || '',
      ...inviteSigners.filter((s) => s.preparer).map((s) => s.email),
      ...payloadEmails.filter((email) => {
        const key = email.toLowerCase();
        if (preparer?.email && key === preparer.email.toLowerCase()) return true;
        return !merchantEmails.has(key);
      }),
    ]);
    if (!emails.length) {
      console.warn('[SignNow] no Owner/preparer email to mint the review link');
      throw new BadRequestException(
        'Could not mint a SignNow review link. No Owner/preparer email is configured for SignNow — set SIGNNOW_PREPARER_EMAIL (or the deal owner) and try again.',
      );
    }
    /**
     * Every candidate signer on the invite, not only the Owner bucket. SignNow
     * mints a link per signer email, and it rejects an email that did not end up
     * on the invite it just created — which is what left the CRM with no link at
     * all whenever a role repair moved the Owner into a different bucket.
     */
    const linkEmails = uniqueEmails([...emails, ...payloadEmails]);
    const linkFailures: string[] = [];
    for (const email of linkEmails) {
      // A fresh document group is still settling on SignNow's side for a moment
      // after the invite is created; the first link POST can come back 4xx/5xx
      // and succeed on the retry.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        if (attempt > 0) {
          countSignNowRetry();
          await sleepSignNow(500 * attempt);
        }
        const linkStarted = Date.now();
        const linkRes = await client.post(
          `/v2/document-groups/${options.groupId}/embedded-invites/${inviteId}/link`,
          {
            email,
            auth_method: 'none',
            link_expiration: SIGNNOW_EMBED_LINK_EXPIRATION_MINUTES,
            // SignNow rejects a session that outlives its link, so this tracks
            // `link_expiration` rather than carrying a longer value of its own.
            session_expiration: SIGNNOW_EMBED_LINK_EXPIRATION_MINUTES,
          },
          { validateStatus: () => true },
        );
        logSignNowTiming('embedded-invite-link', Date.now() - linkStarted, {
          documentCount: documents.length,
        });
        const url = this.extractEmbeddedLink(linkRes.data);
        if (linkRes.status < 400 && url) return url;
        const detail = this.signNowErrorDetail(linkRes);
        console.warn('[SignNow] group embedded-invite link failed', {
          status: linkRes.status,
          email,
          attempt: attempt + 1,
          detail,
        });
        linkFailures.push(`${email}: ${detail}`);
        if (!isTransientSignNowFailure(linkRes.status, detail)) break;
      }
    }
    // The document-level invite covers the agreement only, but an Owner review
    // of the agreement beats handing the preparer an error they cannot act on.
    const singleDocUrl = await this.mintDocumentEmbeddedInviteLink(client, {
      documentId,
      redirect: options.redirect,
      roles: options.roles,
    });
    if (singleDocUrl) {
      console.warn('[SignNow] fell back to a document-level review link', {
        groupId: options.groupId,
        documentId,
      });
      return singleDocUrl;
    }
    throw new BadRequestException(
      `Could not mint a SignNow review link. SignNow rejected the review link: ${
        linkFailures[0] || 'no signer on the invite could be given a link'
      }`,
    );
  }

  /**
   * Combined PDF for a SignNow document group (signed contract + addenda + disclosures).
   * Once the group is complete, the merged PDF is archived to Cloudinary (see
   * `archiveSignedEnvelopePdf`) so every later "eye" preview / download is served from
   * that durable copy instead of re-hitting SignNow's API and its daily rate limit.
   */
  async downloadGroupPdf(
    groupId: string,
    options?: {
      applicationId?: string | null;
      funderName?: string | null;
      funderProfileId?: string | null;
    },
  ): Promise<Buffer> {
    const id = String(groupId || '').trim();
    if (!id) throw new BadRequestException('Missing SignNow document group id');

    // Concurrent cold requests (preview + download + a completion warm racing
    // each other) must produce one SignNow fetch, not three.
    const inflight = groupPdfInflight.get(id);
    if (inflight) return inflight;
    const pending = this.downloadGroupPdfUncached(id, options).finally(() => {
      groupPdfInflight.delete(id);
    });
    groupPdfInflight.set(id, pending);
    return pending;
  }

  private async downloadGroupPdfUncached(
    id: string,
    options?: {
      applicationId?: string | null;
      funderName?: string | null;
      funderProfileId?: string | null;
    },
  ): Promise<Buffer> {
    /**
     * A portal send answers the click at once and publishes the merchant's copy
     * in the background, document by document: each one has its old stamps
     * cleared and the new values baked in its own SignNow write. A package PDF
     * pulled in that window showed the Contract and Disclosure already done and
     * the Addendums still blank — which "filled in later" on the next view. Wait
     * for the publish, so the Sent view only ever shows what the merchant got.
     */
    if (isPortalSendInFlight(id)) {
      const settled = await waitForPortalSendToSettle(id, PORTAL_SEND_PDF_WAIT_MS);
      if (!settled) {
        console.warn('[SignNow] package PDF requested mid portal send; serving live copy', {
          groupId: id,
        });
      }
    }
    const storedArchive = await getStoredEnvelopePdfArchive(id);
    const storedUrl = storedArchive?.url || null;
    const docFullySigned = isDocumentFullySignedStatus(storedArchive?.status);
    const archiveIsSigned = isSignedPhaseArchiveUrl(storedUrl);
    const staleSentArchive = Boolean(storedUrl && docFullySigned && !archiveIsSigned);
    /**
     * The "sent" archive is a snapshot of whatever SignNow returned the first time
     * anyone opened the package, and it is served on every later view. Taken from a
     * draft, or while Send was still publishing the merchant's copy, it froze a
     * half-written package: addendums blank mid-rebuild and the disclosure still on
     * Review's amounts, shown in the CRM for the rest of the signing even though the
     * merchant saw the finished documents. Only a package that has finished sending
     * is snapshotted (or served from a snapshot).
     */
    const snapshotReady = docFullySigned || (await this.groupPdfSnapshotReady(id));

    if (storedUrl && !staleSentArchive && snapshotReady) {
      const fromCloud = await fetchStoredSignedPdfBuffer(storedUrl);
      if (fromCloud?.length) return fromCloud;
    }

    const client = await createSignNowApiClient();
    const groupRes = await client.get(`/documentgroup/${id}`, { validateStatus: () => true });
    if (groupRes.status >= 400) {
      throw new BadRequestException(
        groupRes.data?.errors?.[0]?.message || 'SignNow contract was not found',
      );
    }
    const documents = this.normalizeGroupDocuments(groupRes.data?.documents);
    if (!documents.length) {
      throw new BadRequestException('SignNow contract PDF is not available yet');
    }
    console.info('[SignNow] downloading group PDF', {
      groupId: id,
      count: documents.length,
      names: documents.map((d) => d.document_name || d.name || d.id),
    });

    let buf: Buffer;
    if (documents.length === 1) {
      buf = await this.downloadDocumentPdfBuffer(
        client,
        documents[0].id,
        String(documents[0].document_name || documents[0].name || 'contract'),
      );
    } else {
      const merged = await this.downloadMergedGroupPdf(client, id, documents);
      if (merged) {
        buf = merged;
      } else {
        const parts: Buffer[] = [];
        for (const doc of documents) {
          const label = String(doc.document_name || doc.name || doc.id);
          parts.push(await this.downloadDocumentPdfBuffer(client, doc.id, label));
        }
        buf = await this.mergePdfBuffers(parts);
      }
    }

    if (!snapshotReady) return buf;

    const phase: EnvelopePdfArchivePhase = docFullySigned || staleSentArchive ? 'completed' : 'sent';
    const archive = archiveSignedEnvelopePdf({
      envelopeId: id,
      pdf: buf,
      phase,
      replaceExisting: phase === 'completed',
      applicationId: options?.applicationId || undefined,
      funderName: options?.funderName || undefined,
      funderProfileId: options?.funderProfileId || undefined,
    }).catch((err) => {
      console.warn(`[SignNow] lazy ${phase} PDF archive failed for ${id}:`, err);
      return null;
    });

    if (phase === 'completed') {
      // The signed package is final: persist the Cloudinary URL before handing
      // the buffer back, so the next preview reads it from the DB rather than
      // racing an unfinished background upload into another SignNow download.
      await archive;
    }

    return buf;
  }

  /**
   * Whether the group's documents are final enough to archive as the "sent"
   * package: marked sent, and no portal send still publishing them. Both send
   * paths stamp `sentAt` only after the merchant's copy is baked. A group with
   * no Document row is an earlier send moved into the send history.
   */
  private async groupPdfSnapshotReady(groupId: string): Promise<boolean> {
    if (isPortalSendInFlight(groupId)) return false;
    try {
      const row = await prisma.document.findUnique({
        where: { envelopeId: groupId },
        select: { sentAt: true, portalSentAt: true },
      });
      if (!row) return true;
      return Boolean(row.sentAt || row.portalSentAt);
    } catch {
      return false;
    }
  }

  /** Persist the CC list onto the envelope row so completion can reuse it. Best-effort. */
  private async rememberCcRecipientsForGroup(
    groupId: string,
    ccEmails: string[],
  ): Promise<void> {
    const id = String(groupId || '').trim();
    if (!id || !ccEmails.length) return;
    try {
      await prisma.document.updateMany({
        where: { envelopeId: id },
        data: { ccEmails } as any,
      });
    } catch (err) {
      console.warn(`[SignNow] could not persist CC list for ${id}:`, err);
    }
  }

  /**
   * Mark the envelope's CC list as having received the signed copy. Backs the
   * application's "Signed copy sent to CC" checkbox, so it only ticks once a
   * CC address was actually emailed. Best-effort.
   */
  private async rememberCcSignedNoticeForGroup(
    groupId: string,
    emailedCc: string[],
  ): Promise<void> {
    await this.recordCcSignedNotice(groupId, new Date(), emailedCc);
  }

  private async recordCcSignedNotice(
    groupId: string,
    sentAt: Date,
    ccReached: string[],
  ): Promise<void> {
    const id = String(groupId || '').trim();
    if (!id || !ccReached.length) return;
    try {
      await prisma.document.updateMany({
        where: { envelopeId: id },
        data: { ccSignedNoticeSentAt: sentAt, ccSignedNoticeEmails: ccReached } as any,
      });
    } catch (err) {
      console.warn(`[SignNow] could not record CC signed notice for ${id}:`, err);
      return;
    }
    // Tick the application's "Signed copy sent to CC" box in open browsers
    // without a reload.
    try {
      const doc = await prisma.document.findFirst({
        where: { envelopeId: id },
        select: { applicationId: true },
      });
      const applicationId = String(doc?.applicationId || '').trim();
      if (applicationId) {
        const { emitContractSigningStatusRealtime } = await import('../contractSigningStatusEffects');
        await emitContractSigningStatusRealtime({
          applicationId,
          envelopeId: id,
          status: 'completed',
          provider: 'signnow',
        });
      }
    } catch (err) {
      console.warn(`[SignNow] CC signed notice realtime push failed for ${id}:`, err);
    }
  }

  /**
   * CC recipients of the signed-contract notice: the selected funder's CC only,
   * never the extra addresses typed at send time. See
   * `resolveSignedNoticeFunderCcEmails`.
   */
  private async readSignedNoticeCcRecipients(
    groupId: string,
    applicationId?: string,
  ): Promise<string[]> {
    try {
      const appId =
        String(applicationId || '').trim() ||
        String(
          (
            await prisma.document.findFirst({
              where: { envelopeId: String(groupId || '').trim() },
              select: { applicationId: true },
            })
          )?.applicationId || '',
        ).trim();
      return await resolveSignedNoticeFunderCcEmails(appId);
    } catch (err) {
      console.warn(`[SignNow] could not resolve funder CC for signed notice ${groupId}:`, err);
      return [];
    }
  }

  /**
   * Emails a copy of the contract package to CC recipients as soon as the SignNow
   * invite is sent. `completion_emails` (set in sendGroupInvite) only notifies CC
   * once every signer finishes, so without this, a CC added at send time received
   * nothing until (and unless) the whole package was fully signed.
   */
  /** Public: also used by the CRM signing-portal send path (SendGrid), which has no SignNow invite of its own to attach CC to. */
  async notifyCcRecipientsOnSend(
    groupId: string,
    ccEmails: string[] | undefined | null,
    signerEmails: string[] | undefined | null,
    subjectBase?: string,
  ): Promise<{ emailed: string[]; skippedReason?: string }> {
    const signerSet = new Set(
      (signerEmails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean),
    );
    const list = [
      ...new Set(
        (ccEmails || [])
          .map((e) => String(e || '').trim())
          .filter((e) => e && !signerSet.has(e.toLowerCase())),
      ),
    ];
    if (!list.length) return { emailed: [], skippedReason: 'no_cc_addresses' };

    // Remember the list before attempting delivery. The CC addresses exist
    // nowhere but the send request body, and the completion notice — which runs
    // days later, from a webhook with no request of its own — has no other way
    // to reach the people who were copied on the unsigned package.
    await this.rememberCcRecipientsForGroup(groupId, list);

    if (!isOutboundSmtpConfigured()) {
      console.warn('[SignNow] CC contract email skipped: SMTP not configured.');
      return { emailed: [], skippedReason: 'smtp_not_configured' };
    }

    let pdf: Buffer | null = null;
    try {
      pdf = await this.downloadGroupPdf(groupId);
    } catch (err) {
      console.warn('[SignNow] Could not download group PDF for CC email:', err);
    }

    const subject = normalizeContractCcEmailSubject(
      String(subjectBase || '').trim() || buildContractEnvelopeEmailSubject('Business', null),
    );
    const pdfFilename = buildContractEnvelopePdfFilename(subject);
    // Sent as the contract's funder (its stored sender identity), else the .env default.
    const from = resolveEnvelopeMailSender(groupId).then((sender) => sender ?? undefined);
    // Each CC is its own message; delivering them one after another made the
    // caller wait on every SendGrid round trip in turn.
    const outcomes = await Promise.allSettled(
      list.map(async (to) =>
        sendMail({
          from: await from,
          to,
          subject,
          html: '<p>Please find the contract package attached for your records.</p>',
          attachments: pdf?.length
            ? [
                {
                  filename: pdfFilename,
                  content: pdf,
                  contentType: 'application/pdf',
                },
              ]
            : undefined,
        }),
      ),
    );
    const emailed: string[] = [];
    outcomes.forEach((outcome, index) => {
      if (outcome.status === 'fulfilled') {
        emailed.push(list[index]);
      } else {
        console.error(`[SignNow] Failed to email CC copy to ${list[index]}:`, outcome.reason);
      }
    });
    if (emailed.length) {
      console.log(`[SignNow] CC contract emailed to ${emailed.join(', ')} (group ${groupId}, subject "${subject}")`);
    }
    return { emailed };
  }

  /**
   * Remember the CC list now, deliver the CC copies in the background.
   *
   * The list is persisted before returning because the completion notice needs
   * it days later; the PDF download and the SendGrid sends run after the HTTP
   * response, so a send only waits on one DB write for its CC recipients.
   */
  async queueCcRecipientsOnSend(
    groupId: string,
    ccEmails: string[] | undefined | null,
    signerEmails: string[] | undefined | null,
    subjectBase?: string,
  ): Promise<{ emailed: string[]; queued: string[]; skippedReason?: string }> {
    const signerSet = new Set(
      (signerEmails || []).map((e) => String(e || '').trim().toLowerCase()).filter(Boolean),
    );
    const list = [
      ...new Set(
        (ccEmails || [])
          .map((e) => String(e || '').trim())
          .filter((e) => e && !signerSet.has(e.toLowerCase())),
      ),
    ];
    if (!list.length) return { emailed: [], queued: [], skippedReason: 'no_cc_addresses' };
    await this.rememberCcRecipientsForGroup(groupId, list);
    if (!isOutboundSmtpConfigured()) {
      console.warn('[SignNow] CC contract email skipped: SMTP not configured.');
      return { emailed: [], queued: [], skippedReason: 'smtp_not_configured' };
    }
    setImmediate(() => {
      this.notifyCcRecipientsOnSend(groupId, list, signerEmails, subjectBase).catch((err) =>
        console.warn(`[SignNow] background CC email failed for ${groupId}:`, err),
      );
    });
    return { emailed: [], queued: list };
  }

  private async downloadMergedGroupPdf(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[],
  ): Promise<Buffer | null> {
    const res = await client.post(
      `/documentgroup/${groupId}/downloadall`,
      {
        type: 'merged',
        with_history: 'no',
        document_order: documents.map((d) => d.id),
      },
      {
        responseType: 'arraybuffer',
        headers: {
          Accept: 'application/pdf, application/octet-stream, application/json',
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      },
    );
    const pdf = this.asPdfBuffer(res.status, res.data);
    if (pdf) return pdf;
    console.warn('[SignNow] group merged download failed; falling back to per-document merge', {
      groupId,
      status: res.status,
      documentCount: documents.length,
    });
    return null;
  }

  private asPdfBuffer(status: number, data: unknown): Buffer | null {
    if (status >= 400 || data == null) return null;
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
    if (buffer.length < 100 || !buffer.slice(0, 4).toString('latin1').startsWith('%PDF')) {
      return null;
    }
    return buffer;
  }

  private async mergePdfBuffers(buffers: Buffer[]): Promise<Buffer> {
    const valid = buffers.filter((buf) => buf?.length >= 100);
    if (!valid.length) {
      throw new BadRequestException('Could not download the SignNow contract PDF');
    }
    if (valid.length === 1) return valid[0];
    const { PDFDocument } = await import('pdf-lib');
    const merged = await PDFDocument.create();
    for (const buf of valid) {
      const src = await PDFDocument.load(buf, { ignoreEncryption: true });
      const pageCount = src.getPageCount();
      if (pageCount < 1) continue;
      const copied = await merged.copyPages(
        src,
        Array.from({ length: pageCount }, (_, i) => i),
      );
      for (const page of copied) merged.addPage(page);
    }
    if (merged.getPageCount() < 1) {
      throw new BadRequestException('Could not merge SignNow contract PDFs');
    }
    return Buffer.from(await merged.save());
  }

  async resolveInviteEmailSubject(options: {
    title?: string;
    applicationId?: string;
    prefillFields?: PrefillField[];
    funderName?: string | null;
    fallbackGroupName?: string;
  }): Promise<string> {
    const fromPrefill = extractContractEmailContextFromPrefill(options.prefillFields);
    let businessName = fromPrefill.businessName;
    let offerAmount: number | string | null = null;
    let selectedFunder =
      String(options.funderName || '').trim() || fromPrefill.funderName || '';

    const appId = String(options.applicationId || '').trim();
    if (appId) {
      try {
        const [contract, app] = await Promise.all([
          prisma.contract.findFirst({
            where: { applicationId: appId },
            orderBy: { createdAt: 'desc' },
            select: {
              legalName: true,
              clientName: true,
              doingBusinessAs: true,
              approvedAmount: true,
              funderName: true,
            },
          }),
          prisma.application.findUnique({
            where: { id: appId },
            select: {
              dealDisplayName: true,
              client: { select: { businessName: true } },
              OfferDecision: { select: { offer: true, decision: true } },
              termsOffers: {
                orderBy: { createdAt: 'desc' },
                take: 1,
                select: { approvedAmount: true },
              },
            },
          }),
        ]);
        if (!businessName) {
          businessName =
            String(app?.client?.businessName || app?.dealDisplayName || '').trim() ||
            String(
              contract?.legalName ||
                contract?.doingBusinessAs ||
                contract?.clientName ||
                '',
            ).trim() ||
            null;
        }
        if (!selectedFunder) {
          selectedFunder = String(contract?.funderName || '').trim();
        }
        const decisionNorm = String(app?.OfferDecision?.decision ?? '')
          .trim()
          .toLowerCase();
        const fromOfferDecision =
          decisionNorm !== 'declined' && app?.OfferDecision?.offer != null
            ? Number(app.OfferDecision.offer)
            : null;
        const fromTerms =
          app?.termsOffers?.[0]?.approvedAmount != null
            ? Number(app.termsOffers[0].approvedAmount)
            : null;
        const fromContractApproved =
          contract?.approvedAmount != null ? Number(contract.approvedAmount) : null;
        offerAmount =
          fromOfferDecision != null && Number.isFinite(fromOfferDecision)
            ? fromOfferDecision
            : fromTerms != null && Number.isFinite(fromTerms)
              ? fromTerms
              : fromContractApproved != null && Number.isFinite(fromContractApproved)
                ? fromContractApproved
                : null;
      } catch {
        /* fall through to title / group name */
      }
    }
    if (offerAmount == null) {
      offerAmount = fromPrefill.offerAmount;
    }

    if (businessName || selectedFunder || offerAmount != null) {
      return buildContractEnvelopeEmailSubject(
        businessName || 'Business',
        offerAmount,
        selectedFunder,
      );
    }
    return ensureSubjectAmountHasDollarSign(
      String(options.title || '').trim() ||
      String(options.fallbackGroupName || '').trim() ||
      'Nitro Advance Contract',
    );
  }

  async sendEnvelope(
    groupId: string,
    options: {
      roles?: SignerRoleInput[];
      title?: string;
      ccEmails?: string[];
      applicationId?: string;
      prefillFields?: PrefillField[];
      funderName?: string | null;
      funderProfileId?: string | null;
      supplementalDocumentRefs?: string[];
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
      requestId?: string;
      /**
       * Live "$25 wire fee" checkbox, exactly as the review build receives it.
       * The contract row can still say "on" when the box was unchecked in the
       * modal, and baking from the row re-added $25 to TOTAL FEES / NET AMOUNT
       * on the merchant's copy of every document.
       */
      includeWireFee?: unknown;
    },
  ) {
    const id = String(groupId || '').trim();
    if (!id) throw new BadRequestException('Missing SignNow document group id');
    const requestId = String(options.requestId || randomUUID()).trim();
    const appIdEarly = String(options.applicationId || '').trim();
    const existingDoc = await prisma.document.findUnique({
      where: { envelopeId: id },
      select: { status: true, sentAt: true, prefillFingerprint: true },
    });
    const alreadyEmailed =
      String(existingDoc?.status || '').toLowerCase() === 'sent' && Boolean(existingDoc?.sentAt);
    if (!alreadyEmailed) assertPackageWasPrefilledByReview(existingDoc?.prefillFingerprint);
    logSignNowSend('Contract send started', {
      contractId: id,
      requestId,
      signnowDocumentId: id,
      sendStatus: alreadyEmailed ? 'SENT' : 'SENDING',
      timestamp: new Date().toISOString(),
    });
    if (alreadyEmailed) {
      await markSignNowInviteSent({ envelopeId: id, requestId }).catch(() => undefined);
      logSignNowSend('Contract already SENT - skipping duplicate invite', {
        contractId: id,
        requestId,
        signnowDocumentId: id,
        sendStatus: 'SENT',
        timestamp: new Date().toISOString(),
      });
      return {
        success: true,
        envelopeId: id,
        status: 'sent',
        url: null,
        duplicate: true,
      };
    }
    const claim = await claimSignNowInviteSend({
      envelopeId: id,
      applicationId: appIdEarly || null,
      requestId,
    });
    if (claim.kind === 'already_sent') {
      logSignNowSend('Contract already SENT - skipping duplicate invite', {
        contractId: id,
        requestId,
        signnowDocumentId: id,
        signnowInviteId: claim.row.inviteId,
        sendStatus: 'SENT',
        attemptNumber: claim.row.attemptCount,
        timestamp: new Date().toISOString(),
      });
      return {
        success: true,
        envelopeId: id,
        status: 'sent',
        url: null,
        duplicate: true,
      };
    }
    if (claim.kind === 'in_progress') {
      logSignNowSend('Waiting for in-progress SignNow send', {
        contractId: id,
        requestId,
        signnowDocumentId: id,
        sendStatus: 'SENDING',
        attemptNumber: claim.row.attemptCount,
        timestamp: new Date().toISOString(),
      });
      const existingInvite = await this.waitForGroupInviteId(id, 75_000);
      if (existingInvite) {
        await markSignNowInviteSent({
          envelopeId: id,
          inviteId: existingInvite,
          requestId,
        }).catch(() => undefined);
        return {
          success: true,
          envelopeId: id,
          status: 'sent',
          url: null,
          duplicate: true,
        };
      }
      throw new BadRequestException(
        'SignNow is still sending this contract. Wait a few seconds and click Send via SignNow again.',
      );
    }

    try {
    // A CRM read the bake needs much later; started now it overlaps the SignNow
    // round trips below instead of adding its own latency after them. Settled
    // into a value so an early failure cannot surface as an unhandled rejection.
    const offerDerivedPromise = loadOfferDerivedValuesForContract({
      applicationId: options.applicationId ?? appIdEarly,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    // The disclosure amounts Review filled from the contract (the business's
    // declared revenue under a 0.00 calculator placeholder) must bake the same.
    // Never rejects: the loader swallows its own failures.
    const contractDefaultsPromise = this.loadContractPrefillDefaults(
      id,
      options.applicationId ?? appIdEarly,
    );
    const client = await createSignNowApiClient();
    const groupRes = await client.get(`/documentgroup/${id}`, { validateStatus: () => true });
    if (groupRes.status >= 400) {
      throw new BadRequestException(
        groupRes.data?.errors?.[0]?.message || 'SignNow document group not found',
      );
    }
    const documents = this.normalizeGroupDocuments(groupRes.data?.documents);
    const signers = orderedSigners(options.roles || []);
    if (!signers.length) {
      throw new BadRequestException('At least one signer with an email is required to send');
    }
    // Subject (CRM reads), document hydration and the embedded-invite listing
    // do not depend on each other. Awaiting them in sequence added two full
    // round trips to every send for no ordering benefit.
    const [subject, hydrated, embeddedRes] = await Promise.all([
      this.resolveInviteEmailSubject({
        title: options.title,
        applicationId: options.applicationId,
        prefillFields: options.prefillFields,
        funderName: options.funderName,
        fallbackGroupName: groupRes.data?.group_name,
      }),
      this.hydrateDocumentRoles(client, documents),
      client.get(`/v2/document-groups/${id}/embedded-invites`, {
        validateStatus: () => true,
      }),
    ]);
    console.info('[SignNow] invite email subject', { groupId: id, subject });
    const fulfilledRoles = uniqueRoleNames([
      ...hydrated.flatMap((doc) => doc.fulfilledRoles || []),
      ...collectFulfilledFromEmbeddedInvites(embeddedRes.data),
    ]);
    console.info('[SignNow] send snapshot', {
      groupId: id,
      fulfilledRoles,
      signerCount: signers.length,
      ccCount: uniqueEmails(options.ccEmails).length,
    });
    // Owner review embedded invites lock field edits. Clear them (and any
    // per-document invites) before baking merchant-visible values. The two
    // teardowns touch different SignNow resources, so running them in sequence
    // only added a full round trip to every send.
    await Promise.all([
      this.deleteEmbeddedInvites(client, id, documents),
      this.cancelPendingFieldInvites(client, hydrated),
    ]);
    // Pass the hydrated refs on: when nothing has to be attached this is the
    // same list, and keeping `remote` lets waitForDocumentsReady below skip a
    // second GET of every document in the package.
    const packaged = await this.attachMissingSupplementalsForSend(client, {
      groupId: id,
      groupName: subject,
      documents: hydrated,
      applicationId: appIdEarly,
      supplementalDocumentRefs: options.supplementalDocumentRefs,
      sendPackage: options.sendPackage,
      funderName: options.funderName,
      funderProfileId: options.funderProfileId,
    });
    if (packaged.groupId !== id) {
      await prisma.document.updateMany({
        where: { envelopeId: id },
        data: { envelopeId: packaged.groupId },
      });
    }
    const sendGroupId = packaged.groupId;
    const sendDocs = await this.waitForDocumentsReady(client, packaged.documents);
    const values = prefillRecord(options.prefillFields);
    if (options.applicationId && !values.application_id) {
      values.application_id = options.applicationId;
      values.case_id = options.applicationId;
    }
    // Same rule as the review build: the live offer outranks payload amounts, so the
    // text baked onto the merchant PDF cannot carry a superseded offer.
    const offerDerived = await offerDerivedPromise;
    if (!offerDerived.ok) throw offerDerived.error;
    layerContractPrefillDefaults(values, (await contractDefaultsPromise).defaults, {
      disclosureAmountsOnly: true,
    });
    Object.assign(
      values,
      buildOfferPrefillOverrides(
        withRequestWireFeePreference(offerDerived.value, options.includeWireFee),
        values,
      ),
    );
    applyMerchantSignerPrefill(values, signers);
    // Review writes Owner `prefilled_text` only. Merchants and the downloaded PDF
    // show committed text — bake/expose those values now, in parallel batches.
    const keepParty2 = Boolean(distinctSecondMerchant(signers));
    // A full package is 6-12 documents. At 6 per round that was two serial
    // rounds of the slowest call in the send; one round covers every package
    // we actually build and still bounds concurrency against SignNow.
    const PREFILL_BATCH = 12;
    /**
     * Each Exhibit C copy is prefilled from its own entity, exactly as the
     * review build does. Baking the shared `values` onto every copy is what
     * made `Exhibit C` and `Exhibit C (2)` show the same merchant, DBA and bank
     * details in SignNow no matter what the CRM held for the second copy.
     */
    const { entities: exhibitCEntities, documentTabValues } =
      await this.loadGroupDocumentPrefillContext(sendGroupId, values);
    console.info('[SignNow] baking send prefill for merchant PDF', {
      groupId: sendGroupId,
      documents: sendDocs.length,
      fulfilledRoles,
      exhibitCEntities: exhibitCEntities.length,
      crmPrefillKeys: Object.keys(values).filter((k) => values[k]).length,
    });
    const bakeDocuments = async (docs: typeof sendDocs, fresh: boolean) => {
      const failures: Array<{ doc: (typeof sendDocs)[number]; error: string }> = [];
      for (let i = 0; i < docs.length; i += PREFILL_BATCH) {
        const batch = docs.slice(i, i + PREFILL_BATCH);
        await Promise.all(
          batch.map(async (doc) => {
            try {
              const { values: docValues, isolated } = signNowDocumentPrefillValues(
                values,
                exhibitCEntities,
                String(doc.document_name || doc.name || '').trim(),
                documentTabValues,
              );
              await this.prefillDocument(client, doc.id, docValues, {
                exposeToMerchant: true,
                keepParty2,
                // A retry re-reads the document: the snapshot is what failed.
                remote: fresh ? undefined : doc.remote,
                // A copy's own entity outranks whatever an earlier send left on
                // the widget, otherwise copy 2 keeps copy 1's baked text. A copy
                // without one is just another page for this deal's merchant, so
                // it keeps what is there rather than being blanked.
                ignoreExistingFieldValues: isolated,
              });
            } catch (err) {
              failures.push({ doc, error: err instanceof Error ? err.message : String(err) });
            }
          }),
        );
      }
      return failures;
    };
    /**
     * SignNow can refuse the committing write on a document it is still
     * processing (the value write just before it, a lock not yet released).
     * Refused documents are retried on a fresh read after a pause, and a
     * document that still fails stops the send below.
     */
    let bakeFailures = await bakeDocuments(sendDocs, false);
    for (const pauseMs of SIGNNOW_PUBLISH_RETRY_PAUSES_MS) {
      if (!bakeFailures.length) break;
      console.warn('[SignNow] send bake refused; retrying', {
        groupId: sendGroupId,
        pauseMs,
        failures: bakeFailures.map((f) => ({ documentId: f.doc.id, error: f.error })),
      });
      await this.deleteEmbeddedInvites(
        client,
        sendGroupId,
        bakeFailures.map((f) => f.doc),
      );
      await sleepSignNow(pauseMs);
      bakeFailures = await bakeDocuments(
        bakeFailures.map((f) => f.doc),
        true,
      );
    }
    if (bakeFailures.length) {
      // Inviting now would email the merchant documents whose values never
      // reached them — the empty-contract send. Fail the send instead.
      throw new BadRequestException(
        `SignNow could not prepare ${bakeFailures
          .map((f) => `"${f.doc.document_name || f.doc.name || f.doc.id}"`)
          .join(', ')} for the merchant, so nothing was sent. ` +
          'Wait a moment and click Send via SignNow again. ' +
          `(${bakeFailures[0].error.slice(0, 200)})`,
      );
    }
    const inviteId = await this.sendGroupInvite(
      client,
      sendGroupId,
      sendDocs,
      signers,
      subject,
      options.ccEmails,
      fulfilledRoles,
      { requestId, attemptNumber: claim.attemptNumber, applicationId: options.applicationId },
    );
    const appId = String(options.applicationId || '').trim();
    // The invite is out: SignNow has emailed the merchant. Recording that and
    // classifying the envelope are independent reads/writes of the CRM.
    const [, isPackageEnvelope] = await Promise.all([
      markSignNowInviteSent({ envelopeId: sendGroupId, inviteId, requestId }),
      isStandalonePackageEnvelope(sendGroupId, {
        applicationId: appId || undefined,
      }),
    ]);
    if (isPackageEnvelope) {
      await updateStandalonePackageDocuSignStatus(sendGroupId, 'sent', {
        applicationId: appId || undefined,
      });
    } else if (appId) {
      await this.markGroupSent(appId, sendGroupId);
    }
    // The CC copy downloads the whole package PDF and emails every CC through
    // SendGrid. It is a courtesy copy, not part of the send, so it runs after
    // the response; a SendGrid failure can no longer fail (or stall) a send
    // SignNow already delivered.
    const ccPrefilledEmail = await this.queueCcRecipientsOnSend(
      sendGroupId,
      options.ccEmails,
      signers.map((s) => s.email),
      subject,
    ).catch((err) => {
      console.warn('[SignNow] queueCcRecipientsOnSend failed:', err);
      return { emailed: [] as string[], queued: [] as string[], skippedReason: 'error' };
    });
    return {
      success: true,
      envelopeId: sendGroupId,
      status: 'sent',
      url: null,
      ccPrefilledEmail,
    };
    } catch (error) {
      const existing = await this.peekGroupInviteId(id).catch(() => '');
      if (existing) {
        await markSignNowInviteSent({ envelopeId: id, inviteId: existing, requestId });
        const appId = String(options.applicationId || '').trim();
        if (appId) {
          const isPackageEnvelope = await isStandalonePackageEnvelope(id, {
            applicationId: appId,
          });
          if (isPackageEnvelope) {
            await updateStandalonePackageDocuSignStatus(id, 'sent', { applicationId: appId });
          } else {
            await this.markGroupSent(appId, id);
          }
        }
        logSignNowSend('Invite request successful', {
          contractId: id,
          requestId,
          signnowDocumentId: id,
          signnowInviteId: existing,
          sendStatus: 'SENT',
          attemptNumber: claim.attemptNumber,
          timestamp: new Date().toISOString(),
        });
        return {
          success: true,
          envelopeId: id,
          status: 'sent',
          url: null,
        };
      }
      await markSignNowInviteFailed({
        envelopeId: id,
        requestId,
        errorCode: error instanceof BadRequestException ? '400' : 'send_failed',
      });
      throw error;
    }
  }

  async voidGroup(
    groupId: string,
    options?: { applicationId?: string; reason?: string },
  ) {
    const id = String(groupId || '').trim();
    if (!id) throw new BadRequestException('Missing SignNow document group id');
    const voidReason = String(options?.reason || '').trim() || 'Voided by user from CRM';
    console.info('[SignNow] void group', { groupId: id, reason: voidReason });

    const client = await createSignNowApiClient();
    const groupRes = await client.get(`/documentgroup/${id}`, { validateStatus: () => true });
    if (groupRes.status >= 400) {
      throw new BadRequestException(
        groupRes.data?.errors?.[0]?.message || 'SignNow document group not found',
      );
    }
    const currentStatus = await this.resolveRemoteGroupStatus(client, id, groupRes.data);
    if (currentStatus === 'completed') {
      throw new BadRequestException(
        'This document is already completed in SignNow and cannot be voided. Send a new package instead.',
      );
    }

    const documents = this.normalizeGroupDocuments(groupRes.data?.documents);
    if (currentStatus !== 'voided') {
      await this.cancelExistingGroupInvite(client, id, groupRes.data, documents);
    }

    const appId = String(options?.applicationId || '').trim();
    const isAchEnvelope = await isStandaloneAchEnvelope(id, {
      applicationId: appId || undefined,
    });
    if (isAchEnvelope) {
      await updateAchAuthorizationDocuSignStatus(id, 'revoked', {
        applicationId: appId || undefined,
      });
      return {
        success: true,
        provider: 'signnow',
        achAuthorization: true,
        envelopeId: id,
        status: 'voided',
      };
    }

    const isPackageEnvelope = await isStandalonePackageEnvelope(id, {
      applicationId: appId || undefined,
    });
    if (isPackageEnvelope) {
      await updateStandalonePackageDocuSignStatus(id, 'revoked', {
        applicationId: appId || undefined,
      });
      return {
        success: true,
        provider: 'signnow',
        standalonePackage: true,
        envelopeId: id,
        status: 'voided',
      };
    }

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId: id },
      select: {
        applicationId: true,
        sentAt: true,
        completedAt: true,
      },
    });
    await prisma.document.updateMany({
      where: { envelopeId: id },
      data: { status: 'revoked' },
    });
    const resolvedAppId = appId || String(existingDoc?.applicationId || '').trim();
    if (resolvedAppId) {
      await this.syncContractSigningFromGroupStatus(id, 'revoked', resolvedAppId);
      const alreadyArchived = await updateArchivedContractSendHistoryStatus(
        resolvedAppId,
        id,
        'revoked',
        {
          sentAt: existingDoc?.sentAt
            ? new Date(existingDoc.sentAt).toISOString()
            : null,
          completedAt: existingDoc?.completedAt
            ? new Date(existingDoc.completedAt).toISOString()
            : null,
        },
      );
      if (!alreadyArchived) {
        await archiveMainContractEnvelopeToHistory(resolvedAppId, {
          envelopeId: id,
          status: 'revoked',
          sentAt: existingDoc?.sentAt,
          completedAt: existingDoc?.completedAt,
          resetContractToDraft: false,
        });
      }
    }

    return {
      success: true,
      provider: 'signnow',
      envelopeId: id,
      status: 'voided',
    };
  }

  /**
   * Once CRM already has signed / completed / voided, never call SignNow again
   * for status. Status polling is what burns the daily API budget after a few sends.
   */
  private async readTerminalGroupStatusFromCrm(
    groupId: string,
    applicationId?: string,
  ): Promise<string | null> {
    const id = String(groupId || '').trim();
    if (!id) return null;

    const terminalDoc = new Set([
      'completed',
      'signed',
      'revoked',
      'voided',
      'declined',
      'expired',
    ]);
    const mapTerminal = (raw: string): string => {
      const s = String(raw || '').trim().toLowerCase();
      if (s === 'completed' || s === 'signed') return 'completed';
      if (terminalDoc.has(s)) return 'voided';
      return '';
    };

    const doc = await prisma.document.findFirst({
      where: { envelopeId: id },
      select: { status: true, applicationId: true },
    });
    const fromDoc = mapTerminal(String(doc?.status || ''));
    if (fromDoc) return fromDoc;

    const appId = String(applicationId || doc?.applicationId || '').trim();
    if (!appId) return null;

    const contract = await prisma.contract.findFirst({
      where: { applicationId: appId },
      select: { status: true, application: { select: { document: { select: { envelopeId: true } } } } },
    });
    const linkedEnvelope = String(
      contract?.application?.document?.envelopeId || '',
    ).trim();
    if (linkedEnvelope === id) {
      const fromContract = mapTerminal(String(contract?.status || ''));
      if (fromContract) return fromContract;
    }

    return null;
  }

  async getGroupStatus(
    groupId: string,
    applicationId?: string,
  ): Promise<{ envelopeId: string; status: string; skippedRemote?: boolean; source?: string }> {
    const id = String(groupId || '').trim();
    const cached = await this.readTerminalGroupStatusFromCrm(id, applicationId);
    if (cached) {
      if (cached === 'completed') {
        void this.reconcileCcSignedNotice(id, applicationId).catch((err) =>
          console.warn(`[SignNow] CC signed notice reconcile failed for ${id}:`, err),
        );
      }
      return {
        envelopeId: id,
        status: cached,
        skippedRemote: true,
        source: 'crm',
      };
    }

    const client = await createSignNowApiClient();
    const res = await client.get(`/documentgroup/${id}`, { validateStatus: () => true });
    const status = await this.resolveRemoteGroupStatus(client, id, res.data);

    // Persist completed / voided into CRM the first time SignNow reports it.
    // Later polls must not reach here — readTerminalGroupStatusFromCrm returns first.
    if (status === 'completed' || status === 'voided') {
      await this.persistTerminalGroupStatus(id, status, applicationId, res.data);
      return { envelopeId: id, status };
    }

    const reverted = await this.revertPrematureSentIfOwnerReview(
      client,
      id,
      applicationId,
      res.data,
    );

    /**
     * SignNow has no webhook, so this refresh is the only moment CRM learns the
     * group is genuinely out for signature. Mirror it onto Contract /
     * Application so the summary header reads Contract Sent instead of sitting
     * on Contract Generated until completion. Skipped when the revert above
     * just decided this is still an unfinished Owner review.
     */
    if (status === 'sent' && !reverted) {
      await prisma.document.updateMany({
        where: { envelopeId: id, sentAt: null },
        data: { status: 'sent', sentAt: new Date() } as any,
      });
      await this.syncContractSigningFromGroupStatus(id, 'sent', applicationId);
    }

    return { envelopeId: id, status };
  }

  /**
   * Write a final SignNow status onto Document + Contract, move the deal
   * (Contract Signed / voided) and, on completion, archive the signed PDF and
   * send the completion / CC notice. Shared by the live status read and the
   * verified webhook, which already knows the group finished.
   */
  private async persistTerminalGroupStatus(
    id: string,
    status: 'completed' | 'voided',
    applicationId: string | undefined,
    groupPayload: unknown,
  ): Promise<void> {
    const mappedInternal = status === 'voided' ? 'revoked' : status;
    const isPackageEnvelope = await isStandalonePackageEnvelope(id, {
      applicationId: applicationId || undefined,
    });
    if (isPackageEnvelope) {
      await updateStandalonePackageDocuSignStatus(id, mappedInternal, {
        applicationId: applicationId || undefined,
      });
      return;
    }
    await prisma.document.updateMany({
      where: { envelopeId: id },
      data: {
        status: mappedInternal,
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
      } as any,
    });
    await this.syncContractSigningFromGroupStatus(id, mappedInternal, applicationId);
    if (status === 'completed') {
      // Warm the Cloudinary archive as soon as SignNow reports completion
      // (webhook or manual refresh) so the "eye" preview never needs a live
      // SignNow GET for a finished contract. The same buffer then rides
      // along on the CRM completion notice, so the contracts inbox gets one
      // email whose subject actually names the deal.
      void this.notifyContractsInboxOnCompletion(id, applicationId, groupPayload).catch((err) =>
        console.warn(`[SignNow] completion notice failed for ${id}:`, err),
      );
    }
  }

  /**
   * A `document_group.complete` / `…invite.declined` webhook whose HMAC
   * signature checked out.
   *
   * SignNow only sends completion once every document in the group is signed,
   * and the signature proves SignNow sent it, so the final status is persisted
   * straight away — no `GET /documentgroup` round trip (which can still read
   * "sent" for a few seconds after the event). Already-final contracts are
   * left alone, so SignNow's retries are no-ops.
   */
  async applyVerifiedGroupStatus(
    groupId: string,
    status: 'completed' | 'voided',
    applicationId?: string,
  ): Promise<{ envelopeId: string; status: string; source: string }> {
    const id = String(groupId || '').trim();
    const cached = await this.readTerminalGroupStatusFromCrm(id, applicationId);
    if (cached) return { envelopeId: id, status: cached, source: 'crm' };
    await this.persistTerminalGroupStatus(id, status, applicationId, null);
    return { envelopeId: id, status, source: 'webhook' };
  }

  /**
   * Archive the signed package, then send it to the submissions inbox and to
   * everyone CC'd at send time.
   *
   * SignNow's own owner email is always subject-lined "Your documents are
   * signed", so an inbox that takes many contracts a day cannot tell them
   * apart. This runs once, on the first poll/webhook that reports completion
   * (`readTerminalGroupStatusFromCrm` short-circuits every later one), and
   * reuses the archive download as the notice's attachment rather than
   * pulling the package from SignNow twice.
   *
   * The CC addresses recorded at send time are copied as well, so the people who
   * received the unsigned package also learn it is signed and get the final
   * copy — the send-side courtesy, repeated at completion.
   */
  private async notifyContractsInboxOnCompletion(
    groupId: string,
    applicationId: string | undefined,
    groupPayload: unknown,
  ): Promise<void> {
    let pdf: Buffer | null = null;
    try {
      pdf = await this.downloadGroupPdf(groupId, {
        applicationId: applicationId || undefined,
      });
    } catch (err) {
      console.warn(`[SignNow] proactive signed PDF archive failed for ${groupId}:`, err);
    }

    const ccEmails = await this.readSignedNoticeCcRecipients(groupId, applicationId);
    if (!resolveSignNowCompletionNoticeRecipients().length && !ccEmails.length) return;

    const documents = this.normalizeGroupDocuments(
      (groupPayload as { documents?: unknown } | null)?.documents,
    );
    const contractLabel = await this.resolveInviteEmailSubject({
      applicationId: applicationId || undefined,
      fallbackGroupName: String(
        (groupPayload as { group_name?: string } | null)?.group_name || '',
      ),
    });

    const notice = await sendSignNowCompletionNotice({
      groupId,
      applicationId: applicationId || null,
      contractLabel,
      pdf,
      documentNames: documents.map((doc) => String(doc.document_name || doc.name || '')),
      ccEmails,
    });
    await this.rememberCcSignedNoticeForGroup(groupId, notice.ccReached);
  }

  /**
   * Make sure a completed envelope's CC list got the signed-contract notice,
   * and that the Document records it.
   *
   * The notice is sent once, on the first status read that sees completion;
   * every later read is answered from the CRM, so a notice that failed (SMTP
   * down, process restart mid-send) or was sent before delivery was recorded
   * would stay "pending" forever. This runs on each later read instead:
   *
   * - a notice already in the outbound log is recorded as-is, never re-sent;
   * - CC addresses it never reached are emailed now, CC-only, with the signed
   *   PDF from the Cloudinary archive (no SignNow call once archived).
   *
   * Returns the record when it could be settled from the log synchronously, so
   * a caller can show it on the response it is building. Sending runs in the
   * background.
   */
  async reconcileCcSignedNotice(
    groupId: string,
    applicationId?: string | null,
  ): Promise<{ ccSignedNoticeSentAt: Date; ccSignedNoticeEmails: string[] } | null> {
    const id = String(groupId || '').trim();
    if (!id || !isSignNowEnvelopeId(id)) return null;
    const doc = (await prisma.document.findFirst({
      where: { envelopeId: id },
      select: {
        status: true,
        applicationId: true,
        ccEmails: true,
        ccSignedNoticeSentAt: true,
        ccSignedNoticeEmails: true,
      } as any,
    })) as {
      status?: string;
      applicationId?: string;
      ccEmails?: string[];
      ccSignedNoticeSentAt?: Date | null;
      ccSignedNoticeEmails?: string[];
    } | null;
    if (!doc || String(doc.status || '').toLowerCase() !== 'completed') return null;
    if (doc.ccSignedNoticeSentAt) {
      return {
        ccSignedNoticeSentAt: doc.ccSignedNoticeSentAt,
        ccSignedNoticeEmails: doc.ccSignedNoticeEmails || [],
      };
    }
    const ccEmails = await this.readSignedNoticeCcRecipients(
      id,
      String(applicationId || doc.applicationId || '').trim() || undefined,
    );
    if (!ccEmails.length) return null;

    const logged = await findLoggedSignNowCompletionNotice(id, ccEmails);
    const reached = logged?.ccReached || [];
    const missing = ccEmails.filter(
      (e) => !reached.some((r) => r.toLowerCase() === e.toLowerCase()),
    );
    if (logged && reached.length && !missing.length) {
      await this.recordCcSignedNotice(id, logged.sentAt, reached);
      return { ccSignedNoticeSentAt: logged.sentAt, ccSignedNoticeEmails: reached };
    }

    const last = ccNoticeCatchUpAttempts.get(id);
    if (ccNoticeCatchUpInflight.has(id) || (last && Date.now() - last < CC_NOTICE_RETRY_MS)) {
      return null;
    }
    ccNoticeCatchUpInflight.add(id);
    ccNoticeCatchUpAttempts.set(id, Date.now());
    const appId = String(applicationId || doc.applicationId || '').trim() || undefined;
    void this.sendCcSignedNoticeCatchUp(id, appId, missing, reached)
      .catch((err) => console.warn(`[SignNow] CC signed notice catch-up failed for ${id}:`, err))
      .finally(() => ccNoticeCatchUpInflight.delete(id));
    return null;
  }

  private async sendCcSignedNoticeCatchUp(
    groupId: string,
    applicationId: string | undefined,
    missing: string[],
    alreadyReached: string[],
  ): Promise<void> {
    let pdf: Buffer | null = null;
    try {
      pdf = await this.downloadGroupPdf(groupId, { applicationId: applicationId || undefined });
    } catch (err) {
      console.warn(`[SignNow] CC signed notice: signed PDF unavailable for ${groupId}:`, err);
    }
    const contractLabel = await this.resolveInviteEmailSubject({
      applicationId: applicationId || undefined,
      fallbackGroupName: '',
    });
    const notice = await sendSignNowCompletionNotice({
      groupId,
      applicationId: applicationId || null,
      contractLabel,
      pdf,
      ccEmails: missing,
      ccOnly: true,
    });
    if (notice.ccReached.length) {
      await this.recordCcSignedNotice(groupId, new Date(), [...alreadyReached, ...notice.ccReached]);
    }
  }

  /**
   * Widget type + validator per field name, so phone / SSN values can be sent
   * dashed on plain text widgets and digits-only on Number-validated ones.
   */
  private collectPrefillableFieldWidgets(remote: any): Map<string, SigningWidgetInfo> {
    const widgets = new Map<string, SigningWidgetInfo>();
    for (const container of ['texts', 'fields', 'fillable_fields'] as const) {
      const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
      for (const field of rows) {
        if (!field || typeof field !== 'object') continue;
        const attrs = parseSignNowFieldAttrs(field);
        const name = String(
          attrs.name || field.name || field.field_name || attrs.label || field.label || '',
        ).trim();
        if (!name || widgets.has(name)) continue;
        widgets.set(name, {
          type: signNowFieldType(field, container),
          validatorId: String(attrs.validator_id || field.validator_id || '').trim(),
        });
      }
    }
    return widgets;
  }

  private collectPrefillableFieldNames(remote: any): string[] {
    const names: string[] = [];
    const skipType = new Set(['signature', 'initials', 'checkmark', 'checkbox', 'radiobutton', 'attachment']);
    for (const container of ['texts', 'fields', 'fillable_fields'] as const) {
      const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
      for (const field of rows) {
        if (!field || typeof field !== 'object') continue;
        const attrs = parseSignNowFieldAttrs(field);
        const type = String(field.type || attrs.type || '').toLowerCase();
        if (type && skipType.has(type)) continue;
        const name = String(
          attrs.name || field.name || field.field_name || attrs.label || field.label || '',
        ).trim();
        if (name) names.push(name);
      }
    }
    return uniqueRoleNames(names);
  }

  /**
   * Write CRM values onto SignNow fields and commit `texts[].data` so the
   * downloaded PDF is not blank. Owner review still uses Owner-assigned fields.
   * Independent documents are prefilled in parallel; each document still runs
   * GET → prefill-texts → optional field PUT sequentially.
   */
  private async prefillDocumentsForReview(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
    values: Record<string, string>,
    signers: Array<{ name: string; email: string; roleName: string }>,
    /** One per Exhibit C copy, from `resolveExhibitCEntities`. */
    entities: ExhibitCEntityPrefillRow[] = [],
    documentTabValues: SignNowDocumentTabValues[] = [],
  ): Promise<{ applied: number; attempted: number; outcomes: ReviewPrefillOutcome[] }> {
    const keepParty2 = Boolean(distinctSecondMerchant(signers));
    const usable = documents.filter((doc) => String(doc.id || '').trim());
    const plans: ReviewPrefillPlan[] = usable.map((doc) => {
      const documentName = String(doc.document_name || doc.name || '').trim();
      const { values: docValues, isolated } = signNowDocumentPrefillValues(
        values,
        entities,
        documentName,
        documentTabValues,
      );
      return {
        documentId: String(doc.id || '').trim(),
        documentName,
        values: docValues,
        remote: doc.remote,
        keepParty2,
        /**
         * Only a copy that carries an entity of its own discards what is
         * already on the widget. Every Exhibit C copy used to, and a copy
         * whose values the package could not supply was then emptied to the
         * bare agreement date the overlay always stamps — the "date and
         * nothing else" page, on Nitro, Obsidian and Tiberian alike.
         */
        ignoreExistingFieldValues: isolated,
      };
    });
    const outcomes = await Promise.all(
      plans.map((plan) => this.prefillReviewDocument(client, plan)),
    );
    return {
      applied: outcomes.reduce((sum, row) => sum + row.applied, 0),
      attempted: outcomes.reduce((sum, row) => sum + row.attempted, 0),
      outcomes,
    };
  }

  /** One document's Owner-review prefill, with the write-level retries. */
  private async prefillReviewDocument(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    plan: ReviewPrefillPlan,
  ): Promise<ReviewPrefillOutcome> {
    const id = plan.documentId;
    const options = {
      exposeToMerchant: false,
      keepParty2: plan.keepParty2,
      remote: plan.remote,
      ignoreExistingFieldValues: plan.ignoreExistingFieldValues,
    };
    try {
      const first = await this.prefillDocument(client, id, plan.values, options);
      /**
       * The write is checked, not assumed: a document that had CRM values to write
       * but published none did not take the prefill, and Review would otherwise open
       * on it empty. Re-read it from SignNow (no cached `remote`) and write once more
       * — the retry is on the failure, so a document that took its values first time
       * costs nothing.
       *
       * `attempted === 0` is the same failure one step earlier: the document
       * offered no prefillable widget at all. On a freshly copied addendum
       * that means SignNow had not finished attaching them yet, and a
       * cached `remote` from before they arrived will keep saying so — so
       * the retry deliberately re-reads the document.
       */
      if ((first.matched > 0 && first.applied === 0) || first.attempted === 0) {
        console.warn('[SignNow] prefill wrote no fields; retrying document once', {
          documentId: id,
          documentName: plan.documentName,
          matched: first.matched,
          attempted: first.attempted,
        });
        const retry = await this.prefillDocument(client, id, plan.values, {
          ...options,
          remote: undefined,
        });
        return { plan, ...(retry.applied > 0 ? retry : first) };
      }
      return { plan, ...first };
    } catch (err) {
      // One slow/failed doc must not wipe success on the agreement or abort Review.
      console.warn(
        '[SignNow] prefill document threw; retrying document once',
        { documentId: id, error: err instanceof Error ? err.message : String(err) },
      );
      try {
        const retry = await this.prefillDocument(client, id, plan.values, {
          ...options,
          remote: undefined,
        });
        return { plan, ...retry };
      } catch (retryErr) {
        console.warn(
          '[SignNow] prefill retry failed; continuing with remaining docs',
          {
            documentId: id,
            error:
              retryErr instanceof Error ? retryErr.message : String(retryErr),
          },
        );
        return {
          plan,
          applied: 0,
          attempted: 0,
          matched: 0,
          written: [],
          plannedFieldNames: [],
        };
      }
    }
  }

  /**
   * Read every document back from SignNow and report what is still empty.
   *
   * Always a fresh `GET /document/{id}` — never the cached `remote` the write
   * was planned from, because that snapshot is exactly what can be missing the
   * widgets SignNow attached afterwards.
   */
  private async checkReviewPrefill(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    outcomes: ReviewPrefillOutcome[],
    options: { requireFields: boolean },
  ): Promise<ReviewPrefillReadBack[]> {
    return Promise.all(
      outcomes.map(async (outcome): Promise<ReviewPrefillReadBack> => {
        const { documentId, documentName } = outcome.plan;
        const base: SignNowReviewPrefillCheck = {
          documentId,
          documentName,
          missing: [],
          unreadable: false,
          withoutFields: false,
        };
        let res: { status: number; data?: any } = { status: 0 };
        try {
          res = await client.get(`/document/${documentId}`, { validateStatus: () => true });
        } catch (err) {
          console.warn('[SignNow] review prefill read-back threw', {
            documentId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        if (res.status < 200 || res.status >= 400) {
          return { outcome, check: { ...base, unreadable: true }, remote: undefined };
        }
        const remote = res.data;
        const fieldNames = this.collectPrefillableFieldNames(remote);
        const prefillOpts = signNowPrefillOptionsForDocument(
          remote?.document_name || remote?.name || documentName,
          fieldNames,
        );
        const expected: Record<string, string> = {};
        const resolvable = fieldNames.filter((name) => {
          if (shouldSkipSignNowPrefill(name, prefillOpts)) return false;
          const value = formatSignNowPrefillValue(
            resolveSignNowPrefillValue(name, outcome.plan.values, prefillOpts),
          );
          if (value) expected[name] = value;
          return Boolean(value);
        });
        const required = requiredReviewPrefillFields({
          resolvable,
          planned: outcome.plannedFieldNames,
          written: outcome.written,
        });
        return {
          outcome,
          remote,
          check: {
            ...base,
            missing: missingReviewPrefillFields(remote, required, expected),
            withoutFields:
              options.requireFields &&
              countSignNowDocumentFields(remote) === 0 &&
              (await this.originTemplateHasFields(client, remote)),
          },
        };
      }),
    );
  }

  /**
   * A field-less copy is only "not loaded yet" when the template it came from
   * has widgets to bring across. A document with no widgets on its template
   * (an information-only page) is complete as it is, and must not hold Review
   * back forever. When the origin cannot be told, it is given the benefit of
   * the doubt — the same as before this check existed.
   */
  private async originTemplateHasFields(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    remote: any,
  ): Promise<boolean> {
    const originId = signNowOriginDocumentId(remote);
    if (!originId || originId === String(remote?.id || '')) return false;
    try {
      const template = await this.fetchTemplateDocumentCached(client, originId);
      return countSignNowDocumentFields(template) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Gate in front of the review link: confirm every Disclosure / Contract /
   * Addendum carries its CRM values, re-prefill from a fresh read whatever does
   * not, and refuse to open Review on a package that never completes.
   *
   * The pause between rounds only paces SignNow while it finishes attaching a
   * copy's widgets; what releases the link is the read-back itself.
   */
  private async ensureReviewPrefillComplete(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    initial: ReviewPrefillOutcome[],
    options: { requireFields: boolean },
  ): Promise<{ rounds: number; repaired: number }> {
    let outcomes = initial;
    let repaired = 0;
    let readBack: ReviewPrefillReadBack[] = [];
    for (let round = 1; round <= REVIEW_PREFILL_CHECK_ROUNDS; round += 1) {
      if (round > 1) countSignNowPoll();
      readBack = await this.checkReviewPrefill(client, outcomes, options);
      const checks = readBack.map((row) => row.check);
      if (reviewPrefillIsComplete(checks)) {
        logSignNowTiming('review-prefill-verified', 0, {
          groupId,
          rounds: round,
          repaired,
          documents: checks.length,
        });
        return { rounds: round, repaired };
      }
      const incomplete = incompleteReviewPrefillDocuments(checks);
      console.warn('[SignNow] review prefill incomplete on read-back', {
        groupId,
        round,
        documents: incomplete.map((c) => ({
          documentId: c.documentId,
          documentName: c.documentName,
          unreadable: c.unreadable,
          withoutFields: c.withoutFields,
          missing: c.missing.slice(0, 20),
        })),
      });
      if (round === REVIEW_PREFILL_CHECK_ROUNDS) break;
      await sleepSignNow(REVIEW_PREFILL_RETRY_PAUSE_MS * round);
      const redo = new Set(incomplete.map((c) => c.documentId));
      outcomes = await Promise.all(
        readBack.map(async ({ outcome, remote }) => {
          if (!redo.has(outcome.plan.documentId)) return outcome;
          repaired += 1;
          countSignNowRetry();
          // Plan against what SignNow holds now, not the snapshot that missed
          // widgets. An unreadable or field-less document re-reads in the prefill.
          const fresh = remote && countSignNowDocumentFields(remote) > 0 ? remote : undefined;
          const redone = await this.prefillReviewDocument(client, {
            ...outcome.plan,
            remote: fresh,
          });
          // Everything the earlier writes sent must still be on the document.
          return {
            ...redone,
            written: [...outcome.written, ...redone.written],
            plannedFieldNames: [...outcome.plannedFieldNames, ...redone.plannedFieldNames],
          };
        }),
      );
    }
    throw new BadRequestException(
      describeIncompleteReviewPrefill(readBack.map((row) => row.check)),
    );
  }

  /**
   * Review prefill: resolve CRM values onto each document's real unique names
   * (e.g. `Text Field 1`, `authorization_client_name_p1`), then PUT prefill-texts.
   */
  private async prefillDocumentsFast(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
    values: Record<string, string>,
  ): Promise<{ applied: number; attempted: number }> {
    if (!documents.length) {
      return { applied: 0, attempted: 0 };
    }
    const fallbackFields = expandSignNowPrefillForUnguidedPut(values);
    const results = await Promise.all(
      documents.map(async (doc) => {
        const id = String(doc.id || '').trim();
        if (!id) return 0;
        const docRes = await client.get(`/document/${id}`, {
          validateStatus: () => true,
        });
        const fieldNames =
          docRes.status < 400
            ? this.collectPrefillableFieldNames(docRes.data)
            : [];
        const documentName =
          doc.document_name ||
          doc.name ||
          docRes.data?.document_name ||
          docRes.data?.name;
        const prefillOpts = signNowPrefillOptionsForDocument(documentName, fieldNames);
        const widgets =
          docRes.status < 400
            ? this.collectPrefillableFieldWidgets(docRes.data)
            : undefined;
        const fields = fieldNames.length
          ? buildSignNowDocumentPrefillTexts(fieldNames, values, prefillOpts, widgets)
          : fallbackFields;
        if (!fields.length) return 0;
        const first = await client.put(
          `/v2/documents/${id}/prefill-texts`,
          { fields },
          { validateStatus: () => true },
        );
        if (first.status < 400) return fields.length;
        const second = await client.put(
          `/v2/documents/${id}/prefill-text`,
          { fields },
          { validateStatus: () => true },
        );
        if (second.status < 400) return fields.length;
        console.warn(
          '[SignNow] fast prefill-texts failed',
          id,
          this.signNowErrorDetail(first),
        );
        return 0;
      }),
    );
    const applied = results.reduce((sum, n) => sum + n, 0);
    return { applied, attempted: applied };
  }

  private async prefillDocument(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documentId: string,
    values: Record<string, string>,
    exposeToMerchant:
      | boolean
      | {
          exposeToMerchant?: boolean;
          keepParty2?: boolean;
          remote?: any;
          ignoreExistingFieldValues?: boolean;
        } = false,
  ): Promise<{
    applied: number;
    attempted: number;
    matched: number;
    /** Widget names this write sent a value to. */
    written: string[];
    /** Widget names the write was planned against (the snapshot it read). */
    plannedFieldNames: string[];
  }> {
    const expose =
      typeof exposeToMerchant === 'boolean'
        ? exposeToMerchant
        : Boolean(exposeToMerchant.exposeToMerchant);
    const keepParty2 =
      typeof exposeToMerchant === 'boolean'
        ? true
        : exposeToMerchant.keepParty2 !== false;
    const cachedRemote =
      typeof exposeToMerchant === 'object' ? exposeToMerchant.remote : undefined;
    const ignoreExisting =
      typeof exposeToMerchant === 'object'
        ? Boolean(exposeToMerchant.ignoreExistingFieldValues)
        : false;
    const prefillGetStarted = Date.now();
    const docRes = cachedRemote
      ? { status: 200, data: cachedRemote }
      : await client.get(`/document/${documentId}`, { validateStatus: () => true });
    if (!cachedRemote) {
      logSignNowTiming('document-prefill-get', Date.now() - prefillGetStarted, {
        documentId,
        documentName: String(docRes.data?.document_name || docRes.data?.name || ''),
      });
    }
    const fieldNames = this.collectPrefillableFieldNames(docRes.data);
    const prefillOpts = signNowPrefillOptionsForDocument(
      docRes.data?.document_name || docRes.data?.name,
      fieldNames,
    );
    const mergedValues = ignoreExisting
      ? { ...values }
      : {
          ...existingValuesBeneathCrmValues(
            collectExistingSignNowFieldValues(docRes.data, {
              skipCommittedTexts: expose,
            }),
            fieldNames,
            values,
            prefillOpts,
          ),
          ...values,
        };
    const unmatched: string[] = [];
    const filledSample: string[] = [];
    for (const name of fieldNames) {
      if (shouldSkipSignNowPrefill(name, prefillOpts)) continue;
      if (formatSignNowPrefillValue(resolveSignNowPrefillValue(name, mergedValues, prefillOpts))) {
        filledSample.push(name);
      } else {
        unmatched.push(name);
      }
    }

    const report = { written: [] as string[] };
    const applied = await this.publishOwnerPrefillToMerchant(client, documentId, {
      exposeToMerchant: expose,
      keepParty2,
      remote: docRes.data,
      values: mergedValues,
      report,
      clearUnresolvedValues: ignoreExisting,
    });

    console.info('[SignNow] prefill document', {
      documentId,
      fieldNames: fieldNames.length,
      applied,
      unmatchedSample: unmatched.slice(0, 20),
      unmatchedRefs: unmatched.filter((name) =>
        /guarantor_name|ref_|ach_user|ach_pass|ach_security|ach_bank_/i.test(name),
      ),
      filledSample: filledSample.slice(0, 12),
    });
    return {
      applied,
      attempted: filledSample.length + unmatched.length,
      matched: filledSample.length,
      written: report.written,
      plannedFieldNames: fieldNames,
    };
  }

  /**
   * Write CRM values onto the document. Owner review stays unlocked widgets.
   * Merchant send stamps filled values as page text (no field boxes), same as
   * addenda/disclosures. Signature/initials stay fillable.
   *
   * PUT /document/{id} overwrites every field. Signature/initials must be
   * included in the same payload or SignNow deletes them.
   */
  private async publishOwnerPrefillToMerchant(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documentId: string,
    options:
      | boolean
      | {
          exposeToMerchant?: boolean;
          keepParty2?: boolean;
          remote?: any;
          values?: Record<string, string>;
          /** Filled with the widget names this publish sent a value to. */
          report?: { written: string[] };
          /**
           * Blank a widget the CRM has no value for instead of keeping the text
           * already on it. Set for an Exhibit C copy that carries its own entity:
           * its widgets arrive holding whatever an earlier write left (the
           * template copy, the warm, a previous Review), and on a copy that is
           * Exhibit C #1's merchant and bank.
           */
          clearUnresolvedValues?: boolean;
        } = false,
  ): Promise<number> {
    const exposeToMerchant =
      typeof options === 'boolean' ? options : Boolean(options.exposeToMerchant);
    const clearUnresolvedValues =
      typeof options === 'boolean' ? false : Boolean(options.clearUnresolvedValues);
    const report = typeof options === 'boolean' ? undefined : options.report;
    const keepParty2 = typeof options === 'boolean' ? true : options.keepParty2 !== false;
    const values = typeof options === 'boolean' ? {} : options.values || {};
    let remote = typeof options === 'boolean' ? null : options.remote;
    if (!remote) {
      const getStarted = Date.now();
      const docRes = await client.get(`/document/${documentId}`, { validateStatus: () => true });
      logSignNowTiming('document-prefill-get', Date.now() - getStarted, { documentId });
      if (docRes.status >= 400) return 0;
      remote = docRes.data;
    }
    const documentName = String(
      remote?.document_name || remote?.name || remote?.original_filename || '',
    ).trim();
    const monthlyFee = isMonthlyFeeDocumentName(documentName);
    const pageCount = signNowDocumentPageCount(remote);
    const shortDoc = pageCount > 0 && pageCount <= 2;
    const supplementalDoc =
      monthlyFee ||
      isSupplementalSignNowDocumentName(documentName) ||
      (shortDoc && !/agreement|pcm[_ ]?contract/i.test(documentName));
    const exhibitCDoc = isExhibitCDocumentName(documentName);
    // Signer (merchant) view: filled CRM values are stamped as page text, so this
    // publish owns the document's `texts` and rewrites them from scratch below.
    const bakeFilledText = Boolean(exposeToMerchant);
    let sourceFields = collectSignNowPutFields(remote, {
      ...(monthlyFee || shortDoc || exhibitCDoc ? { defaultRole: 'Recipient 1' } : {}),
      skipCommittedTexts: bakeFilledText,
    });
    const basePrefillOpts = signNowPrefillOptionsForDocument(
      documentName,
      sourceFields.map((field) => String(field.name || '')),
    );
    // The title already said Exhibit C even when the widget list did not, and the
    // options now always carry the document's widget canons — so the kind is
    // merged in rather than replacing the whole object.
    const kindOpts =
      basePrefillOpts?.documentKind || !exhibitCDoc
        ? basePrefillOpts
        : { ...(basePrefillOpts || {}), documentKind: 'exhibit_c' as const };
    const isExhibitC =
      exhibitCDoc || kindOpts?.documentKind === 'exhibit_c';
    // A copy with its own entity prints only that entity (see the option).
    const prefillOpts =
      isExhibitC && clearUnresolvedValues
        ? { ...(kindOpts || {}), documentKind: 'exhibit_c' as const, exhibitCEntityOnly: true }
        : kindOpts;
    sourceFields = fieldsOnExistingPages(sourceFields, pageCount);
    const signCount = sourceFields.filter((field) =>
      SIGN_FIELD_TYPES.has(String(field.type || '')),
    ).length;
    /** Set when the restore below puts this document's own signature widgets back. */
    let restoredSignFields = false;
    /**
     * Every document — agreement, addenda, disclosures — is rebuilt against the
     * template it was copied from, not just the agreement and Exhibit C.
     *
     * A merchant publish bakes filled CRM values into page `texts` and deletes
     * the widgets they came from, and SignNow keeps no field name on a committed
     * text. So on a resend a supplemental document had no widget left for the
     * edited value to land on: nothing covered the old stamp, and
     * `mergeCommittedSignNowTexts` carried it forward. That is why an Offer
     * Amount edit reached the agreement (which always restored from its
     * template) but not the addenda or the disclosure.
     *
     * For a first-time send the live copy still has every widget, so the restore
     * matches nothing and this path is a no-op.
     */
    {
      try {
        /**
         * Exhibit C is resolved from one global template id for every funder, so
         * the document this restores from is often not the one this copy was made
         * from — Nitro's Exhibit C names every widget, Obsidian's ships with
         * SignNow's default `Text Field 1` … `Text Field 11` on the same lines.
         * `mergeMissingSignerFieldsFromTemplate` drops anything that would land
         * on an occupied spot, which is what keeps that mismatch harmless.
         */
        /**
         * `origin_document_id` is SignNow's own record of the template document
         * this copy was made from, so it is right for every document in the
         * group regardless of what the copy ended up being called. The
         * name-driven resolution below it stays as the fallback for older
         * groups that carry no origin.
         *
         * Without it, a document whose title matches neither the agreement nor
         * `isSupplementalSignNowDocumentName` fell through to
         * `resolveAgreementDocumentId` and was rebuilt from the AGREEMENT. That
         * is what happened to the Tiberian disclosure, which the funder titled
         * just "TIBERIAN FUNDING": it has no "disclosure" / "addendum" /
         * "exhibit" in its name and is 3 pages (so not `shortDoc` either), so
         * the agreement's pages 0-2 widgets were merged onto it and baked as
         * page text at the agreement's coordinates — the contract's legal name,
         * addresses, money row, owner names, SSNs and phones printed on top of
         * the disclosure's own text.
         */
        const templateId = isExhibitC
          ? await this.resolveExhibitCDocumentId(client)
          : signNowOriginDocumentId(remote) ||
            (supplementalDoc
              ? await this.resolveSupplementalOriginDocumentId(client, documentName)
              : await this.resolveAgreementDocumentId(client));
        if (templateId && templateId !== documentId) {
          const templateData = await this.fetchTemplateDocumentCached(client, templateId);
          if (templateData) {
            const templatePages = signNowDocumentPageCount(templateData);
            const fromTemplate = fieldsOnExistingPages(
              collectSignNowPutFields(templateData, {
                ...(isExhibitC ? { defaultRole: 'Recipient 1' } : {}),
              }),
              pageCount || templatePages,
            );
            if (!pageCount || !templatePages || templatePages === pageCount) {
              const face = overlayTemplateFieldFace(sourceFields, fromTemplate);
              if (face.staleBoxes > 0) {
                /**
                 * The snapshot is behind the template the live copy was made
                 * from. Drop it so the next publish reads the current widget
                 * boxes instead of shrinking them again for another 24h.
                 */
                await this.invalidateTemplateDocumentCache(templateId);
                console.info('[SignNow] refreshed stale template face cache', {
                  documentId,
                  templateId,
                  staleBoxes: face.staleBoxes,
                });
              }
              if (signCount === 0) {
                const fromSigns = fromTemplate.filter((field) =>
                  SIGN_FIELD_TYPES.has(String(field.type || '')),
                );
                if (fromSigns.length) {
                  sourceFields = [...sourceFields, ...fromSigns];
                  restoredSignFields = true;
                  console.info('[SignNow] restored signature fields from template', {
                    documentId,
                    templateId,
                    restored: fromSigns.length,
                  });
                }
              }
            }
            const beforeRequired = sourceFields.length;
            /**
             * A template with a different page count is not this document's
             * template, whatever resolution picked it, and its widgets can only
             * land on the wrong lines here. The field-face overlay above has
             * always been guarded this way; the merge was not, which is how the
             * agreement's first three pages of widgets reached a 3-page
             * disclosure (they survived `fieldsOnExistingPages`, because pages
             * 0-2 exist on both documents).
             */
            const templateMatchesDocument =
              !pageCount || !templatePages || templatePages === pageCount;
            sourceFields = !templateMatchesDocument
              ? sourceFields
              : mergeMissingSignerFieldsFromTemplate(
              sourceFields,
              fromTemplate,
              {
                ...(isExhibitC ? { documentKind: 'exhibit_c' as const } : prefillOpts),
                // A merchant publish is CRM-driven end to end: bring back every
                // widget an earlier bake deleted so this send's values can land
                // on them instead of the page keeping the previous stamp.
                ...(bakeFilledText ? { restoreAllTextFields: true } : {}),
              },
            );
            if (!templateMatchesDocument) {
              console.warn('[SignNow] skipped field restore from a template of a different size', {
                documentId,
                documentName,
                templateId,
                pageCount,
                templatePages,
              });
            }
            if (sourceFields.length > beforeRequired) {
              console.info('[SignNow] restored missing signer fields from template', {
                documentId,
                templateId,
                exhibitC: isExhibitC,
                restored: sourceFields.length - beforeRequired,
              });
            }
          }
        }
      } catch (err) {
        console.warn('[SignNow] could not restore field face from template', err);
      }
    }
    // Fallback for a supplemental whose own template could not be resolved: the
    // agreement template is the only source of signature widgets left.
    if (
      supplementalDoc &&
      !isExhibitC &&
      !restoredSignFields &&
      signCount === 0 &&
      pageCount > 2
    ) {
      try {
        const templateId = await this.resolveAgreementDocumentId(client);
        if (templateId && templateId !== documentId) {
          // Same origin template the field-face overlay above reads — go through
          // the shared cache instead of a second full GET of the same document.
          const templateData = await this.fetchTemplateDocumentCached(client, templateId);
          if (templateData) {
            const templatePages = signNowDocumentPageCount(templateData);
            if (!pageCount || !templatePages || templatePages === pageCount) {
              const fromTemplate = fieldsOnExistingPages(
                collectSignNowPutFields(templateData).filter((field) =>
                  SIGN_FIELD_TYPES.has(String(field.type || '')),
                ),
                pageCount,
              );
              if (fromTemplate.length) {
                sourceFields = [...sourceFields, ...fromTemplate];
                console.info('[SignNow] restored signature fields from template', {
                  documentId,
                  templateId,
                  restored: fromTemplate.length,
                });
              }
            }
          }
        }
      } catch (err) {
        console.warn('[SignNow] could not restore signature fields from template', err);
      }
    }
    const roles = uniqueRoleNames([
      ...collectDocumentRoles(remote),
      ...sourceFields.map((field) => String(field.role || '')),
    ]);
    const nitroStyle = usesNitroApproverRoles(roles);
    const merchantRole =
      roles.find((role) => isOwner1Role(role, nitroStyle) && !isPreparerRole(role, nitroStyle)) ||
      'Recipient 1';
    const ownerRole =
      roles.find((role) => isPreparerRole(role, nitroStyle)) || 'Owner';
    const fields: Record<string, unknown>[] = [];
    const roleCounts: Record<string, number> = {};
    let applied = 0;
    for (const field of sourceFields) {
      const type = String(field.type || 'text').toLowerCase();
      const role = String(field.role || '').trim();
      roleCounts[role || '(none)'] = (roleCounts[role || '(none)'] || 0) + 1;
      if (!keepParty2 && isOwner2Role(role, nitroStyle)) continue;
      const next = { ...field };
      /**
       * Templates drift into case variants of one role ("Recipient 1" and
       * "recipient 1" on the same document). SignNow treats those as two roles,
       * so the embedded invite tried to attach one signer to the same document
       * twice and failed with "Document id with role must be unique." Collapse
       * every variant onto the exact role string this publish uses.
       */
      if (role && sameSignNowRole(role, merchantRole) && role !== merchantRole) {
        next.role = merchantRole;
      } else if (role && sameSignNowRole(role, ownerRole) && role !== ownerRole) {
        next.role = ownerRole;
      }
      const fieldName = String(next.name || '');
      const resolved = resolveSignNowPrefillValue(fieldName, values, prefillOpts);
      const isDateWidget =
        type === 'date' ||
        type === 'datepicker' ||
        type === 'datetime' ||
        isRemittanceStartDateField(fieldName);
      const resolvedIsMoney = /^\$?-?\d[\d,]*\.\d{2}$/.test(String(resolved || '').trim());
      const crmValue = formatSignNowPrefillValue(
        isDateWidget
          ? (!resolvedIsMoney ? resolved : '') ||
              resolveSignNowPrefillValue('agreement_date', values, prefillOpts) ||
              currentSignNowUsDate()
          : resolved,
        fieldName,
        {
          type,
          validatorId: String(
            parseSignNowFieldAttrs(field).validator_id || (field as any).validator_id || '',
          ).trim(),
        },
      );
      if (!SIGN_FIELD_TYPES.has(type) && crmValue) {
        next.prefilled_text = crmValue;
        applied += 1;
      } else if (
        !SIGN_FIELD_TYPES.has(type) &&
        ((clearUnresolvedValues && !/^(checkbox|checkmark|radiobutton)$/.test(type)) ||
          (prefillOpts?.documentKind === 'monthly_fee' &&
            isMonthlyFeeForcedBlankField(String(next.name || ''))))
      ) {
        delete next.prefilled_text;
        delete next.data;
      }
      const ownerData =
        !SIGN_FIELD_TYPES.has(type) &&
        (isPreparerRole(role, nitroStyle) || role.toLowerCase() === 'owner');
      const hasPrefill = Boolean(String(next.prefilled_text || '').trim());
      const isMerchantRequired =
        !SIGN_FIELD_TYPES.has(type) &&
        isMerchantRequiredSignerField(
          String(next.name || ''),
          Number(next.page_number),
          prefillOpts,
        );
      if (!SIGN_FIELD_TYPES.has(type) && exposeToMerchant) {
        const growFillableFace =
          supplementalDoc ||
          usesAddendumFillableFont(
            String(next.name || ''),
            Number(next.page_number),
            prefillOpts,
          );
        if (growFillableFace) {
          applyContractFillableFont(next);
        }
      }
      if (SIGN_FIELD_TYPES.has(type)) {
        next.required = true;
        delete next.lock_to_sign_prefill;
      } else if (isMerchantRequired) {
        if (exposeToMerchant) {
          next.role = merchantRole;
          if (hasPrefill) {
            next.required = false;
            next.lock_to_sign_prefill = true;
          } else {
            next.required = true;
            delete next.lock_to_sign_prefill;
          }
        } else {
          // Owner Review: assign to Owner so Enter text shows and CRM values can be typed/mapped.
          next.role = ownerRole;
          next.required = false;
          delete next.lock_to_sign_prefill;
        }
      } else if (hasPrefill) {
        next.required = false;
        if (exposeToMerchant) {
          next.lock_to_sign_prefill = true;
          if (ownerData) next.role = merchantRole;
        } else {
          // Owner Review must keep Enter-text widgets editable (contract + addenda).
          delete next.lock_to_sign_prefill;
        }
      } else {
        delete next.lock_to_sign_prefill;
        if (ownerData) next.required = false;
      }
      fields.push(next);
    }
    const putFields = fieldsOnExistingPages(sanitizeSignNowPutFields(fields), pageCount);
    /**
     * Owner review only: Exhibit C (2), (3)… are copies of one template, so their
     * widgets share names with the first Exhibit C, and SignNow's session links
     * same-named widgets across the group — every copy showed the first copy's
     * values. Unique names break that link (see `nameExhibitCCopyFieldsForReview`);
     * the field PUT below is what writes them, so it must not be skipped. The
     * merchant publish reads the names back normalized and restores them.
     */
    const exhibitCCopyIndex = isExhibitC
      ? exhibitCInstanceIndexFromDocumentName(documentName)
      : null;
    if (isExhibitC) clearExhibitCCopyLabels(putFields);
    const relabelledExhibitCCopy =
      !exposeToMerchant &&
      exhibitCCopyIndex != null &&
      exhibitCCopyIndex > 0 &&
      nameExhibitCCopyFieldsForReview(putFields, exhibitCCopyIndex + 1) > 0;
    console.info('[SignNow] field roles before merchant publish', {
      documentId,
      roleCounts,
      keepParty2,
      merchantRole,
      ownerRole,
      applied,
      putting: countPutFieldTypes(putFields),
    });
    if (!putFields.length) return 0;
    const signFields = putFields.filter((field) =>
      SIGN_FIELD_TYPES.has(String(field.type || '')),
    ).length;
    // Always write CRM values via prefill-texts first. One invalid field (e.g.
    // dashed phone on a Number validator) rejects the WHOLE batch — retry after
    // dropping the failing field so the rest of the agreement still fills.
    // A renamed Exhibit C copy skips it: prefill-texts addresses widgets by
    // name, which the field PUT is about to change, and the PUT carries the values.
    let textPrefills = relabelledExhibitCCopy ? [] : signNowPrefillTextPayload(putFields);
    let textsApplied = 0;
    if (textPrefills.length) {
      const paths = [
        `/v2/documents/${documentId}/prefill-texts`,
        `/v2/documents/${documentId}/prefill-text`,
      ];
      for (let round = 0; round < 8 && textPrefills.length; round += 1) {
        if (round > 0) countSignNowRetry();
        let wrote = false;
        let dropField = '';
        for (const path of paths) {
          try {
            const putStarted = Date.now();
            const res = await client.put(
              path,
              { fields: textPrefills },
              { validateStatus: () => true, timeout: 60_000 },
            );
            logSignNowTiming('document-prefill-put', Date.now() - putStarted, {
              documentId,
              documentName,
            });
            if (res.status < 400) {
              textsApplied = textPrefills.length;
              wrote = true;
              report?.written.push(...textPrefills.map((row) => row.field_name));
              console.info('[SignNow] wrote CRM prefill via prefill-texts', {
                documentId,
                applied: textsApplied,
                path,
                round,
              });
              break;
            }
            const detail = this.signNowErrorDetail(res);
            dropField = parseSignNowPrefillValidationField(detail);
            console.warn('[SignNow] prefill-texts failed', path, detail);
            // Only the real prefill-texts endpoint returns field validation errors.
            if (dropField) break;
          } catch (err) {
            console.warn(
              '[SignNow] prefill-texts threw',
              path,
              err instanceof Error ? err.message : String(err),
            );
          }
        }
        if (wrote) break;
        if (!dropField) break;
        // A dashed phone / SSN on a validated widget is recoverable: strip to
        // digits and retry rather than dropping the value off the agreement.
        const matchesDropField = (name: string) =>
          name.toLowerCase() === dropField.toLowerCase() ||
          canonicalizeSignNowFieldName(name) === canonicalizeSignNowFieldName(dropField);
        const dashedRow = textPrefills.find(
          (row) =>
            matchesDropField(row.field_name) &&
            /-/.test(row.prefilled_text) &&
            (isPhoneFieldName(row.field_name) || isSsnFieldName(row.field_name)),
        );
        if (dashedRow) {
          const digits = isPhoneFieldName(dashedRow.field_name)
            ? digitsOnlyPhone(dashedRow.prefilled_text)
            : digitsOnlySsn(dashedRow.prefilled_text);
          console.warn('[SignNow] validator rejected dashed value; retrying digits-only', {
            documentId,
            dropField,
          });
          dashedRow.prefilled_text = digits;
          for (const field of putFields) {
            if (matchesDropField(String(field.name || ''))) field.prefilled_text = digits;
          }
          continue;
        }
        const before = textPrefills.length;
        textPrefills = textPrefills.filter(
          (row) =>
            row.field_name.toLowerCase() !== dropField.toLowerCase() &&
            canonicalizeSignNowFieldName(row.field_name) !==
              canonicalizeSignNowFieldName(dropField),
        );
        // Also clear from putFields so fallback PUT does not reintroduce it.
        for (const field of putFields) {
          if (
            String(field.name || '').toLowerCase() === dropField.toLowerCase() ||
            canonicalizeSignNowFieldName(String(field.name || '')) ===
              canonicalizeSignNowFieldName(dropField)
          ) {
            delete field.prefilled_text;
            delete field.lock_to_sign_prefill;
          }
        }
        console.warn('[SignNow] dropped invalid prefill field; retrying', {
          documentId,
          dropField,
          remaining: textPrefills.length,
          removed: before - textPrefills.length,
        });
        if (textPrefills.length === before) break;
      }
    }

    if (signFields === 0 && !supplementalDoc) {
      console.warn(
        '[SignNow] skipping field PUT without signature fields — keeping prefill-texts only',
        { documentId, textsApplied, applied },
      );
      return textsApplied || applied;
    }

    // prefill-texts has already landed digits-only, so the batch could not be
    // rejected. The field PUT now drops the Number validation the template put on
    // phone / SSN widgets and rewrites the value dashed, so both the committed
    // page text and anything the merchant types read 561-577-8267 / 366-96-0737.
    for (const field of putFields) {
      const fieldName = String(field.name || '');
      const isPhone = isPhoneFieldName(fieldName);
      if (!isPhone && !isSsnFieldName(fieldName)) continue;
      if (SIGN_FIELD_TYPES.has(String(field.type || '').toLowerCase())) continue;
      delete field.validator_id;
      const current = String(field.prefilled_text || '').trim();
      if (!current) continue;
      const dashed = isPhone ? formatUsPhone(current) : formatSsn(current);
      if (dashed !== current) field.prefilled_text = dashed;
    }

    // Filled CRM values are stamped as 10pt page text so the agreement matches
    // addenda/disclosures (values on the line, no field boxes). Owner review
    // stays fillable widgets — see `bakeFilledText` above.
    const needsMerchantRequiredReviewPut =
      !exposeToMerchant &&
      sourceFields.some((field) => {
        if (SIGN_FIELD_TYPES.has(String(field.type || ''))) return false;
        if (
          !isMerchantRequiredSignerField(
            String(field.name || ''),
            Number(field.page_number),
            prefillOpts,
          )
        ) {
          return false;
        }
        const role = String(field.role || '').trim();
        return (
          !isPreparerRole(role, nitroStyle) &&
          role.toLowerCase() !== ownerRole.toLowerCase() &&
          role.toLowerCase() !== 'owner'
        );
      });
    if (
      !exposeToMerchant &&
      textsApplied > 0 &&
      !needsMerchantRequiredReviewPut &&
      !relabelledExhibitCCopy
    ) {
      console.info('[SignNow] review prefill complete via prefill-texts (skipped field PUT)', {
        documentId,
        textsApplied,
        applied,
        signatures: signFields,
        pages: pageCount,
        supplemental: supplementalDoc,
      });
      return textsApplied;
    }

    const bakedRaw = splitPrefillPutPayload(putFields, bakeFilledText, {
      keepEmptyMerchantRequired: exposeToMerchant,
      documentKind: prefillOpts?.documentKind,
      // Blank widgets still held by the CRM role are not the merchant's to fill.
      ownerRole,
    });
    /**
     * `PUT /document/{id}` only ever APPENDS `texts`, so the values this publish
     * bakes would land on top of the stamps an earlier publish left behind and
     * both would render — the overlapping Exhibit C / Exhibit C (2) values.
     * Carry forward any earlier stamp this send does not cover, then clear the
     * document's text elements before writing, so every spot ends up with
     * exactly one value: the current one.
     */
    const committedTexts = bakeFilledText
      ? collectCommittedSignNowTexts(remote)
      : [];
    const mergedTexts = mergeCommittedSignNowTexts(bakedRaw.texts, committedTexts, {
      // Every widget this send knows about owns its spot, so a stamp left
      // there by an earlier send is replaced (or dropped when the CRM value
      // is now blank) instead of being carried forward.
      ownedSpots: putFields,
    });
    /**
     * Clear before deciding what to write: SignNow refuses text deletes once the
     * group is out for signature, and re-sending the carried-forward set onto a
     * page that still holds it is what stacked two copies of every page-1 amount.
     * When the clear fails, only values this page does not already carry go out.
     */
    const clearedCommittedTexts =
      committedTexts.length && mergedTexts.length
        ? await this.clearCommittedSignNowTexts(client, documentId, committedTexts)
        : true;
    const baked = {
      fields: fieldsOnExistingPages(bakedRaw.fields, pageCount),
      texts: fieldsOnExistingPages(
        clearedCommittedTexts
          ? mergedTexts
          : dropBakedTextsAlreadyStamped(bakedRaw.texts, committedTexts),
        pageCount,
      ),
    };
    const fieldBodies = bakeFilledText
      ? [baked.fields, baked.fields.map(({ id: _id, ...rest }) => rest)]
      : [
          putFields,
          putFields.map(({ id: _id, ...rest }) => rest),
          putFields.map(({ lock_to_sign_prefill: _lock, ...rest }) => rest),
        ];
    let lastFailureDetail = '';
    const attempts: Array<{ path: string; body: Record<string, unknown> }> = [];
    const pushPut = (bodyFields: Record<string, unknown>[], includeTexts: boolean) => {
      const withTexts = includeTexts && baked.texts.length > 0;
      attempts.push({
        path: `/document/${documentId}`,
        body: {
          client_timestamp: Math.floor(Date.now() / 1000),
          fields: bodyFields,
          ...(withTexts ? { texts: baked.texts } : {}),
        },
      });
      attempts.push({
        path: `/v2/documents/${documentId}`,
        body: {
          ...(documentName ? { document_name: documentName } : {}),
          fields: bodyFields,
          ...(withTexts ? { texts: baked.texts } : {}),
        },
      });
    };
    if (bakeFilledText && baked.texts.length) {
      pushPut(baked.fields, true);
    }
    for (const bodyFields of fieldBodies) {
      pushPut(bodyFields, true);
    }
    if (baked.texts.length) {
      pushPut(putFields, false);
    }
    // Last resort: the same write without the signature/initials face.
    const lastFields = bakeFilledText ? baked.fields : putFields;
    if (hasSignNowSignatureFieldFont(lastFields)) {
      pushPut(withoutSignNowSignatureFieldFont(lastFields), true);
    }
    for (const attempt of attempts) {
      try {
        const putStarted = Date.now();
        const res = await client.put(attempt.path, attempt.body, {
          validateStatus: () => true,
          // Agreement field rewrite can exceed the default 45s client timeout.
          timeout: 90_000,
        });
        logSignNowTiming('document-prefill-put', Date.now() - putStarted, {
          documentId,
          documentName,
        });
        if (res.status < 400) {
          report?.written.push(
            ...(attempt.body.fields as Record<string, unknown>[])
              .filter((field) => String(field.prefilled_text || '').trim())
              .map((field) => stripExhibitCCopyFieldName(field.name)),
          );
          console.info('[SignNow] wrote CRM prefill onto SignNow fields', {
            documentId,
            applied,
            count: (attempt.body.fields as unknown[])?.length ?? 0,
            texts: baked.texts.length,
            signatures: signFields,
            exposeToMerchant,
            path: attempt.path,
          });
          return applied;
        }
        lastFailureDetail = this.signNowErrorDetail(res);
        console.warn(
          '[SignNow] publish Owner fields failed',
          attempt.path,
          lastFailureDetail,
        );
      } catch (err) {
        console.warn(
          '[SignNow] publish Owner fields threw',
          attempt.path,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    /**
     * Returning quietly here is what hid the real failure: SignNow rejects every
     * field edit on an already-invited document, the merchant publish wrote
     * nothing, and the caller still reported success — so the contract went out
     * with none of the signer's fields on it. A merchant publish that wrote
     * nothing is a failed send, so say so; Owner review keeps the old lenient
     * behaviour because it has a later chance to write.
     */
    if (exposeToMerchant) {
      throw new BadRequestException(
        `SignNow refused every field write for document ${documentId}` +
          (lastFailureDetail ? `: ${lastFailureDetail}` : ''),
      );
    }
    return textsApplied || 0;
  }

  /**
   * Remove every text element committed by an earlier publish.
   *
   * `DELETE /document/{id}/text/{textId}` clears ALL of the document's text
   * elements, not just the id passed — which is what makes it usable as the
   * "clear" step SignNow otherwise has no endpoint for (`texts: []` on the PUT
   * is a no-op). The caller must already hold the full replacement set.
   */
  private async clearCommittedSignNowTexts(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documentId: string,
    committed: readonly CommittedSignNowText[],
  ): Promise<boolean> {
    const textIds = committed.map((row) => row.id).filter(Boolean);
    if (!textIds.length) return false;
    let lastDetail = '';
    // The delete drops every text element, so one success is enough — but a
    // single id can be rejected on its own (already removed by an earlier
    // partial clear), and giving up there left the whole stale set on the page.
    for (const textId of textIds) {
      try {
        const res = await client.delete(`/document/${documentId}/text/${textId}`, {
          validateStatus: () => true,
        });
        if (res.status < 400) {
          console.info('[SignNow] cleared previously baked page text before re-publish', {
            documentId,
            cleared: committed.length,
          });
          return true;
        }
        lastDetail = this.signNowErrorDetail(res);
      } catch (err) {
        lastDetail = err instanceof Error ? err.message : String(err);
      }
    }
    // Not fatal: the caller drops the values this page already carries so they
    // cannot stack, and still writes the ones that changed.
    console.warn('[SignNow] could not clear baked page text; keeping existing stamps', {
      documentId,
      attempted: textIds.length,
      detail: lastDetail,
    });
    return false;
  }

  private unwrapGroupTemplatePayload(raw: any): any | null {
    if (!raw || typeof raw !== 'object') return null;
    return raw.data || raw.document_group_template || raw;
  }

  private groupTemplateRowId(row: any): string {
    const src = this.unwrapGroupTemplatePayload(row) || {};
    return String(
      src.id ||
        src.template_id ||
        src.template_group_id ||
        src.unique_id ||
        '',
    ).trim();
  }

  private templateItemsFromRow(row: any): Array<{ id: string; name: string }> {
    const src = this.unwrapGroupTemplatePayload(row) || {};
    const collections = [src.templates, src.documents, src.document_templates, src.template_ids];
    const items: Array<{ id: string; name: string }> = [];
    for (const col of collections) {
      if (!Array.isArray(col)) continue;
      for (const entry of col) {
        if (typeof entry === 'string' || typeof entry === 'number') {
          const id = String(entry || '').trim();
          if (id) items.push({ id, name: '' });
          continue;
        }
        const id = String(
          entry?.origin_document_id ||
            entry?.origin_id ||
            entry?.template_id ||
            entry?.document_id ||
            entry?.id ||
            entry?.unique_id ||
            '',
        ).trim();
        if (!id) continue;
        items.push({
          id,
          name: String(
            entry?.template_name || entry?.document_name || entry?.name || '',
          ).trim(),
        });
      }
    }
    return items;
  }

  private originIdsFromGroupTemplateRow(row: any): string[] {
    const src = this.unwrapGroupTemplatePayload(row) || {};
    const fromItems = this.templateItemsFromRow(src).map((item) => item.id);
    const extras = [
      ...(Array.isArray(src.origin_document_ids) ? src.origin_document_ids : []),
      ...(Array.isArray(src.template_ids) ? src.template_ids : []),
      ...(Array.isArray(src.document_ids) ? src.document_ids : []),
    ];
    return [...fromItems, ...extras]
      .map((id) => String(id || '').trim())
      .filter((id, index, all) => Boolean(id) && all.indexOf(id) === index);
  }

  private pickPreviewOriginDocumentId(row: any): string {
    const items = this.templateItemsFromRow(row);
    const ids = this.originIdsFromGroupTemplateRow(row);
    const isAddendumName = (name: string) =>
      /addendum|disclosure|exhibit|ach|epa|payoff|flex|weekly|monthly/i.test(name);
    const isAgreementName = (name: string) =>
      /agreement|pcm[_ ]?contract|nitro\s*advance|^contract$/i.test(name);
    const preferred =
      items.find((item) => isAgreementName(item.name) && !isAddendumName(item.name)) ||
      items.find((item) => isAgreementName(item.name));
    return preferred?.id || ids[0] || '';
  }

  private async findGroupTemplateRow(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    templateId: string,
  ): Promise<any | null> {
    const wanted = String(templateId || '').trim();
    if (!wanted) return null;
    const wantedLower = wanted.toLowerCase();
    const cached = groupTemplateRowCache.get(wantedLower);
    if (cached && Date.now() - cached.at < GROUP_TEMPLATE_ROW_TTL_MS) {
      return cached.row;
    }
    /**
     * Prefill runs every document in the package at once and each one resolves
     * its origin template here. On a cold cache that fanned out into one
     * lookup per document — up to two round trips each, since the first path
     * 404s on some accounts — all asking SignNow the same question. Coalesce
     * them onto the first caller.
     */
    const inflight = groupTemplateRowInflight.get(wantedLower);
    if (inflight) return inflight;

    const remember = (row: any) => {
      groupTemplateRowCache.set(wantedLower, { row, at: Date.now() });
      return row;
    };

    const work = (async () => {
      const getPaths = [
        `/documentgroup/template/${wanted}`,
        `/v2/document-group-templates/${wanted}`,
      ];
      for (const path of getPaths) {
        const getRes = await client.get(path, { validateStatus: () => true });
        if (getRes.status >= 400) continue;
        const row = this.unwrapGroupTemplatePayload(getRes.data);
        if (row) return remember(row);
      }

      if (
        groupTemplateListCache &&
        Date.now() - groupTemplateListCache.at < GROUP_TEMPLATE_ROW_TTL_MS
      ) {
        const fromCache = groupTemplateListCache.rows.find(
          (row: any) => this.groupTemplateRowId(row).toLowerCase() === wantedLower,
        );
        if (fromCache) return remember(fromCache);
      }
      return null;
    })().finally(() => {
      groupTemplateRowInflight.delete(wantedLower);
    });
    groupTemplateRowInflight.set(wantedLower, work);
    return work;
  }

  private async resolveGroupTemplateOriginDocumentId(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    templateId: string,
  ): Promise<string> {
    const match = await this.findGroupTemplateRow(client, templateId);
    const fromMeta = this.pickPreviewOriginDocumentId(match);
    if (fromMeta) {
      console.info('[SignNow] preview origin document', {
        templateId,
        originDocumentId: fromMeta,
      });
      return fromMeta;
    }

    console.warn(
      '[SignNow] template metadata had no origin document id; copying the template id directly',
      { templateId },
    );
    return String(templateId || '').trim();
  }

  private async downloadDocumentPdfBuffer(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documentId: string,
    label: string,
  ): Promise<Buffer> {
    const res = await client.get(`/document/${documentId}/download`, {
      responseType: 'arraybuffer',
      headers: { Accept: 'application/pdf, application/octet-stream' },
      validateStatus: () => true,
      params: { type: 'collapsed' },
    });
    if (res.status >= 400) {
      const retry = await client.get(`/document/${documentId}/download`, {
        responseType: 'arraybuffer',
        headers: { Accept: 'application/pdf, application/octet-stream' },
        validateStatus: () => true,
      });
      if (retry.status < 400) {
        const retryBuf = Buffer.from(retry.data as ArrayBuffer);
        if (retryBuf.length >= 100 && retryBuf.slice(0, 4).toString().includes('%PDF')) {
          return retryBuf;
        }
      }
      const detail =
        (res.data && !Buffer.isBuffer(res.data)
          ? JSON.stringify(res.data).slice(0, 240)
          : '') || `HTTP ${res.status}`;
      throw new BadRequestException(`Could not download SignNow ${label} PDF: ${detail}`);
    }
    const buffer = Buffer.from(res.data as ArrayBuffer);
    if (buffer.length < 100 || !buffer.slice(0, 4).toString().includes('%PDF')) {
      throw new BadRequestException(`SignNow ${label} PDF download was empty`);
    }
    return buffer;
  }

  private async copySignNowDocument(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    originId: string,
    documentName: string,
  ): Promise<string> {
    const body = { document_name: documentName };
    const paths = [`/document/${originId}/copy`, `/template/${originId}/copy`];
    let lastDetail = '';
    for (const path of paths) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const res = await client.post(path, body, {
            validateStatus: () => true,
            timeout: 45_000,
          });
          const copied = res.data?.data || res.data || {};
          const id = String(copied.id || copied.document_id || copied.unique_id || '').trim();
          if (res.status < 400 && id) return id;
          lastDetail = this.signNowErrorDetail(res);
          if (isSignNowDailyLimitError(lastDetail)) {
            throw new Error(lastDetail);
          }
          if (
            !isTransientSignNowFailure(res.status, lastDetail) &&
            res.status !== 404
          ) {
            break;
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err || '');
          lastDetail = detail;
          if (isSignNowDailyLimitError(detail)) throw err instanceof Error ? err : new Error(detail);
          if (!isTransientSignNowFailure(undefined, detail)) break;
        }
        await sleepSignNow(500 * (attempt + 1));
        countSignNowRetry();
      }
    }
    throw new Error(`could not copy ${originId}: ${lastDetail || 'unknown error'}`);
  }

  private async addDocumentsToGroup(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    _existingIds: string[],
    newIds: string[],
  ): Promise<boolean> {
    const uniqueNew = [...new Set(newIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!uniqueNew.length) return false;
    await this.waitForDocumentsReady(
      client,
      uniqueNew.map((id) => ({ id })),
      3,
    );
    // SignNow drops a sibling when two extras are POSTed at once.
    for (const documentId of uniqueNew) {
      let added = false;
      for (let attempt = 0; attempt < 4 && !added; attempt += 1) {
        if (attempt > 0) {
          await sleepSignNow(400 * attempt);
          countSignNowRetry();
        }
        const res = await client.post(
          `/v2/document-groups/${groupId}/documents`,
          { unique_id: documentId },
          { validateStatus: () => true },
        );
        if (res.status < 400) {
          added = true;
          break;
        }
        const detail = this.signNowErrorDetail(res);
        if (/already|exist/i.test(detail)) {
          added = true;
          break;
        }
        console.warn('[SignNow] add document to group failed', {
          groupId,
          documentId,
          status: res.status,
          attempt: attempt + 1,
          detail,
        });
        if (
          !isTransientSignNowFailure(res.status, detail) &&
          res.status !== 400 &&
          res.status !== 404
        ) {
          break;
        }
      }
      if (!added) return false;
    }
    const ids = await this.listGroupDocumentIds(client, groupId);
    return uniqueNew.every((id) => ids.includes(id));
  }

  private async refreshGroupDocuments(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
  ): Promise<SignNowDocumentRef[]> {
    const res = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
    return this.normalizeGroupDocuments(res.data?.documents);
  }

  private async deleteDocumentGroup(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
  ): Promise<void> {
    const id = String(groupId || '').trim();
    if (!id) return;
    await client.delete(`/documentgroup/${id}`, { validateStatus: () => true });
    await client.delete(`/v2/document-groups/${id}`, { validateStatus: () => true });
  }

  /** Ungroup then recreate so extra docs can join PCM_CONTRACT (SignNow blocks docs that already belong to a group). */
  private async rebuildGroupWithDocuments(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    oldGroupId: string,
    groupName: string,
    documentIds: string[],
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] } | null> {
    const ids = [...new Set(documentIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (ids.length < 2) return null;
    await this.deleteDocumentGroup(client, oldGroupId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await client.post(
        '/documentgroup',
        { document_ids: ids, group_name: groupName },
        { validateStatus: () => true },
      );
      const created = res.data?.data || res.data || {};
      const groupId = String(created.unique_id || created.id || '').trim();
      if (res.status < 400 && groupId) {
        const documents =
          this.normalizeGroupDocuments(created.documents).length > 0
            ? this.normalizeGroupDocuments(created.documents)
            : await this.refreshGroupDocuments(client, groupId);
        return { groupId, documents };
      }
      const detail = this.signNowErrorDetail(res);
      console.warn('[SignNow] rebuild combined group failed', {
        attempt: attempt + 1,
        detail,
      });
      if (!isTransientSignNowFailure(res.status, detail) && attempt === 2) break;
      countSignNowRetry();
      await sleepSignNow(600 * (attempt + 1));
    }
    return null;
  }

  /**
   * Instantiate each extra template, ungroup those copies, then recreate one
   * combined document group. SignNow cannot add a document that already belongs
   * to another group, and POST /v2/document-groups/{id}/documents expects
   * `{ unique_id: documentId }` — not the group id.
   */
  private groupHasSupplemental(
    documents: SignNowDocumentRef[],
    row: SignNowAddendumTemplate,
  ): boolean {
    return documents.some((doc) =>
      signNowDocumentMatchesSupplemental(String(doc.document_name || doc.name || ''), row),
    );
  }

  /** How many live docs already cover this supplemental layout (supports Exhibit C × N). */
  private countGroupSupplementals(
    documents: SignNowDocumentRef[],
    row: SignNowAddendumTemplate,
  ): number {
    return documents.filter((doc) =>
      signNowDocumentMatchesSupplemental(String(doc.document_name || doc.name || ''), row),
    ).length;
  }

  private missingSupplementals(
    documents: SignNowDocumentRef[],
    toAttach: SignNowAddendumTemplate[],
  ): SignNowAddendumTemplate[] {
    const claimed = new Map<string, number>();
    const missing: SignNowAddendumTemplate[] = [];
    for (const row of toAttach) {
      const key = String(row.layoutKey || row.templateId || row.name || '')
        .trim()
        .toLowerCase();
      const present = this.countGroupSupplementals(documents, row);
      const already = claimed.get(key) || 0;
      if (already < present) {
        claimed.set(key, already + 1);
        continue;
      }
      missing.push(row);
      claimed.set(key, already + 1);
    }
    return missing;
  }

  private async attachMissingSupplementalsForSend(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    options: {
      groupId: string;
      groupName: string;
      documents: SignNowDocumentRef[];
      applicationId?: string;
      supplementalDocumentRefs?: string[];
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
      funderName?: string | null;
      funderProfileId?: string | null;
    },
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] }> {
    const funderProfileId = String(options.funderProfileId || '').trim();
    const funderRow = funderProfileId
      ? await prisma.funderProfile.findUnique({
          where: { id: funderProfileId },
          select: {
            signnowAddendumTemplates: true,
            signnowDisclosureTemplates: true,
          },
        })
      : null;
    const supplementals = resolveSignNowAddendaFromRefs(
      options.supplementalDocumentRefs,
      funderRow,
    );
    const selected = supplementals.filter((row) => {
      if (row.type === 'disclosure') {
        return options.sendPackage?.includeDisclosure !== false;
      }
      return true;
    });
    if (
      options.sendPackage?.includeDisclosure !== false &&
      !selected.some((row) => row.type === 'disclosure')
    ) {
      const platformDisclosure = getSignNowDisclosureTemplates()[0];
      if (platformDisclosure) selected.push(platformDisclosure);
    }
    const toAttach = sortSignNowSupplementalsForPackage(selected);
    const missing = this.missingSupplementals(options.documents, toAttach);
    if (!missing.length) {
      return { groupId: options.groupId, documents: options.documents };
    }
    console.info('[SignNow] attaching missing extras before send', {
      groupId: options.groupId,
      missing: missing.map((row) => row.name),
    });
    const combined = await this.combineGroupWithAddenda(
      client,
      options.groupId,
      options.documents,
      missing,
      options.groupName,
    );
    if (options.applicationId) {
      this.rememberDraftGroup(options.applicationId, combined.groupId, combined.documents);
    }
    return combined;
  }

  /**
   * Copied extra document ids, split by kind so the final group can be ordered
   * Disclosure → Contract → Addendums regardless of which copy settled first.
   */
  private collectCopiedAddendumIds(
    addenda: SignNowAddendumTemplate[],
    extraResults: PromiseSettledResult<string[]>[],
  ): { ids: string[]; disclosureIds: string[]; addendumIds: string[] } {
    const ids: string[] = [];
    const disclosureIds: string[] = [];
    const addendumIds: string[] = [];
    extraResults.forEach((result, index) => {
      const row = addenda[index];
      const name = row?.name || `extra ${index + 1}`;
      if (result.status === 'fulfilled') {
        ids.push(...result.value);
        const bucket =
          String(row?.type || '').toLowerCase() === 'disclosure' ? disclosureIds : addendumIds;
        bucket.push(...result.value);
        return;
      }
      const detail =
        result.reason instanceof Error ? result.reason.message : String(result.reason || '');
      console.warn('[SignNow] extra template copy skipped', { name, detail: detail.slice(0, 240) });
    });
    return { ids, disclosureIds, addendumIds };
  }

  private async attachCopiedAddenda(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[],
    copied: { ids: string[]; disclosureIds: string[]; addendumIds: string[] },
    groupName: string,
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] }> {
    const uniqueExtra = [
      ...new Set(copied.ids.map((id) => String(id || '').trim()).filter(Boolean)),
    ];
    if (!uniqueExtra.length) {
      console.warn('[SignNow] no extras copied; opening the contract documents already created');
      return { groupId, documents };
    }
    const existingIds = documents.map((d) => d.id).filter(Boolean);
    // Hint only the copies we just made. Documents already in the group keep
    // name-based classification, so a disclosure attached on an earlier pass is
    // not mistaken for part of the contract template copy.
    const orderHints = {
      disclosureIds: copied.disclosureIds,
      addendumIds: copied.addendumIds,
    };
    const added = await measureSignNowStep(
      'extra-document-attach',
      { documentCount: uniqueExtra.length },
      () => this.addDocumentsToGroup(client, groupId, existingIds, uniqueExtra),
    );
    if (added) {
      const merged = await this.refreshGroupDocuments(client, groupId);
      const mergedIds = new Set(merged.map((d) => d.id));
      const missing = uniqueExtra.filter((id) => !mergedIds.has(id));
      console.info('[SignNow] extras added to existing group', {
        groupId,
        count: merged.length,
        names: merged.map((d) => d.document_name || d.name || d.id),
        extraIds: uniqueExtra.length,
        missing: missing.length,
      });
      if (!missing.length && merged.length >= existingIds.length + uniqueExtra.length) {
        return this.enforceCanonicalGroupOrder(
          client,
          { groupId, documents: merged.length ? merged : documents },
          groupName,
          orderHints,
        );
      }
    }
    const rebuilt = await measureSignNowStep(
      'group-delete-rebuild',
      { documentCount: existingIds.length + uniqueExtra.length },
      () =>
        this.rebuildGroupWithDocuments(
          client,
          groupId,
          groupName,
          signNowDocumentIdsInOrder(
            orderSignNowGroupDocuments(
              [
                // Existing docs carry their names, so they classify correctly.
                ...documents.filter((doc) => existingIds.includes(doc.id)),
                ...uniqueExtra.map((id) => ({ id })),
              ],
              orderHints,
            ),
          ),
        ),
    );
    if (!rebuilt?.groupId) {
      console.warn('[SignNow] combined rebuild failed; opening the contract documents already created');
      return { groupId, documents };
    }
    const ordered = orderSignNowGroupDocuments(rebuilt.documents, orderHints);
    console.info('[SignNow] combined package documents', {
      groupId: rebuilt.groupId,
      count: ordered.length,
      names: ordered.map((d) => d.document_name || d.name || d.id),
    });
    return { groupId: rebuilt.groupId, documents: ordered };
  }

  /**
   * Force the live group onto Disclosure → Contract → Addendums.
   *
   * SignNow appends documents in whatever order they were POSTed, so the only
   * reliable reorder primitive is regrouping the same document ids. That copies
   * nothing, so it does not spend the account's daily document allowance. When
   * the group is already canonical (the normal case) this is a pure no-op.
   */
  private async enforceCanonicalGroupOrder(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    current: { groupId: string; documents: SignNowDocumentRef[] },
    groupName: string,
    hints?: {
      disclosureIds?: Iterable<string>;
      contractIds?: Iterable<string>;
      addendumIds?: Iterable<string>;
    },
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] }> {
    const desired = orderSignNowGroupDocuments(current.documents, hints);
    const desiredIds = signNowDocumentIdsInOrder(desired);
    const liveIds = signNowDocumentIdsInOrder(current.documents);
    if (desiredIds.length < 2 || sameSignNowDocumentOrder(liveIds, desiredIds)) {
      return { groupId: current.groupId, documents: desired };
    }
    const regrouped = await measureSignNowStep(
      'group-order-normalize',
      { documentCount: desiredIds.length },
      () => this.rebuildGroupWithDocuments(client, current.groupId, groupName, desiredIds),
    );
    if (!regrouped?.groupId) {
      // Ordering is cosmetic relative to losing the package — keep the group.
      console.warn('[SignNow] could not normalize document order; keeping live order', {
        groupId: current.groupId,
      });
      return { groupId: current.groupId, documents: current.documents };
    }
    const ordered = orderSignNowGroupDocuments(regrouped.documents, hints);
    console.info('[SignNow] normalized package order', {
      groupId: regrouped.groupId,
      names: ordered.map((d) => d.document_name || d.name || d.id),
    });
    return { groupId: regrouped.groupId, documents: ordered };
  }

  private async combineGroupWithAddenda(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[],
    addenda: SignNowAddendumTemplate[],
    groupName: string,
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] }> {
    console.info('[SignNow] attaching selected extras', {
      extras: addenda.map((row) => row.name),
    });
    const extraResults = await Promise.allSettled(
      addenda.map((addendum) =>
        this.instantiateAddendumDocumentIds(client, addendum, groupName),
      ),
    );
    return this.attachCopiedAddenda(
      client,
      groupId,
      documents,
      this.collectCopiedAddendumIds(addenda, extraResults),
      groupName,
    );
  }

  private async instantiateAddendumDocumentIds(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    addendum: SignNowAddendumTemplate,
    _groupName: string,
  ): Promise<string[]> {
    const cachedOrigin = addendumOriginIdCache.get(addendum.templateId);
    const sourceId =
      cachedOrigin ||
      (await this.resolveGroupTemplateOriginDocumentId(client, addendum.templateId)) ||
      addendum.templateId;
    const copiedId = await measureSignNowStep(
      'extra-document-copy',
      { documentName: addendum.name },
      () => this.copySignNowDocument(client, sourceId, addendum.name),
    );
    if (!copiedId) {
      throw new Error(`could not copy addendum ${addendum.name}`);
    }
    if (sourceId) addendumOriginIdCache.set(addendum.templateId, sourceId);
    return [copiedId];
  }

  private async createGroupFromAddendumTemplates(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    addenda: SignNowAddendumTemplate[],
    groupName: string,
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] }> {
    const primary = addenda[0];
    if (!primary) {
      throw new BadRequestException('Select a SignNow addendum to send without the main contract.');
    }
    const createRes = await client.post(
      `/v2/document-group-templates/${primary.templateId}/document-group`,
      { group_name: groupName },
      { validateStatus: () => true },
    );
    const created = createRes.data?.data || createRes.data || {};
    const groupId = String(created.unique_id || created.id || '').trim();
    let documents = this.normalizeGroupDocuments(created.documents);
    if (createRes.status >= 400 || !groupId || !documents.length) {
      const detail = this.signNowErrorDetail(createRes);
      if (isSignNowDailyLimitError(detail)) {
        throw new BadRequestException(SIGNNOW_DAILY_LIMIT_MESSAGE);
      }
      throw new BadRequestException(
        detail || `SignNow could not create the ${primary.name} package.`,
      );
    }
    if (addenda.length > 1) {
      return this.combineGroupWithAddenda(
        client,
        groupId,
        documents,
        addenda.slice(1),
        groupName,
      );
    }
    const groupRes = await client.get(`/documentgroup/${groupId}`, {
      validateStatus: () => true,
    });
    const refreshed = this.normalizeGroupDocuments(groupRes.data?.documents);
    if (refreshed.length) documents = refreshed;
    return { groupId, documents };
  }

  private async listGroupDocumentIds(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
  ): Promise<string[]> {
    const res = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
    return this.normalizeGroupDocuments(res.data?.documents).map((d) => d.id);
  }

  private normalizeGroupDocuments(raw: unknown): SignNowDocumentRef[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((d: any) => ({
        id: String(d?.id || d?.document_id || d?.unique_id || '').trim(),
        document_name: d?.document_name || d?.name,
        originDocumentId: signNowOriginDocumentId(d),
        roles: Array.isArray(d?.roles)
          ? d.roles
              .map((r: any) =>
                String(typeof r === 'string' ? r : r?.name || r?.role || r?.role_name || '').trim(),
              )
              .filter(Boolean)
          : [],
      }))
      .filter((d) => d.id);
  }

  /** Merchant emailed — the only SignNow path that sets Application to Contract Sent. */
  private async markGroupSent(applicationId: string, groupId: string) {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    await prisma.document.updateMany({
      where: { envelopeId: groupId },
      data: { status: 'sent', sentAt: new Date() } as any,
    });
    await clearUnfinishedSentArchive(groupId);
    await this.syncContractSigningFromGroupStatus(groupId, 'sent', appId);
  }

  /**
   * Owner embedded review can leave Document/Contract/Application looking "sent"
   * from older pending→sent polling. If that invite is still open, roll CRM back
   * to draft / Contract Generated until Send via SignNow.
   */
  private async revertPrematureSentIfOwnerReview(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    applicationId?: string,
    groupPayload?: unknown,
  ): Promise<boolean> {
    const existingDoc = await prisma.document.findUnique({
      where: { envelopeId: groupId },
      select: { applicationId: true, status: true, sentAt: true, portalSentAt: true },
    });
    const appId = String(applicationId || existingDoc?.applicationId || '').trim();
    if (!appId) return false;

    /**
     * A signing-portal (SendGrid) send deliberately has no SignNow group invite:
     * merchants remint a session from the preparer's embedded invite. That looks
     * identical to an unfinished owner review below, so the explicit portal marker
     * is what keeps a genuinely sent contract from being reverted to draft.
     */
    if (existingDoc?.portalSentAt) return false;

    const docLooksSent =
      String(existingDoc?.status || '').trim().toLowerCase() === 'sent' ||
      Boolean(existingDoc?.sentAt);
    const contract = await prisma.contract.findFirst({
      where: { applicationId: appId },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'desc' },
    });
    const contractStatus = String(contract?.status || '').trim().toUpperCase();
    if (['COMPLETED', 'DECLINED', 'REVOKED', 'EXPIRED'].includes(contractStatus)) return false;

    const application = await prisma.application.findUnique({
      where: { id: appId },
      select: { currentQueue: true, currentState: true },
    });
    const queueNorm = String(application?.currentQueue || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    const stateNorm = String(application?.currentState || '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '');
    const appLooksSent =
      queueNorm === 'contractsent' ||
      queueNorm === 'contractout' ||
      queueNorm === 'contractsout' ||
      stateNorm === 'contractsent';
    if (!docLooksSent && contractStatus !== 'SENT' && !appLooksSent) return false;

    const embeddedRes = await client.get(`/v2/document-groups/${groupId}/embedded-invites`, {
      validateStatus: () => true,
    });
    const hasEmbeddedReview = hasActiveEmbeddedInvites(embeddedRes.data);
    const hasEmailGroupInvite = Boolean(this.extractGroupInviteId(groupPayload));
    // Email groupinvite is created only by sendEnvelope. Keep Contract Sent in
    // that case. Otherwise this is still Owner review — roll back.
    if (!hasEmbeddedReview && hasEmailGroupInvite) return false;

    if (docLooksSent) {
      await prisma.document.updateMany({
        where: { envelopeId: groupId },
        data: { status: 'draft', sentAt: null } as any,
      });
    }
    if (contract && ['SENT', 'VIEWED', 'SIGNED'].includes(contractStatus)) {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: 'DRAFT' as any },
      });
    }

    try {
      const { syncApplicationToContractGenerated } = await import(
        '../contractApplicationWorkflowSync'
      );
      await syncApplicationToContractGenerated(
        prisma,
        appId,
        {
          source: 'signnow.revertPrematureSentIfOwnerReview',
          contractStatusPrevious: contractStatus || existingDoc?.status || null,
          contractStatusNew: 'DRAFT',
        },
        { revertFromSent: true },
      );
      return true;
    } catch (err) {
      console.warn('[SignNow] premature Contract Sent revert skipped', err);
    }
    return false;
  }

  /**
   * Keep Contract.status and Application currentQueue/currentState in lockstep with SignNow.
   * Completed group → Contract Signed (same path DocuSign / BoldSign use).
   */
  private async syncContractSigningFromGroupStatus(
    groupId: string,
    envelopeStatus: string,
    applicationId?: string,
  ) {
    const appId =
      String(applicationId || '').trim() ||
      (
        await prisma.document.findUnique({
          where: { envelopeId: groupId },
          select: { applicationId: true },
        })
      )?.applicationId ||
      '';
    if (!appId) return;

    const statusKey = String(envelopeStatus || '').trim().toLowerCase();
    const contractStatusMap: Record<string, string> = {
      sent: 'SENT',
      viewed: 'VIEWED',
      signed: 'SIGNED',
      completed: 'COMPLETED',
      declined: 'DECLINED',
      revoked: 'REVOKED',
      expired: 'EXPIRED',
    };
    const contractStatus = contractStatusMap[statusKey];
    if (contractStatus) {
      await prisma.contract.updateMany({
        where: { applicationId: appId },
        data: { status: contractStatus as any },
      });
    }

    try {
      const { syncApplicationWorkflowFromContractEnvelopeStatus } = await import(
        '../contractApplicationWorkflowSync'
      );
      await syncApplicationWorkflowFromContractEnvelopeStatus(prisma, appId, envelopeStatus, {
        source: 'signnow.syncContractSigningFromGroupStatus',
        contractStatusNew: contractStatus ?? envelopeStatus,
      });
    } catch (err) {
      console.warn('[SignNow] application workflow sync skipped', err);
    }
  }

  /**
   * Has the preparer finished Owner Review on this group?
   *
   * The CRM used to infer this from the SignNow iframe: either a postMessage
   * from the `/embedded-complete` redirect, or a "the iframe navigated again"
   * heuristic. Both are lossy — SignNow drops the redirect when the CRM origin
   * is not publicly reachable, and the heuristic misfires on SignNow's own
   * in-app navigations. When the signal was missed the button stayed on
   * "Review in SignNow" and the next click rebuilt the whole package from the
   * start. This asks SignNow directly instead, so the UI has a signal that
   * cannot be lost.
   *
   * Only the preparer holds an embedded invite while a group is in review —
   * merchants are invited by email at send time — so any fulfilled embedded
   * signer means review is done.
   */
  async getReviewStatus(
    groupId: string,
    options: {
      /**
       * Epoch ms the CRM opened this review session. Evidence SignNow dates
       * before it belongs to an earlier review of the same reused group and is
       * ignored — otherwise the very first poll after the iframe opens reports
       * last session's Finish and the UI jumps straight to "Send via SignNow".
       */
      since?: number;
    } = {},
  ): Promise<{
    envelopeId: string;
    reviewComplete: boolean;
    fulfilledRoles: string[];
    status: string | null;
  }> {
    const id = String(groupId || '').trim();
    if (!id) throw new BadRequestException('Missing SignNow document group id');
    if (!this.isEnabled()) {
      return { envelopeId: id, reviewComplete: false, fulfilledRoles: [], status: null };
    }
    const session = await readSignNowReviewSession(id).catch((err) => {
      console.warn(`[SignNow] could not read review session for ${id}:`, err);
      return null;
    });
    // Already confirmed for the current review link: answer from the CRM. The
    // row is reset whenever a new link is minted, so this cannot be a stale
    // Finish from an earlier review of a reused group.
    if (session?.completedAt) {
      return {
        envelopeId: id,
        reviewComplete: true,
        fulfilledRoles: session.fulfilledRoles,
        status: 'review_complete',
      };
    }
    // Callers that lost their own review clock (a refreshed CRM tab, the
    // completion page) fall back to when the current link was minted.
    const since =
      Number.isFinite(options.since) && Number(options.since) > 0
        ? Number(options.since)
        : session
          ? session.startedAt.getTime()
          : undefined;
    const client = await createSignNowApiClient();
    const checkOnce = async () => {
      const res = await client.get(`/v2/document-groups/${id}/embedded-invites`, {
        validateStatus: () => true,
      });
      const fromInvites =
        res.status >= 400
          ? { reviewComplete: false, fulfilledRoles: [] as string[], status: null as string | null }
          : resolveSignNowReviewStatus(res.data, since);
      if (fromInvites.reviewComplete) return fromInvites;

      /**
       * Second opinion: a signature that is actually filled in on the package.
       *
       * SignNow does not always flip the embedded invite's own status the moment
       * the preparer clicks Finish — on some groups only the document changes —
       * and a review whose finish is never noticed leaves the UI stuck on
       * "Review in SignNow" with no way to send. Signed widgets cannot appear
       * before somebody signed, and during Owner review the preparer is the only
       * party holding the package, so this cannot report a finish that did not
       * happen.
       */
      const groupRes = await client.get(`/documentgroup/${id}`, { validateStatus: () => true });
      const signedRoles =
        groupRes.status >= 400
          ? []
          : collectSignedRoleNames(groupRes.data?.data ?? groupRes.data, since);
      if (signedRoles.length) {
        return { reviewComplete: true, fulfilledRoles: signedRoles, status: 'review_complete' };
      }
      return fromInvites;
    };

    /**
     * One check per request — no sleep-and-retry.
     *
     * This endpoint is a 4-second liveness poll that runs for as long as the
     * review pane is open. Re-checking inside a single call doubled the SignNow
     * API traffic of every poll (four calls per tick) and held each request
     * open for an extra 1.5s, which is load the account's rate limit then takes
     * out on the signing session running in the iframe. The propagation lag the
     * retry was there for is covered by the next poll, 4 seconds later.
     */
    const result = await checkOnce();
    if (result.reviewComplete) {
      // Persist the Finish so it outlives the browser tab that saw it.
      await recordSignNowReviewCompleted(id, result.fulfilledRoles).catch((err) =>
        console.warn(`[SignNow] could not persist review completion for ${id}:`, err),
      );
    }
    return { envelopeId: id, ...result };
  }

  async getInviteSendDiagnostics(options: { envelopeId?: string; applicationId?: string }) {
    const envelopeId = String(options.envelopeId || '').trim();
    const applicationId = String(options.applicationId || '').trim();
    if (envelopeId) {
      const row = await getSignNowInviteSend(envelopeId);
      const document = await prisma.document.findUnique({
        where: { envelopeId },
        select: { status: true, sentAt: true, createdAt: true, envelopeId: true, applicationId: true },
      });
      return {
        contractId: document?.applicationId || applicationId || null,
        signnowDocumentId: envelopeId,
        sendStatus: row?.sendStatus || document?.status || null,
        createdAt: row?.createdAt || document?.createdAt || null,
        lastSendAttempt: row?.startedAt || document?.sentAt || null,
        applicationAttempts: row?.attemptCount ?? 0,
        inviteId: row?.inviteId || null,
      };
    }
    if (!applicationId) {
      throw new BadRequestException('Provide envelopeId or applicationId');
    }
    const rows = await listSignNowInviteSendsForApplication(applicationId);
    return {
      applicationId,
      sends: rows.map((row) => ({
        contractId: applicationId,
        signnowDocumentId: row.envelopeId,
        sendStatus: row.sendStatus,
        createdAt: row.createdAt,
        lastSendAttempt: row.startedAt,
        applicationAttempts: row.attemptCount,
        inviteId: row.inviteId,
      })),
    };
  }

  private async peekGroupInviteId(groupId: string): Promise<string> {
    const client = await createSignNowApiClient();
    const res = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
    if (res.status >= 400) return '';
    return this.extractGroupInviteId(res.data);
  }

  private async waitForGroupInviteId(groupId: string, timeoutMs: number): Promise<string> {
    const started = Date.now();
    let delay = 800;
    while (Date.now() - started < timeoutMs) {
      const inviteId = await this.peekGroupInviteId(groupId).catch(() => '');
      if (inviteId) return inviteId;
      const row = await getSignNowInviteSend(groupId).catch(() => null);
      if (row?.sendStatus === 'SENT' && row.inviteId) return row.inviteId;
      if (row?.sendStatus === 'FAILED') return '';
      await sleepSignNow(delay);
      delay = Math.min(3_000, delay + 400);
    }
    return this.peekGroupInviteId(groupId).catch(() => '');
  }

  private async deleteEmbeddedInvites(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[] = [],
  ) {
    const started = Date.now();
    await client.delete(`/v2/document-groups/${groupId}/embedded-invites`, {
      validateStatus: () => true,
    });
    await Promise.all(
      documents.map((doc) =>
        doc.id
          ? client.delete(`/v2/documents/${doc.id}/embedded-invites`, {
              validateStatus: () => true,
            })
          : Promise.resolve(),
      ),
    );
    logSignNowTiming('embedded-invite-delete', Date.now() - started, {
      documentCount: documents.length,
    });
  }

  /**
   * Cancel per-document field invites left over from Owner embedded review.
   * Callers that already hydrated `/document/{id}` pass those bodies through
   * `doc.remote`: the invite list is the same one a second GET would return,
   * so re-reading every document here only added a full round trip per
   * document to both Review and Send.
   */
  private async cancelPendingFieldInvites(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
  ) {
    await Promise.all(
      documents.map(async (doc) => {
        const id = String(doc.id || '').trim();
        if (!id) return;
        let remote = doc.remote;
        if (!remote) {
          const docRes = await client.get(`/document/${id}`, { validateStatus: () => true });
          if (docRes.status >= 400) return;
          remote = docRes.data;
        }
        const invites = Array.isArray(remote?.field_invites)
          ? remote.field_invites
          : [];
        for (const invite of invites) {
          const inviteId = String(invite?.id || invite?.unique_id || '').trim();
          const status = String(invite?.status || '').toLowerCase();
          if (!inviteId || ['fulfilled', 'completed', 'signed', 'finished'].includes(status)) {
            continue;
          }
          await client.put(
            `/fieldinvite/${inviteId}/cancel`,
            { reason: 'Nitro CRM rebake before send' },
            { validateStatus: () => true },
          );
        }
      }),
    );
  }

  private async sendEmailGroupInviteOnce(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[],
    signers: Array<{ name: string; email: string; roleName: string }>,
    subject: string,
    options: {
      applicationId?: string;
      ccEmails?: string[];
      fulfilledRoles?: string[];
      requestId?: string;
    },
  ) {
    const requestId = String(options.requestId || randomUUID()).trim();
    logSignNowSend('Contract send started', {
      contractId: groupId,
      requestId,
      signnowDocumentId: groupId,
      sendStatus: 'SENDING',
      timestamp: new Date().toISOString(),
    });
    const claim = await claimSignNowInviteSend({
      envelopeId: groupId,
      applicationId: options.applicationId || null,
      requestId,
    });
    if (claim.kind === 'already_sent' || claim.kind === 'in_progress') {
      logSignNowSend(
        claim.kind === 'already_sent'
          ? 'Contract already SENT - skipping duplicate invite'
          : 'Duplicate send prevented',
        {
          contractId: groupId,
          requestId,
          signnowDocumentId: groupId,
          sendStatus: claim.row.sendStatus,
          attemptNumber: claim.row.attemptCount,
          timestamp: new Date().toISOString(),
        },
      );
      return;
    }
    try {
      const inviteId = await this.sendGroupInvite(
        client,
        groupId,
        documents,
        signers,
        subject,
        options.ccEmails,
        options.fulfilledRoles || [],
        { requestId, attemptNumber: claim.attemptNumber, applicationId: options.applicationId },
      );
      await markSignNowInviteSent({ envelopeId: groupId, inviteId, requestId });
    } catch (error) {
      const existing = await this.peekGroupInviteId(groupId).catch(() => '');
      if (existing) {
        await markSignNowInviteSent({ envelopeId: groupId, inviteId: existing, requestId });
        return;
      }
      await markSignNowInviteFailed({
        envelopeId: groupId,
        requestId,
        errorCode: 'send_failed',
      });
      throw error;
    }
  }

  /**
   * Live status of a SignNow document group.
   *
   * `GET /documentgroup/{id}` carries no top-level `state`, so the group invite
   * is what actually reports whether every signer has finished. Fetching it is
   * one extra call and only happens while the group is still non-terminal —
   * `readTerminalGroupStatusFromCrm` short-circuits every later poll.
   */
  private async resolveRemoteGroupStatus(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    groupPayload: unknown,
  ): Promise<string> {
    let invitePayload: unknown = null;
    const inviteId = this.extractGroupInviteId(groupPayload);
    if (inviteId) {
      const inviteRes = await client.get(
        `/documentgroup/${groupId}/groupinvite/${inviteId}`,
        { validateStatus: () => true },
      );
      if (inviteRes.status < 400) invitePayload = inviteRes.data;
    }
    const status = resolveSignNowGroupStatus(groupPayload, invitePayload);
    console.info('[SignNow] group status resolved', {
      groupId,
      inviteId: inviteId || null,
      status,
    });
    return status;
  }

  private extractGroupInviteId(payload: unknown): string {
    const root = (payload || {}) as Record<string, unknown>;
    const nested = (root.data || root) as Record<string, unknown>;
    const invites = (nested.invites || root.invites) as Array<{ id?: string; unique_id?: string }> | undefined;
    return String(
      nested.invite_id ||
        nested.inviteId ||
        (nested as { document_group_invite_id?: string }).document_group_invite_id ||
        root.invite_id ||
        root.inviteId ||
        (root as { document_group_invite_id?: string }).document_group_invite_id ||
        invites?.[0]?.id ||
        invites?.[0]?.unique_id ||
        '',
    ).trim();
  }

  private async cancelExistingGroupInvite(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    groupPayload?: unknown,
    documents: SignNowDocumentRef[] = [],
  ) {
    await this.deleteEmbeddedInvites(client, groupId, documents);
    let inviteId = this.extractGroupInviteId(groupPayload);
    if (!inviteId) {
      const res = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
      inviteId = this.extractGroupInviteId(res.data);
    }
    if (!inviteId) return;
    const cancel = await client.post(
      `/documentgroup/${groupId}/groupinvite/${inviteId}/cancelinvite`,
      {},
      { validateStatus: () => true },
    );
    if (cancel.status >= 400) {
      const retryGet = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
      const retryId = this.extractGroupInviteId(retryGet.data);
      if (retryId && retryId !== inviteId) {
        const retryCancel = await client.post(
          `/documentgroup/${groupId}/groupinvite/${retryId}/cancelinvite`,
          {},
          { validateStatus: () => true },
        );
        if (retryCancel.status < 400) {
          console.info('[SignNow] cancelled existing groupinvite', {
            groupId,
            inviteId: retryId,
            status: retryCancel.status,
          });
          return;
        }
      }
      console.info('[SignNow] skip cancel — id is not an email groupinvite', {
        groupId,
        inviteId,
        status: cancel.status,
        detail: cancel.data?.errors?.[0]?.message || cancel.data?.error || cancel.status,
      });
      return;
    }
    console.info('[SignNow] cancelled existing groupinvite', {
      groupId,
      inviteId,
      status: cancel.status,
    });
  }

  /**
   * Wait until every copied document is readable and — when `requireFields` is
   * set — actually carries its widgets.
   *
   * SignNow answers `GET /document/{id}` with 200 while the copy's fields are
   * still being attached, so "loaded" is not the same as "has fields". An
   * embedded invite posted inside that window is rejected with "At least one
   * document in document group must contain fields", which is what surfaced in
   * the CRM as a failed Review in SignNow on a freshly built package.
   */
  private async waitForDocumentsReady(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
    attempts = 4,
    options?: { requireFields?: boolean },
  ): Promise<SignNowDocumentRef[]> {
    const usable = documents.filter((d) => String(d.id || '').trim());
    if (!usable.length) return documents;
    const started = Date.now();
    let current = usable;
    try {
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (attempt > 0) countSignNowPoll();
        current = await this.hydrateDocumentRoles(client, current, { skipIfHydrated: true });
        const pending = current.filter(
          (d) => !d.remote || (options?.requireFields && !(d.fieldCount ?? 0)),
        );
        if (!pending.length) return current;
        console.warn('[SignNow] waiting for copied documents to finish loading', {
          attempt: attempt + 1,
          pending: pending.map((d) => d.document_name || d.name || d.id),
          withoutFields: options?.requireFields
            ? pending.filter((d) => !(d.fieldCount ?? 0)).length
            : undefined,
        });
        await sleepSignNow(450 * (attempt + 1));
      }
      return current;
    } finally {
      logSignNowTiming('wait-for-documents-ready', Date.now() - started, {
        documentCount: usable.length,
      });
    }
  }

  /**
   * Put a field-less copy's widgets back from the template it was copied from.
   *
   * The last resort behind the review link: when a document in the group still
   * reports no fields after the readiness wait, the copy itself is broken (the
   * widgets never came across, or an earlier publish wrote an empty field set
   * onto it) and no amount of waiting will fix it. `origin_document_id` names
   * the exact template document this copy came from — the funder's own, not a
   * global fallback that would stamp another funder's layout onto the page — so
   * its field set can be written straight back.
   *
   * Returns the documents re-hydrated, so the caller sees the repaired counts.
   */
  private async restoreFieldsFromOriginTemplate(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
  ): Promise<SignNowDocumentRef[]> {
    const empty = documents.filter((d) => String(d.id || '').trim() && !(d.fieldCount ?? 0));
    if (!empty.length) return documents;
    let repaired = 0;
    for (const doc of empty) {
      const originId =
        doc.originDocumentId || signNowOriginDocumentId(doc.remote);
      if (!originId || originId === doc.id) {
        console.warn('[SignNow] field-less document has no origin template to restore from', {
          documentId: doc.id,
          name: doc.document_name || doc.name || '',
        });
        continue;
      }
      try {
        const templateData = await this.fetchTemplateDocumentCached(client, originId);
        if (!templateData) continue;
        const fields = fieldsOnExistingPages(
          collectSignNowPutFields(templateData).map(({ id: _id, ...rest }) => rest),
          signNowDocumentPageCount(doc.remote) || signNowDocumentPageCount(templateData),
        );
        if (!fields.length) continue;
        const putFields = (body: Record<string, unknown>[]) =>
          client.put(
            `/document/${doc.id}`,
            { client_timestamp: Math.floor(Date.now() / 1000), fields: body },
            { validateStatus: () => true, timeout: 90_000 },
          );
        let res = await putFields(fields);
        if (res.status >= 400 && hasSignNowSignatureFieldFont(fields)) {
          res = await putFields(withoutSignNowSignatureFieldFont(fields));
        }
        if (res.status >= 400) {
          console.warn('[SignNow] could not restore fields onto field-less document', {
            documentId: doc.id,
            originId,
            detail: this.signNowErrorDetail(res),
          });
          continue;
        }
        repaired += 1;
        console.info('[SignNow] restored fields onto a field-less group document', {
          documentId: doc.id,
          originId,
          restored: fields.length,
        });
      } catch (err) {
        console.warn(
          '[SignNow] restoring fields from the origin template threw',
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    if (!repaired) return documents;
    const refreshed = await this.hydrateDocumentRoles(
      client,
      documents.map((d) => (empty.some((e) => e.id === d.id) ? { ...d, fieldCount: 0 } : d)),
      { skipIfHydrated: true },
    );
    return refreshed;
  }

  private async hydrateDocumentRoles(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
    options?: { skipIfHydrated?: boolean },
  ): Promise<SignNowDocumentRef[]> {
    const fetched = await Promise.all(
      documents.map(async (doc) => {
        // `roles` from document-group listings are not trustworthy — only a prior
        // /document/{id} hydrate sets listedRoles / remainingRoles.
        /**
         * A document hydrated with zero fields is never re-read while it is
         * cached as "hydrated", so the empty-field window a fresh package opens
         * would never close and the review link would keep failing. Always
         * re-read that one.
         */
        if (
          options?.skipIfHydrated &&
          doc.fieldCount !== 0 &&
          (doc.remote || doc.listedRoles?.length || doc.remainingRoles?.length)
        ) {
          return doc;
        }
        let res: { status: number; data?: any } = { status: 0, data: {} };
        const hydrateStarted = Date.now();
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) countSignNowRetry();
          res = await client.get(`/document/${doc.id}`, { validateStatus: () => true });
          if (res.status < 400) break;
          if (
            !isTransientSignNowFailure(res.status, this.signNowErrorDetail(res)) &&
            res.status !== 404
          ) {
            break;
          }
          await sleepSignNow(350 * (attempt + 1));
        }
        logSignNowTiming('document-hydration-get', Date.now() - hydrateStarted, {
          documentId: doc.id,
          documentName: String(doc.document_name || doc.name || ''),
        });
        if (res.status >= 400) {
          return {
            ...doc,
            roles: uniqueRoleNames(doc.roles || []),
          };
        }
        const fieldCount = countSignNowDocumentFields(res.data);
        const listedRoles = uniqueRoleNames([
          ...collectListedDocumentRoles(res.data),
          ...collectSignWidgetRoles(res.data),
        ]);
        // Prefer roles that actually have fields. Document `roles` lists can
        // include Recipient 2 even when that PDF has no Recipient 2 widgets.
        // Keep text/prefill Owner roles here for embedded review; sendEnvelope
        // skips Owner/Approver on email groupinvite separately.
        const fieldRoles = collectDocumentRoles(res.data);
        return {
          ...doc,
          remote: res.data,
          fieldCount,
          originDocumentId:
            signNowOriginDocumentId(res.data) || doc.originDocumentId || '',
          listedRoles,
          roles: fieldRoles.length
            ? fieldRoles
            : listedRoles.length
              ? listedRoles
              : uniqueRoleNames(doc.roles || []),
          remainingRoles: collectRemainingInviteRoles(res.data),
          fulfilledRoles: uniqueRoleNames([
            ...(doc.fulfilledRoles || []),
            ...collectFulfilledRoleNames(res.data),
          ]),
        };
      }),
    );
    return fetched;
  }

  private async sendGroupInvite(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[],
    signers: Array<{ name: string; email: string; roleName: string }>,
    subject: string,
    ccEmails?: string[],
    fulfilledRoles: string[] = [],
    meta: { requestId?: string; attemptNumber?: number; applicationId?: string } = {},
  ): Promise<string> {
    const alreadyHydrated = documents.every(
      (d) => Boolean(d.listedRoles?.length || d.roles?.length) && String(d.id || '').trim(),
    );
    const usableDocs = (
      alreadyHydrated
        ? documents
        : await this.hydrateDocumentRoles(client, documents)
    ).filter((d) => String(d.id || '').trim());
    if (!usableDocs.length) {
      throw new BadRequestException('SignNow group has no documents to invite');
    }

    const templateRoles = uniqueRoleNames(usableDocs.flatMap((d) => d.roles || []));
    const mappedSigners = fillSignersForTemplateRoles(templateRoles, signers);
    if (!mappedSigners.length) {
      throw new BadRequestException('At least one signer with an email is required to send');
    }

    const byRole = new Map(
      mappedSigners.map((s) => [s.roleName.trim().toLowerCase(), s] as const),
    );
    const preparer = resolvePreparerIdentity();
    const primary = mappedSigners.find((s) => !s.preparer) || mappedSigners[0];
    const resolveSignerForRole = (role: string) => {
      const mapped =
        byRole.get(role.trim().toLowerCase()) ||
        [...byRole.entries()].find(([key]) => sameSignNowRole(key, role))?.[1];
      if (mapped?.email) return mapped;
      const nitroStyle = usesNitroApproverRoles(templateRoles);
      if ((isPreparerRole(role, nitroStyle) || isInternalSignNowRole(role)) && preparer) {
        return { ...preparer, roleName: role, preparer: true as const };
      }
      if (isOwner2Role(role, nitroStyle)) {
        const second = distinctSecondMerchant(signers);
        // Only invite Recipient 2 when CRM has a distinct second merchant.
        // Do not fall back to merchant 1 — that forces R2 onto docs that lack it.
        if (second) return { ...second, roleName: role };
        return null;
      }
      if (isOwner1Role(role, nitroStyle) && primary?.email) {
        return { ...primary, roleName: role };
      }
      return null;
    };
    type InviteAction = {
      email: string;
      role_name: string;
      action: 'sign' | 'view';
      document_id: string;
      allow_reassign: '0';
      decline_by_signature: '0';
    };
    const steps: Array<{
      order: number;
      email: string;
      name: string;
      actions: InviteAction[];
    }> = [];
    const usedEmails: string[] = [];

    const addAction = (signer: { name: string; email: string }, action: InviteAction) => {
      const alreadyAnywhere = steps.some((step) =>
        step.actions.some(
          (a) =>
            a.document_id === action.document_id &&
            a.role_name.toLowerCase() === action.role_name.toLowerCase(),
        ),
      );
      if (alreadyAnywhere) return;
      // SignNow: document id must be unique for a signer in one step.
      const emailAlreadyHasDoc = steps.some(
        (step) =>
          step.email.toLowerCase() === action.email.toLowerCase() &&
          step.actions.some((a) => a.document_id === action.document_id),
      );
      if (emailAlreadyHasDoc) {
        action = {
          ...action,
          email: uniqueEmailAlias(action.email, usedEmails, action.role_name),
        };
      }
      let step = steps.find((s) => s.email.toLowerCase() === action.email.toLowerCase());
      if (!step) {
        if (!usedEmails.includes(action.email.toLowerCase())) {
          usedEmails.push(action.email.toLowerCase());
        }
        step = {
          order: steps.length + 1,
          email: action.email,
          name: signer.name,
          actions: [],
        };
        steps.push(step);
      }
      step.actions.push({ ...action, email: step.email });
    };

    const missing: string[] = [];
    const nitroStyle = usesNitroApproverRoles(templateRoles);
    const skipCompleted = new Set(
      uniqueRoleNames([
        ...fulfilledRoles,
        ...usableDocs.flatMap((doc) => doc.fulfilledRoles || []),
      ]).map((role) => role.toLowerCase()),
    );
    const hasSecondMerchant = Boolean(distinctSecondMerchant(signers));
    const exactRoleOnDoc = (role: string, catalog: string[]) => {
      const hit = catalog.find((name) => sameSignNowRole(name, role));
      return hit || role;
    };
    // Field-backed roles only — listedRoles can invent Recipient 2 with no widgets.
    const catalogFor = (doc: SignNowDocumentRef) =>
      uniqueRoleNames(doc.roles?.length ? doc.roles : doc.listedRoles || []);
    console.info('[SignNow] groupinvite document roles', {
      groupId,
      skipCompleted: [...skipCompleted],
      hasSecondMerchant,
      documents: usableDocs.map((d) => ({
        id: d.id,
        name: d.document_name || d.name,
        listedRoles: d.listedRoles,
        roles: d.roles,
        remainingRoles: d.remainingRoles,
      })),
    });
    const merchantInviteRoles = (source: string[]) =>
      uniqueRoleNames(source).filter((role) => {
        if (isPreparerRole(role, nitroStyle) || isInternalSignNowRole(role)) return false;
        // One CRM signer → never invite Recipient 2 / owner 2.
        if (isOwner2Role(role, nitroStyle) && !hasSecondMerchant) return false;
        if (skipCompleted.has(role.toLowerCase()) && !isOwner2Role(role, nitroStyle)) return false;
        return true;
      });
    // After Owner review, do NOT email Owner/Approver. Templates often keep Owner
    // on text/prefill fields, which made groupinvite send "Role name Owner is not
    // found on document …". Merchants only — SignNow will ask via "was not
    // specified" if a document still requires a CRM role.
    for (const doc of usableDocs) {
      let catalog = catalogFor(doc);
      if (!catalog.length) {
        catalog = ['Recipient 1'];
      }
      const live = merchantInviteRoles(doc.remainingRoles || [])
        .map((role) => exactRoleOnDoc(role, catalog))
        .filter(
          (role) =>
            !catalog.length || catalog.some((name) => sameSignNowRole(name, role)),
        );
      const fallback = merchantInviteRoles(catalog);
      let merchantRoles = uniqueRoleNames(live.length ? live : fallback);
      if (!merchantRoles.length && primary?.email) {
        const merchantCatalog = catalog.filter(
          (role) => !isPreparerRole(role, nitroStyle) && !isInternalSignNowRole(role),
        );
        merchantRoles = uniqueRoleNames([
          merchantCatalog.find((role) => isOwner1Role(role, nitroStyle)) ||
            merchantCatalog[0] ||
            'Recipient 1',
        ]);
      }
      // Merchants only — never attach Owner/Approver to email groupinvite.
      const roles = merchantRoles;
      if (!roles.length) {
        if (!primary?.email) {
          missing.push(`${doc.document_name || doc.id}: (no merchant roles left to invite)`);
          continue;
        }
        addAction(primary, {
          email: primary.email,
          role_name: 'Recipient 1',
          action: 'sign',
          document_id: doc.id,
          allow_reassign: '0',
          decline_by_signature: '0',
        });
        continue;
      }
      for (const role of roles) {
        const signer = resolveSignerForRole(role);
        if (!signer?.email) {
          missing.push(`${doc.document_name || doc.id}: ${role}`);
          continue;
        }
        addAction(signer, {
          email: signer.email,
          role_name: role,
          action: 'sign',
          document_id: doc.id,
          allow_reassign: '0',
          decline_by_signature: '0',
        });
      }
    }
    if (missing.length) {
      throw new BadRequestException(
        `Cannot send: SignNow roles missing an email assignment: ${missing.join('; ')}`,
      );
    }

    const isCrmInviteStep = (step: { actions: Array<{ role_name: string }> }) =>
      step.actions.some(
        (action) => isPreparerRole(action.role_name, nitroStyle) || isInternalSignNowRole(action.role_name),
      );
    const toInviteSteps = () => {
      const active = steps.filter((step) => step.actions.length);
      const merchants = active.filter((step) => !isCrmInviteStep(step));
      const crmSteps = active.filter((step) => isCrmInviteStep(step));
      // Merchant first so SignNow emails them immediately. Owner is omitted
      // unless SignNow requires that role, in which case it is added last.
      const inviteSubject =
        String(subject || '').trim() || 'Nitro Advance Contract';
      return [...merchants, ...crmSteps].map((step, idx) => ({
        order: idx + 1,
        invite_emails: [
          {
            email: step.email,
            expiration_days: 30,
            reminder: 0,
            subject: inviteSubject,
          },
        ],
        invite_actions: step.actions.map((action) => ({
          ...action,
          email: step.email,
        })),
      }));
    };

    let inviteSteps = toInviteSteps();
    if (!inviteSteps.length) {
      throw new BadRequestException('At least one merchant signer with an email is required to send');
    }

    const invitedEmails = () =>
      uniqueEmails(inviteSteps.flatMap((step) => step.invite_emails.map((row) => row.email)));
    // SignNow's own "documents signed" email goes to completion_emails. Only
    // the selected funder's CC is added there — extra addresses typed at send
    // get the unsigned copy, not the signed one.
    const funderCc = new Set(
      (await this.readSignedNoticeCcRecipients(groupId, meta.applicationId)).map((e) =>
        e.toLowerCase(),
      ),
    );
    const extraCc = uniqueEmails(ccEmails).filter((e) => funderCc.has(e.toLowerCase()));
    const buildBody = (): Record<string, unknown> => {
      const emails = invitedEmails();
      // Do not send `cc` on groupinvite — SignNow treats malformed CC as
      // "Email is invalid". Notify extras when the package completes instead.
      return {
        invite_steps: inviteSteps,
        completion_emails: uniqueEmails([...emails, preparer?.email || '', ...extraCc]).map(
          (email) => ({
            email,
            disable_document_attachment: 0,
          }),
        ),
      };
    };

    const postInvite = async (body: Record<string, unknown>) => {
      console.info('[SignNow] groupinvite roles', {
        groupId,
        stepCount: inviteSteps.length,
        actionCount: inviteSteps.reduce((n, step) => n + step.invite_actions.length, 0),
        roles: inviteSteps.flatMap((step) =>
          step.invite_actions.map((a) => ({
            action: a.action,
            role: a.role_name,
            document_id: a.document_id,
          })),
        ),
      });
      const res = await client.post(`/documentgroup/${groupId}/groupinvite`, body, {
        validateStatus: () => true,
      });
      if (res.status >= 400) {
        console.warn('[SignNow] groupinvite failed', {
          groupId,
          status: res.status,
          detail:
            res.data?.errors?.[0]?.message ||
            res.data?.error ||
            JSON.stringify(res.data || {}).slice(0, 500),
        });
      }
      return res;
    };

    const findExistingInviteId = async () => {
      const res = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
      return this.extractGroupInviteId(res.data);
    };

    const rolesOnDoc = (documentId: string) => {
      const doc = usableDocs.find((d) => d.id.toLowerCase() === documentId.toLowerCase());
      return catalogFor(doc || { id: documentId });
    };

    const repairForFailedDetail = async (detail: string) => {
      if (/65536|embedded invite/i.test(detail)) {
        await this.deleteEmbeddedInvites(client, groupId, usableDocs);
        return true;
      }
      const unknown = parseUnknownInviteRole(detail);
      if (unknown) {
        const unknownDoc = unknown.documentId.toLowerCase();
        const catalog = rolesOnDoc(unknown.documentId);
        const exact = catalog.find((name) => sameSignNowRole(name, unknown.role));
        let changed = false;
        // Spelling-only fix (Recipient2 → Recipient 2). Never swap to a different
        // role — that caused "Owner is not found" on addenda that only have R1.
        if (exact) {
          for (const step of steps) {
            for (const action of step.actions) {
              if (
                action.document_id.toLowerCase() === unknownDoc &&
                sameSignNowRole(action.role_name, unknown.role) &&
                action.role_name !== exact
              ) {
                action.role_name = exact;
                changed = true;
              }
            }
          }
        }
        if (!changed) {
          // Owner/Approver text fields often appear on every PDF. If SignNow says
          // the role is not inviteable on one doc, drop that CRM role everywhere
          // so one repair clears the whole package (maxRoleRepairs is small).
          const dropEverywhere = isPreparerRole(unknown.role, nitroStyle);
          for (const step of steps) {
            const before = step.actions.length;
            step.actions = step.actions.filter((action) => {
              if (!sameSignNowRole(action.role_name, unknown.role)) return true;
              if (dropEverywhere) return false;
              return action.document_id.toLowerCase() !== unknownDoc;
            });
            if (step.actions.length !== before) changed = true;
          }
          if (changed) {
            console.warn('[SignNow] dropping unknown groupinvite role', {
              ...unknown,
              dropEverywhere,
            });
          }
        }
        if (!changed) return false;
        inviteSteps = toInviteSteps();
        return inviteSteps.length > 0;
      }
      const omitted = parseMissingInviteRole(detail);
      if (!omitted) return false;
      // Do not invent Recipient 2 for single-merchant sends.
      if (isOwner2Role(omitted.role, nitroStyle) && !hasSecondMerchant) {
        console.warn('[SignNow] ignoring omitted Recipient 2 — no second merchant', omitted);
        return false;
      }
      let signer = resolveSignerForRole(omitted.role);
      if (!signer?.email && isOwner2Role(omitted.role, nitroStyle) && primary?.email) {
        signer = { ...primary, roleName: omitted.role };
      }
      if (
        !signer?.email &&
        (isPreparerRole(omitted.role, nitroStyle) || isInternalSignNowRole(omitted.role)) &&
        preparer
      ) {
        signer = { ...preparer, roleName: omitted.role, preparer: true as const };
      }
      if (!signer?.email) return false;
      addAction(signer, {
        email: signer.email,
        role_name: omitted.role,
        action: 'sign',
        document_id: omitted.documentId,
        allow_reassign: '0',
        decline_by_signature: '0',
      });
      inviteSteps = toInviteSteps();
      return inviteSteps.length > 0;
    };

    const result = await postGroupInviteSafely({
      groupId,
      requestId: meta.requestId || randomUUID(),
      attemptNumber: meta.attemptNumber || 1,
      postInvite: async () => {
        inviteSteps = toInviteSteps();
        const posted = await postInvite(buildBody());
        return {
          status: posted.status,
          data: posted.data,
          headers: posted.headers as Record<string, unknown> | undefined,
        };
      },
      findExistingInviteId,
      repairForFailedDetail,
      log: logSignNowSend,
    });
    if (result.ok) return result.inviteId;

    throw new BadRequestException(
      `SignNow send failed: ${result.detail || 'groupinvite rejected'}`,
    );
  }

  private async withSignNowGroupWriteLock<T>(
    groupId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const id = String(groupId || '').trim();
    if (!id) return work();
    const previous = signNowGroupWriteLocks.get(id) || Promise.resolve();
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => held);
    signNowGroupWriteLocks.set(id, queued);
    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (signNowGroupWriteLocks.get(id) === queued) {
        signNowGroupWriteLocks.delete(id);
      }
    }
  }

  /**
   * Reassign merchant-required ACH/Exhibit C fields to Owner so the later Review
   * click can skip the ~4s field PUT and only write prefill-texts.
   */
  /**
   * Hand every document in the group over to the merchant: reassign the fields
   * off Owner, mark the merchant-required slots required, and bake the current
   * CRM values onto the page as text.
   *
   * `sendEnvelope` does exactly this inline before posting a SignNow group
   * invite, which is why the SignNow send showed the merchant their fields and
   * their latest amounts. The SendGrid portal reuses the embedded invite minted
   * during Owner review, so without this step merchants opened a document whose
   * fields were still Owner-assigned and whose values were whatever review had
   * written.
   *
   * `values` must be the caller's freshly built CRM prefill map. Passing an
   * empty map leaves each field's existing `prefilled_text` in place, which is
   * how a contract edited after review still emailed its previous numbers —
   * `exposeToMerchant` rewrites `fields` *and* `texts` in one PUT, so supplying
   * current values replaces the baked page text rather than layering over it.
   */
  /**
   * Current CRM values for this group's contract, straight from the database.
   *
   * A resend must never depend on the caller's payload being fresh: when it
   * omits a key (or arrives empty), the value the merchant publish would fall
   * back to is whatever an earlier send baked onto the page. Reading the
   * Contract row — which the application edit updates — means an Offer Amount
   * change reaches every document even if the request carries nothing.
   *
   * These fill gaps only; a value the caller did send always wins.
   */
  /**
   * Exhibit C entities for a group we only know by envelope id.
   *
   * The review build already has the contract id to hand; the send and the
   * merchant publish do not, so they resolve it the same way
   * `loadContractPrefillDefaults` does (document → applicationId → contract).
   * Returns an empty list when the contract cannot be resolved, which leaves
   * the caller baking the package-wide values exactly as before.
   */
  private async loadGroupDocumentPrefillContext(
    groupId: string,
    values: Record<string, string>,
  ): Promise<{
    entities: ExhibitCEntityPrefillRow[];
    documentTabValues: SignNowDocumentTabValues[];
  }> {
    const empty = { entities: [], documentTabValues: [] };
    try {
      const document = await prisma.document.findUnique({
        where: { envelopeId: groupId },
        select: { applicationId: true },
      });
      const applicationId = String(document?.applicationId || '').trim();
      if (!applicationId) return empty;
      const contract = await prisma.contract.findFirst({
        where: { applicationId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, contractPrefillOverrides: true },
      });
      if (!contract) return empty;
      const mappingRows = await (prisma as any).contractDocumentTemplateMapping.findMany({
        where: { contractId: contract.id },
        include: { template: true },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      });
      return {
        entities: buildExhibitCEntitiesForPrefill(
          values,
          contract.contractPrefillOverrides,
          mappingRows,
        ),
        documentTabValues: buildSignNowDocumentTabValues(
          mappingRows,
          contract.contractPrefillOverrides,
        ),
      };
    } catch (err) {
      console.warn('[SignNow] could not load per-document prefill for group', {
        groupId,
        error: err instanceof Error ? err.message : String(err),
      });
      return empty;
    }
  }

  /**
   * `applicationIdHint` covers the Review build, which needs these defaults
   * before the document group exists (and so before `Document.envelopeId` can
   * name the application).
   */
  private async loadContractPrefillDefaults(
    groupId: string,
    applicationIdHint?: string,
    /**
     * Contract to fall back to when the caller has no application id. Review is
     * reachable from screens that only carry the contract, and without this the
     * whole package went out with nothing but the values the field resolver can
     * invent from an empty map.
     */
    contractIdHint?: number,
  ): Promise<{
    defaults: Record<string, string>;
    offerSource: ContractOfferPrefillSource;
  }> {
    try {
      const document = groupId
        ? await prisma.document.findUnique({
            where: { envelopeId: groupId },
            select: { applicationId: true },
          })
        : null;
      const applicationId =
        String(document?.applicationId || '').trim() ||
        String(applicationIdHint || '').trim();
      const contractId =
        Number.isFinite(contractIdHint) && Number(contractIdHint) > 0
          ? Number(contractIdHint)
          : null;
      if (!applicationId && !contractId) {
        return { defaults: {}, offerSource: { values: null, includeWireFee: true } };
      }
      const contract = await prisma.contract.findFirst({
        where: applicationId ? { applicationId } : { id: contractId as number },
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          purchasePrice: true,
          purchaseAmount: true,
          purchasePercent: true,
          remittance: true,
          appendixUnderwritingFees: true,
          contractPrefillOverrides: true,
          offer: {
            select: {
              offer: true,
              totalRemit: true,
              term: true,
              frequency: true,
              repayPerPeriod: true,
              fees: true,
              refinanceAmount: true,
            },
          },
          legalName: true,
          customerName: true,
          doingBusinessAs: true,
          federalTaxIdEin: true,
          clientName: true,
          clientEmail: true,
          clientPhone: true,
          businessAddress: true,
          businessAddressCity: true,
          businessAddressState: true,
          businessAddressZip: true,
          businessAddressContract: true,
          businessAddressContractCity: true,
          businessAddressContractState: true,
          businessAddressContractZip: true,
          // The business's own email — the Waiver of Personal Service page
          // prints it on the MERCHANT service-of-process line, which must not
          // carry Owner 1's personal address. Contract has no column of its
          // own for it, so it comes from the Client record behind the deal.
          client: {
            select: {
              id: true,
              businessEmail: true,
              businessEntityType: true,
              ownerFirstName: true,
              ownerLastName: true,
              ownerEmail: true,
              ownerSsn: true,
            },
          },
          entityType: true,
          authorizationClientBankName: true,
          authorizationClientBankAccount: true,
          authorizationClientBankRouting: true,
          paymentBankId: true,
        },
      });
      if (!contract) {
        return { defaults: {}, offerSource: { values: null, includeWireFee: true } };
      }
      const out: Record<string, string> = {};
      const put = (key: string, value: unknown) => {
        const text = String(value ?? '').trim();
        if (text) out[key] = text;
      };
      // The columns are a creation-time snapshot; the live OfferDecision wins so a
      // re-scrubbed offer reaches the ACH / disclosure documents on every send.
      const derived = resolveOfferDerivedContractValues(contract.offer);
      put('purchase_price', derived?.purchasePrice ?? contract.purchasePrice);
      put('purchased_amount', derived?.purchaseAmount ?? contract.purchaseAmount);
      put('purchase_percent', contract.purchasePercent);
      put('remittance', derived?.remittance ?? contract.remittance);
      // `frequency` has no scalar column on Contract (it only lives on OfferDecision /
      // BoldSignTemplate / ACH); `derived` is the only funder-agnostic source here, and
      // it is populated whenever the contract's required OfferDecision loaded correctly.
      put('frequency', derived?.frequency);
      put(
        'appendix_underwriting_fees',
        derived?.appendixUnderwritingFees ?? contract.appendixUnderwritingFees,
      );
      put('legal_name', contract.legalName);
      put('customer_name', contract.customerName);
      put('doing_business_as', contract.doingBusinessAs);
      put('federal_tax_id_ein', contract.federalTaxIdEin);
      put('client_name', contract.clientName);
      put('client_email', contract.clientEmail);
      // Business email, distinct from Owner 1's `client_email` above.
      put('business_email', contract.client?.businessEmail);
      put('client_phone', contract.clientPhone);
      put('business_address', contract.businessAddress);
      put('business_address_city', contract.businessAddressCity);
      put('business_address_state', contract.businessAddressState);
      put('business_address_zip', contract.businessAddressZip);
      // Merchant / Owner 1 home address — a separate CRM entry from the business
      // physical address above, and the value the agreement's merchant contact
      // block and the addendums' contact line resolve from.
      put('business_address_contract', contract.businessAddressContract);
      put('business_address_contract_city', contract.businessAddressContractCity);
      put('business_address_contract_state', contract.businessAddressContractState);
      put('business_address_contract_zip', contract.businessAddressContractZip);
      /**
       * Entity type, owner SSNs and Owner 2's contact block.
       *
       * Like the bank block below, these reached SignNow only through the CRM
       * screen's payload. When a Review adopted the background pre-warm, or ran
       * after "Resend new contract" cleared the saved prefill, the payload came
       * through without them and the agreement opened with Form of Business
       * Entity, both SSN lines and Owner 2's phone / address on "Enter text" —
       * although the deal holds every one of them. They fill gaps only; a value
       * the screen sends still wins.
       */
      try {
        await this.putContractPartyDefaults(put, contract);
      } catch (err) {
        console.warn('[SignNow] could not read party prefill defaults', {
          groupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      // Obsidian's EPA / Exhibit A addendums carry a numbered seller table and an
      // early-payoff schedule that live in their own CRM tables, not on Contract.
      try {
        const addendum = contract.id
          ? await prisma.addendum.findFirst({
              where: { contractId: contract.id },
              orderBy: { updatedAt: 'desc' },
            })
          : null;
        put('addendum_type_of_entity_1', addendum?.typeOfEntity1);
        put('addendum_type_of_entity_2', addendum?.typeOfEntity2);
        put('addendum_type_of_entity_3', addendum?.typeOfEntity3);
        put('addendum_ein_1', addendum?.ein1);
        put('addendum_ein_2', addendum?.ein2);
        put('addendum_ein_3', addendum?.ein3);
        put('exhibit_a_value_1', addendum?.legalName1);
        put('exhibit_a_value_2', addendum?.legalName2);
        put('exhibit_a_value_3', addendum?.legalName3);
      } catch (err) {
        console.warn('[SignNow] could not read addendum prefill defaults', {
          groupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      try {
        const epo = contract.id
          ? await prisma.ePO.findFirst({
              where: { contractId: contract.id },
              orderBy: { updatedAt: 'desc' },
            })
          : null;
        put('epo_amount_received_1', epo?.amountReceived1);
        put('epo_amount_received_2', epo?.amountReceived2);
        put('epo_amount_received_3', epo?.amountReceived3);
        put('epo_received_date_1', epo?.receivedDate1);
        put('epo_received_date_2', epo?.receivedDate2);
        put('epo_received_date_3', epo?.receivedDate3);
      } catch (err) {
        console.warn('[SignNow] could not read EPO prefill defaults', {
          groupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      /**
       * The bank block every addendum prints: Account Holder Bank Name, Account
       * Number and Routing Number on the Monthly Fee page, on Exhibit C and on
       * the ACH authorization, plus the portal / username the deal may carry.
       *
       * These reached SignNow from ONE place — the CRM screen's prefill payload —
       * and nothing on the server could fill them in, because this read covered
       * the merchant and money columns only. So whenever that payload arrived
       * without them (a package the screen posted before the ACH block was
       * opened, a Review whose request never reached the server, a group adopted
       * from the pre-warm) every addendum went out with "Enter text" on all three
       * bank lines, on every funder — they share the widget names, so they share
       * the fix.
       *
       * Read in the order the CRM itself treats as authoritative: the prefill
       * editor's own saved block (which already falls back to the primary
       * Exhibit C entity), then the contract columns, then the application's
       * Bank Details row. `readBankFieldsFromPrefill` decrypts, so nothing here
       * can publish ciphertext onto a page.
       */
      try {
        const bank = readBankFieldsFromPrefill(contract.contractPrefillOverrides);
        const bankName =
          bank.bankName || decryptSensitiveField(contract.authorizationClientBankName);
        const bankAccount =
          bank.accountNumber ||
          decryptSensitiveField(contract.authorizationClientBankAccount);
        const bankRouting =
          bank.routingNumber ||
          decryptSensitiveField(contract.authorizationClientBankRouting);
        let fromBankDetail: {
          bankName?: string | null;
          accountNumber?: string | null;
          routingNumber?: string | null;
        } | null = null;
        if (!bankName || !bankAccount || !bankRouting) {
          fromBankDetail = contract.paymentBankId
            ? await prisma.bankDetail.findUnique({
                where: { id: contract.paymentBankId },
                select: { bankName: true, accountNumber: true, routingNumber: true },
              })
            : applicationId
              ? await prisma.bankDetail.findFirst({
                  where: { applicationId },
                  orderBy: { updatedAt: 'desc' },
                  select: { bankName: true, accountNumber: true, routingNumber: true },
                })
              : null;
        }
        const resolvedBankName =
          bankName || decryptSensitiveField(fromBankDetail?.bankName);
        const resolvedBankAccount =
          bankAccount || decryptSensitiveField(fromBankDetail?.accountNumber);
        const resolvedBankRouting =
          bankRouting || decryptSensitiveField(fromBankDetail?.routingNumber);
        // Published under every CRM id the field map resolves the bank widgets
        // through, so the Monthly Fee (`authorization_client_bank_*`), Exhibit C
        // and the ACH pages (`ach_bank_*`) all reach the same values.
        for (const key of [
          'authorization_client_bank_name',
          'ach_authorization_account_holder_bank_name',
          'ach_bank_name',
        ]) {
          put(key, resolvedBankName);
        }
        for (const key of [
          'authorization_client_bank_account',
          'ach_authorization_account_holder_bank_account_number',
          'ach_bank_account',
        ]) {
          put(key, resolvedBankAccount);
        }
        for (const key of [
          'authorization_client_bank_routing',
          'ach_authorization_account_holder_bank_routing_number',
          'ach_bank_routing',
        ]) {
          put(key, resolvedBankRouting);
        }
        for (const key of ['ach_authorization_bank_portal_website', 'ach_bank_portal']) {
          put(key, bank.bankPortal);
        }
        for (const key of ['ach_authorization_username', 'ach_username']) {
          put(key, bank.bankUsername);
        }
      } catch (err) {
        console.warn('[SignNow] could not read bank prefill defaults', {
          groupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      /**
       * The state disclosure prints the business's average monthly revenue and
       * scales its "percent of business income" line off the same number. Bank
       * analyses are the CRM screen's source for it and are not readable here,
       * but the business's own declared monthly revenue is the same fallback the
       * screen uses when no analysis is attached — and a declared figure beats
       * the blank box the disclosure otherwise went out with.
       */
      try {
        const client = applicationId
          ? await prisma.application.findUnique({
              where: { id: applicationId },
              select: { client: { select: { businessMonthlyRevenue: true } } },
            })
          : null;
        const revenue = Number(client?.client?.businessMonthlyRevenue ?? 0);
        if (Number.isFinite(revenue) && revenue > 0) {
          const text = new Intl.NumberFormat('en-US', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          }).format(Math.round(revenue * 100) / 100);
          put('disclosure_avg_monthly_revenue', text);
          put('avarage_monthly_income', text);
          put('monthly_income', text);
        }
      } catch (err) {
        console.warn('[SignNow] could not read business monthly revenue', {
          groupId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return {
        defaults: out,
        offerSource: {
          values: derived,
          includeWireFee: readIncludeWireFeeFromOverrides(contract.contractPrefillOverrides),
        },
      };
    } catch (err) {
      console.warn('[SignNow] could not read contract prefill defaults', {
        groupId,
        error: err instanceof Error ? err.message : String(err),
      });
      return { defaults: {}, offerSource: { values: null, includeWireFee: true } };
    }
  }

  /**
   * Party values the deal stores outside the Contract columns. Owner 1 is the
   * Client's own owner; Owner 2 is the contract's second owner row, with the SSN
   * taken from the matching Client owner. Every address widget gets the whole
   * address, never another party's.
   */
  private async putContractPartyDefaults(
    put: (key: string, value: unknown) => void,
    contract: {
      id: number;
      entityType?: string | null;
      client?: {
        id?: string | null;
        businessEntityType?: string | null;
        ownerFirstName?: string | null;
        ownerLastName?: string | null;
        ownerEmail?: string | null;
        ownerSsn?: string | null;
      } | null;
    },
  ): Promise<void> {
    put('entity_type', contract.entityType || contract.client?.businessEntityType);

    const owner1Ssn = decryptSensitiveField(contract.client?.ownerSsn);
    put('guaranty_guarantor1_ss', owner1Ssn);
    put('guaranty_owner1_ss', owner1Ssn);
    put('guaranty_ss', owner1Ssn);

    const [contractOwners, clientOwners] = await Promise.all([
      prisma.contractOwner.findMany({
        where: { contractId: contract.id },
        orderBy: { id: 'asc' },
      }),
      contract.client?.id
        ? prisma.clientOwner.findMany({
            where: { clientId: contract.client.id },
            orderBy: { sortOrder: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    const owner2 = contractOwners[1];
    if (!owner2) return;
    // The resolver only releases Owner 2 values once the map names a distinct
    // second owner, so the block carries its own identity with it.
    put('owner2_guarantor_name', `${owner2.firstName || ''} ${owner2.lastName || ''}`);
    put('owner2_email', owner2.email);
    put('owner2_phone', owner2.phone);
    put('guarantor2_phone', owner2.phone);
    const locality = [
      owner2.city,
      [owner2.state, owner2.zip].map((part) => String(part || '').trim()).filter(Boolean).join(' '),
    ]
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(', ');
    const owner2Address = [String(owner2.address || '').trim(), locality]
      .filter(Boolean)
      .join(', ');
    put('owner2_address', owner2Address);
    put('guarantor2_address', owner2Address);

    // Match Owner 2 to its Client owner by email, then by name — never by
    // position, since the Client's primary owner is not in that list.
    const norm = (value: unknown) => String(value || '').trim().toLowerCase();
    const owner2Name = norm(`${owner2.firstName} ${owner2.lastName}`);
    const match =
      clientOwners.find((row) => owner2.email && norm(row.email) === norm(owner2.email)) ||
      clientOwners.find((row) => norm(`${row.firstName} ${row.lastName}`) === owner2Name);
    const owner2Ssn = decryptSensitiveField(match?.ssn);
    put('guaranty_guarantor2_ss', owner2Ssn);
    put('guaranty_owner2_ss', owner2Ssn);
  }

  async publishGroupFieldsToMerchant(
    groupId: string,
    options?: {
      keepParty2?: boolean;
      /** Raw CRM prefill payload, exactly as `/send-envelope` receives it. */
      prefillFields?: PrefillField[];
      roles?: SignerRoleInput[];
      /** Live "$25 wire fee" checkbox; wins over the contract row when sent. */
      includeWireFee?: unknown;
    },
  ): Promise<{
    documentCount: number;
    failed: string[];
    /** SignNow's reason per failed document id. */
    errors: Record<string, string>;
    valueCount: number;
  }> {
    const id = String(groupId || '').trim();
    if (!id) return { documentCount: 0, failed: [], errors: {}, valueCount: 0 };
    const client = await createSignNowApiClient();
    const groupRes = await client.get(`/documentgroup/${id}`, { validateStatus: () => true });
    if (groupRes.status >= 400) {
      throw new BadRequestException(
        `Could not read SignNow document group: ${this.signNowErrorDetail(groupRes)}`,
      );
    }
    const documents = await this.waitForDocumentsReady(
      client,
      this.normalizeGroupDocuments(groupRes.data?.documents),
    );
    // Same shaping the SignNow invite applies, so both paths bake identical text.
    const values = prefillRecord(options?.prefillFields);
    // Latest CRM values from the database, under whatever the caller sent — except the
    // offer-derived amounts, which go over it so a resend cannot re-bake an old offer.
    const { defaults: fromDb, offerSource } = await this.loadContractPrefillDefaults(id);
    layerContractPrefillDefaults(values, fromDb);
    Object.assign(
      values,
      buildOfferPrefillOverrides(
        withRequestWireFeePreference(offerSource, options?.includeWireFee),
        values,
      ),
    );
    if (options?.roles?.length) {
      applyMerchantSignerPrefill(values, orderedSigners(options.roles));
    }
    const valueCount = Object.keys(values).filter((key) => values[key]).length;
    /**
     * Owner review leaves embedded invites on the group, and SignNow refuses
     * every field edit on an invited document with "Cannot edit fields on this
     * document. This document has already been sent for signing." The publish
     * then failed silently on all four documents, which is why the restored
     * widgets never reached the signer no matter how the field logic changed.
     *
     * `sendEnvelope` clears the same invites before it bakes; this path has to
     * do it too, then put the embedded invites back so the portal can still
     * mint signing links from them.
     */
    await this.deleteEmbeddedInvites(client, id, documents);
    await this.cancelPendingFieldInvites(client, documents);

    const PUBLISH_BATCH = 6;
    // Same per-copy rule as the review build and the send bake: an Exhibit C
    // copy is prefilled from the entity saved against its own send position.
    const { entities: exhibitCEntities, documentTabValues } =
      await this.loadGroupDocumentPrefillContext(id, values);
    const errors: Record<string, string> = {};
    const publishDocuments = async (docs: SignNowDocumentRef[], fresh: boolean) => {
      const failures: string[] = [];
      for (let i = 0; i < docs.length; i += PUBLISH_BATCH) {
        const batch = docs.slice(i, i + PUBLISH_BATCH);
        await Promise.all(
          batch.map(async (doc) => {
            try {
              const { values: docValues, isolated } = signNowDocumentPrefillValues(
                values,
                exhibitCEntities,
                String(doc.document_name || doc.name || '').trim(),
                documentTabValues,
              );
              await this.prefillDocument(client, doc.id, docValues, {
                exposeToMerchant: true,
                keepParty2: options?.keepParty2 !== false,
                // A retry re-reads the document: the snapshot is what failed.
                remote: fresh ? undefined : doc.remote,
                ignoreExistingFieldValues: isolated,
              });
            } catch (err) {
              failures.push(doc.id);
              errors[doc.id] = err instanceof Error ? err.message : String(err);
              console.warn('[SignNow] merchant field publish failed for document', {
                groupId: id,
                documentId: doc.id,
                retry: fresh,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }),
        );
      }
      return failures;
    };
    // Same retry as the SignNow send bake: a refused document is re-read and
    // written again after a pause; one that still fails is reported to the caller.
    let failed = await publishDocuments(documents, false);
    for (const pauseMs of SIGNNOW_PUBLISH_RETRY_PAUSES_MS) {
      if (!failed.length) break;
      const retryDocs = documents.filter((doc) => failed.includes(doc.id));
      await this.deleteEmbeddedInvites(client, id, retryDocs);
      await sleepSignNow(pauseMs);
      failed = await publishDocuments(retryDocs, true);
    }
    // Restore the embedded invites the unlock removed — `mintPortalSigningLink`
    // refuses to mint a session for a group that has none. No link is minted
    // here: each signer gets a fresh one when they open their 7-day portal link.
    if (options?.roles?.length) {
      try {
        await this.mintGroupEmbeddedInviteLink(client, {
          documentId: '',
          groupId: id,
          redirect: '',
          roles: options.roles,
          documents,
          inviteOnly: true,
        });
      } catch (err) {
        console.error('[SignNow] could not recreate embedded invites after publish', {
          groupId: id,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    console.info('[SignNow] published fields to merchant', {
      groupId: id,
      documentCount: documents.length,
      valueCount,
      failed,
    });
    return {
      documentCount: documents.length,
      failed,
      errors: Object.fromEntries(failed.map((docId) => [docId, errors[docId] || ''])),
      valueCount,
    };
  }

  private async prepareOwnerReviewFieldRoles(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
    applicationId: string,
    groupId: string,
    fingerprint: string,
    /** CRM values to seed the warmed documents with (see the call site). */
    values: Record<string, string> = {},
    /** Each document's own prefill tab, so a warmed addendum is not seeded thin. */
    documentTabValues: SignNowDocumentTabValues[] = [],
    /**
     * One entity per Exhibit C copy. Warming every copy from the package map
     * seeded `Exhibit C (2)` with the first copy's merchant/bank text, and
     * Review only replaces the widgets the copy's own record fills — so the
     * rest kept showing Exhibit C #1's values.
     */
    exhibitCEntities: ExhibitCEntityPrefillRow[] = [],
  ): Promise<boolean> {
    const cached = applicationId ? draftGroupCache.get(applicationId) : undefined;
    if (
      cached?.ownerRolesPrepared &&
      signNowPackageFingerprintsEqual(cached.fingerprint, fingerprint) &&
      cached.groupId === groupId
    ) {
      return true;
    }
    const usable = documents.filter((doc) => String(doc.id || '').trim());
    await measureSignNowStep(
      'owner-review-role-prepare',
      { documentCount: usable.length },
      async () => {
        await Promise.all(
          usable.map(async (doc) => {
            const id = String(doc.id || '').trim();
            const { values: docValues, isolated } = signNowDocumentPrefillValues(
              values,
              exhibitCEntities,
              String(doc.document_name || doc.name || '').trim(),
              documentTabValues,
            );
            try {
              await this.prefillDocument(client, id, docValues, {
                exposeToMerchant: false,
                keepParty2: true,
                remote: doc.remote,
                ignoreExistingFieldValues: isolated,
              });
            } catch (err) {
              console.warn(
                '[SignNow] owner-review role prepare failed; Review will retry',
                { documentId: id, error: err instanceof Error ? err.message : String(err) },
              );
            }
          }),
        );
      },
    );
    const refreshed = await this.hydrateDocumentRoles(client, usable);
    const byId = new Map(refreshed.map((doc) => [doc.id, doc]));
    for (const doc of documents) {
      const next = byId.get(doc.id);
      if (!next) continue;
      doc.remote = next.remote;
      doc.roles = next.roles;
      doc.listedRoles = next.listedRoles;
      doc.remainingRoles = next.remainingRoles;
    }
    if (applicationId && groupId) {
      this.rememberDraftGroup(applicationId, groupId, documents, fingerprint, true);
    }
    return true;
  }

  private slimDraftDocuments(documents: SignNowDocumentRef[]): SignNowDocumentRef[] {
    return documents.map(({ remote: _remote, ...rest }) => rest);
  }

  private scheduleCrmPersist(work: () => Promise<void>): void {
    void measureSignNowStep('crm-persistence', { deferred: true }, async () => {
      try {
        await work();
      } catch (err) {
        countSignNowRetry();
        console.warn(
          '[SignNow] CRM persist failed; retrying',
          err instanceof Error ? err.message : String(err),
        );
        await sleepSignNow(400);
        await work();
      }
    }).catch((err) => {
      console.warn(
        '[SignNow] CRM persist failed after retry',
        err instanceof Error ? err.message : String(err),
      );
    });
  }

  private async ensureReviewDocumentGroup(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    options: {
      appId: string;
      groupName: string;
      includeMainContract: boolean;
      resolvedContractTemplateId: string;
      toAttach: SignNowAddendumTemplate[];
      funderProfileId?: string | null;
      funderName?: string | null;
      packageFingerprint: string;
      /** Value fingerprint — reuse is refused when it differs from the stored one. */
      prefillFingerprint?: string;
      allowReuse: boolean;
    },
  ): Promise<{
    groupId: string;
    documents: SignNowDocumentRef[];
    reusedExisting: boolean;
    ownerRolesPrepared: boolean;
  }> {
    const inflightKey =
      options.appId && options.packageFingerprint
        ? `${options.appId}:${options.packageFingerprint}`
        : '';
    if (inflightKey) {
      const pending = draftGroupInflight.get(inflightKey);
      if (pending) {
        return measureSignNowStep(
          'draft-group-inflight-wait',
          { fingerprint: options.packageFingerprint },
          () => pending,
        );
      }
    }
    const work = this.instantiateReviewDocumentGroup(client, options).finally(() => {
      if (inflightKey) draftGroupInflight.delete(inflightKey);
    });
    if (inflightKey) draftGroupInflight.set(inflightKey, work);
    return work;
  }

  private async instantiateReviewDocumentGroup(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    options: {
      appId: string;
      groupName: string;
      includeMainContract: boolean;
      resolvedContractTemplateId: string;
      toAttach: SignNowAddendumTemplate[];
      funderProfileId?: string | null;
      funderName?: string | null;
      packageFingerprint: string;
      /** Value fingerprint — reuse is refused when it differs from the stored one. */
      prefillFingerprint?: string;
      allowReuse: boolean;
    },
  ): Promise<{
    groupId: string;
    documents: SignNowDocumentRef[];
    reusedExisting: boolean;
    ownerRolesPrepared: boolean;
  }> {
    const {
      appId,
      groupName,
      includeMainContract,
      resolvedContractTemplateId,
      toAttach,
      packageFingerprint,
    } = options;
    const timing = getSignNowTiming();
    const reuseMatch = {
      fingerprint: packageFingerprint,
      prefillFingerprint: options.prefillFingerprint,
      includeMainContract,
      extras: toAttach,
    };
    let groupId = '';
    let documents: SignNowDocumentRef[] = [];
    let reusedExisting = false;

    if (options.allowReuse && appId) {
      const reused = await measureSignNowStep(
        'draft-reuse-lookup',
        {
          skipped: false,
          fingerprint: packageFingerprint,
          extraCount: toAttach.length,
        },
        () => this.findReusableDraftGroup(client, appId, reuseMatch),
      );
      if (reused) {
        groupId = reused.groupId;
        documents = reused.documents;
        reusedExisting = true;
        if (timing) {
          timing.draftReuseSkipped = false;
          timing.draftReuseSkipReason = null;
          timing.documentCount = documents.length;
        }
        console.info('[SignNow] reusing existing draft group (avoids daily copy limit)', {
          groupId,
          documents: documents.length,
          fingerprint: packageFingerprint,
        });
        logSignNowTiming('reused-draft', 0, {
          documentCount: documents.length,
          fingerprint: packageFingerprint,
        });
      } else if (timing) {
        timing.draftReuseSkipped = true;
        timing.draftReuseSkipReason = 'no-matching-package';
      }
    } else if (timing) {
      timing.draftReuseSkipped = true;
      timing.draftReuseSkipReason = options.allowReuse ? 'no-application-id' : 'auto-send';
      logSignNowTiming('draft-reuse-lookup', 0, {
        skipped: true,
        reason: timing.draftReuseSkipReason,
      });
    }

    if (!(groupId && documents.length)) {
      if (!includeMainContract) {
        if (!toAttach.length) {
          throw new BadRequestException(
            'Select a SignNow addendum or disclosure to send without the main contract.',
          );
        }
        const createdAddendumGroup = await this.createGroupFromAddendumTemplates(
          client,
          toAttach,
          groupName,
        );
        groupId = createdAddendumGroup.groupId;
        documents = createdAddendumGroup.documents;
      } else {
        const extrasCopyPromise = toAttach.length
          ? Promise.allSettled(
              toAttach.map((addendum) =>
                this.instantiateAddendumDocumentIds(client, addendum, groupName),
              ),
            )
          : null;
        console.info('[SignNow] creating contract group from funder/template', {
          funderProfileId: options.funderProfileId || null,
          funderName: options.funderName || null,
          contractTemplateId: resolvedContractTemplateId,
        });
        let createRes: { status: number; data?: any } = { status: 0, data: {} };
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) countSignNowRetry();
          const attemptStarted = Date.now();
          try {
            createRes = await client.post(
              `/v2/document-group-templates/${resolvedContractTemplateId}/document-group`,
              { group_name: groupName },
              { validateStatus: () => true, timeout: 90_000 },
            );
            logSignNowTiming('group-template-copy', Date.now() - attemptStarted, {
              attempt: attempt + 1,
            });
          } catch (err) {
            logSignNowTiming('group-template-copy', Date.now() - attemptStarted, {
              attempt: attempt + 1,
              failed: true,
            });
            const detail = err instanceof Error ? err.message : String(err || '');
            if (attempt === 2 || !isTransientSignNowFailure(undefined, detail)) {
              throw new BadRequestException(`SignNow could not create the contract group: ${detail}`);
            }
            const recovered =
              (appId ? await this.findReusableDraftGroup(client, appId, reuseMatch) : null) ||
              (await this.findRecentUnsignedGroupByName(client, groupName));
            if (recovered) {
              groupId = recovered.groupId;
              documents = recovered.documents;
              reusedExisting = true;
              console.info('[SignNow] recovered group after create timeout', {
                groupId,
                documents: documents.length,
              });
              break;
            }
            await sleepSignNow(700 * (attempt + 1));
            continue;
          }
          const createdAttempt = createRes.data?.data || createRes.data || {};
          groupId = String(createdAttempt.unique_id || createdAttempt.id || '').trim();
          if (createRes.status < 400 && groupId) break;
          const detail = this.signNowErrorDetail(createRes);
          if (isSignNowDailyLimitError(detail) || !isTransientSignNowFailure(createRes.status, detail)) {
            break;
          }
          await sleepSignNow(700 * (attempt + 1));
        }
        if (!(reusedExisting && groupId && documents.length)) {
          const created = createRes.data?.data || createRes.data || {};
          groupId = String(created.unique_id || created.id || '').trim();
          if (createRes.status >= 400 || !groupId) {
            const detail = this.signNowErrorDetail(createRes);
            const recovered = isSignNowDailyLimitError(detail)
              ? (await this.findReusableDraftGroup(client, appId, reuseMatch)) ||
                (await this.findRecentUnsignedGroupByName(client, groupName))
              : null;
            if (recovered) {
              groupId = recovered.groupId;
              documents = recovered.documents;
              console.info('[SignNow] recovered existing draft after copy limit', {
                groupId,
                documents: documents.length,
              });
            } else if (isSignNowDailyLimitError(detail)) {
              throw new BadRequestException(SIGNNOW_DAILY_LIMIT_MESSAGE);
            } else {
              throw new BadRequestException(`SignNow could not create the contract group: ${detail}`);
            }
          } else {
            documents = this.normalizeGroupDocuments(created.documents);
            if (timing) timing.documentCount = documents.length;
            logSignNowTiming('group-created', 0, { documentCount: documents.length });
            if (appId) this.rememberDraftGroup(appId, groupId, documents, packageFingerprint);
          }
        }
        if (extrasCopyPromise && groupId && documents.length) {
          try {
            const extraResults = await extrasCopyPromise;
            const extraIds = this.collectCopiedAddendumIds(toAttach, extraResults);
            const combined = await this.attachCopiedAddenda(
              client,
              groupId,
              documents,
              extraIds,
              groupName,
            );
            groupId = combined.groupId;
            documents = combined.documents;
            if (timing) timing.documentCount = documents.length;
            if (appId) this.rememberDraftGroup(appId, groupId, documents, packageFingerprint);
            logSignNowTiming('addenda-attached', 0, { documentCount: documents.length });
          } catch (error) {
            const extraDetail = error instanceof Error ? error.message : String(error);
            console.warn('[SignNow] extras not attached; retrying once', extraDetail);
            try {
              await sleepSignNow(800);
              const extraResults = await extrasCopyPromise;
              const extraIds = this.collectCopiedAddendumIds(toAttach, extraResults);
              const combined = await this.attachCopiedAddenda(
                client,
                groupId,
                documents,
                extraIds,
                groupName,
              );
              groupId = combined.groupId;
              documents = combined.documents;
              if (timing) timing.documentCount = documents.length;
              if (appId) this.rememberDraftGroup(appId, groupId, documents, packageFingerprint);
              logSignNowTiming('addenda-attached-retry', 0, { documentCount: documents.length });
            } catch (retryError) {
              const retryDetail =
                retryError instanceof Error ? retryError.message : String(retryError);
              console.warn('[SignNow] extras not attached; opening main contract group', retryDetail);
              if (!documents.length) {
                if (isSignNowDailyLimitError(extraDetail) || isSignNowDailyLimitError(retryDetail)) {
                  throw new BadRequestException(SIGNNOW_DAILY_LIMIT_MESSAGE);
                }
                throw retryError;
              }
            }
          }
        }
      }
    }

    if (!groupId || !documents.length) {
      throw new BadRequestException(
        'SignNow did not return a contract group to review. Try Review in SignNow again.',
      );
    }

    /**
     * `requireFields` matters here, not just at invite time. A document-group
     * copy is readable from `/document/{id}` seconds before SignNow has
     * attached its widgets to it, and the prefill that runs next collects its
     * targets from exactly that list: a copy caught in that window has no
     * widget to write to, so nothing is written, nothing reports a failure, and
     * the addendum opens in Review completely empty — while the invite mint
     * behind it rejects the group with "must contain fields". Clicking Review a
     * second time then worked, because by then the copy had finished. Waiting
     * for the widgets before prefilling is what makes the FIRST click carry the
     * deal, on Nitro, Obsidian and Tiberian alike.
     */
    documents = await this.waitForDocumentsReady(client, documents, 6, {
      requireFields: true,
    });
    /**
     * Still field-less after the wait means the copy is broken rather than
     * slow, so its widgets are put back from the template it came from. Only
     * for a group built in this call: a reused draft may legitimately have a
     * field-less document, because a merchant publish bakes that document's
     * values into page text and deletes the widgets behind them.
     */
    if (!reusedExisting && documents.some((d) => !(d.fieldCount ?? 0))) {
      console.warn('[SignNow] copied documents still carry no fields — restoring from templates', {
        groupId,
        without: documents.filter((d) => !(d.fieldCount ?? 0)).map((d) => d.document_name || d.id),
      });
      documents = await this.restoreFieldsFromOriginTemplate(client, documents);
    }
    // Reused drafts (and any group SignNow returned out of order) converge here.
    const normalized = await this.enforceCanonicalGroupOrder(
      client,
      { groupId, documents },
      groupName,
    );
    groupId = normalized.groupId;
    documents = normalized.documents;
    if (timing) timing.documentCount = documents.length;
    const ownerRolesPrepared = Boolean(
      appId &&
        draftGroupCache.get(appId)?.ownerRolesPrepared &&
        signNowPackageFingerprintsEqual(
          draftGroupCache.get(appId)?.fingerprint,
          packageFingerprint,
        ) &&
        draftGroupCache.get(appId)?.groupId === groupId,
    );
    if (appId) this.rememberDraftGroup(appId, groupId, documents, packageFingerprint, ownerRolesPrepared);
    return { groupId, documents, reusedExisting, ownerRolesPrepared };
  }

  private rememberDraftGroup(
    applicationId: string,
    groupId: string,
    documents: SignNowDocumentRef[],
    fingerprint = '',
    ownerRolesPrepared = false,
  ) {
    const appId = String(applicationId || '').trim();
    const id = String(groupId || '').trim();
    if (!appId || !id || !documents.length) return;
    const previous = draftGroupCache.get(appId);
    const sameGroup =
      previous?.groupId === id &&
      (!fingerprint ||
        !previous.fingerprint ||
        signNowPackageFingerprintsEqual(previous.fingerprint, fingerprint));
    draftGroupCache.set(appId, {
      groupId: id,
      documents: this.slimDraftDocuments(documents),
      fingerprint: String(fingerprint || previous?.fingerprint || '').trim(),
      ownerRolesPrepared: ownerRolesPrepared || (sameGroup && previous?.ownerRolesPrepared === true),
      at: Date.now(),
    });
  }

  private async loadLiveDocumentGroup(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] } | null> {
    const id = String(groupId || '').trim();
    if (!id || !isSignNowEnvelopeId(id)) return null;
    const groupRes = await client.get(`/documentgroup/${id}`, {
      validateStatus: () => true,
    });
    if (groupRes.status >= 400) return null;
    const documents = this.normalizeGroupDocuments(groupRes.data?.documents);
    if (!documents.length) return null;
    return { groupId: id, documents };
  }

  private async findRecentUnsignedGroupByName(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupName: string,
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] } | null> {
    const wanted = String(groupName || '').trim().toLowerCase();
    if (!wanted) return null;
    const paths = ['/user/documentgroups', '/v2/document-groups?limit=25'];
    for (const path of paths) {
      const res = await client.get(path, { validateStatus: () => true });
      if (res.status >= 400) continue;
      const rows =
        res.data?.document_groups ||
        res.data?.data ||
        res.data?.groups ||
        (Array.isArray(res.data) ? res.data : []);
      const match = (Array.isArray(rows) ? rows : []).find((row: any) => {
        const name = String(row?.group_name || row?.name || '').trim().toLowerCase();
        const inviteId = String(row?.invite_id || row?.field_invite_id || '').trim();
        if (inviteId) return false;
        return name === wanted || (wanted.length >= 12 && name.startsWith(wanted));
      });
      if (!match) continue;
      const id = String(match.unique_id || match.id || '').trim();
      const live = await this.loadLiveDocumentGroup(client, id);
      if (live) return live;
    }
    return null;
  }

  private async findReusableDraftGroup(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    applicationId: string,
    match?: {
      fingerprint?: string;
      prefillFingerprint?: string;
      includeMainContract?: boolean;
      extras?: SignNowAddendumTemplate[];
    },
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] } | null> {
    const fingerprint = String(match?.fingerprint || '').trim();
    const wantedPrefillFingerprint = String(match?.prefillFingerprint || '').trim();
    const extras = match?.extras;
    const includeMainContract = match?.includeMainContract !== false;
    const matchesPackage = (documents: SignNowDocumentRef[]) => {
      if (!extras) return true;
      return liveSignNowGroupMatchesPackage({
        documents,
        includeMainContract,
        extras,
      });
    };

    const cached = draftGroupCache.get(applicationId);
    if (
      cached &&
      // The in-process cache only knows package structure. When a value
      // fingerprint is in play the stored one on Document is authoritative, so
      // fall through to the DB read below rather than short-circuiting past it.
      !wantedPrefillFingerprint &&
      Date.now() - cached.at <= DRAFT_GROUP_CACHE_TTL_MS &&
      cached.documents.length &&
      (!fingerprint || signNowPackageFingerprintsEqual(cached.fingerprint, fingerprint))
    ) {
      const liveFromCache = await this.loadLiveDocumentGroup(client, cached.groupId);
      if (liveFromCache && matchesPackage(liveFromCache.documents)) {
        return liveFromCache;
      }
    }

    const existing = await prisma.document.findUnique({
      where: { applicationId },
      select: { envelopeId: true, status: true, prefillFingerprint: true },
    });
    countSignNowDb();
    const status = String(existing?.status || '').toLowerCase();
    if (
      status === 'completed' ||
      status === 'voided' ||
      status === 'declined' ||
      status === 'cancelled'
    ) {
      return null;
    }
    /**
     * Values behind the stored group must still match the values about to be
     * written. Re-prefill alone is not enough to make a reused group current:
     * a group that was already sent carries CRM values baked onto the page as
     * `texts[]`, and `prefill-texts` only rewrites `prefilled_text`. Reusing it
     * after an edit is exactly how an updated contract came back showing its
     * previous amounts. On a mismatch, fall through and build a fresh group.
     */
    if (wantedPrefillFingerprint) {
      const decision = resolveSignNowPrefillReuse({
        previousFingerprint: existing?.prefillFingerprint,
        currentFingerprint: wantedPrefillFingerprint,
      });
      if (!decision.reuse) {
        console.info('[SignNow] not reusing draft group — contract values changed', {
          applicationId,
          reason: decision.reason,
        });
        const timing = getSignNowTiming();
        if (timing) {
          timing.draftReuseSkipped = true;
          timing.draftReuseSkipReason = decision.reason;
        }
        return null;
      }
    }
    const live = await this.loadLiveDocumentGroup(
      client,
      String(existing?.envelopeId || ''),
    );
    if (live && matchesPackage(live.documents)) {
      this.rememberDraftGroup(applicationId, live.groupId, live.documents, fingerprint);
      return live;
    }
    return null;
  }

  private async linkGroupToApplication(
    userId: string,
    applicationId: string,
    groupId: string,
    /** Values this group was built/prefilled with — gates reuse on the next send. */
    prefillFingerprint?: string,
    options?: {
      /**
       * Set by the `structureOnly` pre-warm. The warm only parks a copied,
       * empty group for the Review click to adopt; the user has not asked for
       * anything yet, so it must not advance the application to Contract
       * Generated. The Review click does that.
       */
      skipWorkflowSync?: boolean;
      /**
       * Write only if the Document row is still exactly what the caller read
       * (`'absent'`: there was no row). Lets the pre-warm link without racing a
       * concurrent Review write on the same application.
       */
      onlyIfUnchangedFrom?:
        | 'absent'
        | { envelopeId: string; prefillFingerprint: string | null };
    },
  ) {
    const expected = options?.onlyIfUnchangedFrom;
    const existingDoc = await prisma.document.findUnique({
      where: { applicationId },
      select: { envelopeId: true, userId: true },
    });
    countSignNowDb();
    const documentOwnerUserId = await resolveDocumentOwnerNumericUserId(
      userId,
      applicationId,
      existingDoc?.userId,
    );
    if (documentOwnerUserId == null) {
      throw new BadRequestException(
        'Cannot link SignNow contract: CRM user record not found for this session.',
      );
    }
    if (expected === 'absent') {
      try {
        await prisma.document.create({
          data: {
            applicationId,
            envelopeId: groupId,
            status: 'draft',
            userId: documentOwnerUserId,
            prefillFingerprint: prefillFingerprint || null,
          },
        });
        countSignNowDb();
      } catch (err) {
        // P2002: someone (the Review click) linked the application first.
        if ((err as { code?: string })?.code === 'P2002') {
          console.info('[SignNow] link skipped; document was linked concurrently', {
            applicationId,
          });
          return;
        }
        throw err;
      }
    } else if (expected) {
      const updated = await prisma.document.updateMany({
        where: {
          applicationId,
          envelopeId: expected.envelopeId,
          prefillFingerprint: expected.prefillFingerprint,
        },
        data: {
          envelopeId: groupId,
          status: 'draft',
          sentAt: null,
          completedAt: null,
          signedPdfUrl: null,
          signedPdfPublicId: null,
          prefillFingerprint: prefillFingerprint || null,
        },
      });
      countSignNowDb();
      if (!updated.count) {
        console.info('[SignNow] link skipped; document changed concurrently', {
          applicationId,
        });
        return;
      }
    } else {
      await prisma.document.upsert({
        where: { applicationId },
        create: {
          applicationId,
          envelopeId: groupId,
          status: 'draft',
          userId: documentOwnerUserId,
          prefillFingerprint: prefillFingerprint || null,
        },
        update: {
          envelopeId: groupId,
          status: 'draft',
          sentAt: null,
          completedAt: null,
          signedPdfUrl: null,
          signedPdfPublicId: null,
          prefillFingerprint: prefillFingerprint || null,
        },
      });
      countSignNowDb();
    }
    if (options?.skipWorkflowSync) return;
    try {
      const { syncApplicationToContractGenerated } = await import(
        '../contractApplicationWorkflowSync'
      );
      await syncApplicationToContractGenerated(
        prisma,
        applicationId,
        {
          source: 'signnow.linkGroupToApplication',
          contractStatusNew: 'DRAFT',
        },
        { revertFromSent: true },
      );
    } catch (err) {
      console.warn('[SignNow] Contract Generated sync on review draft skipped', err);
    }
  }
}

export const signNowService = new SignNowService();
