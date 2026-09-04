import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import prisma from '../../config/prismaClient';
import { resolveDocumentOwnerNumericUserId } from '../../middleware/authMiddleware';
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
import { buildContractEnvelopeEmailSubject } from '../../utils/contractEnvelopeEmailSubject';
import {
  createSignNowApiClient,
  extractSignNowTemplateId,
  isSignNowConfigured,
  isSignNowDailyLimitError,
  isSignNowEnvelopeId,
  SIGNNOW_DAILY_LIMIT_MESSAGE,
  SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID,
} from './utils/signnow-client';
import {
  claimSignNowInviteSend,
  getSignNowInviteSend,
  listSignNowInviteSendsForApplication,
  logSignNowSend,
  markSignNowInviteFailed,
  markSignNowInviteSent,
} from './utils/signnow-invite-send';
import { postGroupInviteSafely } from './utils/signnow-groupinvite-post';
import { decryptField, isEncrypted } from '../../utils/fieldEncryption';
import {
  buildSignNowDocumentPrefillTexts,
  canonicalizeSignNowFieldName,
  expandSignNowPrefillForUnguidedPut,
  formatSignNowPrefillValue,
  isMonthlyFeeDocumentName,
  resolveSignNowPrefillValue,
  shouldSkipSignNowPrefill,
} from './utils/signnow-field-map';
import {
  applySignNowFieldStyle,
  parseSignNowPrefillValidationField,
  sanitizeSignNowPutFields,
  signNowPrefillTextPayload,
  splitPrefillPutPayload,
} from './utils/signnow-prefill-put';
import {
  resolveSignNowAddendaFromRefs,
  resolveSignNowAddendumTemplate,
  type SignNowAddendumTemplate,
} from './utils/signnow-addendum-templates';

type SignerRoleInput = {
  roleName?: string;
  signerRole?: string;
  signerName?: string;
  signerEmail?: string;
  signerOrder?: number;
  roleIndex?: number;
};

type PrefillField = { id?: string; value?: string };

type SignNowDocumentRef = {
  id: string;
  document_name?: string;
  name?: string;
  roles?: string[];
  listedRoles?: string[];
  remainingRoles?: string[];
  fulfilledRoles?: string[];
};

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
  return out;
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
    if (!Number.isFinite(page)) return false;
    return page >= 0 && page < pageCount;
  });
}

