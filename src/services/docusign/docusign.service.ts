import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import prisma from '../../config/prismaClient';
import { Prisma } from '@prisma/client';
import sendMail, { isOutboundSmtpConfigured } from '../../config/nodemailer';
import {
  DOCUSIGN_CLIENT_ID,
  DOCUSIGN_INTEGRATION_KEY,
  DOCUSIGN_CLIENT_SECRET,
  DOCUSIGN_AUTO_SEND_ENVELOPE,
  DOCUSIGN_DEFAULT_ROLE_NAME,
  DOCUSIGN_DEFAULT_TEMPLATE_ID,
  DOCUSIGN_LOCK_SIGNER_DATA_TABS,
  DOCUSIGN_LOCK_RETRY_ATTEMPTS,
  DOCUSIGN_LOCK_RETRY_DELAY_MS,
  DOCUSIGN_SINGLE_SIGNER_ONLY,
  DOCUSIGN_REDIRECT_URI,
  DOCUSIGN_JWT_CONSENT_REDIRECT_URI,
  DOCUSIGN_WEBHOOK_BASIC_PASSWORD,
  DOCUSIGN_WEBHOOK_BASIC_USER,
  resolveDocusignWebhookUrl,
  getDocusignOAuthUrls,
  normalizeDocusignRestBaseUri,
  resolveDocusignAuthMode,
} from './utils/docusign-client';
import {
  buildPrefillValueMap,
  buildTextTabsFromPrefillIds,
  collectTabLabels,
  mapMatchedTabsToEnvelopeTabIds,
  matchPrefillFieldsToTextTabs,
  normalizeFieldKey,
  type DocusignTextTabRef,
  type PrefillFieldInput,
} from './utils/docusign-prefill';

/** DocuSign tab group → property name used when setting prefilled values on create/update. */
function tabGroupPrefillProperty(group: string): 'value' | 'numberValue' | 'selected' {
  if (group === 'numberTabs') return 'numberValue';
  if (group === 'checkboxTabs') return 'selected';
  return 'value';
}

function resolvePrefillForTab(
  valueMap: Map<string, string>,
  tab: DocusignTextTabRef,
): string | undefined {
  const candidates = [tab.tabLabel, tab.name, tab.tabId].filter(Boolean) as string[];
  for (const c of candidates) {
    const k = normalizeFieldKey(c);
    if (valueMap.has(k)) return valueMap.get(k);
    const noUnderscore = k.replace(/_/g, '');
    if (valueMap.has(noUnderscore)) return valueMap.get(noUnderscore);
  }
  return undefined;
}
import {
  clearDocusignJwtCache,
  getDocusignJwtSession,
  isDocusignJwtConfigured,
} from './utils/docusign-jwt';
import {
  extractCrmApplicationIdFromWebhook,
  extractDocusignConnectEventName,
  extractDocusignEnvelopeId,
  internalEnvelopeStatusToContractStatusDbValue,
  mapDocusignEnvelopeStatus,
  mergeWithExistingEnvelopeStatus,
  parseDocusignWebhookBody,
  resolveDocusignWebhookEnvelopeStatus,
} from './utils/docusign-webhook';
import {
  buildPlatformLayoutEnvelopeDefinition,
  filterSupplementalRefs,
  resolveSupplementalRefsFromDb,
} from './utils/platform-layout-envelope';
import { applyDocuSignPrefillTabStyle } from './utils/docusign-tab-style';
import {
  contractHasAchAuthorizationEnvelope,
  findApplicationIdByAchEnvelopeId,
  isStandaloneAchEnvelope,
  linkAchAuthorizationEnvelopeToContract,
  mapInternalEnvelopeStatusToAchCapsule,
  parseAchAuthorizationDocuSignFromPrefill,
  updateAchAuthorizationDocuSignStatus,
  clearAchAuthorizationIfMatchesMainContract,
} from './utils/ach-authorization-docusign';
import {
  isStandalonePackageEnvelope,
  linkStandalonePackageEnvelopeToContract,
  mapInternalEnvelopeStatusToPackageCapsule,
  parseStandalonePackageDocuSignFromPrefill,
  resolveStandaloneLinkKind,
  updateStandalonePackageDocuSignStatus,
} from './utils/standalone-package-docusign';
import {
  archiveMainContractEnvelopeToHistory,
  updateArchivedContractSendHistoryStatus,
} from './utils/contract-send-history';
import { decryptField, isEncrypted } from '../../utils/fieldEncryption';
import { handleContractSigningStatusTransition } from '../contractSigningStatusEffects';
import { mergeDefaultContractCcEmails } from '../../utils/contractCcDefaults';
import {
  buildContractEnvelopeDocumentName,
  buildContractEnvelopeEmailSubject,
  buildContractEnvelopePdfFilename,
  normalizeContractCcEmailSubject,
} from '../../utils/contractEnvelopeEmailSubject';

dotenv.config();

/** Short-lived cache so UI polling does not hammer DocuSign GET /envelopes (429). */
const envelopeStatusSyncCache = new Map<
  string,
  { syncedAt: number; payload: Record<string, unknown> }
>();
const ENVELOPE_STATUS_SYNC_MIN_INTERVAL_MS = 60_000;

export function invalidateEnvelopeStatusSyncCache(envelopeId?: string): void {
  const eid = String(envelopeId || '').trim();
  if (eid) envelopeStatusSyncCache.delete(eid);
  else envelopeStatusSyncCache.clear();
}

class UnauthorizedException extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedException';
  }
}

class BadRequestException extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestException';
  }
}

/** DocuSign not configured / not connected — must not use HTTP 401 (CRM axios treats 401 as logout). */
class ServiceConfigException extends Error {
  status = 503;
  constructor(message: string) {
    super(message);
    this.name = 'ServiceConfigException';
  }
}

/** Turn DocuSign/Axios failures into a user-visible message (not "Request failed with status code 400"). */
export function formatDocusignApiErrorMessage(err: unknown): string {
  const ax = err as {
    response?: { status?: number; data?: unknown };
    message?: string;
  };
  const data = ax?.response?.data;
  if (typeof data === 'string' && data.trim()) {
    return data.trim();
  }
  if (data && typeof data === 'object') {
    const o = data as Record<string, unknown>;
    const code = String(o.errorCode ?? '').trim();
    const msg = String(o.message ?? o.error ?? '').trim();
    if (msg) {
      return code ? `DocuSign (${code}): ${msg}` : `DocuSign: ${msg}`;
    }
    const details = o.errorDetails;
    if (Array.isArray(details) && details.length > 0) {
      const first = details[0] as Record<string, unknown>;
      const dMsg = String(first?.message ?? '').trim();
      const dCode = String(first?.errorCode ?? '').trim();
      if (dMsg) {
        return dCode ? `DocuSign (${dCode}): ${dMsg}` : `DocuSign: ${dMsg}`;
      }
    }
    try {
      return `DocuSign error: ${JSON.stringify(data)}`;
    } catch {
      /* fall through */
    }
  }
  const fallback = String(ax?.message ?? err ?? 'Unknown error');
  if (/^request failed with status code \d+$/i.test(fallback) && ax?.response?.status) {
    return `DocuSign API returned HTTP ${ax.response.status} with no error details. Check envelope id, DocuSign account, and JWT impersonated user.`;
  }
  if (/BURST_ENVELOPE_POLLING|HOURLY_ENVELOPE_POLLING/i.test(fallback)) {
    return `DocuSign polling limit reached. Wait a few minutes before checking status again — use Connect webhooks for live updates. (${fallback})`;
  }
  return fallback;
}

export function formatDocusignRouteError(error: unknown): { status: number; message: string } {
  if (error instanceof BadRequestException) {
    return { status: 400, message: error.message };
  }
  if (error instanceof ServiceConfigException) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof UnauthorizedException) {
    return { status: 401, message: error.message };
  }
  const ax = error as { response?: { status?: number }; status?: number };
  if (ax?.response?.status === 401) {
    clearDocusignJwtCache();
    return {
      status: 503,
      message:
        'DocuSign API rejected credentials. Check JWT key, impersonated user, and admin consent.',
    };
  }
  const httpStatus = ax?.status || ax?.response?.status || 500;
  return {
    status: httpStatus >= 400 && httpStatus < 600 ? httpStatus : 500,
    message: formatDocusignApiErrorMessage(error),
  };
}

type PrefillField = PrefillFieldInput;

type SignerRoleInput = Record<string, unknown> & {
  roleIndex?: number;
  roleName?: string;
  signerName?: string;
  signerEmail?: string;
  signerOrder?: number;
  signerRole?: string;
};

export class DocusignService {
  // ─── OAuth ───────────────────────────────────────────────────────────────────

  /**
   * One-time JWT admin consent URL (DocuSign often hides "Grant consent" under Actions).
   * Open while logged in as DOCUSIGN_IMPERSONATED_USER_ID (e.g. dev@).
   */
  getJwtConsentUrl(): string {
    const clientId = DOCUSIGN_INTEGRATION_KEY || DOCUSIGN_CLIENT_ID;
    if (!clientId?.trim()) {
      throw new BadRequestException('DOCUSIGN_CLIENT_ID / DOCUSIGN_INTEGRATION_KEY is not set.');
    }
    const redirectUri = DOCUSIGN_REDIRECT_URI?.trim() || DOCUSIGN_JWT_CONSENT_REDIRECT_URI;
    const scopes = encodeURIComponent('signature impersonation');
    const { authUrl } = getDocusignOAuthUrls();
    return (
      `${authUrl}?response_type=code&scope=${scopes}` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}`
    );
  }

  getConnectionStatus() {
    const mode = resolveDocusignAuthMode();
    const status: Record<string, unknown> = {
      mode,
      jwtConfigured: isDocusignJwtConfigured(),
      requiresUserConnect: mode === 'oauth',
    };
    if (mode === 'jwt' && isDocusignJwtConfigured()) {
      try {
        status.consentUrl = this.getJwtConsentUrl();
        status.consentInstructions =
          'Open consentUrl in a browser while logged in as the impersonated DocuSign user (dev@). ' +
          'Add the redirect URI to Apps and Keys → Redirect URIs if DocuSign rejects the redirect.';
      } catch {
        /* omit consent URL if misconfigured */
      }
    }
    return status;
  }

  getAuthUrl(state: string): string {
    if (resolveDocusignAuthMode() === 'jwt') {
      throw new BadRequestException(
        'DocuSign uses server JWT auth. Per-user Connect is not required.',
      );
    }
    const scopes = encodeURIComponent('signature impersonation');
    const { authUrl } = getDocusignOAuthUrls();
    return (
      `${authUrl}?response_type=code&scope=${scopes}` +
      `&client_id=${encodeURIComponent(DOCUSIGN_CLIENT_ID)}` +
      `&state=${encodeURIComponent(state)}` +
      `&redirect_uri=${encodeURIComponent(DOCUSIGN_REDIRECT_URI)}`
    );
  }

  async handleCallback(code: string, userId: string) {
    const { tokenUrl, userInfoUrl } = getDocusignOAuthUrls();
    try {
      const params = new URLSearchParams();
      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('client_id', DOCUSIGN_CLIENT_ID);
      params.append('client_secret', DOCUSIGN_CLIENT_SECRET);
      params.append('redirect_uri', DOCUSIGN_REDIRECT_URI);

      const tokenRes = await axios.post(tokenUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, refresh_token, expires_in } = tokenRes.data;
      if (!access_token) {
        throw new Error('Invalid response from DocuSign: Missing access token');
      }

      const userInfoRes = await axios.get(userInfoUrl, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const accounts = userInfoRes.data?.accounts || [];
      const defaultAccount = accounts.find((a: { is_default?: boolean }) => a.is_default) || accounts[0];
      if (!defaultAccount?.account_id) {
        throw new Error('No default DocuSign account found for user');
      }

      const tokenExpiry = expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : new Date(Date.now() + 8 * 60 * 60 * 1000);

      await prisma.user.update({
        where: { id: userId },
        data: {
          docusignAccessToken: access_token,
          docusignRefreshToken: refresh_token || null,
          docusignTokenExpiry: tokenExpiry,
          docusignAccountId: defaultAccount.account_id,
          docusignBaseUri: defaultAccount.base_uri,
        } as any,
      });

      return { success: true };
    } catch (error: any) {
      throw new UnauthorizedException(
        'Failed to get DocuSign tokens: ' + (error?.message || error),
      );
    }
  }

  private async refreshToken(userId: string) {
    const user: any = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.docusignRefreshToken) {
      throw new UnauthorizedException('DocuSign refresh token missing');
    }
    const { tokenUrl } = getDocusignOAuthUrls();
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('refresh_token', user.docusignRefreshToken);
    params.append('client_id', DOCUSIGN_CLIENT_ID);
    params.append('client_secret', DOCUSIGN_CLIENT_SECRET);

    const res = await axios.post(tokenUrl, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const { access_token, refresh_token, expires_in } = res.data;
    await prisma.user.update({
      where: { id: userId },
      data: {
        docusignAccessToken: access_token,
        docusignRefreshToken: refresh_token || user.docusignRefreshToken,
        docusignTokenExpiry: new Date(Date.now() + (expires_in || 28800) * 1000),
      } as any,
    });
  }

  /** Whether API calls use server JWT (no per-user Connect). */
  isJwtAuthMode(): boolean {
    return resolveDocusignAuthMode() === 'jwt';
  }

  getAuthMode(): 'jwt' | 'oauth' {
    return resolveDocusignAuthMode();
  }

  private createRestClient(accessToken: string, baseUri: string): AxiosInstance {
    const baseURL = normalizeDocusignRestBaseUri(baseUri);
    return axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  private ensureClientApiBase(client: AxiosInstance): void {
    const current = String(client.defaults.baseURL || '');
    const fixed = normalizeDocusignRestBaseUri(current);
    if (fixed && fixed !== current) {
      console.warn(`[DocuSign] normalized axios baseURL: ${current} → ${fixed}`);
      client.defaults.baseURL = fixed;
    }
  }

  private async getJwtAuthContext() {
    try {
      const { accessToken, accountId, baseUri } = await getDocusignJwtSession();
      return {
        user: null as any,
        accountId,
        client: this.createRestClient(accessToken, baseUri),
      };
    } catch (error: any) {
      clearDocusignJwtCache();
      const detail = error?.response?.data?.error_description || error?.message || String(error);
      throw new ServiceConfigException(
        `DocuSign JWT authentication failed. Check integration key, impersonated user GUID, RSA key, and admin consent. ${detail}`,
      );
    }
  }

  private async getOAuthAuthContext(userId: string) {
    let user: any = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.docusignAccessToken) {
      throw new ServiceConfigException(
        'DocuSign is not connected for this user. Ask an admin to enable JWT (DOCUSIGN_RSA_PRIVATE_KEY) or connect DocuSign once.',
      );
    }

    const isExpired =
      user.docusignTokenExpiry &&
      new Date(user.docusignTokenExpiry).getTime() - 5 * 60 * 1000 < Date.now();

    if (isExpired && user.docusignRefreshToken) {
      await this.refreshToken(userId);
      user = await prisma.user.findUnique({ where: { id: userId } });
    }

    if (!user?.docusignAccessToken || !user.docusignAccountId || !user.docusignBaseUri) {
      throw new ServiceConfigException(
        'DocuSign account information missing. Reconnect DocuSign or configure JWT.',
      );
    }

    const baseUri = normalizeDocusignRestBaseUri(user.docusignBaseUri);
    return {
      user,
      accountId: user.docusignAccountId as string,
      client: this.createRestClient(user.docusignAccessToken, baseUri),
    };
  }

  private async getAuthContext(userId: string) {
    if (resolveDocusignAuthMode() === 'jwt') {
      if (!isDocusignJwtConfigured()) {
        throw new ServiceConfigException(
          'DocuSign JWT is not configured. Set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_IMPERSONATED_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY.',
        );
      }
      return this.getJwtAuthContext();
    }
    return this.getOAuthAuthContext(userId);
  }

  // ─── Prefill helpers ───────────────────────────────────────────────────────

  /**
   * One recipients GET plus document tab walks — used for prefill and role names (avoids duplicate template API calls).
   */
  private async fetchTemplateDefinition(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
  ): Promise<{ textTabs: DocusignTextTabRef[]; roleNames: string[] }> {
    const merged: DocusignTextTabRef[] = [];
    const roleNames: string[] = [];
    const seen = new Set<string>();

    const pushTabs = (tabsResData: Record<string, unknown>) => {
      for (const [group, tabs] of Object.entries(tabsResData)) {
        if (!this.isSignerDataTabGroup(group) || !Array.isArray(tabs)) continue;
        for (const raw of tabs as DocusignTextTabRef[]) {
          const key = String(raw.tabId || raw.tabLabel || raw.name || '').trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          merged.push(raw);
        }
      }
    };

    try {
      const recRes = await client.get(
        `/v2.1/accounts/${accountId}/templates/${templateId}/recipients`,
      );
      const signers = recRes.data?.signers || [];
      for (const s of signers) {
        const rn = String(s.roleName || '').trim();
        if (rn) roleNames.push(rn);
      }
      const signer = signers[0];
      const recipientId = signer?.recipientId;
      if (recipientId) {
        const tabsRes = await client.get(
          `/v2.1/accounts/${accountId}/templates/${templateId}/recipients/${recipientId}/tabs`,
        );
        pushTabs((tabsRes.data || {}) as Record<string, unknown>);
      }
    } catch (err) {
      console.warn('[DocuSign] fetchTemplateDefinition (recipients) failed:', err);
    }

    try {
      const docsRes = await client.get(
        `/v2.1/accounts/${accountId}/templates/${templateId}/documents`,
      );
      const docs =
        docsRes.data?.templateDocuments || docsRes.data?.documents || [];
      for (const doc of docs) {
        const docId = String(doc?.documentId ?? '1');
        const tabsRes = await client.get(
          `/v2.1/accounts/${accountId}/templates/${templateId}/documents/${docId}/tabs`,
        );
        pushTabs((tabsRes.data || {}) as Record<string, unknown>);
      }
    } catch (err) {
      console.warn('[DocuSign] fetchTemplateDefinition (documents) failed:', err);
    }

    return { textTabs: merged, roleNames };
  }

  /** All text tabs on template documents (DocuSign stores most fields here, not only on recipient). */
  private async fetchAllTemplateTextTabs(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
  ): Promise<DocusignTextTabRef[]> {
    const { textTabs } = await this.fetchTemplateDefinition(client, accountId, templateId);
    return textTabs;
  }

  /** DocuSign virtual document ids (tabs/download per-doc are invalid for these). */
  private static readonly DOCUSIGN_VIRTUAL_DOCUMENT_IDS = new Set([
    'certificate',
    'combined',
    'portfolio',
  ]);

  /** True when document id supports GET .../documents/{id}/tabs (content docs only). */
  private supportsEnvelopeDocumentTabs(doc: {
    documentId?: string;
    type?: string;
  }): boolean {
    const docId = String(doc?.documentId ?? '').trim();
    if (!docId) return false;
    if (DocusignService.DOCUSIGN_VIRTUAL_DOCUMENT_IDS.has(docId.toLowerCase())) {
      return false;
    }
    const docType = String(doc?.type ?? '').trim().toLowerCase();
    if (docType && docType !== 'content') {
      return false;
    }
    return true;
  }

  private filterEnvelopeContentDocuments<
    T extends { documentId?: string; type?: string },
  >(docs: T[]): T[] {
    return docs.filter((d) => this.supportsEnvelopeDocumentTabs(d));
  }

  private pushEnvelopeDataTabsFromResponse(
    tabsResData: Record<string, unknown>,
    merged: DocusignTextTabRef[],
    seen: Set<string>,
  ) {
    for (const [group, tabs] of Object.entries(tabsResData)) {
      if (!this.isSignerDataTabGroup(group) || !Array.isArray(tabs)) continue;
      for (const raw of tabs as Record<string, unknown>[]) {
        const t = raw as DocusignTextTabRef;
        const key = String(t.tabId || t.tabLabel || t.name || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(t);
      }
    }
  }

  private async fetchEnvelopeDocumentDataTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<DocusignTextTabRef[]> {
    const merged: DocusignTextTabRef[] = [];
    const seen = new Set<string>();

    try {
      const docsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents`,
      );
      const docs = docsRes.data?.envelopeDocuments || docsRes.data?.documents || [];
      const contentDocs = this.filterEnvelopeContentDocuments(
        docs.length ? docs : [{ documentId: '1' }],
      );
      const toFetch = contentDocs.length ? contentDocs : [{ documentId: '1' }];