function toSignNowPutField(
  field: any,
  container?: string,
  options?: { defaultRole?: string; maxSize?: number },
): Record<string, unknown> | null {
  const attrs = parseSignNowFieldAttrs(field);
  const type = signNowFieldType(field, container);
  if (!type || type === 'attachment') return null;
  if (SIGN_FIELD_TYPES.has(type) && isCompletedSignElement(field)) return null;
  const role =
    String(field?.role || field?.signer || attrs.role || '').trim() ||
    String(options?.defaultRole || '').trim();
  if (!role) return null;
  const page_number = Number(attrs.page_number ?? field?.page_number ?? 0);
  const x = Number(attrs.x ?? field?.x ?? 0);
  const y = Number(attrs.y ?? field?.y ?? 0);
  const width = Number(attrs.width ?? field?.width ?? (SIGN_FIELD_TYPES.has(type) ? 120 : 12));
  const height = Number(attrs.height ?? field?.height ?? (SIGN_FIELD_TYPES.has(type) ? 34 : 12));
  if (!Number.isFinite(page_number) || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const name = String(attrs.name || field?.name || field?.field_name || '').trim();
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
  if (!SIGN_FIELD_TYPES.has(type)) {
    applySignNowFieldStyle(
      row,
      { ...attrs, ...field },
      options?.maxSize ? { maxSize: options.maxSize } : undefined,
    );
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

function collectSignNowPutFields(
  remote: any,
  options?: { defaultRole?: string; maxSize?: number },
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const containers = [
    'fields',
    'fillable_fields',
    'texts',
    'signatures',
    'initials',
    'checks',
  ] as const;
  for (const container of containers) {
    const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
    for (const field of rows) {
      if (!field || typeof field !== 'object') continue;
      const key = signNowFieldKey(field, container);
      if (seen.has(key)) continue;
      const put = toSignNowPutField(field, container, options);
      if (!put) continue;
      seen.add(key);
      out.push(put);
    }
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

function collectExistingSignNowFieldValues(remote: any): Record<string, string> {
  const out: Record<string, string> = {};
  const skipType = new Set(['signature', 'initials', 'checkmark', 'checkbox', 'radiobutton', 'attachment']);
  for (const container of ['texts', 'fields', 'fillable_fields'] as const) {
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

function mapGroupState(state: string | undefined): string {
  const s = String(state || '').trim().toLowerCase();
  if (s === 'completed' || s === 'fulfilled') return 'completed';
  if (s === 'declined' || s === 'canceled' || s === 'cancelled' || s === 'voided') return 'voided';
  // pending / in_progress is SignNow's state for both Owner embedded review and
  // merchant signing. CRM "sent" is applied only by sendEnvelope → markGroupSent.
  if (s === 'sent') return 'sent';
  return 'draft';
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

let cachedAgreementDocumentId = '';
const cachedAgreementDocumentIdByTemplate = new Map<string, string>();
const cachedAgreementPdfByTemplate = new Map<string, { buffer: Buffer; at: number }>();
const agreementPdfInflightByTemplate = new Map<string, Promise<Buffer>>();
const cachedAddendumPdf = new Map<string, { buffer: Buffer; at: number }>();
const addendumPdfInflight = new Map<string, Promise<Buffer>>();
/** Blank template PDFs change rarely — keep them warm so View Contract is instant. */
const AGREEMENT_PDF_TTL_MS = 6 * 60 * 60 * 1000;
const DRAFT_GROUP_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const draftGroupCache = new Map<
  string,
  { groupId: string; documents: SignNowDocumentRef[]; at: number }
>();
const addendumOriginIdCache = new Map<string, string>();
const groupTemplateRowCache = new Map<string, { row: any; at: number }>();
const GROUP_TEMPLATE_ROW_TTL_MS = 30 * 60 * 1000;
let groupTemplateListCache: { at: number; rows: any[] } | null = null;

export class SignNowService {
  isEnabled(): boolean {
    return isSignNowConfigured();
  }

  /** Blank Agreement PDF from a SignNow document-group template (for CRM preview). */
  async downloadAgreementPdf(templateId?: string | null): Promise<Buffer> {
    const resolvedTemplateId =
      extractSignNowTemplateId(templateId) || SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID;
    if (!resolvedTemplateId) {
      throw new BadRequestException(
        'No SignNow main contract template id was provided.',
      );
    }
    const now = Date.now();
    const cached = cachedAgreementPdfByTemplate.get(resolvedTemplateId);
    if (cached && now - cached.at < AGREEMENT_PDF_TTL_MS) {
      return cached.buffer;
    }
    const inflight = agreementPdfInflightByTemplate.get(resolvedTemplateId);
    if (inflight) return inflight;
    const pending = this.fetchAgreementPdfUncached(now, resolvedTemplateId).finally(() => {
      agreementPdfInflightByTemplate.delete(resolvedTemplateId);
    });
    agreementPdfInflightByTemplate.set(resolvedTemplateId, pending);
    return pending;
  }

  private async fetchAgreementPdfUncached(
    now: number,
    templateId: string,
  ): Promise<Buffer> {
    const client = await createSignNowApiClient();
    const documentId = await this.resolveAgreementDocumentId(client, templateId);
    const buffer = await this.downloadDocumentPdfBuffer(
      client,
      documentId,
      'Agreement',
    );
    cachedAgreementPdfByTemplate.set(templateId, { buffer, at: now });
    return buffer;
  }

  /** Blank addendum PDF from a SignNow document-group template (CRM picker preview). */
  async downloadGroupTemplatePdf(layoutKeyOrId: string): Promise<Buffer> {
    const def = resolveSignNowAddendumTemplate(layoutKeyOrId);
    if (!def?.templateId) {
      throw new BadRequestException(`Unknown SignNow addendum "${layoutKeyOrId}"`);
    }
    const now = Date.now();
    const cached = cachedAddendumPdf.get(def.layoutKey);
    if (cached && now - cached.at < AGREEMENT_PDF_TTL_MS) {
      return cached.buffer;
    }
    const inflight = addendumPdfInflight.get(def.layoutKey);
    if (inflight) return inflight;
    const pending = (async () => {
      const client = await createSignNowApiClient();
      const documentId = await this.resolveGroupTemplateOriginDocumentId(
        client,
        def.templateId,
      );
      const buffer = await this.downloadDocumentPdfBuffer(client, documentId, def.name);
      cachedAddendumPdf.set(def.layoutKey, { buffer, at: now });
      return buffer;
    })().finally(() => {
      addendumPdfInflight.delete(def.layoutKey);
    });
    addendumPdfInflight.set(def.layoutKey, pending);
    return pending;
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
    },
  ) {
    if (!this.isEnabled()) {
      throw new BadRequestException('SignNow is not configured');
    }
    const signers = orderedSigners(options.roles || []);
    if (!signers.length) {
      throw new BadRequestException('At least one signer with an email is required');
    }

    const client = await createSignNowApiClient();
    const startedAt = Date.now();
    const mark = (label: string, extra?: Record<string, unknown>) => {
      console.info('[SignNow] timing', { label, ms: Date.now() - startedAt, ...extra });
    };
    const groupName =
      String(options.title || '').trim() ||
      buildContractEnvelopeEmailSubject(signers[0].name, null, options.funderName);
    const includeMainContract = options.sendPackage?.includeMainContract !== false;
    const funderProfileId = String(options.funderProfileId || '').trim();
    const funderRow = funderProfileId
      ? await prisma.funderProfile.findUnique({
          where: { id: funderProfileId },
          select: {
            id: true,
            name: true,
            signnowContractTemplateLink: true,
            signnowAddendumTemplates: true,
            signnowDisclosureTemplates: true,
          },
        })
      : null;
    const funderContractTemplateId = extractSignNowTemplateId(
      funderRow?.signnowContractTemplateLink,
    );
    // Never silently fall back to the Nitro/platform DGT when a funder is selected.
    if (funderProfileId && !funderContractTemplateId) {
      throw new BadRequestException(
        `No SignNow main contract template is configured for ${
          funderRow?.name || 'this funder'
        } (Settings → Funders).`,
      );
    }
    const resolvedContractTemplateId =
      funderContractTemplateId || SIGNNOW_DOCUMENT_GROUP_TEMPLATE_ID;
    if (!resolvedContractTemplateId) {
      throw new BadRequestException(
        'No SignNow main contract template is configured (Settings → Funders).',
      );
    }
    const supplementals = resolveSignNowAddendaFromRefs(
      options.supplementalDocumentRefs,
      funderRow,
    );
    const toAttach = supplementals.filter((row) => {
      if (row.type === 'disclosure') {
        return options.sendPackage?.includeDisclosure !== false;
      }
      return options.sendPackage?.includeAddendum !== false;
    });

    let groupId = '';
    let documents: SignNowDocumentRef[] = [];
    let reusedExisting = false;
    const appId = String(options.applicationId || '').trim();
    if (options.autoSend !== true && appId) {
      const wantsMonthlyFee = toAttach.some((row) => row.layoutKey === 'monthly_fee');
      const reused = wantsMonthlyFee
        ? null
        : await this.findReusableDraftGroup(client, appId, groupName);
      if (reused) {
        groupId = reused.groupId;
        documents = reused.documents;
        reusedExisting = true;
        console.info('[SignNow] reusing existing draft group (avoids daily copy limit)', {
          groupId,
          documents: documents.length,
        });
        mark('reused-draft', { documents: documents.length });
      }
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
        // Copy addenda while SignNow instantiates the main contract group so
        // Review is max(group create, copies) instead of those steps stacked.
        const extrasCopyPromise = toAttach.length
          ? Promise.allSettled(
              toAttach.map((addendum) =>
                this.instantiateAddendumDocumentIds(client, addendum, groupName),
              ),
            )
          : null;
        console.info('[SignNow] creating contract group from funder/template', {
          funderProfileId: funderRow?.id || null,
          funderName: funderRow?.name || options.funderName || null,
          contractTemplateId: resolvedContractTemplateId,
        });
        const createRes = await client.post(
          `/v2/document-group-templates/${resolvedContractTemplateId}/document-group`,
          { group_name: groupName },
          { validateStatus: () => true },
        );
        const created = createRes.data?.data || createRes.data || {};
        groupId = String(created.unique_id || created.id || '').trim();
        if (createRes.status >= 400 || !groupId) {
          const detail = this.signNowErrorDetail(createRes);
          const recovered = isSignNowDailyLimitError(detail)
            ? (await this.findReusableDraftGroup(client, appId, groupName)) ||
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
          mark('group-created', { documents: documents.length });
          if (appId) this.rememberDraftGroup(appId, groupId, documents);
          if (extrasCopyPromise) {
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
              if (appId) this.rememberDraftGroup(appId, groupId, documents);
              mark('addenda-attached', { documents: documents.length });
            } catch (error) {
              const extraDetail = error instanceof Error ? error.message : String(error);
              console.warn('[SignNow] extras not attached; opening main contract group', extraDetail);
              if (!documents.length) {
                if (isSignNowDailyLimitError(extraDetail)) {
                  throw new BadRequestException(SIGNNOW_DAILY_LIMIT_MESSAGE);
                }
                throw error;
              }
            }
          }
        }
      }
    }

    const values = prefillRecord(options.prefillFields);
    if (options.applicationId && !values.application_id) {
      values.application_id = options.applicationId;
      values.case_id = options.applicationId;
    }
    applyMerchantSignerPrefill(values, signers);

    if (!groupId || !documents.length) {
      throw new BadRequestException(
        'SignNow did not return a contract group to review. Try Review in SignNow again.',
      );
    }

    // Reused drafts often already have an Owner embedded invite. SignNow then
    // rejects prefill with "Document has been already sent to a signer".
    if (reusedExisting) {
      try {
        await this.deleteEmbeddedInvites(client, groupId, documents);
        const hydrated = await this.hydrateDocumentRoles(client, documents);
        await this.cancelPendingFieldInvites(client, hydrated);
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

    const contractIdNum = Number(options.contractId);
    const skipMainLink =
      options.skipApplicationEnvelopeLink === true || !includeMainContract;
    const persistPromise =
      appId && !skipMainLink
        ? Promise.all([
            this.linkGroupToApplication(userId, appId, groupId),
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
          ])
        : Promise.resolve();

    const autoSend = options.autoSend === true;
    let envelopeStatus: 'created' | 'sent' = 'created';
    let sendUrl: string | null = null;
    let applied = 0;
    let attempted = 0;
    if (autoSend) {
      const [prefillStats] = await Promise.all([
        this.prefillDocumentsForReview(client, documents, values, signers),
        persistPromise,
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
      mark('prefill');
    } else {
      // Prefill agreement + addenda + disclosures BEFORE minting the review link.
      // Once an embedded invite exists, SignNow rejects edits with
      // "Document has been already sent to a signer" — which left addenda empty.
      const [prefillStats] = await Promise.all([
        this.prefillDocumentsForReview(client, documents, values, signers),
        persistPromise,
      ]);
      applied = prefillStats.applied;
      attempted = prefillStats.attempted;
      mark('prefill');
      const embedded = await this.getSenderViewUrl(groupId, {
        returnUrl: options.returnUrl,
        documentId: this.pickEditorDocumentId(documents),
        roles: options.roles,
        client,
        documents,
      });
      sendUrl = embedded.url;
      mark('embedded-link');
      console.info('[SignNow] prefill summary', {
        groupId,
        reusedDraft: reusedExisting,
        crmPrefillKeys: Object.keys(values).length,
        applied,
        attempted,
        documentsPrefillBeforeMint: documents.length,
      });
    }

    if (appId && skipMainLink) {
      await linkStandalonePackageEnvelopeToContract(
        appId,
        groupId,
        envelopeStatus === 'sent' ? 'sent' : 'draft',
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
    const redirect = this.resolveEmbeddedCompleteUrl(options.returnUrl);
    const url = await this.mintEmbeddedSigningLink(client, {
      documentId,
      groupId: id,
      redirect,
      roles: options.roles,
      documents: options.documents,
    });
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

  private resolveEmbeddedCompleteUrl(returnUrl?: string): string {
    const candidates = [
      String(returnUrl || '').trim(),
      `${String(process.env.FRONTEND_URL || '').trim().replace(/\/$/, '')}/embedded-complete`,
    ];
    for (const url of candidates) {
      if (!url || !/^https?:\/\//i.test(url) || isPrivateNetworkUrl(url)) continue;
      return url;
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
    },
  ): Promise<string> {
    let documents = (options.documents || []).filter((d) => String(d.id || '').trim());
    if (!documents.length) {
      const groupRes = await client.get(`/documentgroup/${options.groupId}`, {
        validateStatus: () => true,
      });
      documents = this.normalizeGroupDocuments(groupRes.data?.documents);
    }
    // Group listings often carry incomplete/wrong role unions. Only skip a GET when
    // we already hydrated from /document/{id} (listedRoles / remainingRoles set).
    documents = await this.hydrateDocumentRoles(client, documents, {
      skipIfHydrated: true,
    });
    const missingRoles = documents.filter((d) => !(d.roles || []).length);
    if (missingRoles.length) {
      const hydrated = await this.hydrateDocumentRoles(client, missingRoles);
      const byId = new Map(hydrated.map((d) => [d.id, d]));
      documents = documents.map((d) => byId.get(d.id) || d);
    }
    const documentId = options.documentId || this.pickEditorDocumentId(documents);
    if (!documentId) return '';

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
    if (!inviteSigners.length) return '';
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
    const hasSecondMerchant = Boolean(
      distinctSecondMerchant(orderedSigners(options.roles || [])),
    );

    const buildSigners = (source: EmbedSigner[]) => {
      const buckets: Array<{
        email: string;
        tag: string;
        documents: InviteDoc[];
      }> = [];
      const pushDoc = (signer: EmbedSigner, doc: InviteDoc) => {
        if (!doc.id || skippedAssignments.has(assignmentKey(doc.id, doc.role))) return;
        const tag = signer.preparer
          ? 'preparer'
          : signer.roleName.replace(/[^a-z0-9]/gi, '').toLowerCase() || 'signer';
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
      const signerForRole = (role: string): EmbedSigner | undefined =>
        source.find((s) => s.roleName.toLowerCase() === role.toLowerCase()) ||
        (/^owner$/i.test(role) || isPreparerRole(role, nitroStyle)
          ? source.find((s) => s.preparer)
          : undefined) ||
        source[0];

      for (const doc of documents) {
        // Use the document's exact role spelling. Group listings often omit roles
        // (or use "Owner" while the PDF has "owner"), which SignNow then rejects.
        const listed = uniqueRoleNames(doc.roles || []);
        const isAgreement = /agreement/i.test(String(doc.document_name || doc.name || ''));
        const assign = uniqueRoleNames(
          listed.length
            ? listed.filter((role) => !isOwner2Role(role, nitroStyle) || hasSecondMerchant)
            : isAgreement
              ? [ownerRole, 'Recipient 1']
              : ['Recipient 1'],
        );
        for (const role of assign) {
          const exact = exactRoleByDoc.get(assignmentKey(doc.id, role)) || role;
          const signer = signerForRole(exact);
          if (!signer) continue;
          pushDoc(signer, { id: doc.id, role: exact, action: 'sign' });
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
        const row: Record<string, unknown> = {
          email,
          order: idx + 1,
          auth_method: 'none',
          first_name,
          last_name,
          documents: bucket.documents,
        };
        if (options.redirect) {
          row.redirect_uri = options.redirect;
          row.close_redirect_uri = options.redirect;
          row.decline_redirect_uri = options.redirect;
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
          documents: (s.documents as InviteDoc[]).map((d) => ({
            id: d.id.slice(0, 8),
            role: d.role,
          })),
        })),
      });
      await client.delete(`/v2/document-groups/${options.groupId}/embedded-invites`, {
        validateStatus: () => true,
      });
      const res = await client.post(
        `/v2/document-groups/${options.groupId}/embedded-invites`,
        payload,
        { validateStatus: () => true },
      );
      return { res, signers };
    };

    let created = await postEmbedded(embedSigners);
    let inviteId = this.extractEmbeddedInviteId(created.res.data);
    // One SignNow error = one missing/unknown role on one document. A full
    // agreement + addenda package needs enough retries to cover every role.
    const maxRoleRetries = Math.max(24, documents.length * 4);
    let emptyFieldsRetries = 0;
    for (
      let attempt = 0;
      attempt < maxRoleRetries && (created.res.status >= 400 || !inviteId);
      attempt += 1
    ) {
      const detail = this.signNowErrorDetail(created.res);
      const unknown = parseUnknownInviteRole(detail);
      const omitted = parseMissingInviteRole(detail);
      const emptyFields = /must contain fields/i.test(detail);
      if (unknown) {
        skippedAssignments.add(assignmentKey(unknown.documentId, unknown.role));
        console.warn('[SignNow] dropping unknown embedded role', unknown);
      } else if (omitted) {
        exactRoleByDoc.set(assignmentKey(omitted.documentId, omitted.role), omitted.role);
        extraAssignments.push({
          id: omitted.documentId,
          role: omitted.role,
          action: 'sign',
        });
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
          if (fallback) embedSigners.push({ ...fallback, roleName: omitted.role });
        }
        console.warn('[SignNow] adding omitted embedded role', omitted);
      } else if (emptyFields && emptyFieldsRetries < 1) {
        // Single short retry only — long multi-hydrate sleeps were adding ~5–15s
        // when the real fix is avoiding PUT /document races before mint.
        emptyFieldsRetries += 1;
        await new Promise((r) => setTimeout(r, 300));
        const needsRefresh = documents.filter(
          (d) => !(d.listedRoles?.length || d.roles?.length),
        );
        if (needsRefresh.length) {
          const refreshed = await this.hydrateDocumentRoles(client, needsRefresh);
          const byId = new Map(refreshed.map((d) => [d.id, d]));
          documents = documents.map((d) => byId.get(d.id) || d);
        }
        console.warn('[SignNow] retrying embedded invite after empty-fields error', {
          attempt: emptyFieldsRetries,
          docsWithRoles: documents.filter((d) => (d.roles || []).length).length,
          totalDocs: documents.length,
        });
      } else {
        break;
      }
      created = await postEmbedded(embedSigners);
      inviteId = this.extractEmbeddedInviteId(created.res.data);
    }
    if (created.res.status >= 400 || !inviteId) {
      const detail = this.signNowErrorDetail(created.res);
      console.warn('[SignNow] group embedded-invite create failed', detail);
      throw new BadRequestException(
        detail
          ? `Could not mint a SignNow review link. ${detail}`
          : 'Could not mint a SignNow review link. SignNow still reports a missing role on one of the attached documents.',
      );
    }

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
      return '';
    }
    for (const email of emails) {
      const linkRes = await client.post(
        `/v2/document-groups/${options.groupId}/embedded-invites/${inviteId}/link`,
        {
          email,
          auth_method: 'none',
          link_expiration: 45,
          session_expiration: 60,
        },
        { validateStatus: () => true },
      );
      const url = this.extractEmbeddedLink(linkRes.data);
      if (linkRes.status < 400 && url) return url;
      console.warn('[SignNow] group embedded-invite link failed', this.signNowErrorDetail(linkRes));
    }
    return '';
  }

  /** Combined PDF for a SignNow document group (signed contract + addenda + disclosures). */
  async downloadGroupPdf(groupId: string): Promise<Buffer> {
    const id = String(groupId || '').trim();
    if (!id) throw new BadRequestException('Missing SignNow document group id');
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
    if (documents.length === 1) {
      return this.downloadDocumentPdfBuffer(
        client,
        documents[0].id,
        String(documents[0].document_name || documents[0].name || 'contract'),
      );
    }

    const merged = await this.downloadMergedGroupPdf(client, id, documents);
    if (merged) return merged;

    const parts: Buffer[] = [];
    for (const doc of documents) {
      const label = String(doc.document_name || doc.name || doc.id);
      parts.push(await this.downloadDocumentPdfBuffer(client, doc.id, label));
    }
    return this.mergePdfBuffers(parts);
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

  async sendEnvelope(
    groupId: string,
    options: {
      roles?: SignerRoleInput[];
      title?: string;
      ccEmails?: string[];
      applicationId?: string;
      prefillFields?: PrefillField[];
      requestId?: string;
    },
  ) {
    const id = String(groupId || '').trim();
    if (!id) throw new BadRequestException('Missing SignNow document group id');
    const requestId = String(options.requestId || randomUUID()).trim();
    const appIdEarly = String(options.applicationId || '').trim();
    const existingDoc = await prisma.document.findUnique({
      where: { envelopeId: id },
      select: { status: true, sentAt: true },
    });
    const alreadyEmailed =
      String(existingDoc?.status || '').toLowerCase() === 'sent' && Boolean(existingDoc?.sentAt);
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
      logSignNowSend('Duplicate send prevented', {
        contractId: id,
        requestId,
        signnowDocumentId: id,
        sendStatus: 'SENDING',
        attemptNumber: claim.row.attemptCount,
        timestamp: new Date().toISOString(),
      });
      return {
        success: true,
        envelopeId: id,
        status: 'sending',
        url: null,
        duplicate: true,
      };
    }

    try {
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
    const subject =
      String(options.title || '').trim() ||
      String(groupRes.data?.group_name || 'Nitro Advance Contract');
    const hydrated = await this.hydrateDocumentRoles(client, documents);
    const embeddedRes = await client.get(`/v2/document-groups/${id}/embedded-invites`, {
      validateStatus: () => true,
    });
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
    // per-document invites) before baking merchant-visible values.
    await this.deleteEmbeddedInvites(client, id, documents);
    await this.cancelPendingFieldInvites(client, hydrated);
    const values = prefillRecord(options.prefillFields);
    if (options.applicationId && !values.application_id) {
      values.application_id = options.applicationId;
      values.case_id = options.applicationId;
    }
    applyMerchantSignerPrefill(values, signers);
    // Review writes Owner `prefilled_text` only. Merchants and the downloaded PDF
    // show committed text — bake/expose those values now, in parallel batches.
    const keepParty2 = Boolean(distinctSecondMerchant(signers));
    const PREFILL_BATCH = 3;
    console.info('[SignNow] baking send prefill for merchant PDF', {
      groupId: id,
      documents: hydrated.length,
      fulfilledRoles,
      crmPrefillKeys: Object.keys(values).filter((k) => values[k]).length,
    });
    for (let i = 0; i < hydrated.length; i += PREFILL_BATCH) {
      const batch = hydrated.slice(i, i + PREFILL_BATCH);
      await Promise.all(
        batch.map(async (doc) => {
          try {
            await this.prefillDocument(client, doc.id, values, {
              exposeToMerchant: true,
              keepParty2,
            });
          } catch (err) {
            console.warn(
              '[SignNow] send bake prefill threw; continuing',
              {
                documentId: doc.id,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
        }),
      );
    }
    const inviteId = await this.sendGroupInvite(
      client,
      id,
      hydrated,
      signers,
      subject,
      options.ccEmails,
      fulfilledRoles,
      { requestId, attemptNumber: claim.attemptNumber },
    );
    await markSignNowInviteSent({ envelopeId: id, inviteId, requestId });
    const appId = String(options.applicationId || '').trim();
    const isPackageEnvelope = await isStandalonePackageEnvelope(id, {
      applicationId: appId || undefined,
    });
    if (isPackageEnvelope) {
      await updateStandalonePackageDocuSignStatus(id, 'sent', {
        applicationId: appId || undefined,
      });
    } else if (appId) {
      await this.markGroupSent(appId, id);
    }
    return {
      success: true,
      envelopeId: id,
      status: 'sent',
      url: null,
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
    const currentStatus = mapGroupState(groupRes.data?.state);
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
      return {
        envelopeId: id,
        status: cached,
        skippedRemote: true,
        source: 'crm',
      };
    }

    const client = await createSignNowApiClient();
    const res = await client.get(`/documentgroup/${id}`, { validateStatus: () => true });
    const status = mapGroupState(res.data?.state);
    const documentStatus = status === 'voided' ? 'revoked' : status;
    const mappedInternal = status === 'voided' ? 'revoked' : status;

    // Persist completed / voided into CRM the first time SignNow reports it.
    // Later polls must not reach here — readTerminalGroupStatusFromCrm returns first.
    if (status === 'completed' || status === 'voided') {
      const isPackageEnvelope = await isStandalonePackageEnvelope(id, {
        applicationId: applicationId || undefined,
      });
      if (isPackageEnvelope) {
        await updateStandalonePackageDocuSignStatus(id, mappedInternal, {
          applicationId: applicationId || undefined,
        });
      } else {
        await prisma.document.updateMany({
          where: { envelopeId: id },
          data: {
            status: documentStatus,
            ...(status === 'completed' ? { completedAt: new Date() } : {}),
          } as any,
        });
        await this.syncContractSigningFromGroupStatus(
          id,
          mappedInternal,
          applicationId,
        );
      }
      return { envelopeId: id, status };
    }

    await this.revertPrematureSentIfOwnerReview(client, id, applicationId, res.data);
    return { envelopeId: id, status };
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
   */
  private async prefillDocumentsForReview(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
    values: Record<string, string>,
    signers: Array<{ name: string; email: string; roleName: string }>,
  ): Promise<{ applied: number; attempted: number }> {
    const keepParty2 = Boolean(distinctSecondMerchant(signers));
    // Prefill agreement first so a slow addendum PUT cannot block Owner review values.
    const { main, extras } = this.splitReviewPrefillDocuments(documents);
    const ordered = [...main, ...extras];
    let applied = 0;
    let attempted = 0;
    for (const doc of ordered) {
      const id = String(doc.id || '').trim();
      if (!id) continue;
      try {
        const row = await this.prefillDocument(client, id, values, {
          exposeToMerchant: false,
          keepParty2,
        });
        applied += row.applied;
        attempted += row.attempted;
      } catch (err) {
        // One slow/failed doc must not wipe success on the agreement or abort Review.
        console.warn(
          '[SignNow] prefill document threw; continuing with remaining docs',
          { documentId: id, error: err instanceof Error ? err.message : String(err) },
        );
      }
    }
    return { applied, attempted };
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
        const monthlyFee = isMonthlyFeeDocumentName(
          doc.document_name ||
            doc.name ||
            docRes.data?.document_name ||
            docRes.data?.name,
        );
        const prefillOpts = monthlyFee ? { documentKind: 'monthly_fee' as const } : undefined;
        const fields = fieldNames.length
          ? buildSignNowDocumentPrefillTexts(fieldNames, values, prefillOpts)
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
      | { exposeToMerchant?: boolean; keepParty2?: boolean } = false,
  ): Promise<{ applied: number; attempted: number }> {
    const expose =
      typeof exposeToMerchant === 'boolean'
        ? exposeToMerchant
        : Boolean(exposeToMerchant.exposeToMerchant);
    const keepParty2 =
      typeof exposeToMerchant === 'boolean'
        ? true
        : exposeToMerchant.keepParty2 !== false;
    const docRes = await client.get(`/document/${documentId}`, { validateStatus: () => true });
    const fieldNames = this.collectPrefillableFieldNames(docRes.data);
    const monthlyFee = isMonthlyFeeDocumentName(
      docRes.data?.document_name || docRes.data?.name,
    );
    const prefillOpts = monthlyFee ? { documentKind: 'monthly_fee' as const } : undefined;
    const mergedValues = {
      ...collectExistingSignNowFieldValues(docRes.data),
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

    const applied = await this.publishOwnerPrefillToMerchant(client, documentId, {
      exposeToMerchant: expose,
      keepParty2,
      remote: docRes.data,
      values: mergedValues,
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
    return { applied, attempted: filledSample.length + unmatched.length };
  }

  /**
   * Write CRM values onto Owner text fields, lock them, and optionally copy
   * filled values onto Recipient 1 so the merchant can see (but not edit) them.
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
        } = false,
  ): Promise<number> {
    const exposeToMerchant =
      typeof options === 'boolean' ? options : Boolean(options.exposeToMerchant);
    const keepParty2 = typeof options === 'boolean' ? true : options.keepParty2 !== false;
    const values = typeof options === 'boolean' ? {} : options.values || {};
    let remote = typeof options === 'boolean' ? null : options.remote;
    if (!remote) {
      const docRes = await client.get(`/document/${documentId}`, { validateStatus: () => true });
      if (docRes.status >= 400) return 0;
      remote = docRes.data;
    }
    const documentName = String(
      remote?.document_name || remote?.name || remote?.original_filename || '',
    ).trim();
    const monthlyFee = isMonthlyFeeDocumentName(documentName);
    const prefillOpts = monthlyFee ? { documentKind: 'monthly_fee' as const } : undefined;
    const pageCount = signNowDocumentPageCount(remote);
    const shortDoc = pageCount > 0 && pageCount <= 2;
    let sourceFields = collectSignNowPutFields(remote, {
      ...(monthlyFee || shortDoc ? { defaultRole: 'Recipient 1' } : {}),
    });
    sourceFields = fieldsOnExistingPages(sourceFields, pageCount);
    const signCount = sourceFields.filter((field) =>
      SIGN_FIELD_TYPES.has(String(field.type || '')),
    ).length;
    if (signCount === 0 && pageCount > 2) {
      try {
        const templateId = await this.resolveAgreementDocumentId(client);
        if (templateId && templateId !== documentId) {
          const templateRes = await client.get(`/document/${templateId}`, {
            validateStatus: () => true,
          });
          if (templateRes.status < 400) {
            const templatePages = signNowDocumentPageCount(templateRes.data);
            if (!pageCount || !templatePages || templatePages === pageCount) {
              const fromTemplate = fieldsOnExistingPages(
                collectSignNowPutFields(templateRes.data).filter((field) =>
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
    const fields: Record<string, unknown>[] = [];
    const roleCounts: Record<string, number> = {};
    let applied = 0;
    for (const field of sourceFields) {
      const type = String(field.type || 'text').toLowerCase();
      const role = String(field.role || '').trim();
      roleCounts[role || '(none)'] = (roleCounts[role || '(none)'] || 0) + 1;
      if (!keepParty2 && isOwner2Role(role, nitroStyle)) continue;
      const next = { ...field };
      const crmValue = formatSignNowPrefillValue(
        resolveSignNowPrefillValue(String(next.name || ''), values, prefillOpts),
        String(next.name || ''),
      );
      if (!SIGN_FIELD_TYPES.has(type) && crmValue) {
        next.prefilled_text = crmValue;
        applied += 1;
      }
      if (!SIGN_FIELD_TYPES.has(type)) {
        applySignNowFieldStyle(next, next);
      }
      const ownerData =
        !SIGN_FIELD_TYPES.has(type) &&
        (isPreparerRole(role, nitroStyle) || role.toLowerCase() === 'owner');
      const hasPrefill = Boolean(String(next.prefilled_text || '').trim());
      if (SIGN_FIELD_TYPES.has(type)) {
        next.required = true;
        delete next.lock_to_sign_prefill;
      } else if (hasPrefill) {
        next.required = false;
        next.lock_to_sign_prefill = true;
        if (ownerData && exposeToMerchant) next.role = merchantRole;
      } else {
        // Empty Owner slots (owner 2, unmatched ACH, etc.) must stay unlocked.
        // SignNow rejects the entire PUT if lock_to_sign_prefill is set without text.
        delete next.lock_to_sign_prefill;
        if (ownerData) next.required = false;
      }
      fields.push(next);
    }
    const putFields = fieldsOnExistingPages(sanitizeSignNowPutFields(fields), pageCount);
    console.info('[SignNow] field roles before merchant publish', {
      documentId,
      roleCounts,
      keepParty2,
      merchantRole,
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
    let textPrefills = signNowPrefillTextPayload(putFields);
    let textsApplied = 0;
    if (textPrefills.length) {
      const paths = [
        `/v2/documents/${documentId}/prefill-texts`,
        `/v2/documents/${documentId}/prefill-text`,
      ];
      for (let round = 0; round < 8 && textPrefills.length; round += 1) {
        let wrote = false;
        let dropField = '';
        for (const path of paths) {
          try {
            const res = await client.put(
              path,
              { fields: textPrefills },
              { validateStatus: () => true, timeout: 60_000 },
            );
            if (res.status < 400) {
              textsApplied = textPrefills.length;
              wrote = true;
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

    if (signFields === 0 && !monthlyFee) {
      console.warn(
        '[SignNow] skipping field PUT without signature fields — keeping prefill-texts only',
        { documentId, textsApplied, applied },
      );
      return textsApplied || applied;
    }

    // Owner review: prefill-texts is enough for SignNow to show CRM values.
    // Skipping PUT avoids a 45s+ timeout on the agreement that can wipe those values.
    if (!exposeToMerchant && textsApplied > 0) {
      console.info('[SignNow] review prefill complete via prefill-texts (skipped field PUT)', {
        documentId,
        textsApplied,
        applied,
        signatures: signFields,
        pages: pageCount,
      });
      return textsApplied;
    }

    const bakedRaw = splitPrefillPutPayload(putFields, exposeToMerchant);
    const baked = {
      fields: fieldsOnExistingPages(bakedRaw.fields, pageCount),
      texts: fieldsOnExistingPages(bakedRaw.texts, pageCount),
    };
    const fieldBodies = exposeToMerchant
      ? [baked.fields, baked.fields.map(({ id: _id, ...rest }) => rest)]
      : [
          putFields,
          putFields.map(({ id: _id, ...rest }) => rest),
          putFields.map(({ lock_to_sign_prefill: _lock, ...rest }) => rest),
        ];
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
    if (exposeToMerchant && baked.texts.length) {
      const signWidgets = putFields.filter((field) =>
        SIGN_FIELD_TYPES.has(String(field.type || '')),
      );
      pushPut(signWidgets, true);
    }
    for (const bodyFields of fieldBodies) {
      pushPut(bodyFields, true);
    }
    if (baked.texts.length) {
      pushPut(putFields, false);
    }
    for (const attempt of attempts) {
      try {
        const res = await client.put(attempt.path, attempt.body, {
          validateStatus: () => true,
          // Agreement field rewrite can exceed the default 45s client timeout.
          timeout: 90_000,
        });
        if (res.status < 400) {
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
        console.warn(
          '[SignNow] publish Owner fields failed',
          attempt.path,
          this.signNowErrorDetail(res),
        );
      } catch (err) {
        console.warn(
          '[SignNow] publish Owner fields threw',
          attempt.path,
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return textsApplied || 0;
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
    const remember = (row: any) => {
      groupTemplateRowCache.set(wantedLower, { row, at: Date.now() });
      return row;
    };

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

    if (groupTemplateListCache && Date.now() - groupTemplateListCache.at < GROUP_TEMPLATE_ROW_TTL_MS) {
      const fromCache = groupTemplateListCache.rows.find(
        (row: any) => this.groupTemplateRowId(row).toLowerCase() === wantedLower,
      );
      if (fromCache) return remember(fromCache);
    }
    return null;
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
      try {
        const res = await client.post(path, body, {
          validateStatus: () => true,
          timeout: 25_000,
        });
        const copied = res.data?.data || res.data || {};
        const id = String(copied.id || copied.document_id || copied.unique_id || '').trim();
        if (res.status < 400 && id) return id;
        lastDetail = this.signNowErrorDetail(res);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err || '');
        lastDetail = detail;
        if (/timeout|ECONNABORTED|aborted/i.test(detail)) {
          throw new Error(`could not copy ${originId}: ${detail}`);
        }
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
    const results = await Promise.all(
      uniqueNew.map((documentId) =>
        client.post(
          `/v2/document-groups/${groupId}/documents`,
          { unique_id: documentId },
          { validateStatus: () => true },
        ),
      ),
    );
    const failed: string[] = [];
    for (let i = 0; i < results.length; i += 1) {
      const res = results[i];
      const documentId = uniqueNew[i];
      if (res.status >= 400) {
        console.warn('[SignNow] add document to group failed', {
          groupId,
          documentId,
          status: res.status,
          detail: this.signNowErrorDetail(res),
        });
        failed.push(documentId);
      }
    }
    for (const documentId of failed) {
      const retry = await client.post(
        `/v2/document-groups/${groupId}/documents`,
        { unique_id: documentId },
        { validateStatus: () => true },
      );
      if (retry.status >= 400) {
        console.warn('[SignNow] sequential add document to group failed', {
          groupId,
          documentId,
          status: retry.status,
          detail: this.signNowErrorDetail(retry),
        });
        return false;
      }
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
    const res = await client.post(
      '/documentgroup',
      { document_ids: ids, group_name: groupName },
      { validateStatus: () => true },
    );
    const created = res.data?.data || res.data || {};
    const groupId = String(created.unique_id || created.id || '').trim();
    if (res.status >= 400 || !groupId) {
      console.warn('[SignNow] rebuild combined group failed', this.signNowErrorDetail(res));
      return null;
    }
    const documents =
      this.normalizeGroupDocuments(created.documents).length > 0
        ? this.normalizeGroupDocuments(created.documents)
        : await this.refreshGroupDocuments(client, groupId);
    return { groupId, documents };
  }

  /**
   * Instantiate each extra template, ungroup those copies, then recreate one
   * combined document group. SignNow cannot add a document that already belongs
   * to another group, and POST /v2/document-groups/{id}/documents expects
   * `{ unique_id: documentId }` — not the group id.
   */
  private collectCopiedAddendumIds(
    addenda: SignNowAddendumTemplate[],
    extraResults: PromiseSettledResult<string[]>[],
  ): string[] {
    const extraIds: string[] = [];
    extraResults.forEach((result, index) => {
      const name = addenda[index]?.name || `extra ${index + 1}`;
      if (result.status === 'fulfilled') {
        extraIds.push(...result.value);
        return;
      }
      const detail =
        result.reason instanceof Error ? result.reason.message : String(result.reason || '');
      console.warn('[SignNow] extra template copy skipped', { name, detail: detail.slice(0, 240) });
    });
    return extraIds;
  }

  private async attachCopiedAddenda(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[],
    extraIds: string[],
    groupName: string,
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] }> {
    const uniqueExtra = [...new Set(extraIds.map((id) => String(id || '').trim()).filter(Boolean))];
    if (!uniqueExtra.length) {
      console.warn('[SignNow] no extras copied; opening the contract documents already created');
      return { groupId, documents };
    }
    const existingIds = documents.map((d) => d.id).filter(Boolean);
    const added = await this.addDocumentsToGroup(client, groupId, existingIds, uniqueExtra);
    if (added) {
      const merged = await this.refreshGroupDocuments(client, groupId);
      console.info('[SignNow] extras added to existing group', {
        groupId,
        count: merged.length,
      });
      return { groupId, documents: merged.length ? merged : documents };
    }
    const rebuilt = await this.rebuildGroupWithDocuments(client, groupId, groupName, [
      ...existingIds,
      ...uniqueExtra,
    ]);
    if (!rebuilt?.groupId) {
      console.warn('[SignNow] combined rebuild failed; opening the contract documents already created');
      return { groupId, documents };
    }
    console.info('[SignNow] combined package documents', {
      groupId: rebuilt.groupId,
      count: rebuilt.documents.length,
      names: rebuilt.documents.map((d) => d.document_name || d.name || d.id),
    });
    return rebuilt;
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
    const copiedId = await this.copySignNowDocument(client, sourceId, addendum.name);
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
  ) {
    const existingDoc = await prisma.document.findUnique({
      where: { envelopeId: groupId },
      select: { applicationId: true, status: true, sentAt: true },
    });
    const appId = String(applicationId || existingDoc?.applicationId || '').trim();
    if (!appId) return;

    const docLooksSent =
      String(existingDoc?.status || '').trim().toLowerCase() === 'sent' ||
      Boolean(existingDoc?.sentAt);
    const contract = await prisma.contract.findFirst({
      where: { applicationId: appId },
      select: { id: true, status: true },
      orderBy: { updatedAt: 'desc' },
    });
    const contractStatus = String(contract?.status || '').trim().toUpperCase();
    if (['COMPLETED', 'DECLINED', 'REVOKED', 'EXPIRED'].includes(contractStatus)) return;

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
    if (!docLooksSent && contractStatus !== 'SENT' && !appLooksSent) return;

    const embeddedRes = await client.get(`/v2/document-groups/${groupId}/embedded-invites`, {
      validateStatus: () => true,
    });
    const hasEmbeddedReview = hasActiveEmbeddedInvites(embeddedRes.data);
    const hasEmailGroupInvite = Boolean(this.extractGroupInviteId(groupPayload));
    // Email groupinvite is created only by sendEnvelope. Keep Contract Sent in
    // that case. Otherwise this is still Owner review — roll back.
    if (!hasEmbeddedReview && hasEmailGroupInvite) return;

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
    } catch (err) {
      console.warn('[SignNow] premature Contract Sent revert skipped', err);
    }
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

  private async deleteEmbeddedInvites(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    groupId: string,
    documents: SignNowDocumentRef[] = [],
  ) {
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
  }

  /** Cancel per-document field invites left over from Owner embedded review. */
  private async cancelPendingFieldInvites(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
  ) {
    await Promise.all(
      documents.map(async (doc) => {
        const id = String(doc.id || '').trim();
        if (!id) return;
        const docRes = await client.get(`/document/${id}`, { validateStatus: () => true });
        if (docRes.status >= 400) return;
        const invites = Array.isArray(docRes.data?.field_invites)
          ? docRes.data.field_invites
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
        { requestId, attemptNumber: claim.attemptNumber },
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

  private extractGroupInviteId(payload: unknown): string {
    const root = (payload || {}) as Record<string, unknown>;
    const nested = (root.data || root) as Record<string, unknown>;
    const invites = (nested.invites || root.invites) as Array<{ id?: string; unique_id?: string }> | undefined;
    return String(
      nested.invite_id ||
        nested.inviteId ||
        root.invite_id ||
        root.inviteId ||
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

  private async hydrateDocumentRoles(
    client: Awaited<ReturnType<typeof createSignNowApiClient>>,
    documents: SignNowDocumentRef[],
    options?: { skipIfHydrated?: boolean },
  ): Promise<SignNowDocumentRef[]> {
    const fetched = await Promise.all(
      documents.map(async (doc) => {
        // `roles` from document-group listings are not trustworthy — only a prior
        // /document/{id} hydrate sets listedRoles / remainingRoles.
        if (
          options?.skipIfHydrated &&
          (doc.listedRoles?.length || doc.remainingRoles?.length)
        ) {
          return doc;
        }
        const res = await client.get(`/document/${doc.id}`, { validateStatus: () => true });
        if (res.status >= 400) {
          return {
            ...doc,
            roles: uniqueRoleNames(doc.roles || []),
          };
        }
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
    _subject: string,
    ccEmails?: string[],
    fulfilledRoles: string[] = [],
    meta: { requestId?: string; attemptNumber?: number } = {},
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
      return [...merchants, ...crmSteps].map((step, idx) => ({
        order: idx + 1,
        invite_emails: [{ email: step.email, expiration_days: 30, reminder: 0 }],
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
    const extraCc = uniqueEmails(ccEmails);
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

  private rememberDraftGroup(
    applicationId: string,
    groupId: string,
    documents: SignNowDocumentRef[],
  ) {
    const appId = String(applicationId || '').trim();
    const id = String(groupId || '').trim();
    if (!appId || !id || !documents.length) return;
    draftGroupCache.set(appId, { groupId: id, documents, at: Date.now() });
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
    groupName?: string,
  ): Promise<{ groupId: string; documents: SignNowDocumentRef[] } | null> {
    const cached = draftGroupCache.get(applicationId);
    if (cached && Date.now() - cached.at <= DRAFT_GROUP_CACHE_TTL_MS && cached.documents.length) {
      return { groupId: cached.groupId, documents: cached.documents };
    }
    const existing = await prisma.document.findUnique({
      where: { applicationId },
      select: { envelopeId: true, status: true },
    });
    const status = String(existing?.status || '').toLowerCase();
    if (
      status === 'completed' ||
      status === 'voided' ||
      status === 'declined' ||
      status === 'cancelled'
    ) {
      return null;
    }
    const live = await this.loadLiveDocumentGroup(
      client,
      String(existing?.envelopeId || ''),
    );
    if (live) {
      this.rememberDraftGroup(applicationId, live.groupId, live.documents);
      return live;
    }
    return null;
  }

  private async linkGroupToApplication(userId: string, applicationId: string, groupId: string) {
    const existingDoc = await prisma.document.findUnique({
      where: { applicationId },
      select: { envelopeId: true, userId: true },
    });
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
    await prisma.document.upsert({
      where: { applicationId },
      create: {
        applicationId,
        envelopeId: groupId,
        status: 'draft',
        userId: documentOwnerUserId,
      },
      update: {
        envelopeId: groupId,
        status: 'draft',
        sentAt: null,
        completedAt: null,
        signedPdfUrl: null,
        signedPdfPublicId: null,
      },
    });
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