      for (const doc of toFetch) {
        const docId = String(doc?.documentId ?? '1');
        try {
          const tabsRes = await client.get(
            `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/${docId}/tabs`,
          );
          this.pushEnvelopeDataTabsFromResponse(
            (tabsRes.data || {}) as Record<string, unknown>,
            merged,
            seen,
          );
        } catch (docErr) {
          console.warn(
            `[DocuSign] fetchEnvelopeDocumentDataTabs document ${docId} failed:`,
            docErr,
          );
        }
      }
    } catch (err) {
      console.warn('[DocuSign] fetchEnvelopeDocumentDataTabs failed:', err);
    }

    return merged;
  }

  /** @deprecated Use fetchEnvelopeDocumentDataTabs — kept as alias for callers expecting text-only catalog. */
  private async fetchEnvelopeDocumentTextTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<DocusignTextTabRef[]> {
    return this.fetchEnvelopeDocumentDataTabs(client, accountId, envelopeId);
  }

  private async fetchEnvelopeSignerDataTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    recipientId: string,
  ): Promise<DocusignTextTabRef[]> {
    try {
      const tabsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
      );
      const merged: DocusignTextTabRef[] = [];
      const seen = new Set<string>();
      this.pushEnvelopeDataTabsFromResponse(
        (tabsRes.data || {}) as Record<string, unknown>,
        merged,
        seen,
      );
      return merged;
    } catch (err) {
      console.warn('[DocuSign] fetchEnvelopeSignerDataTabs failed:', err);
      return [];
    }
  }

  private async getTemplateSignerRoleNames(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
  ): Promise<string[]> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/templates/${templateId}/recipients`,
      );
      return (res.data?.signers || [])
        .map((s: { roleName?: string }) => String(s.roleName || '').trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async assertEnvelopeHasSigners(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    templateId?: string,
  ) {
    const res = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = (res.data?.signers || []).filter(
      (s: { email?: string }) => String(s.email || '').trim(),
    );
    if (signers.length) return signers;

    const templateRoles = templateId
      ? await this.getTemplateSignerRoleNames(client, accountId, templateId)
      : [];
    throw new BadRequestException(
      `DocuSign envelope has no signers with email. Template role name(s): ${templateRoles.join(', ') || 'unknown'}. ` +
        'CRM must send roles[].signerRole (or roleName) exactly matching the template role, plus a valid signerEmail.',
    );
  }

  private async fetchEnvelopeSignerTextTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    recipientId: string,
  ): Promise<DocusignTextTabRef[]> {
    return this.fetchEnvelopeSignerDataTabs(client, accountId, envelopeId, recipientId);
  }

  private async buildTextTabsForPrefill(
    client: AxiosInstance,
    accountId: string,
    templateId: string | undefined,
    prefillFields?: PrefillField[],
    preloadedTemplateTabs?: DocusignTextTabRef[],
  ): Promise<Array<{ tabLabel: string; value: string; tabId?: string }>> {
    const fields = this.sanitizePrefillFieldsForDocuSign(prefillFields);
    if (!fields.length) return [];

    const tid = String(templateId || '').trim();
    if (tid) {
      const templateTabs =
        preloadedTemplateTabs ??
        (await this.fetchAllTemplateTextTabs(client, accountId, tid));
      const matched = matchPrefillFieldsToTextTabs(fields, templateTabs);
      if (matched.length) return matched;
      console.warn(
        `[DocuSign] prefill: ${fields.length} CRM field(s), 0 tab matches on template ${tid}. ` +
          `Sample DocuSign tab labels: ${collectTabLabels(templateTabs, 15).join(', ') || '(none — add Data Labels on PDF fields)'}`,
      );
    }

    return buildTextTabsFromPrefillIds(fields);
  }

  private logDocusignApiError(context: string, err: unknown) {
    const ax = err as { response?: { data?: { errorCode?: string; message?: string } }; message?: string };
    const code = ax?.response?.data?.errorCode;
    const message = ax?.response?.data?.message || ax?.message || String(err);
    console.warn(`[DocuSign] ${context}${code ? ` (${code})` : ''}: ${message}`);
  }

  private normalizePublicAppOrigin(raw: string): string {
    const trimmed = String(raw || '').trim().replace(/\/+$/, '');
    if (!trimmed) return '';
    try {
      if (trimmed.includes('://')) return new URL(trimmed).origin;
      return `https://${trimmed.replace(/^\/+/, '')}`;
    } catch {
      return '';
    }
  }

  /**
   * DocuSign sender view rejects many local/dev return URLs (http://localhost, http://).
   * When localhost is sent, remap to public origin + same path so users return to the deal page.
   */
  private normalizeSenderReturnUrl(returnUrl: string): string {
    const fallbackOrigin =
      this.normalizePublicAppOrigin(
        process.env.DOCUSIGN_SENDER_RETURN_URL?.trim() || '',
      ) || 'https://www.docusign.com';
    const raw = String(returnUrl || '').trim();
    if (!raw) return fallbackOrigin;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      const isLocal =
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host.endsWith('.local');
      const pathSuffix = `${u.pathname}${u.search}${u.hash}`;

      if (isLocal || u.protocol !== 'https:') {
        if (isLocal && fallbackOrigin && pathSuffix && pathSuffix !== '/') {
          const remapped = `${fallbackOrigin}${pathSuffix}`;
          console.log(
            `[DocuSign] Sender view returnUrl "${raw}" is not public HTTPS; using ${remapped}`,
          );
          return remapped;
        }
        console.log(
          `[DocuSign] Sender view returnUrl "${raw}" is not a public HTTPS URL; using ${fallbackOrigin}`,
        );
        return fallbackOrigin;
      }
      return raw;
    } catch {
      return fallbackOrigin;
    }
  }

  private throwBadRequestFromDocusignAxios(context: string, err: unknown): never {
    this.logDocusignApiError(context, err);
    throw new BadRequestException(`${context}: ${formatDocusignApiErrorMessage(err)}`);
  }

  private async assertEnvelopeDraftForSenderView(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<void> {
    await this.assertEnvelopeDraftOrThrow(client, accountId, envelopeId);
  }

  /** Throws when the envelope is missing or no longer an editable draft. */
  private async assertEnvelopeDraftOrThrow(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<void> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
      );
      const status = String(res.data?.status || '').toLowerCase();
      if (status && status !== 'created') {
        throw new BadRequestException(
          `DocuSign envelope status is "${status}" (requires draft "created"). ` +
            'Create a new draft from Review & send.',
        );
      }
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const ax = err as { response?: { status?: number } };
      if (ax?.response?.status === 404) {
        throw new BadRequestException(
          'DocuSign draft envelope was not found (it may have been voided or expired). ' +
            'Click Review & send to create a new draft.',
        );
      }
      this.throwBadRequestFromDocusignAxios('Envelope lookup', err);
    }
  }

  /** Decrypt CRM `enc:v1:` values and drop empty fields before sending to DocuSign. */
  private sanitizePrefillFieldsForDocuSign(prefillFields?: PrefillField[]): PrefillField[] {
    return (prefillFields || [])
      .map((f) => {
        const id = String(f?.id ?? '').trim();
        let value = String(f?.value ?? '').trim();
        if (!id || !value) return null;
        if (isEncrypted(value)) {
          try {
            value = String(decryptField(value) ?? '').trim();
          } catch {
            return null;
          }
        }
        if (!value) return null;
        return { id, value };
      })
      .filter((f): f is PrefillField => f != null);
  }

  /**
   * PUT text tab values on envelope recipient tabs (DocuSign rejects text tab PUT on documents/{id}/tabs).
   */
  private async putEnvelopeTextTabsInChunks(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    tabsPath: string,
    textTabs: Array<{ tabId: string; value: string }>,
  ): Promise<number> {
    return this.putEnvelopeDataTabGroupInChunks(
      client,
      accountId,
      envelopeId,
      tabsPath,
      'textTabs',
      textTabs,
    );
  }

  /** PUT prefilled values on any signer data tab group (text, number, date, etc.). */
  private async putEnvelopeDataTabGroupInChunks(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    tabsPath: string,
    group: string,
    updates: Array<{ tabId: string; value: string }>,
    lockTabs = false,
  ): Promise<number> {
    if (!updates.length) return 0;
    const valueKey = tabGroupPrefillProperty(group);
    const CHUNK_SIZE = 20;
    let applied = 0;
    for (let i = 0; i < updates.length; i += CHUNK_SIZE) {
      const chunk = updates.slice(i, i + CHUNK_SIZE).map((t) => ({
        tabId: t.tabId,
        [valueKey]: t.value,
        ...(lockTabs ? { locked: 'true' } : {}),
        shared: 'true',
      }));
      await client.put(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/${tabsPath}`,
        { [group]: chunk },
      );
      applied += chunk.length;
    }
    return applied;
  }

  private async applyPrefillToRecipientTabGroups(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    recipientId: string,
    fields: PrefillField[],
    updatedTabIds: Set<string>,
  ): Promise<number> {
    const valueMap = buildPrefillValueMap(fields);
    if (!valueMap.size) return 0;

    let tabsResData: Record<string, unknown>;
    try {
      const tabsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
      );
      tabsResData = (tabsRes.data || {}) as Record<string, unknown>;
    } catch (err) {
      this.logDocusignApiError(`applyPrefillToRecipientTabGroups ${recipientId}`, err);
      return 0;
    }

    let applied = 0;
    const tabsPath = `recipients/${recipientId}/tabs`;

    for (const [group, tabs] of this.collectSignerDataTabGroups(tabsResData)) {
      const pending: Array<{ tabId: string; value: string }> = [];
      for (const tab of tabs) {
        const tabId = String(tab.tabId || '').trim();
        if (!tabId || updatedTabIds.has(tabId)) continue;
        const prefill = resolvePrefillForTab(valueMap, tab as DocusignTextTabRef);
        if (!prefill) continue;
        pending.push({ tabId, value: prefill });
      }
      if (!pending.length) continue;

      try {
        const n = await this.putEnvelopeDataTabGroupInChunks(
          client,
          accountId,
          envelopeId,
          tabsPath,
          group,
          pending,
        );
        applied += n;
        for (const t of pending) updatedTabIds.add(t.tabId);
      } catch (groupErr) {
        this.logDocusignApiError(`recipient ${recipientId}/${group}`, groupErr);
      }
    }

    return applied;
  }

  /** Recipient tab groups that stay interactive (signature / initials / attachments). */
  private static readonly SIGNER_SIGNING_TAB_GROUPS = new Set([
    'signHereTabs',
    'initialHereTabs',
    'initialHereOptionalTabs',
    'signerAttachmentTabs',
  ]);

  /** Tab response keys that are not lockable tab arrays. */
  private static readonly SIGNER_TAB_SKIP_KEYS = new Set([
    'tabGroups',
    'recipientAttachmentTabs',
  ]);

  private static readonly TAB_VALUE_PRESERVE_KEYS = [
    'value',
    'selected',
    'numberValue',
    'originalValue',
    'listSelectedValue',
  ] as const;

  private isSignerDataTabGroup(group: string): boolean {
    return (
      group.endsWith('Tabs') &&
      !DocusignService.SIGNER_SIGNING_TAB_GROUPS.has(group) &&
      !DocusignService.SIGNER_TAB_SKIP_KEYS.has(group)
    );
  }

  private isSignerDataTabLocked(tab: Record<string, unknown>): boolean {
    return String(tab.locked || '').toLowerCase() === 'true';
  }

  private buildLockedTabUpdateRow(tab: Record<string, unknown>): Record<string, string> | null {
    const tabId = String(tab.tabId || '').trim();
    if (!tabId) return null;
    if (this.isSignerDataTabLocked(tab)) return null;

    const row: Record<string, string> = {
      tabId,
      locked: 'true',
    };
    for (const key of DocusignService.TAB_VALUE_PRESERVE_KEYS) {
      const v = tab[key];
      if (v !== undefined && v !== null && String(v).trim() !== '') {
        row[key] = String(v);
      }
    }
    return row;
  }

  private collectSignerDataTabGroups(
    tabsResData: Record<string, unknown>,
  ): Array<[string, Record<string, unknown>[]]> {
    const groups: Array<[string, Record<string, unknown>[]]> = [];
    for (const [group, tabs] of Object.entries(tabsResData)) {
      if (!this.isSignerDataTabGroup(group) || !Array.isArray(tabs) || !tabs.length) {
        continue;
      }
      groups.push([group, tabs as Record<string, unknown>[]]);
    }
    return groups;
  }

  private async countUnlockedSignerDataTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<{ total: number; unlocked: number; unlockedLabels: string[] }> {
    const recRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = (recRes.data?.signers || []) as Array<{ recipientId?: string }>;
    let total = 0;
    let unlocked = 0;
    const unlockedLabels: string[] = [];

    for (const signer of signers) {
      const recipientId = String(signer.recipientId || '').trim();
      if (!recipientId) continue;

      try {
        const tabsRes = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
        );
        for (const [, tabs] of this.collectSignerDataTabGroups(
          (tabsRes.data || {}) as Record<string, unknown>,
        )) {
          for (const tab of tabs) {
            total += 1;
            if (this.isSignerDataTabLocked(tab)) continue;
            unlocked += 1;
            const label = String(tab.tabLabel || tab.name || tab.tabId || '').trim();
            if (label && unlockedLabels.length < 30) unlockedLabels.push(label);
          }
        }
      } catch (err) {
        this.logDocusignApiError(`countUnlockedSignerDataTabs ${recipientId}`, err);
      }
    }

    return { total, unlocked, unlockedLabels };
  }

  private async putLockedSignerTabGroup(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    recipientId: string,
    group: string,
    toLock: Record<string, string>[],
  ): Promise<number> {
    const path = `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`;
    try {
      await client.put(path, { [group]: toLock });
      return toLock.length;
    } catch (batchErr) {
      this.logDocusignApiError(`lockSignerDataTabs batch ${recipientId}/${group}`, batchErr);
    }

    let locked = 0;
    for (const row of toLock) {
      try {
        await client.put(path, { [group]: [row] });
        locked += 1;
      } catch (err) {
        this.logDocusignApiError(
          `lockSignerDataTabs single ${recipientId}/${group}/${row.tabId}`,
          err,
        );
      }
    }
    return locked;
  }

  /**
   * Lock all signer tabs except Sign Here / Initial Here so receivers can sign only.
   */
  private async lockEnvelopeSignerDataTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<number> {
    if (!DOCUSIGN_LOCK_SIGNER_DATA_TABS) return 0;

    const recRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = (recRes.data?.signers || []) as Array<{ recipientId?: string }>;
    let totalLocked = 0;

    for (const signer of signers) {
      const recipientId = String(signer.recipientId || '').trim();
      if (!recipientId) continue;

      let tabsResData: Record<string, unknown>;
      try {
        const tabsRes = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
        );
        tabsResData = (tabsRes.data || {}) as Record<string, unknown>;
      } catch (err) {
        this.logDocusignApiError(`lockSignerDataTabs fetch ${recipientId}`, err);
        continue;
      }

      for (const [group, tabs] of this.collectSignerDataTabGroups(tabsResData)) {
        const toLock = tabs
          .map((t) => this.buildLockedTabUpdateRow(t))
          .filter((row): row is Record<string, string> => row != null);
        if (!toLock.length) continue;

        const n = await this.putLockedSignerTabGroup(
          client,
          accountId,
          envelopeId,
          recipientId,
          group,
          toLock,
        );
        if (n) {
          totalLocked += n;
          console.log(
            `[DocuSign] locked ${n} ${group} for recipient ${recipientId} on ${envelopeId}`,
          );
        }
      }
    }

    return totalLocked;
  }

  /**
   * Prod envelopes often materialize tabs in waves (main doc, then addendum, numberTabs, etc.).
   * Do not stop after the first partial lock — wait until every data tab is locked or retries end.
   */
  private async lockEnvelopeSignerDataTabsWithRetry(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    options?: { attempts?: number; delayMs?: number },
  ): Promise<number> {
    const attempts = Math.max(1, options?.attempts ?? DOCUSIGN_LOCK_RETRY_ATTEMPTS);
    const delayMs = options?.delayMs ?? DOCUSIGN_LOCK_RETRY_DELAY_MS;
    let totalLocked = 0;

    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) {
        await this.sleep(delayMs);
      }

      const passLocked = await this.lockEnvelopeSignerDataTabs(client, accountId, envelopeId);
      totalLocked += passLocked;

      const { total, unlocked, unlockedLabels } = await this.countUnlockedSignerDataTabs(
        client,
        accountId,
        envelopeId,
      );

      if (total === 0) {
        if (attempt === attempts - 1) {
          console.warn(
            `[DocuSign] sign-only restriction: 0 signer data tabs found on ${envelopeId}`,
          );
        }
        continue;
      }

      if (unlocked === 0) {
        console.log(
          `[DocuSign] sign-only restriction: all ${total} signer data tab(s) locked on ${envelopeId}`,
        );
        return totalLocked;
      }

      console.warn(
        `[DocuSign] sign-only restriction: ${unlocked}/${total} tab(s) still editable on ${envelopeId}` +
          (unlockedLabels.length ? ` (e.g. ${unlockedLabels.slice(0, 8).join(', ')})` : ''),
      );
    }

    const { total, unlocked, unlockedLabels } = await this.countUnlockedSignerDataTabs(
      client,
      accountId,
      envelopeId,
    );
    if (unlocked > 0) {
      console.error(
        `[DocuSign] sign-only restriction FAILED: ${unlocked}/${total} tab(s) still editable on ${envelopeId}` +
          (unlockedLabels.length ? ` — ${unlockedLabels.join(', ')}` : ''),
      );
    }
    return totalLocked;
  }

  private async lockEnvelopeSignerDataTabsAsSystem(envelopeId: string): Promise<number> {
    try {
      const { client, accountId } = await this.getJwtAuthContext();
      return this.lockEnvelopeSignerDataTabsWithRetry(client, accountId, envelopeId);
    } catch (err) {
      console.warn(`[DocuSign] lockEnvelopeSignerDataTabsAsSystem failed for ${envelopeId}:`, err);
      return 0;
    }
  }

  /**
   * Post-create prefill: map CRM ids → envelope tabIds, update via recipient tabs API only.
   */
  private async applyPrefillToEnvelope(
    _userId: string,
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    templateId: string | undefined,
    prefillFields?: PrefillField[],
  ): Promise<{ applied: number; attempted: number }> {
    const fields = this.sanitizePrefillFieldsForDocuSign(prefillFields);
    if (!fields.length) return { applied: 0, attempted: 0 };

    const recipientsRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = recipientsRes.data?.signers || [];
    if (!signers.length) {
      console.warn(`[DocuSign] prefill skipped: no signers on envelope ${envelopeId}`);
      return { applied: 0, attempted: fields.length };
    }

    let envelopeDocTabs: DocusignTextTabRef[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) await this.sleep(2000);
      envelopeDocTabs = await this.fetchEnvelopeDocumentDataTabs(
        client,
        accountId,
        envelopeId,
      );
      if (envelopeDocTabs.length) break;
    }

    let templateTabs: DocusignTextTabRef[] = [];
    if (templateId) {
      templateTabs = await this.fetchAllTemplateTextTabs(client, accountId, templateId);
    }

    let totalApplied = 0;
    const updatedTabIds = new Set<string>();

    for (const signer of signers) {
      const recipientId = String(signer.recipientId || '');
      if (!recipientId) continue;

      const groupApplied = await this.applyPrefillToRecipientTabGroups(
        client,
        accountId,
        envelopeId,
        recipientId,
        fields,
        updatedTabIds,
      );
      if (groupApplied) {
        totalApplied += groupApplied;
        console.log(
          `[DocuSign] prefill recipient ${recipientId}: ${groupApplied} tab(s) on envelope ${envelopeId}`,
        );
        continue;
      }

      const recipientTabs = await this.fetchEnvelopeSignerDataTabs(
        client,
        accountId,
        envelopeId,
        recipientId,
      );

      let matched = matchPrefillFieldsToTextTabs(fields, recipientTabs);
      if (!matched.length && envelopeDocTabs.length) {
        matched = matchPrefillFieldsToTextTabs(fields, envelopeDocTabs);
      }
      if (!matched.length && templateTabs.length) {
        matched = matchPrefillFieldsToTextTabs(fields, templateTabs);
      }

      const tabIdCatalog =
        recipientTabs.length > 0
          ? recipientTabs
          : envelopeDocTabs.length > 0
            ? envelopeDocTabs
            : templateTabs;
      const tabsForUpdate = mapMatchedTabsToEnvelopeTabIds(matched, tabIdCatalog);
      const pending = tabsForUpdate.filter((t) => !updatedTabIds.has(t.tabId));
      if (!pending.length) continue;

      try {
        const n = await this.putEnvelopeTextTabsInChunks(
          client,
          accountId,
          envelopeId,
          `recipients/${recipientId}/tabs`,
          pending,
        );
        totalApplied += n;
        for (const t of pending) updatedTabIds.add(t.tabId);
        console.log(
          `[DocuSign] prefill recipient ${recipientId} (text fallback): ${n} tab(s) on envelope ${envelopeId}`,
        );
      } catch (recipientErr) {
        this.logDocusignApiError(`recipient ${recipientId} tabs`, recipientErr);
      }
    }

    const docTabsForUpdate = mapMatchedTabsToEnvelopeTabIds(
      matchPrefillFieldsToTextTabs(fields, envelopeDocTabs),
      envelopeDocTabs,
    ).filter((t) => !updatedTabIds.has(t.tabId));

    if (docTabsForUpdate.length) {
      for (const signer of signers) {
        const recipientId = String(signer.recipientId || '');
        if (!recipientId) continue;
        const pending = docTabsForUpdate.filter((t) => !updatedTabIds.has(t.tabId));
        if (!pending.length) break;
        try {
          const n = await this.putEnvelopeTextTabsInChunks(
            client,
            accountId,
            envelopeId,
            `recipients/${recipientId}/tabs`,
            pending,
          );
          totalApplied += n;
          for (const t of pending) updatedTabIds.add(t.tabId);
          console.log(
            `[DocuSign] prefill recipient ${recipientId} (doc tab catalog): ${n} tab(s) on envelope ${envelopeId}`,
          );
        } catch (recipientErr) {
          this.logDocusignApiError(`recipient ${recipientId} doc-tab fallback`, recipientErr);
        }
      }
    }

    if (!totalApplied) {
      const labelSample = collectTabLabels(
        [...envelopeDocTabs, ...templateTabs],
        25,
      );
      console.warn(
        `[DocuSign] prefill: no envelope tabs updated (${fields.length} CRM fields). ` +
          `DocuSign field labels sample: ${labelSample.join(', ') || '(none — set Data Labels on PDF fields)'}`,
      );
    }

    return { applied: totalApplied, attempted: fields.length };
  }

  private buildEnvelopeTextCustomFields(
    applicationId?: string,
    ccEmails?: string[],
  ): Array<{ name: string; value: string; show: string }> {
    const fields: Array<{ name: string; value: string; show: string }> = [];
    const appId = String(applicationId || '').trim();
    if (appId) {
      fields.push({ name: 'crmApplicationId', value: appId, show: 'false' });
    }
    const cc = mergeDefaultContractCcEmails(ccEmails);
    if (cc.length) {
      fields.push({ name: 'crmCcEmails', value: cc.join(','), show: 'false' });
    }
    return fields;
  }

  /** DocuSign signer reminder emails (parity with BoldSign `reminderSettings`). */
  private buildSignerReminderNotification(reminderSettings?: {
    enableAutoReminder?: boolean;
    reminderDays?: number;
    reminderCount?: number;
  }): Record<string, unknown> | undefined {
    if (reminderSettings?.enableAutoReminder === false) return undefined;
    return {
      reminders: {
        reminderEnabled: 'true',
        reminderDelay: String(reminderSettings?.reminderDays ?? 3),
        reminderFrequency: String(reminderSettings?.reminderCount ?? 5),
      },
    };
  }

  private async readEnvelopeTextCustomFields(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<Array<{ name: string; value: string; show: string }>> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/custom_fields`,
      );
      const list =
        res.data?.textCustomFields || res.data?.customFields?.textCustomFields || [];
      return (list as Array<{ name?: string; value?: string; show?: string }>).map((f) => ({
        name: String(f.name || ''),
        value: String(f.value ?? ''),
        show: String(f.show ?? 'false'),
      }));
    } catch {
      return [];
    }
  }

  private async hasCcPrefilledPdfEmailed(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<boolean> {
    const fields = await this.readEnvelopeTextCustomFields(client, accountId, envelopeId);
    return fields.some(
      (f) =>
        f.name === 'crmCcPrefilledEmailed' &&
        String(f.value).trim().toLowerCase() === 'true',
    );
  }

  private async markCcPrefilledPdfEmailed(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<void> {
    const existing = await this.readEnvelopeTextCustomFields(client, accountId, envelopeId);
    const merged = existing.filter((f) => f.name !== 'crmCcPrefilledEmailed');
    merged.push({ name: 'crmCcPrefilledEmailed', value: 'true', show: 'false' });
    try {
      await client.put(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/custom_fields`,
        { textCustomFields: merged },
      );
    } catch (err) {
      this.logDocusignApiError('markCcPrefilledPdfEmailed', err);
    }
  }

  private parseCcEmailsFromWebhookCustomFields(
    customFields: { textCustomFields?: Array<{ name?: string; value?: string }> } | undefined,
  ): string[] {
    const raw = customFields?.textCustomFields?.find?.(
      (f) => f.name === 'crmCcEmails',
    )?.value;
    if (!raw) return [];
    return [...new Set(String(raw).split(',').map((e) => e.trim()).filter(Boolean))];
  }

  private async getEnvelopeCcEmailsFromApi(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string[]> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/custom_fields`,
      );
      const list = res.data?.textCustomFields || res.data?.customFields?.textCustomFields || [];
      const raw = (list as Array<{ name?: string; value?: string }>).find(
        (f) => f.name === 'crmCcEmails',
      )?.value;
      if (!raw) return [];
      return [...new Set(String(raw).split(',').map((e) => e.trim()).filter(Boolean))];
    } catch {
      return [];
    }
  }

  /**
   * DocuSign carbon-copy recipients on template/draft envelopes break Sender View Send
   * (signer never receives email). CRM CC is stored in custom fields and emailed on send.
   */
  private async removeEnvelopeCarbonCopies(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<number> {
    const recRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const existingCc = (recRes.data?.carbonCopies || []) as Array<{
      recipientId?: string;
    }>;
    let removed = 0;
    for (const cc of existingCc) {
      const rid = String(cc.recipientId || '').trim();
      if (!rid) continue;
      try {
        await client.delete(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${rid}`,
        );
        removed++;
      } catch (delErr) {
        this.logDocusignApiError('removeEnvelopeCarbonCopies', delErr);
      }
    }
    if (removed) {
      console.log(`[DocuSign] removed ${removed} carbon copy slot(s) on ${envelopeId}`);
    }
    return removed;
  }

  /** Next unused recipientId (signers + CC) — avoids CC id colliding with signer 2. */
  private nextEnvelopeRecipientId(
    recipients: {
      signers?: Array<{ recipientId?: string }>;
      carbonCopies?: Array<{ recipientId?: string }>;
      certifiedDeliveries?: Array<{ recipientId?: string }>;
    } | null | undefined,
    startAt = 100,
  ): number {
    const used = new Set<number>();
    for (const group of [
      recipients?.signers,
      recipients?.carbonCopies,
      recipients?.certifiedDeliveries,
    ]) {
      for (const row of group || []) {
        const n = parseInt(String(row?.recipientId ?? ''), 10);
        if (Number.isFinite(n)) used.add(n);
      }
    }
    let id = Math.max(startAt, used.size + 1);
    while (used.has(id)) id += 1;
    return id;
  }

  /**
   * Attach CRM CC emails as DocuSign carbon copies after prefill (BoldSign parity).
   * Each CC is granted visibility on every content document so they do not receive an empty envelope.
   */
  private async syncEnvelopeCarbonCopies(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    ccEmails?: string[],
    signerEmails: string[] = [],
  ): Promise<number> {
    await this.removeEnvelopeCarbonCopies(client, accountId, envelopeId);

    const list = mergeDefaultContractCcEmails(ccEmails).filter(
      (email) =>
        !signerEmails
          .map((s) => String(s).trim().toLowerCase())
          .filter(Boolean)
          .includes(email.toLowerCase()),
    );
    if (!list.length) return 0;

    const recRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = (recRes.data?.signers || []) as Array<{ routingOrder?: string }>;
    const maxSignerRouting = signers.reduce((max, s) => {
      const n = parseInt(String(s.routingOrder || '1'), 10);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, Math.max(1, signers.length));
    const routingOrder = String(maxSignerRouting + 1);

    let contentDocIds: string[] = [];
    try {
      const docsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents`,
      );
      contentDocIds = this.filterEnvelopeContentDocuments(
        docsRes.data?.envelopeDocuments || docsRes.data?.documents || [],
      )
        .map((d) => String(d.documentId ?? '').trim())
        .filter(Boolean);
    } catch (err) {
      console.warn('[DocuSign] syncEnvelopeCarbonCopies documents list failed:', err);
    }

    let nextRecipientId = this.nextEnvelopeRecipientId(recRes.data);
    const carbonCopies = list.map((email) => {
      const recipientId = String(nextRecipientId++);
      const row: Record<string, unknown> = {
        email,
        name: email.split('@')[0],
        recipientId,
        routingOrder,
      };
      if (contentDocIds.length) {
        row.documentVisibility = contentDocIds.map((documentId) => ({
          recipientId,
          documentId,
          visible: 'true',
        }));
      }
      return row;
    });

    try {
      await client.put(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
        { carbonCopies },
      );
      console.log(
        `[DocuSign] synced ${carbonCopies.length} carbon copy recipient(s) on ${envelopeId}`,
      );
      return carbonCopies.length;
    } catch (err) {
      this.logDocusignApiError('syncEnvelopeCarbonCopies', err);
      return 0;
    }
  }

  /**
   * DocuSign copies every signer role from the template into the envelope.
   * When CRM sends one signer (e.g. Signer), remove extra signer slots on the draft.
   */
  private async pruneEnvelopeSignersToCrmRoles(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    roles: SignerRoleInput[],
  ): Promise<number> {
    if (!DOCUSIGN_SINGLE_SIGNER_ONLY) return 0;

    const normalized = this.normalizeSignerRoles(roles);
    if (!normalized.length) return 0;
    /** CRM explicitly configured multiple signers — keep every template slot that will be filled. */
    if (normalized.length > 1) return 0;

    const recRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = (recRes.data?.signers || []) as Array<{
      recipientId?: string;
      roleName?: string;
    }>;
    if (signers.length <= normalized.length) return 0;

    const allowedRoles = new Set(
      normalized.map((r) => r.roleName.toLowerCase()).filter(Boolean),
    );

    let removed = 0;
    if (normalized.length === 1) {
      const preferredRole = normalized[0]!.roleName.toLowerCase();
      let keepIndex = signers.findIndex(
        (s) => String(s.roleName || '').trim().toLowerCase() === preferredRole,
      );
      if (keepIndex < 0) keepIndex = 0;

      for (let i = 0; i < signers.length; i++) {
        if (i === keepIndex) continue;
        const rid = String(signers[i]?.recipientId || '').trim();
        if (!rid) continue;
        try {
          await client.delete(
            `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${rid}`,
          );
          removed++;
        } catch (delErr) {
          this.logDocusignApiError('pruneEnvelopeSignersToCrmRoles', delErr);
        }
      }
    } else {
      for (const signer of signers) {
        const rid = String(signer.recipientId || '').trim();
        if (!rid) continue;
        const roleKey = String(signer.roleName || '').trim().toLowerCase();
        if (allowedRoles.has(roleKey)) continue;
        try {
          await client.delete(
            `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${rid}`,
          );
          removed++;
        } catch (delErr) {
          this.logDocusignApiError('pruneEnvelopeSignersToCrmRoles', delErr);
        }
      }
    }

    if (removed) {
      console.log(
        `[DocuSign] removed ${removed} extra signer slot(s) on ${envelopeId} (CRM single-signer send)`,
      );
    }
    return removed;
  }

  private async getTemplateIdFromEnvelope(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string | null> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/templates`,
      );
      const rows = res.data?.envelopeTemplates || res.data?.templates || [];
      const tid = String(
        (rows as Array<{ templateId?: string }>)?.[0]?.templateId ?? '',
      ).trim();
      return tid || null;
    } catch {
      return null;
    }
  }

  private async getTemplateSignerDefaults(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
  ): Promise<
    Array<{ roleName: string; email: string; name: string; routingOrder: string }>
  > {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/templates/${templateId}/recipients`,
      );
      return (res.data?.signers || []).map(
        (s: {
          roleName?: string;
          email?: string;
          name?: string;
          routingOrder?: string;
        },
        idx: number,
      ) => ({
        roleName: String(s.roleName || DOCUSIGN_DEFAULT_ROLE_NAME).trim(),
        email: String(s.email || '').trim(),
        name: String(s.name || '').trim(),
        routingOrder: String(s.routingOrder || idx + 1),
      }));
    } catch {
      return [];
    }
  }

  private async buildCrmRolesForEnvelope(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
    applicationId?: string,
  ): Promise<SignerRoleInput[]> {
    const fromTemplate = await this.getTemplateSignerDefaults(
      client,
      accountId,
      templateId,
    );
    const resolved = await this.resolveSignerEmailForApplication(applicationId);
    const clientEmail = resolved?.email || '';
    const clientName = resolved?.name || clientEmail.split('@')[0] || 'Signer';

    if (!fromTemplate.length) {
      if (!clientEmail) return [];
      return [
        {
          signerEmail: clientEmail,
          signerName: clientName,
          roleName: DOCUSIGN_DEFAULT_ROLE_NAME,
          signerRole: DOCUSIGN_DEFAULT_ROLE_NAME,
          signerOrder: 1,
        },
      ];
    }

    return fromTemplate
      .map((row, idx) => {
        const email = row.email || (idx === 0 ? clientEmail : '');
        const name = row.name || (idx === 0 ? clientName : `Signer ${idx + 1}`);
        return {
          signerEmail: email,
          signerName: name,
          roleName: row.roleName,
          signerRole: row.roleName,
          signerOrder: parseInt(row.routingOrder, 10) || idx + 1,
        };
      })
      .filter((r) => String(r.signerEmail || '').trim());
  }

  /**
   * Update envelope signers via PUT /recipients (bulk).
   * Per-recipient PUT .../recipients/{id} returns INVALID_API_VERSION on current DocuSign REST.
   */
  private async updateEnvelopeSignersBulk(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    signerUpdates: Array<{
      recipientId: string;
      email: string;
      name: string;
      roleName?: string;
      routingOrder?: string;
    }>,
  ): Promise<void> {
    if (!signerUpdates.length) return;
    await client.put(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
      {
        signers: signerUpdates.map((s) => ({
          recipientId: s.recipientId,
          email: s.email,
          name: s.name,
          roleName: s.roleName,
          routingOrder: s.routingOrder,
        })),
      },
    );
  }

  /**
   * When CRM has more signers than the draft envelope, add missing slots via POST /recipients.
   */
  private async addMissingCrmSignersToEnvelope(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    roles: SignerRoleInput[],
    templateId?: string | null,
  ): Promise<number> {
    const normalized = this.normalizeSignerRoles(roles);
    if (!normalized.length) return 0;

    const recRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const existingSigners = (recRes.data?.signers || []) as Array<{
      recipientId?: string;
    }>;
    if (existingSigners.length >= normalized.length) return 0;

    const tid =
      String(templateId || '').trim() ||
      (await this.getTemplateIdFromEnvelope(client, accountId, envelopeId));
    const templateRoleNames = tid
      ? await this.getTemplateSignerRoleNames(client, accountId, tid)
      : [];

    const maxRecipientId = existingSigners.reduce((max, s) => {
      const n = parseInt(String(s.recipientId || ''), 10);
      return Number.isFinite(n) ? Math.max(max, n) : max;
    }, 0);

    const toAdd: Array<{
      email: string;
      name: string;
      roleName: string;
      recipientId: string;
      routingOrder: string;
    }> = [];

    for (let i = existingSigners.length; i < normalized.length; i++) {
      const crm = normalized[i]!;
      const roleName = String(
        templateRoleNames[i] || templateRoleNames[0] || crm.roleName || DOCUSIGN_DEFAULT_ROLE_NAME,
      ).trim();
      toAdd.push({
        email: crm.email,
        name: crm.name || crm.email.split('@')[0],
        roleName,
        recipientId: String(maxRecipientId + toAdd.length + 1),
        routingOrder: crm.routingOrder || String(i + 1),
      });
    }

    if (!toAdd.length) return 0;

    await client.post(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
      { signers: toAdd },
    );
    console.log(
      `[DocuSign] added ${toAdd.length} signer slot(s) on ${envelopeId}: ${toAdd.map((s) => s.roleName).join(', ')}`,
    );
    return toAdd.length;
  }

  /**
   * Apply CRM signer emails onto the draft envelope (bulk PUT /recipients — does not wipe other recipients).
   */
  private async applyCrmRolesToEnvelopeSigners(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    roles: SignerRoleInput[],
    templateId?: string | null,
  ): Promise<{ updated: number; missingRoles: string[] }> {
    const normalized = this.normalizeSignerRoles(roles);
    if (!normalized.length) {
      return { updated: 0, missingRoles: [] };
    }

    await this.addMissingCrmSignersToEnvelope(
      client,
      accountId,
      envelopeId,
      roles,
      templateId,
    );

    const recRes = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = (recRes.data?.signers || []) as Array<{
      recipientId?: string;
      roleName?: string;
      email?: string;
      name?: string;
      routingOrder?: string;
    }>;

    if (!signers.length) {
      throw new BadRequestException(
        'DocuSign envelope has no signer slots. Create a new draft from the contract modal.',
      );
    }

    if (normalized.length > signers.length) {
      throw new BadRequestException(
        `This DocuSign draft has ${signers.length} signer slot(s) but CRM now has ${normalized.length}. ` +
          'Click Review & send again to create a new draft with all signers (e.g. Owner 2).',
      );
    }

    const tid =
      String(templateId || '').trim() ||
      (await this.getTemplateIdFromEnvelope(client, accountId, envelopeId));
    const templateRoleNames = tid
      ? await this.getTemplateSignerRoleNames(client, accountId, tid)
      : [];

    const missingRoles: string[] = [];
    const bulkUpdates: Array<{
      recipientId: string;
      email: string;
      name: string;
      roleName?: string;
      routingOrder?: string;
    }> = [];

    for (let i = 0; i < signers.length; i++) {
      const signer = signers[i];
      const roleKey = String(signer.roleName || '').trim().toLowerCase();
      const match =
        normalized.find((n) => n.roleName.toLowerCase() === roleKey) ||
        normalized[i] ||
        null;
      const email = String(match?.email || '').trim();
      const rid = String(signer.recipientId || '').trim();
      if (!rid) continue;

      if (!email) {
        missingRoles.push(
          String(
            templateRoleNames[i] || signer.roleName || match?.roleName || `Signer ${i + 1}`,
          ),
        );
        continue;
      }

      const currentEmail = String(signer.email || '').trim().toLowerCase();
      const currentName = String(signer.name || '').trim();
      const nextName = match.name || email.split('@')[0];
      const emailChanged = currentEmail !== email.toLowerCase();
      const nameChanged = currentName !== nextName;
      if (!emailChanged && !nameChanged) continue;

      bulkUpdates.push({
        recipientId: rid,
        email,
        name: nextName,
        roleName: signer.roleName,
        routingOrder: signer.routingOrder || String(i + 1),
      });
    }

    if (bulkUpdates.length) {
      await this.updateEnvelopeSignersBulk(client, accountId, envelopeId, bulkUpdates);
      for (const u of bulkUpdates) {
        console.log(
          `[DocuSign] signer ${u.roleName || 'Signer'} on ${envelopeId} → ${u.email}`,
        );
      }
    }

    return { updated: bulkUpdates.length, missingRoles };
  }

  /**
   * Ensures the primary template signer has the CRM client email before send (drafts may keep template placeholders).
   */
  private async ensurePrimarySignerOnEnvelope(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    signerEmail: string,
    signerName?: string,
  ) {
    const email = String(signerEmail || '').trim();
    if (!email) return;
    try {
      const recRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
      );
      const signers = (recRes.data?.signers || []) as Array<{
        recipientId?: string;
        email?: string;
        name?: string;
        roleName?: string;
        routingOrder?: string;
      }>;
      if (!signers.length) {
        console.warn(
          `[DocuSign] ensurePrimarySigner skipped: no signers on envelope ${envelopeId}`,
        );
        return;
      }
      const primary =
        signers.find((s) => String(s.routingOrder || '') === '1') || signers[0];
      const rid = String(primary.recipientId || '').trim();
      if (!rid) return;
      const current = String(primary.email || '').trim().toLowerCase();
      if (current === email.toLowerCase()) return;

      await this.updateEnvelopeSignersBulk(client, accountId, envelopeId, [
        {
          recipientId: rid,
          email,
          name:
            String(signerName || primary.name || email.split('@')[0]).trim() ||
            email.split('@')[0],
          roleName: primary.roleName,
          routingOrder: primary.routingOrder || '1',
        },
      ]);
      console.log(
        `[DocuSign] primary signer on ${envelopeId} set to ${email} (was ${current || 'empty'})`,
      );
    } catch (err) {
      this.logDocusignApiError('ensurePrimarySignerOnEnvelope', err);
    }
  }

  private async resolveSignerEmailForApplication(
    applicationId?: string,
  ): Promise<{ email: string; name: string } | null> {
    const appId = String(applicationId || '').trim();
    if (!appId) return null;
    const contract = await prisma.contract.findFirst({
      where: { applicationId: appId },
      select: { clientEmail: true },
    });
    let email = String(contract?.clientEmail || '').trim();
    let name = email ? email.split('@')[0] : '';

    if (!email) {
      const app = await prisma.application.findUnique({
        where: { id: appId },
        select: {
          client: {
            select: {
              businessEmail: true,
              ownerEmail: true,
              ownerFirstName: true,
              ownerLastName: true,
            },
          },
        },
      });
      const c = app?.client;
      email = String(c?.businessEmail || c?.ownerEmail || '').trim();
      const full = `${c?.ownerFirstName || ''} ${c?.ownerLastName || ''}`.trim();
      name = full || (email ? email.split('@')[0] : '');
    }

    if (!email) return null;
    return { email, name: name || email.split('@')[0] };
  }

  /**
   * Sync signer emails + CRM CC list before Sender View or send.
   * CC are added as DocuSign carbon copies (after prefill) with document visibility, and also
   * stored in crmCcEmails for a CRM prefilled-PDF email when the envelope is sent.
   */
  async syncEnvelopeCcEmails(
    userId: string,
    envelopeId: string,
    ccEmails: string[],
    applicationId?: string,
    signerEmail?: string,
    signerName?: string,
    roles?: SignerRoleInput[],
  ) {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      throw new BadRequestException('envelopeId is required');
    }
    const { client, accountId } = await this.getAuthContext(userId);

    await this.assertEnvelopeDraftOrThrow(client, accountId, eid);

    const templateIdFromEnvelope = await this.getTemplateIdFromEnvelope(
      client,
      accountId,
      eid,
    );

    let rolesToApply: SignerRoleInput[] = Array.isArray(roles) ? roles : [];
    if (!rolesToApply.length) {
      const templateId =
        templateIdFromEnvelope || DOCUSIGN_DEFAULT_TEMPLATE_ID;
      if (templateId) {
        rolesToApply = await this.buildCrmRolesForEnvelope(
          client,
          accountId,
          templateId,
          applicationId,
        );
      }
    }

    const primaryEmail = String(signerEmail || '').trim();
    if (primaryEmail && rolesToApply.length) {
      const first = rolesToApply[0] as SignerRoleInput;
      rolesToApply[0] = {
        ...first,
        signerEmail: primaryEmail,
        signerName: String(signerName || first.signerName || '').trim() || undefined,
      };
    } else if (primaryEmail && !rolesToApply.length) {
      rolesToApply = [
        {
          signerEmail: primaryEmail,
          signerName: signerName || primaryEmail.split('@')[0],
          roleName: DOCUSIGN_DEFAULT_ROLE_NAME,
          signerRole: DOCUSIGN_DEFAULT_ROLE_NAME,
          signerOrder: 1,
        },
      ];
    }

    let { updated, missingRoles } = await this.applyCrmRolesToEnvelopeSigners(
      client,
      accountId,
      eid,
      rolesToApply,
      templateIdFromEnvelope,
    );

    const list = mergeDefaultContractCcEmails(ccEmails);

    const recAfter = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${eid}/recipients`,
    );
    const signersAfter = ((recAfter.data?.signers || []) as Array<{ email?: string }>).filter(
      (s) => String(s.email || '').trim(),
    );
    if (!signersAfter.length) {
      throw new BadRequestException(
        'DocuSign envelope has no signers with email after sync. Create a new draft.',
      );
    }
    if (missingRoles.length) {
      throw new BadRequestException(
        `DocuSign template requires email for signer role(s): ${missingRoles.join(', ')}. ` +
          'Set default signer emails on the template in DocuSign Admin, or add them in CRM.',
      );
    }
    const textCustomFields = this.buildEnvelopeTextCustomFields(applicationId, list);
    if (!textCustomFields.some((f) => f.name === 'crmCcEmails')) {
      textCustomFields.push({ name: 'crmCcEmails', value: list.join(','), show: 'false' });
    }
    if (textCustomFields.length) {
      try {
        await client.put(
          `/v2.1/accounts/${accountId}/envelopes/${eid}/custom_fields`,
          { textCustomFields },
        );
      } catch (err) {
        this.logDocusignApiError('syncEnvelopeCcEmails custom_fields', err);
      }
    }

    const signerEmailList = signersAfter
      .map((s) => String(s.email || '').trim())
      .filter(Boolean);
    const ccSynced = await this.syncEnvelopeCarbonCopies(
      client,
      accountId,
      eid,
      list,
      signerEmailList,
    );

    const envelopeSigners = ((recAfter.data?.signers || []) as Array<{
      roleName?: string;
      email?: string;
      name?: string;
    }>).map((s) => ({
      roleName: s.roleName,
      email: s.email,
      name: s.name,
    }));
    return {
      envelopeId: eid,
      ccCount: list.length,
      ccSynced,
      signersUpdated: updated,
      envelopeSigners,
      /** DocuSign carbon copies + CRM prefilled PDF email when envelope is sent. */
      ccDelivery: 'docusign_carbon_copy_and_crm_email_on_sent',
      crmCcEmails: list,
    };
  }

  private normalizeSignerRoles(roles: SignerRoleInput[]): Array<{
    roleName: string;
    name: string;
    email: string;
    routingOrder: string;
  }> {
    const defaultRole = DOCUSIGN_DEFAULT_ROLE_NAME;
    return roles
      .map((r, idx) => {
        const rawRole = String(r.roleName || r.signerRole || defaultRole || `Signer ${idx + 1}`).trim();
        const roleLower = rawRole.toLowerCase();
        const roleName =
          !rawRole ||
          roleLower === defaultRole.toLowerCase() ||
          /^(receiver|client|merchant|customer|owner|guarantor|signer)/i.test(rawRole)
            ? defaultRole
            : rawRole;
        return {
          roleName,
          name: String(r.signerName || '').trim(),
          email: String(r.signerEmail || '').trim(),
          routingOrder: String(r.signerOrder ?? idx + 1),
        };
      })
      .filter((r) => r.email);
  }

  /**
   * Map a CRM signer role to the template role name (always prefers Signer over legacy Receiver).
   */
  private resolveTemplateRoleNameForSigner(
    crmRoleName: string,
    templateRoleNames: string[],
    idx: number,
  ): string {
    const defaultRole = DOCUSIGN_DEFAULT_ROLE_NAME;
    const crm = String(crmRoleName || '').trim();
    const crmLower = crm.toLowerCase();

    const signerTemplateRole = templateRoleNames.find(
      (r) => String(r).trim().toLowerCase() === defaultRole.toLowerCase(),
    );

    const crmIsDocuSignSigner =
      !crm ||
      crmLower === defaultRole.toLowerCase() ||
      /^(receiver|client|merchant|customer|owner|guarantor|signer)/i.test(crm);

    if (crmIsDocuSignSigner) {
      if (signerTemplateRole) return String(signerTemplateRole).trim();
      const nonReceiver = templateRoleNames.find(
        (r) => String(r).trim().toLowerCase() !== 'receiver',
      );
      if (nonReceiver) return String(nonReceiver).trim();
      return defaultRole;
    }

    if (crm) {
      const match = templateRoleNames.find(
        (r) => String(r).trim().toLowerCase() === crmLower,
      );
      if (match) return String(match).trim();
    }

    if (signerTemplateRole && idx === 0) return String(signerTemplateRole).trim();

    return String(
      templateRoleNames[idx] ||
        signerTemplateRole ||
        templateRoleNames[0] ||
        crm ||
        defaultRole,
    ).trim();
  }

  private async fetchTemplateLockableTabGroupsForRole(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
    roleName: string,
  ): Promise<Record<string, Record<string, unknown>[]>> {
    const merged = new Map<string, Map<string, Record<string, unknown>>>();

    const addGroupTabs = (data: Record<string, unknown>) => {
      for (const [group, tabs] of this.collectSignerDataTabGroups(data)) {
        if (!merged.has(group)) merged.set(group, new Map());
        const byLabel = merged.get(group)!;
        for (const tab of tabs) {
          const label = String(tab.tabLabel || tab.name || tab.tabId || '').trim();
          if (!label || byLabel.has(label)) continue;
          byLabel.set(label, tab);
        }
      }
    };

    let roleRecipientId = '';
    try {
      const recRes = await client.get(
        `/v2.1/accounts/${accountId}/templates/${templateId}/recipients`,
      );
      const signers = recRes.data?.signers || [];
      const roleLower = roleName.trim().toLowerCase();
      const signer =
        signers.find(
          (s: { roleName?: string }) =>
            String(s.roleName || '').trim().toLowerCase() === roleLower,
        ) || signers[0];
      roleRecipientId = String(signer?.recipientId || '').trim();
      if (roleRecipientId) {
        const tabsRes = await client.get(
          `/v2.1/accounts/${accountId}/templates/${templateId}/recipients/${roleRecipientId}/tabs`,
        );
        addGroupTabs((tabsRes.data || {}) as Record<string, unknown>);
      }
    } catch (err) {
      console.warn('[DocuSign] fetchTemplateLockableTabGroupsForRole (recipient) failed:', err);
    }

    try {
      const docsRes = await client.get(
        `/v2.1/accounts/${accountId}/templates/${templateId}/documents`,
      );
      const docs =
        docsRes.data?.templateDocuments || docsRes.data?.documents || [];
      for (const doc of docs.length ? docs : [{ documentId: '1' }]) {
        const docId = String(doc?.documentId ?? '1');
        try {
          const tabsRes = await client.get(
            `/v2.1/accounts/${accountId}/templates/${templateId}/documents/${docId}/tabs`,
          );
          const raw = (tabsRes.data || {}) as Record<string, unknown>;
          if (!roleRecipientId) {
            addGroupTabs(raw);
            continue;
          }
          const filtered: Record<string, unknown> = {};
          for (const [group, tabs] of Object.entries(raw)) {
            if (!this.isSignerDataTabGroup(group) || !Array.isArray(tabs)) continue;
            const roleTabs = (tabs as Record<string, unknown>[]).filter(
              (t) => String(t.recipientId || '').trim() === roleRecipientId,
            );
            if (roleTabs.length) filtered[group] = roleTabs;
          }
          addGroupTabs(filtered);
        } catch (docErr) {
          console.warn(
            `[DocuSign] fetchTemplateLockableTabGroupsForRole document ${docId} failed:`,
            docErr,
          );
        }
      }
    } catch (err) {
      console.warn('[DocuSign] fetchTemplateLockableTabGroupsForRole (documents) failed:', err);
    }

    const out: Record<string, Record<string, unknown>[]> = {};
    for (const [group, byLabel] of merged) {
      out[group] = [...byLabel.values()];
    }
    return out;
  }

  private buildCreateTimeLockedTabsPayload(
    tabGroups: Record<string, Record<string, unknown>[]>,
    prefillFields: PrefillField[],
  ): Record<string, Array<Record<string, string>>> {
    const valueMap = buildPrefillValueMap(this.sanitizePrefillFieldsForDocuSign(prefillFields));
    const payload: Record<string, Array<Record<string, string>>> = {};

    for (const [group, tabs] of Object.entries(tabGroups)) {
      const valueKey = tabGroupPrefillProperty(group);
      const rows: Array<Record<string, string>> = [];
      for (const tab of tabs) {
        const tabLabel = String(tab.tabLabel || tab.name || '').trim();
        if (!tabLabel) continue;

        const row: Record<string, string> = {
          tabLabel,
          shared: 'true',
        };

        const prefill = resolvePrefillForTab(valueMap, tab as DocusignTextTabRef);
        if (prefill) {
          row[valueKey] = prefill;
        } else {
          for (const key of DocusignService.TAB_VALUE_PRESERVE_KEYS) {
            const v = tab[key];
            if (v === undefined || v === null || String(v).trim() === '') continue;
            const outKey = key === 'numberValue' ? valueKey : key;
            row[outKey] = String(v);
          }
        }
        rows.push(
          applyDocuSignPrefillTabStyle(row, { height: tab.height as string | number | undefined }),
        );
      }
      if (rows.length) payload[group] = rows;
    }

    return payload;
  }

  private async buildCreateTimeLockedTabsForTemplate(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
    roleName: string,
    prefillFields: PrefillField[],
  ): Promise<Record<string, Array<Record<string, string>>>> {
    const templateTabGroups = await this.fetchTemplateLockableTabGroupsForRole(
      client,
      accountId,
      templateId,
      roleName,
    );
    return this.buildCreateTimeLockedTabsPayload(templateTabGroups, prefillFields);
  }

  private async buildTemplateRolesForSend(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
    roles: SignerRoleInput[],
    textTabs: Array<{ tabLabel: string; value: string; tabId?: string }>,
    preloadedRoleNames?: string[],
    prefillFields?: PrefillField[],
  ) {
    const signers = this.normalizeSignerRoles(roles);
    if (!signers.length) {
      throw new BadRequestException('At least one signer with a valid email is required.');
    }

    const templateRoleNames =
      preloadedRoleNames?.length ?
        preloadedRoleNames
      : await this.getTemplateSignerRoleNames(client, accountId, templateId);

    const primaryRoleName = this.resolveTemplateRoleNameForSigner(
      signers[0]?.roleName || DOCUSIGN_DEFAULT_ROLE_NAME,
      templateRoleNames,
      0,
    );

    let createTimeLockedTabs: Record<string, Array<Record<string, string>>> = {};
    if (templateId && prefillFields?.length) {
      createTimeLockedTabs = await this.buildCreateTimeLockedTabsForTemplate(
        client,
        accountId,
        templateId,
        primaryRoleName,
        prefillFields,
      );
      const tabCount = Object.values(createTimeLockedTabs).reduce((n, g) => n + g.length, 0);
      if (tabCount) {
        console.log(
          `[DocuSign] create-time lock: ${tabCount} template tab(s) for role ${primaryRoleName}`,
        );
      }
    }

    return signers.map((s, idx) => {
      const roleName = this.resolveTemplateRoleNameForSigner(
        s.roleName,
        templateRoleNames,
        idx,
      );
      const isPrimaryPrefillSigner =
        roleName.toLowerCase() === primaryRoleName.toLowerCase();

      let tabs: Record<string, Array<Record<string, string>>> | undefined;
      if (isPrimaryPrefillSigner) {
        if (Object.keys(createTimeLockedTabs).length) {
          tabs = createTimeLockedTabs;
        } else if (textTabs.length) {
          tabs = {
            textTabs: textTabs.map((t) =>
              applyDocuSignPrefillTabStyle({
                ...(t.tabId
                  ? { tabId: t.tabId, tabLabel: t.tabLabel, value: t.value }
                  : { tabLabel: t.tabLabel, value: t.value }),
                shared: 'true',
              }),
            ),
          };
        }
      }

      return {
        roleName: String(roleName).trim(),
        name: s.name || s.email.split('@')[0],
        email: s.email,
        tabs,
      };
    });
  }

  private buildCarbonCopies(ccEmails?: string[]) {
    return this.buildCarbonCopiesForEnvelopeCreate(ccEmails, 1);
  }

  /** Legacy helper for template recipient updates in DocuSign Admin (not envelope create). */
  private buildCarbonCopiesForEnvelopeCreate(
    ccEmails?: string[],
    signerCount = 1,
    signerEmails: string[] = [],
  ): Array<{ email: string; name: string; recipientId: string; routingOrder: string }> {
    const signerSet = new Set(
      signerEmails.map((e) => String(e).trim().toLowerCase()).filter(Boolean),
    );
    const desired = [
      ...new Set((ccEmails || []).map((e) => String(e).trim()).filter(Boolean)),
    ].filter((e) => !signerSet.has(e.toLowerCase()));
    if (!desired.length) return [];

    const routing = String(Math.max(1, signerCount) + 1);
    let nextRecipientId = Math.max(100, signerCount + 1);
    return desired.map((email) => ({
      email,
      name: email.split('@')[0],
      recipientId: String(nextRecipientId++),
      routingOrder: routing,
    }));
  }

  private async linkEnvelopeToApplication(
    userId: string,
    applicationId: string,
    envelopeId: string,
  ) {
    if (!userId?.trim()) {
      throw new BadRequestException(
        'Cannot link DocuSign envelope: authenticated user id is missing.',
      );
    }
    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { userId: true },
    });
    if (!userRecord?.userId) {
      throw new BadRequestException(
        'Cannot link DocuSign envelope: CRM user record not found for this session.',
      );
    }

    const newEnvelopeId = String(envelopeId).trim();
    const existingDoc = await prisma.document.findUnique({
      where: { applicationId },
      select: {
        envelopeId: true,
        status: true,
        sentAt: true,
        completedAt: true,
      },
    });
    const priorEnvelopeId = String(existingDoc?.envelopeId ?? '').trim();
    if (priorEnvelopeId && priorEnvelopeId !== newEnvelopeId) {
      const priorIsAch = await contractHasAchAuthorizationEnvelope(priorEnvelopeId);
      if (!priorIsAch) {
        await archiveMainContractEnvelopeToHistory(applicationId, {
          envelopeId: priorEnvelopeId,
          status: String(existingDoc?.status ?? 'draft'),
          sentAt: existingDoc?.sentAt,
          completedAt: existingDoc?.completedAt,
        });
      }
    }

    await clearAchAuthorizationIfMatchesMainContract(applicationId, newEnvelopeId);

    await prisma.document.upsert({
      where: { applicationId },
      create: {
        applicationId,
        envelopeId: newEnvelopeId,
        status: 'draft',
        userId: userRecord.userId,
      },
      update: {
        envelopeId: newEnvelopeId,
        status: 'draft',
        sentAt: null,
        completedAt: null,
      },
    });
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Per-envelope Connect config so lifecycle events fire even when account Connect
   * only subscribes to Sent (common misconfiguration).
   */
  private buildEnvelopeConnectNotification(): Record<string, unknown> | null {
    const url = resolveDocusignWebhookUrl();
    if (!url) {
      console.warn(
        '[DocuSign] DOCUSIGN_WEBHOOK_URL not set — envelope will not register Connect callbacks. ' +
          'Set DOCUSIGN_WEBHOOK_URL or CRM_API_URL (…/api/v1/uploads) in .env.',
      );
      return null;
    }

    const notification: Record<string, unknown> = {
      url,
      loggingEnabled: 'true',
      requireAcknowledgment: 'true',
      includeDocuments: 'false',
      eventData: {
        version: 'restv2.1',
        format: 'json',
        includeData: ['recipients', 'custom_fields'],
      },
      envelopeEvents: [
        { envelopeEventStatusCode: 'Sent', includeDocuments: 'false' },
        { envelopeEventStatusCode: 'Delivered', includeDocuments: 'false' },
        { envelopeEventStatusCode: 'Completed', includeDocuments: 'false' },
        { envelopeEventStatusCode: 'Declined', includeDocuments: 'false' },
        { envelopeEventStatusCode: 'Voided', includeDocuments: 'false' },
      ],
      recipientEvents: [
        { recipientEventStatusCode: 'Sent', includeDocuments: 'false' },
        { recipientEventStatusCode: 'Delivered', includeDocuments: 'false' },
        { recipientEventStatusCode: 'Completed', includeDocuments: 'false' },
        { recipientEventStatusCode: 'Declined', includeDocuments: 'false' },
      ],
    };

    if (DOCUSIGN_WEBHOOK_BASIC_USER && DOCUSIGN_WEBHOOK_BASIC_PASSWORD) {
      (notification as any).authenticationType = 'basic';
      (notification as any).userName = DOCUSIGN_WEBHOOK_BASIC_USER;
      (notification as any).password = DOCUSIGN_WEBHOOK_BASIC_PASSWORD;
    }

    return notification;
  }

  private async applySigningStatusUpdate(
    envelopeId: string,
    incomingResolved: string,
    applicationId: string | null,
    existingDoc?: {
      status?: string | null;
      sentAt?: Date | null;
      applicationId?: string;
      originalName?: string | null;
      title?: string | null;
    } | null,
    achHints?: { contractId?: number },
  ) {
    const achLookup = {
      applicationId: applicationId ?? undefined,
      contractId: achHints?.contractId,
    };

    if (await updateAchAuthorizationDocuSignStatus(envelopeId, incomingResolved, achLookup)) {
      return incomingResolved;
    }

    if (
      await updateStandalonePackageDocuSignStatus(envelopeId, incomingResolved, achLookup)
    ) {
      return incomingResolved;
    }

    if (
      !existingDoc &&
      achHints?.contractId &&
      applicationId &&
      (await isStandaloneAchEnvelope(envelopeId, achLookup)) === false
    ) {
      const mainDoc = await prisma.document.findUnique({
        where: { applicationId: String(applicationId) },
        select: { envelopeId: true },
      });
      const mainEid = String(mainDoc?.envelopeId ?? '').trim();
      if (!mainEid || mainEid !== String(envelopeId)) {
        await linkAchAuthorizationEnvelopeToContract(
          String(applicationId),
          envelopeId,
          incomingResolved,
          achHints.contractId,
        );
        if (await updateAchAuthorizationDocuSignStatus(envelopeId, incomingResolved, achLookup)) {
          return incomingResolved;
        }
      }
    }

    if (await isStandaloneAchEnvelope(envelopeId, achLookup)) {
      await updateAchAuthorizationDocuSignStatus(envelopeId, incomingResolved, achLookup);
      return incomingResolved;
    }

    if (await isStandalonePackageEnvelope(envelopeId, achLookup)) {
      await updateStandalonePackageDocuSignStatus(envelopeId, incomingResolved, achLookup);
      return incomingResolved;
    }

    const priorStatus = existingDoc?.status
      ? String(existingDoc.status).trim().toLowerCase()
      : null;
    const status = mergeWithExistingEnvelopeStatus(existingDoc?.status, incomingResolved);
    if (!status) return status;

    const updateData: Record<string, unknown> = { status };
    if (status === 'sent') {
      updateData.sentAt = existingDoc?.sentAt ?? new Date();
    } else if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    const updateResult = await prisma.document.updateMany({
      where: { envelopeId: String(envelopeId) },
      data: updateData as any,
    });
    if (updateResult.count === 0) {
      const appIdForHistory = applicationId || existingDoc?.applicationId || null;
      if (appIdForHistory) {
        const historyUpdated = await updateArchivedContractSendHistoryStatus(
          String(appIdForHistory),
          String(envelopeId),
          status,
          {
            sentAt:
              status === 'sent' && updateData.sentAt
                ? new Date(updateData.sentAt as Date).toISOString()
                : undefined,
            completedAt:
              status === 'completed' && updateData.completedAt
                ? new Date(updateData.completedAt as Date).toISOString()
                : undefined,
          },
        );
        if (historyUpdated) {
          return status;
        }
      }
      console.warn('[DocuSign] webhook: no Document row updated for envelope', {
        envelopeId,
        incoming: incomingResolved,
        applicationId: applicationId || existingDoc?.applicationId,
      });
    }

    const appId = applicationId || existingDoc?.applicationId || null;
    if (appId) {
      await this.syncContractSigningStatus(String(appId), status);
      if (priorStatus !== status) {
        const documentName =
          String(existingDoc?.originalName || existingDoc?.title || '').trim() || 'Contract.pdf';
        void handleContractSigningStatusTransition({
          applicationId: String(appId),
          priorStatus,
          newStatus: status,
          envelopeId: String(envelopeId),
          documentName,
          provider: 'docusign',
        }).catch((err) => {
          console.warn('[DocuSign] contract signing status side-effects failed:', err);
        });
      }
    }
    return status;
  }

  private async syncContractSigningStatus(applicationId: string, internalStatus: string) {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    const contractStatus = internalEnvelopeStatusToContractStatusDbValue(internalStatus);
    if (!contractStatus) return;
    await prisma.contract.updateMany({
      where: { applicationId: appId },
      data: { status: contractStatus as any },
    });
    await this.syncApplicationWorkflowOnContractSigning(appId, internalStatus);
  }

  /** Draft envelope ready in DocuSign (review before send) — not yet Contract Out. */
  private async syncApplicationWorkflowOnDraftCreated(applicationId: string) {
    const appId = String(applicationId || '').trim();
    if (!appId) return;

    const normalizeQueueKey = (queue: string | null | undefined) =>
      String(queue ?? '')
        .trim()
        .replace(/[\s_-]+/g, '')
        .toLowerCase();

    const app = await prisma.application.findUnique({
      where: { id: appId },
      select: { currentQueue: true },
    });
    const qKey = normalizeQueueKey(app?.currentQueue);
    const postDraftQueues = new Set([
      'contractgenerated',
      'contractout',
      'contractsout',
      'contractsigned',
      'signedcontracts',
      'final',
      'fundingcall',
      'disbursment',
      'disbursement',
      'funded',
    ]);
    if (postDraftQueues.has(qKey)) return;

    await prisma.application.updateMany({
      where: { id: appId },
      data: {
        currentQueue: 'Contract Generated',
        currentState: 'Contract_Generated',
      },
    });
  }

  /** Move deal to Contract Signed when fully signed; keep Contract Out while awaiting signature. */
  private async syncApplicationWorkflowOnContractSigning(
    applicationId: string,
    internalStatus: string,
  ) {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    const status = String(internalStatus || '').trim().toLowerCase();

    const normalizeQueueKey = (queue: string | null | undefined) =>
      String(queue ?? '')
        .trim()
        .replace(/[\s_-]+/g, '')
        .toLowerCase();

    const postSignedQueueKeys = new Set([
      'contractsigned',
      'signedcontracts',
      'final',
      'fundingcall',
      'disbursment',
      'disbursement',
      'funded',
    ]);

    if (status === 'completed') {
      await prisma.application.updateMany({
        where: { id: appId },
        data: {
          currentQueue: 'Contract Signed',
          currentState: 'SIGNED_CONTRACTS',
        },
      });
      return;
    }

    if (['sent', 'viewed', 'signed'].includes(status)) {
      const app = await prisma.application.findUnique({
        where: { id: appId },
        select: { currentQueue: true },
      });
      const qKey = normalizeQueueKey(app?.currentQueue);
      if (!postSignedQueueKeys.has(qKey)) {
        await prisma.application.updateMany({
          where: { id: appId },
          data: {
            currentQueue: 'Contract Out',
            currentState: 'Contract Out',
          },
        });
      }
    }
  }

  /** After auto-send: mark linked `Document` row and `Contract.status` as SENT. */
  private async markEnvelopeSent(applicationId: string, envelopeId: string) {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId: String(envelopeId), applicationId: appId },
    });
    await this.applySigningStatusUpdate(
      String(envelopeId),
      'sent',
      appId,
      existingDoc,
    );
  }

  private async getEnvelopeStatus(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
      );
      return String(res.data?.status || '').toLowerCase();
    } catch {
      return '';
    }
  }

  /** Longest non-empty text-tab value on the envelope (used to verify PDF embed). */
  private async getEnvelopePrefillSampleValue(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string | null> {
    let best = '';
    const consider = (raw: string) => {
      const v = String(raw || '').trim();
      if (v.length > best.length) best = v;
    };
    const sampleReady = () => best.length >= 4;

    try {
      const rec = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
      );
      for (const signer of rec.data?.signers || []) {
        const recipientId = String(signer.recipientId || '');
        if (!recipientId) continue;
        const tabsRes = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
        );
        for (const tab of tabsRes.data?.textTabs || []) {
          consider(String(tab.value ?? ''));
        }
        if (sampleReady()) return best;
      }
    } catch (err) {
      console.warn('[DocuSign] getEnvelopePrefillSampleValue (recipients) failed:', err);
    }

    if (!sampleReady()) {
      for (const tab of await this.fetchEnvelopeDocumentTextTabs(
        client,
        accountId,
        envelopeId,
      )) {
        consider(String(tab.value ?? ''));
        if (sampleReady()) break;
      }
    }

    return sampleReady() ? best : null;
  }

  private async downloadEnvelopeCombinedPdf(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    showChanges: boolean,
  ): Promise<Buffer | null> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/combined`,
        {
          responseType: 'arraybuffer',
          params: showChanges ? { show_changes: 'true' } : undefined,
        },
      );
      const buf = Buffer.from(res.data);
      return buf?.length ? buf : null;
    } catch (err) {
      console.warn('[DocuSign] download combined PDF failed:', err);
      return null;
    }
  }

  /** Fallback when combined PDF is unavailable — first content document only. */
  private async downloadEnvelopeFirstContentPdf(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    showChanges: boolean,
  ): Promise<Buffer | null> {
    try {
      const docsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents`,
      );
      const docs = docsRes.data?.envelopeDocuments || docsRes.data?.documents || [];
      const contentDocs = this.filterEnvelopeContentDocuments(
        docs.length ? docs : [{ documentId: '1' }],
      );
      const docId = String(
        (contentDocs[0] || { documentId: '1' }).documentId ?? '1',
      );
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/${docId}`,
        {
          responseType: 'arraybuffer',
          params: showChanges ? { show_changes: 'true' } : undefined,
        },
      );
      const buf = Buffer.from(res.data);
      return buf?.length ? buf : null;
    } catch (err) {
      console.warn('[DocuSign] download first content PDF failed:', err);
      return null;
    }
  }

  /** Pick the larger of two PDF buffers (heuristic when DocuSign embeds more data in one variant). */
  private pickLargerPdfBuffer(a: Buffer | null, b: Buffer | null): Buffer | null {
    const lenA = a?.length ?? 0;
    const lenB = b?.length ?? 0;
    if (lenA >= lenB) return lenA ? a : b;
    return b;
  }

  /**
   * Download envelope PDF (combined, then first content doc as fallback).
   * Completed envelopes use a clean PDF; draft/sent try show_changes and plain, return the larger file.
   */
  private async downloadEnvelopePdfBuffer(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    knownStatus?: string,
  ): Promise<Buffer | null> {
    const downloadPdf = async (showChanges: boolean) =>
      (await this.downloadEnvelopeCombinedPdf(
        client,
        accountId,
        envelopeId,
        showChanges,
      )) ??
      (await this.downloadEnvelopeFirstContentPdf(
        client,
        accountId,
        envelopeId,
        showChanges,
      ));

    const status =
      knownStatus || (await this.getEnvelopeStatus(client, accountId, envelopeId));
    if (status === 'completed') {
      return downloadPdf(false);
    }

    const withChanges = await downloadPdf(true);
    const plain = await downloadPdf(false);
    return this.pickLargerPdfBuffer(withChanges, plain);
  }

  /**
   * CRM draft preview: tab values are on the envelope via API, but DocuSign often does not flatten
   * them into a downloadable draft PDF (account setting may be required). Do not scan raw PDF bytes
   * for text — compressed PDFs fail that check even when the Sender View shows values.
   */
  private async downloadEnvelopePdfBufferForPreview(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    knownStatus?: string,
  ): Promise<Buffer | null> {
    const status =
      knownStatus || (await this.getEnvelopeStatus(client, accountId, envelopeId));
    if (status === 'completed') {
      return this.downloadEnvelopePdfBuffer(client, accountId, envelopeId, status);
    }

    let sample: string | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt > 0) await this.sleep(2000);
      sample = await this.getEnvelopePrefillSampleValue(
        client,
        accountId,
        envelopeId,
      );
      if (sample) break;
    }

    await this.sleep(sample ? 3000 : 1500);
    let buf = await this.downloadEnvelopePdfBuffer(
      client,
      accountId,
      envelopeId,
      status,
    );
    if (!buf?.length) {
      await this.sleep(2000);
      buf = await this.downloadEnvelopePdfBuffer(client, accountId, envelopeId, status);
    }

    if (sample && buf?.length) {
      console.log(
        `[DocuSign] Draft PDF downloaded for envelope ${envelopeId} (${buf.length} bytes). ` +
          `Tabs include prefilled values (e.g. "${sample.slice(0, 48)}${sample.length > 48 ? '…' : ''}") but DocuSign may not embed them in the PDF until send/completed. ` +
          'Use Sender View to verify fields, or enable Admin → Sending Settings → write initial field values for all recipients.',
      );
    }

    return buf;
  }

  /** Read filled tab values from the envelope for local PDF rendering (CC copy). */
  private async collectEnvelopePrefillFieldsFromTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<PrefillField[]> {
    const out: PrefillField[] = [];
    const seen = new Set<string>();

    const addTab = (tab: DocusignTextTabRef) => {
      const value = String(tab.value ?? '').trim();
      if (!value) return;
      const rawId = String(tab.name || tab.tabLabel || tab.tabId || '').trim();
      const id = normalizeFieldKey(rawId);
      if (!id || seen.has(id)) return;
      seen.add(id);
      out.push({ id, value });
    };

    for (const tab of await this.fetchEnvelopeDocumentDataTabs(
      client,
      accountId,
      envelopeId,
    )) {
      addTab(tab);
    }

    try {
      const rec = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
      );
      for (const signer of rec.data?.signers || []) {
        const recipientId = String(signer.recipientId || '').trim();
        if (!recipientId) continue;
        const tabs = await this.fetchEnvelopeSignerDataTabs(
          client,
          accountId,
          envelopeId,
          recipientId,
        );
        for (const tab of tabs) addTab(tab);
      }
    } catch (err) {
      console.warn('[DocuSign] collectEnvelopePrefillFieldsFromTabs recipients failed:', err);
    }

    return out;
  }

  /**
   * Build a flattened contract PDF from platform layout + envelope tab values.
   * DocuSign's downloadable PDF often omits prefilled signer tabs (CC sees a blank form).
   */
  private async buildFlattenedContractPdfForCc(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<Buffer | null> {
    try {
      const { loadLatestContractLayoutPackage } = await import('./utils/platform-layout-envelope');
      const { prefillFieldsToValueMap, renderFlattenedLayoutPdf } = await import(
        './utils/build-envelope-from-layout'
      );
      const layout = await loadLatestContractLayoutPackage();
      const fields = await this.collectEnvelopePrefillFieldsFromTabs(
        client,
        accountId,
        envelopeId,
      );
      if (!fields.length) return null;

      let ownerCount = 1;
      try {
        const rec = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
        );
        const signerEmails = new Set(
          ((rec.data?.signers || []) as Array<{ email?: string }>)
            .map((s) => String(s.email || '').trim().toLowerCase())
            .filter(Boolean),
        );
        if (signerEmails.size >= 2) ownerCount = 2;
      } catch {
        /* default 1 */
      }

      const values = prefillFieldsToValueMap(fields);
      return await renderFlattenedLayoutPdf(layout, values, {
        ownerCount,
        guarantorCount: ownerCount >= 2 ? 2 : 0,
      });
    } catch (err) {
      console.warn(`[DocuSign] buildFlattenedContractPdfForCc failed for ${envelopeId}:`, err);
      return null;
    }
  }

  private async getEnvelopeEmailSubject(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string | null> {
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
      );
      const subject = String(res.data?.emailSubject || '').trim();
      return subject || null;
    } catch {
      return null;
    }
  }

  private async resolveApplicationContractEmailContext(
    applicationId: string,
  ): Promise<{ businessName: string | null; offerAmount: number | null }> {
    try {
      const contract = await prisma.contract.findFirst({
        where: { applicationId },
        orderBy: { createdAt: 'desc' },
        select: {
          legalName: true,
          clientName: true,
          doingBusinessAs: true,
          approvedAmount: true,
        },
      });

      let businessName = String(
        contract?.legalName || contract?.doingBusinessAs || contract?.clientName || '',
      ).trim();
      let offerAmount =
        contract?.approvedAmount != null ? Number(contract.approvedAmount) : null;

      const app = await prisma.application.findUnique({
        where: { id: applicationId },
        select: {
          dealDisplayName: true,
          client: {
            select: { businessName: true },
          },
          OfferDecision: {
            select: { offer: true },
          },
          termsOffers: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { approvedAmount: true },
          },
        },
      });

      if (!businessName) {
        businessName = String(
          app?.client?.businessName || app?.dealDisplayName || '',
        ).trim();
      }

      if (offerAmount == null || !Number.isFinite(offerAmount)) {
        const fromOfferDecision =
          app?.OfferDecision?.offer != null ? Number(app.OfferDecision.offer) : null;
        const fromTerms =
          app?.termsOffers?.[0]?.approvedAmount != null
            ? Number(app.termsOffers[0].approvedAmount)
            : null;
        offerAmount =
          fromOfferDecision != null && Number.isFinite(fromOfferDecision)
            ? fromOfferDecision
            : fromTerms != null && Number.isFinite(fromTerms)
              ? fromTerms
              : null;
      }

      return {
        businessName: businessName || null,
        offerAmount: offerAmount != null && Number.isFinite(offerAmount) ? offerAmount : null,
      };
    } catch {
      return { businessName: null, offerAmount: null };
    }
  }

  /** Match signer envelope subject (e.g. KATAN CAPITAL : Business Name - $12,345.67). */
  private async resolveCcContractEmailSubject(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    subjectHint?: string | null,
    applicationId?: string | null,
  ): Promise<string> {
    const hint = normalizeContractCcEmailSubject(subjectHint);
    if (hint !== 'Contract') return hint;

    const fromEnvelope = await this.getEnvelopeEmailSubject(
      client,
      accountId,
      envelopeId,
    );
    if (fromEnvelope) return fromEnvelope;

    const appId = String(applicationId || '').trim();
    if (appId) {
      const { businessName, offerAmount } =
        await this.resolveApplicationContractEmailContext(appId);
      if (businessName) {
        return buildContractEnvelopeEmailSubject(businessName, offerAmount);
      }
    }

    return hint;
  }

  private async emailPrefilledContractPdfToCcRecipients(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    ccEmails: string[] | undefined | null,
    subjectBase: string,
  ): Promise<{ emailed: string[] }> {
    const list = mergeDefaultContractCcEmails(ccEmails);
    if (!list.length) return { emailed: [] };

    if (!isOutboundSmtpConfigured()) {
      console.warn('[DocuSign] CC prefilled PDF email skipped: SMTP not configured.');
      return { emailed: [] };
    }

    const status = await this.getEnvelopeStatus(client, accountId, envelopeId);
    const waitMs = status === 'sent' || status === 'completed' ? 4000 : 2000;
    await this.sleep(waitMs);

    let pdf = await this.buildFlattenedContractPdfForCc(client, accountId, envelopeId);
    if (!pdf?.length) {
      pdf = await this.downloadEnvelopePdfBufferForPreview(
        client,
        accountId,
        envelopeId,
        status,
      );
    }
    if (!pdf?.length && (status === 'sent' || status === 'completed')) {
      await this.sleep(4000);
      pdf =
        (await this.buildFlattenedContractPdfForCc(client, accountId, envelopeId)) ||
        (await this.downloadEnvelopePdfBuffer(client, accountId, envelopeId, status));
    }
    if (!pdf?.length) {
      console.warn(`[DocuSign] No PDF for envelope ${envelopeId}; CC email skipped.`);
      return { emailed: [] };
    }

    const subject = normalizeContractCcEmailSubject(subjectBase);
    const pdfFilename = buildContractEnvelopePdfFilename(subject);
    const emailed: string[] = [];
    for (const to of list) {
      try {
        await sendMail({
          to,
          subject,
          html: '',
          attachments: [
            {
              filename: pdfFilename,
              content: pdf,
              contentType: 'application/pdf',
            },
          ],
        });
        emailed.push(to);
      } catch (err) {
        console.error(`[DocuSign] Failed to email prefilled PDF to ${to}:`, err);
      }
    }
    return { emailed };
  }

  /**
   * Email CC recipients a prefilled PDF once per envelope (BoldSign parity).
   * Skips when already sent or when SMTP / PDF is unavailable.
   */
  private async emailCcPrefilledPdfOnce(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    ccEmails: string[],
    subjectBase = 'Contract',
    applicationId?: string | null,
  ): Promise<{ emailed: string[]; skippedReason?: string }> {
    const list = [...new Set(ccEmails.map((e) => String(e).trim()).filter(Boolean))];
    if (!list.length) return { emailed: [], skippedReason: 'no_cc_addresses' };
    if (await this.hasCcPrefilledPdfEmailed(client, accountId, envelopeId)) {
      return { emailed: [], skippedReason: 'already_emailed' };
    }
    if (!isOutboundSmtpConfigured()) {
      return { emailed: [], skippedReason: 'smtp_not_configured' };
    }
    const subject = await this.resolveCcContractEmailSubject(
      client,
      accountId,
      envelopeId,
      subjectBase,
      applicationId,
    );
    const result = await this.emailPrefilledContractPdfToCcRecipients(
      client,
      accountId,
      envelopeId,
      list,
      subject,
    );
    if (result.emailed.length) {
      await this.markCcPrefilledPdfEmailed(client, accountId, envelopeId);
    }
    return result;
  }

  private async createSenderViewUrl(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    returnUrl: string,
  ): Promise<string> {
    this.ensureClientApiBase(client);
    const safeReturnUrl = this.normalizeSenderReturnUrl(returnUrl);
    try {
      const res = await client.post(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/sender`,
        { returnUrl: safeReturnUrl },
      );
      const url = res.data?.url;
      if (!url) throw new BadRequestException('DocuSign did not return sender view URL');
      return url;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.throwBadRequestFromDocusignAxios('Sender view', err);
    }
  }

  private async finalizeEnvelopeFlow(
    userId: string,
    envelopeId: string,
    options: {
      applicationId?: string;
      contractId?: number;
      /** When false, link envelope on contract prefill — not main Document row. */
      linkApplicationDocument?: boolean;
      standaloneLinkKind?: 'ach' | 'package';
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
      redirectUrl?: string;
      ccEmails?: string[];
      title?: string;
      prefillFields?: PrefillField[];
      templateId?: string;
      autoSend?: boolean;
      createTimePrefillTabCount?: number;
      /** CRM values are burned into uploaded PDFs — skip signer overlay text tabs. */
      prefillFlattenedInPdf?: boolean;
      client: AxiosInstance;
      accountId: string;
    },
  ) {
    const appId = String(options.applicationId || '').trim();
    const ccEmails = mergeDefaultContractCcEmails(options.ccEmails);
    const linkApplicationDocument = options.linkApplicationDocument !== false;
    if (appId && linkApplicationDocument) {
      await this.linkEnvelopeToApplication(userId, appId, envelopeId);
    } else if (appId && !linkApplicationDocument) {
      const contractIdNum = Number(options.contractId);
      const resolvedContractId =
        Number.isFinite(contractIdNum) && contractIdNum > 0 ? contractIdNum : undefined;
      if (options.standaloneLinkKind === 'ach') {
        await linkAchAuthorizationEnvelopeToContract(
          appId,
          envelopeId,
          'draft',
          resolvedContractId,
        );
      } else {
        await linkStandalonePackageEnvelopeToContract(
          appId,
          envelopeId,
          'draft',
          resolvedContractId,
          options.sendPackage,
        );
      }
    }

    let prefillApplied = {
      applied: 0,
      attempted: 0,
      atCreate: 0,
      atPostCreate: 0,
    };
    if (options.prefillFields?.length && !options.prefillFlattenedInPdf) {
      const post = await this.applyPrefillToEnvelope(
        userId,
        options.client,
        options.accountId,
        envelopeId,
        options.templateId,
        options.prefillFields,
      );
      prefillApplied = {
        applied: Math.max(post.applied, options.createTimePrefillTabCount ?? 0),
        attempted: post.attempted,
        atCreate: options.createTimePrefillTabCount ?? 0,
        atPostCreate: post.applied,
      };
    } else if (options.prefillFlattenedInPdf) {
      prefillApplied = {
        applied: options.createTimePrefillTabCount ?? 0,
        attempted: options.prefillFields?.length ?? 0,
        atCreate: 0,
        atPostCreate: 0,
      };
    }

    const autoSend =
      options.autoSend !== false &&
      (options.autoSend === true || DOCUSIGN_AUTO_SEND_ENVELOPE);

    if (prefillApplied.applied > 0 || prefillApplied.attempted > 0) {
      await this.sleep(autoSend ? 4000 : 5000);
    }

    let ccSynced = 0;
    if (ccEmails.length) {
      let signerEmails: string[] = [];
      try {
        const rec = await options.client.get(
          `/v2.1/accounts/${options.accountId}/envelopes/${envelopeId}/recipients`,
        );
        signerEmails = ((rec.data?.signers || []) as Array<{ email?: string }>)
          .map((s) => String(s.email || '').trim())
          .filter(Boolean);
      } catch {
        /* omit */
      }
      ccSynced = await this.syncEnvelopeCarbonCopies(
        options.client,
        options.accountId,
        envelopeId,
        ccEmails,
        signerEmails,
      );
    }

    // CRM emails CC a prefilled PDF when the envelope is sent (not on draft — PDF is often blank).
    let ccPrefilledEmail: { emailed: string[]; skippedReason?: string } | null = null;

    let envelopeSigners: Array<{ roleName?: string; email?: string; name?: string }> = [];
    try {
      const rec = await options.client.get(
        `/v2.1/accounts/${options.accountId}/envelopes/${envelopeId}/recipients`,
      );
      envelopeSigners = (rec.data?.signers || []).map((s: any) => ({
        roleName: s.roleName,
        email: s.email,
        name: s.name,
      }));
    } catch {
      /* omit */
    }

    let envelopeStatus: 'created' | 'sent' = 'created';
    if (autoSend) {
      try {
        await this.lockEnvelopeSignerDataTabsWithRetry(
          options.client,
          options.accountId,
          envelopeId,
        );
        await options.client.put(
          `/v2.1/accounts/${options.accountId}/envelopes/${envelopeId}`,
          { status: 'sent' },
        );
        envelopeStatus = 'sent';
        if (prefillApplied.applied > 0) {
          await this.sleep(6000);
        }
        await this.lockEnvelopeSignerDataTabsWithRetry(
          options.client,
          options.accountId,
          envelopeId,
        );
        if (appId) {
          await this.markEnvelopeSent(appId, envelopeId);
        } else {
          await prisma.document.updateMany({
            where: { envelopeId: String(envelopeId) },
            data: { status: 'sent', sentAt: new Date() } as any,
          });
        }
        if (ccEmails.length) {
          ccPrefilledEmail = await this.emailCcPrefilledPdfOnce(
            options.client,
            options.accountId,
            envelopeId,
            ccEmails,
            options.title || 'Contract',
            appId || null,
          );
        }
      } catch (sendErr) {
        console.error('[DocuSign] auto-send failed:', sendErr);
      }
    }

    const returnUrl =
      options.redirectUrl ||
      process.env.DOCUSIGN_SENDER_RETURN_URL ||
      'https://www.docusign.com';

    let sendUrl: string | null = null;
    if (!autoSend) {
      try {
        sendUrl = await this.createSenderViewUrl(
          options.client,
          options.accountId,
          envelopeId,
          returnUrl,
        );
      } catch (senderViewErr) {
        console.warn(
          `[DocuSign] Sender view URL skipped for envelope ${envelopeId} (draft PDF preview still works):`,
          senderViewErr,
        );
      }
    }

    if (!autoSend && envelopeStatus !== 'sent' && appId) {
      await this.syncApplicationWorkflowOnDraftCreated(appId);
    }

    const message =
      envelopeStatus === 'sent'
        ? 'Contract sent via DocuSign; signing email delivered to the signer.'
        : 'Envelope created in DocuSign; open sender view to review and send.';

    return {
      success: true,
      documentId: envelopeId,
      envelopeId,
      sendUrl,
      message,
      data: {
        prefillFieldCount: options.prefillFields?.length ?? 0,
        prefillTabsApplied: prefillApplied.applied,
        prefillTabsAtCreate: prefillApplied.atCreate,
        prefillTabsAtPostCreate: prefillApplied.atPostCreate,
        envelopeStatus,
        autoSend,
        envelopeSigners,
        ccSynced,
        ccPrefilledEmail,
        nextStep:
          envelopeStatus === 'sent'
            ? 'Signers were emailed by DocuSign.'
            : 'Open sendUrl, confirm prefilled fields, then click Send in DocuSign to email signers.',
      },
    };
  }

  // ─── Template ID resolution (reuses BoldSignTemplate table) ───────────────

  private normalizeTemplateLookupKey(value: string | null | undefined): string | undefined {
    const v = String(value ?? '').trim().toLowerCase();
    return v || undefined;
  }

  async resolveTemplateIdsFromDb(filters: {
    state?: string | null;
    frequency?: string | null;
    type?: string | null;
  }): Promise<string[]> {
    return resolveSupplementalRefsFromDb(filters);
  }

  private decoratePlatformLayoutEnvelope(
    envelopeDefinition: Record<string, unknown>,
    options: {
      applicationId?: string;
      ccEmails?: string[];
      reminderSettings?: {
        enableAutoReminder?: boolean;
        reminderDays?: number;
        reminderCount?: number;
      };
    },
  ) {
    if (options.reminderSettings?.enableAutoReminder !== false) {
      (envelopeDefinition as any).notification = {
        reminders: {
          reminderEnabled: 'true',
          reminderDelay: String(options.reminderSettings?.reminderDays ?? 3),
          reminderFrequency: String(options.reminderSettings?.reminderCount ?? 5),
        },
      };
    }

    const appIdForEnvelope = String(options.applicationId || '').trim();
    const textCustomFields = this.buildEnvelopeTextCustomFields(
      appIdForEnvelope,
      options.ccEmails,
    );
    if (textCustomFields.length) {
      (envelopeDefinition as any).customFields = { textCustomFields };
    }

    const connectNotification = this.buildEnvelopeConnectNotification();
    if (connectNotification) {
      (envelopeDefinition as any).eventNotification = connectNotification;
    }
  }

  private async sendEnvelopeFromPlatformLayouts(
    userId: string,
    options: {
      supplementalRefs?: string[];
      includeMainContract?: boolean;
      redirectUrl?: string;
      title?: string;
      message?: string;
      roles: SignerRoleInput[];
      prefillFields?: PrefillField[];
      ccEmails?: string[];
      applicationId?: string;
      ownerCount?: number;
      guarantorCount?: number;
      reminderSettings?: {
        enableAutoReminder?: boolean;
        reminderDays?: number;
        reminderCount?: number;
      };
      autoSend?: boolean;
      contractId?: number;
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
    },
  ) {
    const { client, accountId } = await this.getAuthContext(userId);

    const supplementalRefs = options.supplementalRefs || [];
    const standaloneLinkKind = resolveStandaloneLinkKind(
      supplementalRefs,
      options.includeMainContract,
    );

    let built;
    try {
      const sendImmediately = options.autoSend === true;
      const envelopeSubject = String(options.title || '').trim();
      built = await buildPlatformLayoutEnvelopeDefinition({
        supplementalRefs,
        includeMainContract: options.includeMainContract,
        roles: options.roles,
        prefillFields: options.prefillFields,
        ownerCount: options.ownerCount,
        guarantorCount: options.guarantorCount,
        title: options.title,
        message: options.message,
        documentName: envelopeSubject
          ? buildContractEnvelopeDocumentName(envelopeSubject)
          : undefined,
        flattenPrefillInPdf: sendImmediately,
        lockDataTabs: sendImmediately,
      });
    } catch (err: any) {
      throw new BadRequestException(err?.message || String(err));
    }

    const envelopeDefinition: Record<string, unknown> = {
      ...built.envelopeDefinition,
    };
    this.decoratePlatformLayoutEnvelope(envelopeDefinition, options);

    try {
      const createRes = await client.post(
        `/v2.1/accounts/${accountId}/envelopes`,
        envelopeDefinition,
      );
      const envelopeId = createRes.data?.envelopeId;
      if (!envelopeId) {
        throw new BadRequestException('DocuSign did not return envelopeId');
      }

      await this.assertEnvelopeHasSigners(client, accountId, envelopeId);

      const result = await this.finalizeEnvelopeFlow(userId, envelopeId, {
        applicationId: options.applicationId,
        contractId: options.contractId,
        linkApplicationDocument: options.includeMainContract !== false,
        standaloneLinkKind:
          options.includeMainContract !== false
            ? undefined
            : standaloneLinkKind === 'ach'
              ? 'ach'
              : 'package',
        sendPackage: options.sendPackage,
        redirectUrl: options.redirectUrl,
        ccEmails: options.ccEmails,
        title: options.title,
        prefillFields: options.prefillFields,
        autoSend: options.autoSend,
        createTimePrefillTabCount: built.createTimePrefillTabCount,
        prefillFlattenedInPdf: built.prefillFlattenedInPdf,
        client,
        accountId,
      });

      return {
        ...result,
        data: {
          ...(result.data as object),
          layoutKeys: built.layoutKeys,
          supplementalRefs: options.supplementalRefs || [],
          source: 'platform-layout',
          merge: createRes.data,
        },
      };
    } catch (error: any) {
      if (error?.response?.status === 401) {
        clearDocusignJwtCache();
        throw new ServiceConfigException(
          'DocuSign API rejected credentials. Check JWT key, impersonated user, and admin consent.',
        );
      }
      if (error?.response?.data) {
        throw new BadRequestException(`DocuSign error: ${JSON.stringify(error.response.data)}`);
      }
      throw new BadRequestException(
        'Failed to send envelope from platform layouts: ' + (error?.message || error),
      );
    }
  }

  // ─── Send contract (platform PDF + coordinate layouts) ───────────────────────

  async sendTemplate(
    userId: string,
    options: {
      templateId?: string;
      redirectUrl?: string;
      title?: string;
      message?: string;
      roles?: SignerRoleInput[];
      signerName?: string;
      signerEmail?: string;
      prefillFields?: PrefillField[];
      ccEmails?: string[];
      applicationId?: string;
      ownerCount?: number;
      guarantorCount?: number;
      reminderSettings?: {
        enableAutoReminder?: boolean;
        reminderDays?: number;
        reminderCount?: number;
      };
      autoSend?: boolean;
    },
  ) {
    const roles: SignerRoleInput[] = options.roles?.length
      ? options.roles
      : [
          {
            signerName: options.signerName || '',
            signerEmail: options.signerEmail || '',
            roleName: DOCUSIGN_DEFAULT_ROLE_NAME,
          },
        ];

    return this.sendEnvelopeFromPlatformLayouts(userId, {
      supplementalRefs: [],
      roles,
      redirectUrl: options.redirectUrl,
      title: options.title,
      message: options.message,
      prefillFields: options.prefillFields,
      ccEmails: options.ccEmails,
      applicationId: options.applicationId,
      ownerCount: options.ownerCount,
      guarantorCount: options.guarantorCount,
      reminderSettings: options.reminderSettings,
      autoSend: options.autoSend,
    });
  }

  // ─── Merge contract PDF + supplemental platform layouts ────────────────────────

  async mergeAndSendTemplates(
    userId: string,
    options: {
      templates?: Array<{ templateId: string }>;
      templateIds?: string[];
      supplementalLayoutKeys?: string[];
      supplementalDocumentRefs?: string[];
      includeMainContract?: boolean;
      contractTemplateFilters?: {
        state?: string | null;
        frequency?: string | null;
        type?: string | null;
      };
      roles: SignerRoleInput[];
      prefillFields?: PrefillField[];
      redirectUrl?: string;
      applicationId?: string;
      ccEmails?: string[];
      title?: string;
      message?: string;
      ownerCount?: number;
      guarantorCount?: number;
      autoSend?: boolean;
      reminderSettings?: {
        enableAutoReminder?: boolean;
        reminderDays?: number;
        reminderCount?: number;
      };
      contractId?: number;
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
    },
  ) {
    if (!options?.roles?.length) {
      throw new BadRequestException('At least one role is required');
    }

    let supplementalRefs: string[] = [];
    if (options.supplementalLayoutKeys?.length) {
      supplementalRefs = await filterSupplementalRefs(
        options.supplementalLayoutKeys.map((k) => String(k).trim()).filter(Boolean),
      );
    } else if (options.supplementalDocumentRefs?.length) {
      supplementalRefs = await filterSupplementalRefs(
        options.supplementalDocumentRefs.map((id) => String(id).trim()).filter(Boolean),
      );
    } else if (options.templateIds?.length) {
      supplementalRefs = await filterSupplementalRefs(options.templateIds);
    } else if (options.contractTemplateFilters) {
      supplementalRefs = await this.resolveTemplateIdsFromDb(options.contractTemplateFilters);
    } else if (options.templates?.length) {
      supplementalRefs = await filterSupplementalRefs(
        options.templates.map((t) => String(t.templateId).trim()).filter(Boolean),
      );
    }

    return this.sendEnvelopeFromPlatformLayouts(userId, {
      supplementalRefs,
      includeMainContract: options.includeMainContract,
      roles: options.roles,
      prefillFields: options.prefillFields,
      redirectUrl: options.redirectUrl,
      applicationId: options.applicationId,
      ccEmails: options.ccEmails,
      title: options.title,
      message: options.message,
      ownerCount: options.ownerCount,
      guarantorCount: options.guarantorCount,
      autoSend: options.autoSend,
      reminderSettings: options.reminderSettings,
      contractId: options.contractId,
      sendPackage: options.sendPackage,
    });
  }

  /**
   * Updates default recipients on a DocuSign template (does not create an envelope).
   */
  async addRecipientsToTemplate(
    userId: string,
    options: {
      templateId: string;
      roles: SignerRoleInput[];
      title?: string;
      message?: string;
      ccEmails?: string[];
    },
  ) {
    const templateId = String(options.templateId || '').trim();
    if (!templateId) {
      throw new BadRequestException('templateId is required');
    }

    const signers = this.normalizeSignerRoles(options.roles);
    if (!signers.length) {
      throw new BadRequestException('At least one signer with a valid email is required.');
    }

    const { client, accountId } = await this.getAuthContext(userId);

    const existingRes = await client.get(
      `/v2.1/accounts/${accountId}/templates/${templateId}/recipients`,
    );
    const existingSigners = existingRes.data?.signers || [];

    const updatedSigners = signers.map((s, idx) => {
      const existing = existingSigners.find(
        (es: { roleName?: string }) =>
          String(es.roleName || '').toLowerCase() === s.roleName.toLowerCase(),
      ) || existingSigners[idx];
      const roleName = String(existing?.roleName || s.roleName).trim();
      return {
        ...(existing || {}),
        roleName,
        name: s.name || s.email.split('@')[0],
        email: s.email,
        routingOrder: s.routingOrder || String(idx + 1),
        recipientId: existing?.recipientId || String(idx + 1),
      };
    });

    const carbonCopies = this.buildCarbonCopies(options.ccEmails);

    try {
      const updateRes = await client.put(
        `/v2.1/accounts/${accountId}/templates/${templateId}/recipients`,
        {
          signers: updatedSigners,
          ...(carbonCopies.length ? { carbonCopies } : {}),
        },
      );
      return {
        success: true,
        templateId,
        message: 'Template recipients updated in DocuSign.',
        data: updateRes.data,
      };
    } catch (error: any) {
      if (error?.response?.data) {
        throw new BadRequestException(`DocuSign error: ${JSON.stringify(error.response.data)}`);
      }
      throw new BadRequestException(
        'Failed to update template recipients: ' + (error?.message || error),
      );
    }
  }

  async prefillFormFields(
    userId: string,
    documentId: string,
    fields: PrefillField[],
  ) {
    const eid = String(documentId || '').trim();
    if (!eid) {
      throw new BadRequestException('documentId (envelopeId) is required');
    }
    const { client, accountId } = await this.getAuthContext(userId);
    await this.assertEnvelopeDraftOrThrow(client, accountId, eid);
    const templateId =
      (await this.getTemplateIdFromEnvelope(client, accountId, eid)) || undefined;
    const result = await this.applyPrefillToEnvelope(
      userId,
      client,
      accountId,
      eid,
      templateId,
      fields,
    );
    if (!result.applied && result.attempted) {
      console.warn(
        `[DocuSign] prefill sync: 0/${result.attempted} tab(s) matched on envelope ${eid}`,
      );
    }
    return result;
  }

  async getEmbeddedRequestUrl(userId: string, documentId: string, redirectUrl: string) {
    const { client, accountId } = await this.getAuthContext(userId);
    const url = await this.createSenderViewUrl(client, accountId, documentId, redirectUrl);
    return { sendUrl: url, url };
  }

  async getEmbeddedSignLink(
    userId: string,
    envelopeId: string,
    signerEmail: string,
    returnUrl: string,
  ) {
    const { client, accountId } = await this.getAuthContext(userId);
    const res = await client.post(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
      {
        returnUrl,
        authenticationMethod: 'email',
        email: signerEmail,
        userName: signerEmail.split('@')[0],
      },
    );
    return res.data;
  }

  async voidDocument(userId: string, documentId: string, reason: string) {
    const envelopeId = String(documentId || '').trim();
    const { client, accountId } = await this.getAuthContext(userId);
    await client.put(`/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
      status: 'voided',
      voidedReason: reason || 'Voided by user',
    });
    invalidateEnvelopeStatusSyncCache(envelopeId);

    const isAchEnvelope = await isStandaloneAchEnvelope(envelopeId);
    if (isAchEnvelope) {
      await updateAchAuthorizationDocuSignStatus(envelopeId, 'revoked');
      return { success: true, achAuthorization: true };
    }

    const isPackageEnvelope = await isStandalonePackageEnvelope(envelopeId);
    if (isPackageEnvelope) {
      await updateStandalonePackageDocuSignStatus(envelopeId, 'revoked');
      return { success: true, standalonePackage: true };
    }

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId },
      select: { applicationId: true },
    });
    await prisma.document.updateMany({
      where: { envelopeId },
      data: { status: 'revoked' },
    });
    const appId = existingDoc?.applicationId
      ? String(existingDoc.applicationId).trim()
      : '';
    if (appId) {
      await this.syncContractSigningStatus(appId, 'revoked');
    }
    return { success: true, achAuthorization: false };
  }

  async getDocumentProperties(userId: string, documentId: string) {
    const { client, accountId } = await this.getAuthContext(userId);
    const res = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${documentId}`,
    );
    return res.data;
  }

  async getEnvelopeIdForApplication(applicationUuid: string): Promise<string | null> {
    const row = await prisma.document.findUnique({
      where: { applicationId: applicationUuid },
      select: { envelopeId: true },
    });
    const id = row?.envelopeId ? String(row.envelopeId).trim() : '';
    return id || null;
  }

  async downloadDocumentPdfForApplication(userId: string, applicationUuid: string) {
    const envelopeId = await this.getEnvelopeIdForApplication(applicationUuid);
    if (!envelopeId) {
      throw new BadRequestException(
        'No DocuSign envelope is linked to this application yet. Send to DocuSign first.',
      );
    }
    return this.downloadDocumentPdfByEnvelopeId(userId, envelopeId);
  }

  async downloadDocumentPdfByEnvelopeId(userId: string, envelopeId: string) {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      throw new BadRequestException('envelopeId is required');
    }
    const { client, accountId } = await this.getAuthContext(userId);
    const status = await this.getEnvelopeStatus(client, accountId, eid);
    let buf = await this.downloadEnvelopePdfBufferForPreview(client, accountId, eid, status);
    if (!buf?.length) {
      await this.sleep(2000);
      buf = await this.downloadEnvelopePdfBufferForPreview(client, accountId, eid, status);
    }
    if (!buf?.length) {
      throw new BadRequestException('Could not download PDF from DocuSign');
    }
    return buf;
  }

  async downloadTemplatePdf(_userId: string, templateRef: string) {
    const ref = String(templateRef || '').trim();
    const { isDocumentLayoutKey, loadPlatformDocumentPdfBase64 } = await import(
      './platform-document-registry'
    );
    if (isDocumentLayoutKey(ref)) {
      const base64 = await loadPlatformDocumentPdfBase64(ref);
      return Buffer.from(base64, 'base64');
    }

    const row = await prisma.boldSignTemplate.findFirst({
      where: { OR: [{ id: ref }, { templateId: ref }, { layoutKey: ref }] },
      select: { pdfUrl: true, name: true },
    });
    const pdfUrl = String(row?.pdfUrl || '').trim();
    if (pdfUrl.startsWith('http://') || pdfUrl.startsWith('https://')) {
      const res = await fetch(pdfUrl);
      if (!res.ok) {
        throw new BadRequestException(
          `Failed to download template PDF for "${row?.name || ref}" (${res.status}).`,
        );
      }
      return Buffer.from(await res.arrayBuffer());
    }

    throw new BadRequestException(
      `Unknown document "${ref}". Use a layout key (e.g. flex_addendum) or a CRM document row id with a Cloudinary pdfUrl.`,
    );
  }

  async downloadSignedPdf(userId: string, documentId: string) {
    return this.downloadDocumentPdfByEnvelopeId(userId, documentId);
  }

  async fetchSignedDocumentPdf(userId: string, envelopeId: string) {
    return this.downloadSignedPdf(userId, envelopeId);
  }

  async listDocuments(userId: string, page = 1, pageSize = 10) {
    const { client, accountId } = await this.getAuthContext(userId);
    const fromDate = new Date();
    fromDate.setMonth(fromDate.getMonth() - 6);
    const res = await client.get(`/v2.1/accounts/${accountId}/envelopes`, {
      params: {
        from_date: fromDate.toISOString(),
        count: pageSize,
        start_position: (page - 1) * pageSize,
      },
    });
    return res.data;
  }

  async getTemplateRecipients(_userId: string, _templateId?: string) {
    const { getPlatformTemplateRecipients } = await import('./platform-document-registry');
    return getPlatformTemplateRecipients();
  }

  async getSenderViewUrl(
    userId: string,
    envelopeId: string,
    returnUrl: string,
    options?: {
      ccEmails?: string[];
      applicationId?: string;
      signerEmail?: string;
      signerName?: string;
      roles?: SignerRoleInput[];
    },
  ) {
    const eid = String(envelopeId || '').trim();
    try {
      const ccList = [
        ...new Set((options?.ccEmails || []).map((e) => String(e).trim()).filter(Boolean)),
      ];
      const hasSignerSync =
        Boolean(String(options?.signerEmail || '').trim()) ||
        (Array.isArray(options?.roles) && options.roles.length > 0);
      if (ccList.length || hasSignerSync) {
        await this.syncEnvelopeCcEmails(
          userId,
          eid,
          ccList,
          options?.applicationId,
          options?.signerEmail,
          options?.signerName,
          options?.roles,
        );
      }
      const { client, accountId } = await this.getAuthContext(userId);
      await this.assertEnvelopeDraftForSenderView(client, accountId, eid);
      const url = await this.createSenderViewUrl(client, accountId, eid, returnUrl);
      return { url };
    } catch (err) {
      if (
        err instanceof BadRequestException ||
        err instanceof ServiceConfigException ||
        err instanceof UnauthorizedException
      ) {
        throw err;
      }
      this.throwBadRequestFromDocusignAxios('DocuSign sender view', err);
    }
  }

  private async emailCcPrefilledPdfIfConfigured(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    ccEmails: string[],
    subjectBase = 'Contract',
    applicationId?: string | null,
  ) {
    return this.emailCcPrefilledPdfOnce(
      client,
      accountId,
      envelopeId,
      ccEmails,
      subjectBase,
      applicationId,
    );
  }

  /** CRM SMTP copy for CC list when envelope first becomes sent (webhook + poll). */
  private async notifyCcRecipientsOnEnvelopeSent(
    userId: string,
    envelopeId: string,
    applicationId?: string | null,
    existingDoc?: { userId?: number | null } | null,
    ccEmailsOverride?: string[],
  ): Promise<{ emailed: string[]; skippedReason?: string }> {
    try {
      let authUserId = String(userId || '').trim();
      if (!authUserId && existingDoc?.userId != null) {
        const owner = await prisma.user.findFirst({
          where: { userId: existingDoc.userId },
          select: { id: true },
        });
        authUserId = owner?.id || '';
      }
      const { client, accountId } = await this.getAuthContext(authUserId);
      const fromApi = ccEmailsOverride?.length
        ? ccEmailsOverride
        : await this.getEnvelopeCcEmailsFromApi(client, accountId, envelopeId);
      const ccEmails = mergeDefaultContractCcEmails(fromApi);
      if (!ccEmails.length) {
        return { emailed: [], skippedReason: 'no_cc_addresses' };
      }
      const result = await this.emailCcPrefilledPdfIfConfigured(
        client,
        accountId,
        envelopeId,
        ccEmails,
        'Contract',
        applicationId,
      );
      if (result.emailed.length) {
        console.log(
          `[DocuSign] CC prefilled PDF emailed to ${result.emailed.join(', ')} (envelope ${envelopeId})`,
        );
      }
      return result;
    } catch (err) {
      console.warn('[DocuSign] notifyCcRecipientsOnEnvelopeSent failed:', err);
      return { emailed: [], skippedReason: 'error' };
    }
  }

  async sendEnvelope(
    userId: string,
    envelopeId: string,
    options?: { applicationId?: string; ccEmails?: string[]; title?: string },
  ) {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      throw new BadRequestException('envelopeId is required');
    }
    const { client, accountId } = await this.getAuthContext(userId);
    const appId = String(options?.applicationId || '').trim();
    const ccFromRequest = mergeDefaultContractCcEmails(options?.ccEmails);
    const priorStatus = await this.getEnvelopeStatus(client, accountId, eid);

    await this.syncEnvelopeCcEmails(
      userId,
      eid,
      ccFromRequest,
      appId || undefined,
    );

    if (priorStatus === 'sent' || priorStatus === 'completed') {
      if (appId) {
        await this.markEnvelopeSent(appId, eid);
      }
      return { envelopeId: eid, status: priorStatus, alreadySent: true };
    }

    await this.lockEnvelopeSignerDataTabsWithRetry(client, accountId, eid);

    const res = await client.put(`/v2.1/accounts/${accountId}/envelopes/${eid}`, {
      status: 'sent',
    });
    if (appId) {
      await this.markEnvelopeSent(appId, eid);
    } else {
      await prisma.document.updateMany({
        where: { envelopeId: eid },
        data: { status: 'sent', sentAt: new Date() } as any,
      });
    }

    await this.lockEnvelopeSignerDataTabsWithRetry(client, accountId, eid);

    const ccForEmail = ccFromRequest.length
      ? ccFromRequest
      : await this.getEnvelopeCcEmailsFromApi(client, accountId, eid);
    const ccPrefilledEmail = await this.emailCcPrefilledPdfIfConfigured(
      client,
      accountId,
      eid,
      ccForEmail,
      options?.title || 'Contract',
      appId || null,
    );

    return {
      envelopeId: eid,
      status: res.data?.status || 'sent',
      alreadySent: false,
      ccPrefilledEmail,
    };
  }

  // ─── Webhook (DocuSign Connect) ──────────────────────────────────────────────

  verifyWebhookBasicAuth(authHeader: string | undefined): boolean {
    if (!DOCUSIGN_WEBHOOK_BASIC_USER || !DOCUSIGN_WEBHOOK_BASIC_PASSWORD) {
      return true;
    }
    if (!authHeader?.startsWith('Basic ')) return false;
    const token = authHeader.split(' ')[1];
    const expected = Buffer.from(
      `${DOCUSIGN_WEBHOOK_BASIC_USER}:${DOCUSIGN_WEBHOOK_BASIC_PASSWORD}`,
    ).toString('base64');
    return token === expected;
  }

  async processWebhookEvent(rawBody: unknown) {
    const body = parseDocusignWebhookBody(rawBody) as any;
    const envelopeId = extractDocusignEnvelopeId(body);
    const eventName = extractDocusignConnectEventName(body);

    if (!envelopeId) {
      console.warn('[DocuSign] webhook: missing envelopeId', {
        hasBody: !!rawBody,
        event: eventName,
      });
      return;
    }

    const incomingResolved = resolveDocusignWebhookEnvelopeStatus(body);
    if (!incomingResolved) {
      console.warn('[DocuSign] webhook: unrecognized status', {
        envelopeId,
        event: eventName,
        status: body?.data?.envelopeSummary?.status ?? body?.data?.status,
        recipientStatus: body?.data?.recipientStatus,
      });
      return;
    }

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId: String(envelopeId) },
    });

    let applicationId = extractCrmApplicationIdFromWebhook(body);

    if (!applicationId && existingDoc?.applicationId) {
      applicationId = existingDoc.applicationId;
    }

    if (!applicationId) {
      const achAppId = await findApplicationIdByAchEnvelopeId(envelopeId);
      if (achAppId) applicationId = achAppId;
    }

    if (!existingDoc && !applicationId) {
      console.warn('[DocuSign] webhook: envelope not linked to CRM application', {
        envelopeId,
        event: eventName,
        incoming: incomingResolved,
      });
    }

    const priorStatus = String(existingDoc?.status || '').toLowerCase();
    const status = await this.applySigningStatusUpdate(
      envelopeId,
      incomingResolved,
      applicationId,
      existingDoc,
    );

    if (
      incomingResolved === 'sent' &&
      priorStatus !== 'sent' &&
      priorStatus !== 'completed'
    ) {
      await this.lockEnvelopeSignerDataTabsAsSystem(envelopeId);
      await this.notifyCcRecipientsOnEnvelopeSent(
        '',
        envelopeId,
        applicationId,
        existingDoc,
      );
    }

    console.info('[DocuSign] webhook processed', {
      envelopeId,
      event: eventName,
      incoming: incomingResolved,
      stored: status,
      applicationId: applicationId || existingDoc?.applicationId,
    });
  }

  /** Poll DocuSign for current envelope status (fallback when Connect misses events). */
  async syncEnvelopeStatusFromDocusign(
    userId: string,
    options: {
      applicationId?: string;
      envelopeId?: string;
      ccEmails?: string[];
      contractId?: number;
      force?: boolean;
    },
  ) {
    let envelopeId = String(options.envelopeId || '').trim();
    const applicationId = String(options.applicationId || '').trim();

    if (!envelopeId && applicationId) {
      envelopeId = (await this.getEnvelopeIdForApplication(applicationId)) || '';
    }
    if (!envelopeId) {
      throw new BadRequestException(
        'No DocuSign envelope linked. Provide envelopeId or applicationId.',
      );
    }

    const forceRefresh = options.force === true;
    const cached = envelopeStatusSyncCache.get(envelopeId);
    if (
      !forceRefresh &&
      cached &&
      Date.now() - cached.syncedAt < ENVELOPE_STATUS_SYNC_MIN_INTERVAL_MS
    ) {
      return { ...cached.payload, cached: true };
    }

    const contractIdHint = Number(options.contractId);
    const achHints = {
      applicationId: applicationId || undefined,
      contractId:
        Number.isFinite(contractIdHint) && contractIdHint > 0
          ? contractIdHint
          : undefined,
    };

    const isAchEnvelope = await isStandaloneAchEnvelope(envelopeId, achHints);
    const isPackageEnvelope =
      !isAchEnvelope && (await isStandalonePackageEnvelope(envelopeId, achHints));
    const isSupplementalEnvelope = isAchEnvelope || isPackageEnvelope;

    if (!forceRefresh) {
      const terminalPayload = await this.buildTerminalEnvelopeSyncPayload(
        envelopeId,
        applicationId,
        isSupplementalEnvelope,
        isAchEnvelope,
        achHints,
      );
      if (terminalPayload) {
        envelopeStatusSyncCache.set(envelopeId, {
          syncedAt: Date.now(),
          payload: terminalPayload,
        });
        return { ...terminalPayload, cached: true, skippedDocuSign: true };
      }
    }

    const { client, accountId } = await this.getAuthContext(userId);
    let res: { data?: { status?: string } };
    try {
      res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
      );
    } catch (err: unknown) {
      const httpStatus = (err as { response?: { status?: number } })?.response
        ?.status;
      const errMsg = formatDocusignApiErrorMessage(err);
      const isPollingLimit = /BURST_ENVELOPE_POLLING|HOURLY_ENVELOPE_POLLING/i.test(
        errMsg,
      );
      if ((httpStatus === 429 || httpStatus === 400) && isPollingLimit && cached) {
        return { ...cached.payload, cached: true, rateLimited: true };
      }
      if (httpStatus === 429 || (httpStatus === 400 && isPollingLimit)) {
        const rateErr = new Error(
          'DocuSign polling limit reached. Wait a few minutes before checking again.',
        ) as Error & { status?: number };
        rateErr.status = httpStatus === 400 ? 400 : 429;
        throw rateErr;
      }
      if (httpStatus === 429 && cached) {
        return { ...cached.payload, cached: true, rateLimited: true };
      }
      if (httpStatus === 429) {
        const rateErr = new Error(
          'DocuSign rate limit reached. Wait a few seconds and try again.',
        ) as Error & { status?: number };
        rateErr.status = 429;
        throw rateErr;
      }
      throw err;
    }
    const dsStatus = res.data?.status;
    const incomingResolved = mapDocusignEnvelopeStatus(dsStatus);
    if (!incomingResolved) {
      throw new BadRequestException(
        `DocuSign returned unrecognized envelope status: ${String(dsStatus)}`,
      );
    }

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId: String(envelopeId) },
    });

    const priorStatus = String(existingDoc?.status || '').toLowerCase();
    const appId = applicationId || existingDoc?.applicationId || null;
    const status = await this.applySigningStatusUpdate(
      envelopeId,
      incomingResolved,
      appId,
      existingDoc,
      achHints,
    );

    let ccPrefilledEmail: { emailed: string[]; skippedReason?: string } = {
      emailed: [],
    };
    if (
      !isSupplementalEnvelope &&
      incomingResolved === 'sent' &&
      priorStatus !== 'sent' &&
      priorStatus !== 'completed'
    ) {
      await this.lockEnvelopeSignerDataTabsWithRetry(client, accountId, envelopeId);
      ccPrefilledEmail = await this.notifyCcRecipientsOnEnvelopeSent(
        userId,
        envelopeId,
        appId,
        existingDoc,
        options.ccEmails,
      );
    }

    const achAuthorization = isAchEnvelope;
    const standalonePackage = isPackageEnvelope;

    const payload = {
      envelopeId,
      applicationId: appId,
      docusignStatus: dsStatus,
      internalStatus: status,
      achAuthorization,
      standalonePackage,
      achAuthorizationStatus: achAuthorization
        ? mapInternalEnvelopeStatusToAchCapsule(status)
        : null,
      standalonePackageStatus: standalonePackage
        ? mapInternalEnvelopeStatusToPackageCapsule(status)
        : null,
      contractStatus:
        isSupplementalEnvelope || !status
          ? null
          : internalEnvelopeStatusToContractStatusDbValue(status),
      ccPrefilledEmail,
    };
    envelopeStatusSyncCache.set(envelopeId, {
      syncedAt: Date.now(),
      payload,
    });
    return payload;
  }

  /** Skip DocuSign GET when CRM already has a terminal status for this envelope. */
  private async buildTerminalEnvelopeSyncPayload(
    envelopeId: string,
    applicationId: string,
    isSupplementalEnvelope: boolean,
    isAchEnvelope: boolean,
    achHints: { applicationId?: string; contractId?: number },
  ): Promise<Record<string, unknown> | null> {
    const eid = String(envelopeId || '').trim();
    if (!eid) return null;

    if (isSupplementalEnvelope) {
      const where =
        achHints.contractId && achHints.contractId > 0
          ? { id: achHints.contractId }
          : achHints.applicationId
            ? { applicationId: achHints.applicationId }
            : null;
      if (!where) return null;
      const contracts = await prisma.contract.findMany({
        where,
        select: { contractPrefillOverrides: true },
        take: 5,
      });
      for (const row of contracts) {
        const ach = isAchEnvelope
          ? parseAchAuthorizationDocuSignFromPrefill(row.contractPrefillOverrides)
          : null;
        const pkg = !isAchEnvelope
          ? parseStandalonePackageDocuSignFromPrefill(row.contractPrefillOverrides)
          : null;
        const meta = ach ?? pkg;
        if (meta?.envelopeId !== eid) continue;
        const capsule = String(meta.status || '').toUpperCase();
        if (capsule === 'SIGNED' || capsule === 'VOIDED') {
          return {
            envelopeId: eid,
            applicationId: applicationId || achHints.applicationId || null,
            docusignStatus: capsule === 'SIGNED' ? 'completed' : 'voided',
            internalStatus: capsule === 'SIGNED' ? 'completed' : 'voided',
            achAuthorization: Boolean(ach),
            standalonePackage: Boolean(pkg),
            achAuthorizationStatus: ach?.status ?? null,
            standalonePackageStatus: pkg?.status ?? null,
            contractStatus: null,
            ccPrefilledEmail: { emailed: [] },
          };
        }
      }
      return null;
    }

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId: eid },
    });
    if (!existingDoc) return null;

    const docStatus = String(existingDoc.status || '').trim().toLowerCase();
    const terminalDoc = new Set([
      'completed',
      'declined',
      'voided',
      'revoked',
      'expired',
    ]);
    if (!terminalDoc.has(docStatus)) {
      const appId = String(applicationId || existingDoc.applicationId || '').trim();
      if (appId) {
        const contract = await prisma.contract.findFirst({
          where: { applicationId: appId },
          orderBy: { createdAt: 'desc' },
          select: { status: true },
        });
        const cs = String(contract?.status || '').trim().toUpperCase();
        const terminalContract = new Set([
          'COMPLETED',
          'SIGNED',
          'DECLINED',
          'REVOKED',
          'EXPIRED',
          'VOIDED',
        ]);
        if (!terminalContract.has(cs)) return null;
      } else {
        return null;
      }
    }

    const appId = String(applicationId || existingDoc.applicationId || '').trim() || null;
    let contractStatus: string | null = null;
    if (appId) {
      const contract = await prisma.contract.findFirst({
        where: { applicationId: appId },
        orderBy: { createdAt: 'desc' },
        select: { status: true },
      });
      contractStatus = contract?.status ? String(contract.status) : null;
    }

    return {
      envelopeId: eid,
      applicationId: appId,
      docusignStatus: docStatus === 'completed' ? 'completed' : docStatus,
      internalStatus: docStatus,
      achAuthorization: false,
      achAuthorizationStatus: null,
      contractStatus,
      ccPrefilledEmail: { emailed: [] },
    };
  }

  /** @deprecated Legacy PDF+tabs path — use sendTemplate / mergeAndSendTemplates */
  async createDraftEnvelope(
    userId: string,
    _documentBase64: string,
    recipientEmail: string,
    _state: string,
    application: { id: string },
    _termsOffer: unknown,
    ccEmails: string[] = [],
  ) {
    return this.sendTemplate(userId, {
      templateId: DOCUSIGN_DEFAULT_TEMPLATE_ID,
      roles: [
        {
          signerEmail: recipientEmail,
          signerName: recipientEmail.split('@')[0],
        },
      ],
      ccEmails,
      applicationId: application?.id,
    });
  }

  async updateDocumentStatusFromWebhook(body: any) {
    return this.processWebhookEvent(body);
  }
}
