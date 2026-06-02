import axios, { type AxiosInstance } from '../../types/http';
import type { DocuSignUserInfoResponse, OAuthTokenResponse } from '../../types/oauth-api';
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
  buildTextTabsFromPrefillIds,
  collectTabLabels,
  mapMatchedTabsToEnvelopeTabIds,
  matchPrefillFieldsToTextTabs,
  type DocusignTextTabRef,
  type PrefillFieldInput,
} from './utils/docusign-prefill';
import {
  clearDocusignJwtCache,
  getDocusignJwtSession,
  isDocusignJwtConfigured,
} from './utils/docusign-jwt';
import {
  extractDocusignConnectEventName,
  extractDocusignEnvelopeId,
  internalEnvelopeStatusToContractStatusDbValue,
  mapDocusignEnvelopeStatus,
  mergeWithExistingEnvelopeStatus,
  parseDocusignWebhookBody,
  resolveDocusignWebhookEnvelopeStatus,
} from './utils/docusign-webhook';
import { decryptField, isEncrypted } from '../../utils/fieldEncryption';

dotenv.config();

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

      const tokenRes = await axios.post<OAuthTokenResponse>(tokenUrl, params, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });

      const { access_token, refresh_token, expires_in } = tokenRes.data;
      if (!access_token) {
        throw new Error('Invalid response from DocuSign: Missing access token');
      }

      const userInfoRes = await axios.get<DocuSignUserInfoResponse>(userInfoUrl, {
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

    const res = await axios.post<OAuthTokenResponse>(tokenUrl, params, {
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
    return axios.create({
      baseURL: baseUri,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
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

    const pushTabs = (tabs: DocusignTextTabRef[]) => {
      for (const t of tabs) {
        const key = String(t.tabId || t.tabLabel || t.name || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(t);
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
        pushTabs((tabsRes.data?.textTabs || []) as DocusignTextTabRef[]);
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
        pushTabs((tabsRes.data?.textTabs || []) as DocusignTextTabRef[]);
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

  private async fetchEnvelopeDocumentTextTabs(
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
          for (const t of (tabsRes.data?.textTabs || []) as DocusignTextTabRef[]) {
            const key = String(t.tabId || t.tabLabel || '').trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            merged.push(t);
          }
        } catch (docErr) {
          console.warn(
            `[DocuSign] fetchEnvelopeDocumentTextTabs document ${docId} failed:`,
            docErr,
          );
        }
      }
    } catch (err) {
      console.warn('[DocuSign] fetchEnvelopeDocumentTextTabs failed:', err);
    }

    return merged;
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
    templateId: string,
  ) {
    const res = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
    );
    const signers = (res.data?.signers || []).filter(
      (s: { email?: string }) => String(s.email || '').trim(),
    );
    if (signers.length) return signers;

    const templateRoles = await this.getTemplateSignerRoleNames(
      client,
      accountId,
      templateId,
    );
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
    try {
      const tabsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
      );
      return (tabsRes.data?.textTabs || []) as DocusignTextTabRef[];
    } catch (err) {
      console.warn('[DocuSign] fetchEnvelopeSignerTextTabs failed:', err);
      return [];
    }
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
    if (!textTabs.length) return 0;
    const CHUNK_SIZE = 20;
    let applied = 0;
    for (let i = 0; i < textTabs.length; i += CHUNK_SIZE) {
      const chunk = textTabs.slice(i, i + CHUNK_SIZE).map((t) => ({
        tabId: t.tabId,
        value: t.value,
        locked: 'true',
      }));
      await client.put(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/${tabsPath}`,
        { textTabs: chunk },
      );
      applied += chunk.length;
    }
    return applied;
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
      envelopeDocTabs = await this.fetchEnvelopeDocumentTextTabs(
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

      const recipientTabs = await this.fetchEnvelopeSignerTextTabs(
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
          `[DocuSign] prefill recipient ${recipientId}: ${n} tab(s) on envelope ${envelopeId}`,
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
    const cc = [...new Set((ccEmails || []).map((e) => String(e).trim()).filter(Boolean))];
    if (cc.length) {
      fields.push({ name: 'crmCcEmails', value: cc.join(','), show: 'false' });
    }
    return fields;
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
      console.log(
        `[DocuSign] removed ${removed} carbon copy slot(s) on ${envelopeId} (CRM emails CC when sent)`,
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
   * Apply CRM signer emails onto the draft envelope (per recipient PUT — does not wipe other recipients).
   */
  private async applyCrmRolesToEnvelopeSigners(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    roles: SignerRoleInput[],
  ): Promise<{ updated: number; missingRoles: string[] }> {
    const normalized = this.normalizeSignerRoles(roles);
    if (!normalized.length) {
      return { updated: 0, missingRoles: [] };
    }

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

    const missingRoles: string[] = [];
    let updated = 0;

    for (let i = 0; i < signers.length; i++) {
      const signer = signers[i];
      const roleKey = String(signer.roleName || '').trim().toLowerCase();
      const match =
        normalized.find((n) => n.roleName.toLowerCase() === roleKey) ||
        normalized[i] ||
        normalized[0];
      const email = String(match?.email || '').trim();
      const rid = String(signer.recipientId || '').trim();
      if (!rid) continue;

      if (!email) {
        missingRoles.push(String(signer.roleName || `Signer ${i + 1}`));
        continue;
      }

      const current = String(signer.email || '').trim().toLowerCase();
      if (current === email.toLowerCase()) continue;

      await client.put(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${rid}`,
        {
          recipientId: rid,
          email,
          name: match.name || email.split('@')[0],
          roleName: signer.roleName,
          routingOrder: signer.routingOrder || String(i + 1),
        },
      );
      updated++;
      console.log(
        `[DocuSign] signer ${signer.roleName} on ${envelopeId} → ${email}`,
      );
    }

    return { updated, missingRoles };
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

      await client.put(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${rid}`,
        {
          recipientId: rid,
          email,
          name:
            String(signerName || primary.name || email.split('@')[0]).trim() ||
            email.split('@')[0],
          roleName: primary.roleName,
          routingOrder: primary.routingOrder || '1',
        },
      );
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
   * CC are NOT added as DocuSign carbon copies (that blocks signer delivery); they are stored
   * in crmCcEmails and emailed a prefilled PDF when the envelope status becomes sent.
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

    let rolesToApply: SignerRoleInput[] = Array.isArray(roles) ? roles : [];
    if (!rolesToApply.length) {
      const templateId =
        (await this.getTemplateIdFromEnvelope(client, accountId, eid)) ||
        DOCUSIGN_DEFAULT_TEMPLATE_ID;
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
    );

    const list = [...new Set(ccEmails.map((e) => String(e).trim()).filter(Boolean))];

    await this.removeEnvelopeCarbonCopies(client, accountId, eid);

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
      signersUpdated: updated,
      envelopeSigners,
      /** CC delivery is via CRM email on send, not DocuSign carbonCopies. */
      ccDelivery: 'crm_email_on_sent',
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
      .map((r, idx) => ({
        roleName: String(
          r.roleName || r.signerRole || defaultRole || `Signer ${idx + 1}`,
        ).trim(),
        name: String(r.signerName || '').trim(),
        email: String(r.signerEmail || '').trim(),
        routingOrder: String(r.signerOrder ?? idx + 1),
      }))
      .filter((r) => r.email);
  }

  private async buildTemplateRolesForSend(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
    roles: SignerRoleInput[],
    textTabs: Array<{ tabLabel: string; value: string; tabId?: string }>,
    preloadedRoleNames?: string[],
  ) {
    const signers = this.normalizeSignerRoles(roles);
    if (!signers.length) {
      throw new BadRequestException('At least one signer with a valid email is required.');
    }

    const templateRoleNames =
      preloadedRoleNames?.length ?
        preloadedRoleNames
      : await this.getTemplateSignerRoleNames(client, accountId, templateId);

    return signers.map((s, idx) => {
      const roleName =
        templateRoleNames[idx] ||
        templateRoleNames[0] ||
        s.roleName ||
        DOCUSIGN_DEFAULT_ROLE_NAME;

      return {
        roleName: String(roleName).trim(),
        name: s.name || s.email.split('@')[0],
        email: s.email,
        tabs:
          idx === 0 && textTabs.length
            ? {
                textTabs: textTabs.map((t) => ({
                  ...(t.tabId
                    ? { tabId: t.tabId, tabLabel: t.tabLabel, value: t.value }
                    : { tabLabel: t.tabLabel, value: t.value }),
                  locked: 'true',
                })),
              }
            : undefined,
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
    return desired.map((email, i) => ({
      email,
      name: email.split('@')[0],
      recipientId: String(2 + i),
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

    await prisma.document.upsert({
      where: { applicationId },
      create: {
        applicationId,
        envelopeId: String(envelopeId),
        status: 'draft',
        userId: userRecord.userId,
      },
      update: {
        envelopeId: String(envelopeId),
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
    existingDoc?: { status?: string | null; sentAt?: Date | null; applicationId?: string } | null,
  ) {
    const status = mergeWithExistingEnvelopeStatus(existingDoc?.status, incomingResolved);
    if (!status) return status;

    const updateData: Record<string, unknown> = { status };
    if (status === 'sent') {
      updateData.sentAt = existingDoc?.sentAt ?? new Date();
    } else if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    await prisma.document.updateMany({
      where: { envelopeId: String(envelopeId) },
      data: updateData as any,
    });

    const appId = applicationId || existingDoc?.applicationId || null;
    if (appId) {
      await this.syncContractSigningStatus(String(appId), status);
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
    await prisma.document.updateMany({
      where: { envelopeId: String(envelopeId), applicationId: appId },
      data: { status: 'sent', sentAt: new Date() } as any,
    });
    await this.syncContractSigningStatus(appId, 'sent');
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

  private async emailPrefilledContractPdfToCcRecipients(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    ccEmails: string[] | undefined | null,
    subjectBase: string,
  ): Promise<{ emailed: string[] }> {
    const list = [...new Set((ccEmails || []).map((e) => String(e).trim()).filter(Boolean))];
    if (!list.length) return { emailed: [] };

    if (!isOutboundSmtpConfigured()) {
      console.warn('[DocuSign] CC prefilled PDF email skipped: SMTP not configured.');
      return { emailed: [] };
    }

    await this.sleep(5000);
    const pdf = await this.downloadEnvelopePdfBufferForPreview(
      client,
      accountId,
      envelopeId,
    );
    if (!pdf?.length) {
      console.warn(`[DocuSign] No PDF for envelope ${envelopeId}; CC email skipped.`);
      return { emailed: [] };
    }

    const subject = subjectBase.trim() ? `${subjectBase.trim()} ` : 'Contract';
    const emailed: string[] = [];
    for (const to of list) {
      try {
        await sendMail({
          to,
          subject,
          html: '',
          attachments: [
            {
              filename: 'contract-prefilled.pdf',
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

  private async createSenderViewUrl(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    returnUrl: string,
  ): Promise<string> {
    const res = await client.post(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/sender`,
      { returnUrl },
    );
    const url = res.data?.url;
    if (!url) throw new BadRequestException('DocuSign did not return sender view URL');
    return url;
  }

  private async finalizeEnvelopeFlow(
    userId: string,
    envelopeId: string,
    options: {
      applicationId?: string;
      redirectUrl?: string;
      ccEmails?: string[];
      title?: string;
      prefillFields?: PrefillField[];
      templateId?: string;
      autoSend?: boolean;
      createTimePrefillTabCount?: number;
      client: AxiosInstance;
      accountId: string;
    },
  ) {
    const appId = String(options.applicationId || '').trim();
    if (appId) {
      await this.linkEnvelopeToApplication(userId, appId, envelopeId);
    }

    let prefillApplied = {
      applied: 0,
      attempted: 0,
      atCreate: 0,
      atPostCreate: 0,
    };
    if (options.prefillFields?.length) {
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
    }

    const autoSend =
      options.autoSend !== false &&
      (options.autoSend === true || DOCUSIGN_AUTO_SEND_ENVELOPE);

    await this.removeEnvelopeCarbonCopies(
      options.client,
      options.accountId,
      envelopeId,
    );

    let ccPrefilledEmail: { emailed: string[] } | null = null;
    if (options.ccEmails?.length && autoSend) {
      ccPrefilledEmail = await this.emailPrefilledContractPdfToCcRecipients(
        options.client,
        options.accountId,
        envelopeId,
        options.ccEmails,
        options.title || 'Contract',
      );
    }

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
    if (prefillApplied.applied > 0) {
      await this.sleep(autoSend ? 4000 : 5000);
    }
    if (autoSend) {
      try {
        await options.client.put(
          `/v2.1/accounts/${options.accountId}/envelopes/${envelopeId}`,
          { status: 'sent' },
        );
        envelopeStatus = 'sent';
        if (prefillApplied.applied > 0) {
          await this.sleep(6000);
        }
        if (appId) {
          await this.markEnvelopeSent(appId, envelopeId);
        } else {
          await prisma.document.updateMany({
            where: { envelopeId: String(envelopeId) },
            data: { status: 'sent', sentAt: new Date() } as any,
          });
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
    const state = this.normalizeTemplateLookupKey(filters.state);
    const frequency = this.normalizeTemplateLookupKey(filters.frequency);
    const type = this.normalizeTemplateLookupKey(filters.type);

    const where: Prisma.BoldSignTemplateWhereInput = {};
    if (state) where.state = state;
    if (frequency) where.frequency = frequency;
    if (type) where.type = type;

    const rows = await prisma.boldSignTemplate.findMany({
      where,
      select: { templateId: true },
    });
    return [...new Set(rows.map((r) => String(r.templateId).trim()).filter(Boolean))];
  }

  // ─── Send single template ────────────────────────────────────────────────────

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
      reminderSettings?: {
        enableAutoReminder?: boolean;
        reminderDays?: number;
        reminderCount?: number;
      };
      /** When true (or DOCUSIGN_AUTO_SEND_ENVELOPE), emails signers without opening sender view. */
      autoSend?: boolean;
    },
  ) {
    const { client, accountId } = await this.getAuthContext(userId);
    const templateId = options.templateId || DOCUSIGN_DEFAULT_TEMPLATE_ID;
    if (!templateId) {
      throw new BadRequestException('templateId is required (set DOCUSIGN_DEFAULT_TEMPLATE_ID).');
    }

    let roles: SignerRoleInput[] = options.roles?.length
      ? options.roles
      : [
          {
            signerName: options.signerName || '',
            signerEmail: options.signerEmail || '',
            roleName: DOCUSIGN_DEFAULT_ROLE_NAME,
          },
        ];

    const templateDef = await this.fetchTemplateDefinition(client, accountId, templateId);
    const textTabs = await this.buildTextTabsForPrefill(
      client,
      accountId,
      templateId,
      options.prefillFields,
      templateDef.textTabs,
    );
    const templateRoles = await this.buildTemplateRolesForSend(
      client,
      accountId,
      templateId,
      roles,
      textTabs,
      templateDef.roleNames,
    );
    const createTimePrefillTabCount = textTabs.length;

    const envelopeDefinition: Record<string, unknown> = {
      status: 'created',
      emailSubject: options.title || 'Please sign this document',
      emailBlurb: options.message || '',
      templateId,
      templateRoles,
    };

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

    try {
      const createRes = await client.post(
        `/v2.1/accounts/${accountId}/envelopes`,
        envelopeDefinition,
      );
      const envelopeId = createRes.data?.envelopeId;
      if (!envelopeId) {
        throw new BadRequestException('DocuSign did not return envelopeId');
      }

      await this.assertEnvelopeHasSigners(client, accountId, envelopeId, templateId);

      return this.finalizeEnvelopeFlow(userId, envelopeId, {
        applicationId: options.applicationId,
        redirectUrl: options.redirectUrl,
        ccEmails: options.ccEmails,
        title: options.title,
        prefillFields: options.prefillFields,
        templateId,
        autoSend: options.autoSend,
        createTimePrefillTabCount,
        client,
        accountId,
      });
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
      throw new BadRequestException('Failed to send template: ' + (error?.message || error));
    }
  }

  // ─── Merge multiple templates (composite) ───────────────────────────────────

  async mergeAndSendTemplates(
    userId: string,
    options: {
      templates?: Array<{ templateId: string }>;
      templateIds?: string[];
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
      autoSend?: boolean;
    },
  ) {
    if (!options?.roles?.length) {
      throw new BadRequestException('At least one role is required');
    }

    let templateIds: string[] = [];
    if (options.templateIds?.length) {
      templateIds = options.templateIds.map((id) => String(id).trim()).filter(Boolean);
    } else if (options.contractTemplateFilters) {
      templateIds = await this.resolveTemplateIdsFromDb(options.contractTemplateFilters);
    } else if (options.templates?.length) {
      templateIds = options.templates.map((t) => String(t.templateId).trim()).filter(Boolean);
    }

    if (!templateIds.length) {
      throw new BadRequestException(
        'No DocuSign template IDs to merge. Provide templateIds or contractTemplateFilters.',
      );
    }

    if (templateIds.length === 1) {
      return this.sendTemplate(userId, {
        templateId: templateIds[0],
        roles: options.roles,
        prefillFields: options.prefillFields,
        redirectUrl: options.redirectUrl,
        applicationId: options.applicationId,
        ccEmails: options.ccEmails,
        title: options.title,
        message: options.message,
        autoSend: options.autoSend,
      });
    }

    const { client, accountId } = await this.getAuthContext(userId);
    const textTabs = await this.buildTextTabsForPrefill(
      client,
      accountId,
      templateIds[0],
      options.prefillFields,
    );
    const signers = this.normalizeSignerRoles(options.roles);
    if (!signers.length) {
      throw new BadRequestException('At least one signer with a valid email is required.');
    }

    const primarySigner = signers[0];
    const templateRoleNames = await this.getTemplateSignerRoleNames(
      client,
      accountId,
      templateIds[0],
    );
    const roleName =
      templateRoleNames[0] || primarySigner.roleName || DOCUSIGN_DEFAULT_ROLE_NAME;

    const compositeTemplates = templateIds.map((tid, idx) => ({
      compositeTemplateId: String(idx + 1),
      serverTemplates: [{ sequence: '1', templateId: tid }],
      inlineTemplates: [
        {
          sequence: String(idx + 1),
          recipients: {
            signers: [
              {
                roleName,
                name: primarySigner.name || primarySigner.email.split('@')[0],
                email: primarySigner.email,
                recipientId: '1',
                routingOrder: String(primarySigner.routingOrder || idx + 1),
                ...(idx === 0 && textTabs.length ? { tabs: { textTabs } } : {}),
              },
            ],
          },
        },
      ],
    }));

    const envelopeDefinition: Record<string, unknown> = {
      status: 'created',
      emailSubject: options.title || 'Please sign this document',
      emailBlurb: options.message || '',
      compositeTemplates,
    };

    const appId = String(options.applicationId || '').trim();
    const mergeCustomFields = this.buildEnvelopeTextCustomFields(
      appId,
      options.ccEmails,
    );
    if (mergeCustomFields.length) {
      (envelopeDefinition as any).customFields = {
        textCustomFields: mergeCustomFields,
      };
    }

    const connectNotification = this.buildEnvelopeConnectNotification();
    if (connectNotification) {
      (envelopeDefinition as any).eventNotification = connectNotification;
    }

    try {
      const createRes = await client.post(
        `/v2.1/accounts/${accountId}/envelopes`,
        envelopeDefinition,
      );
      const envelopeId = createRes.data?.envelopeId;
      if (!envelopeId) {
        throw new BadRequestException('DocuSign did not return envelopeId from composite merge');
      }

      const result = await this.finalizeEnvelopeFlow(userId, envelopeId, {
        applicationId: options.applicationId,
        redirectUrl: options.redirectUrl,
        ccEmails: options.ccEmails,
        title: options.title,
        prefillFields: options.prefillFields,
        templateId: templateIds[0],
        autoSend: options.autoSend,
        client,
        accountId,
      });

      return {
        ...result,
        data: {
          ...(result.data as object),
          templateIds,
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
      throw new BadRequestException('Failed to merge and send templates: ' + (error?.message || error));
    }
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
    const { client, accountId } = await this.getAuthContext(userId);
    const result = await this.applyPrefillToEnvelope(
      userId,
      client,
      accountId,
      documentId,
      undefined,
      fields,
    );
    if (!result.applied) {
      throw new BadRequestException(
        'No DocuSign form fields matched the provided prefill ids for this envelope.',
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
    const { client, accountId } = await this.getAuthContext(userId);
    await client.put(`/v2.1/accounts/${accountId}/envelopes/${documentId}`, {
      status: 'voided',
      voidedReason: reason || 'Voided by user',
    });
    await prisma.document.updateMany({
      where: { envelopeId: documentId },
      data: { status: 'revoked' },
    });
    return { success: true };
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

  async downloadTemplatePdf(userId: string, templateId: string) {
    const { client, accountId } = await this.getAuthContext(userId);
    const listRes = await client.get(
      `/v2.1/accounts/${accountId}/templates/${templateId}/documents`,
    );
    const docs = listRes.data?.templateDocuments || listRes.data?.documents || [];
    const docId = docs[0]?.documentId || '1';
    const res = await client.get(
      `/v2.1/accounts/${accountId}/templates/${templateId}/documents/${docId}`,
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data);
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

  async getTemplateRecipients(userId: string, templateId?: string) {
    const { client, accountId } = await this.getAuthContext(userId);
    const tid = templateId || DOCUSIGN_DEFAULT_TEMPLATE_ID;
    if (!tid) {
      throw new BadRequestException('templateId is required');
    }

    const res = await client.get(
      `/v2.1/accounts/${accountId}/templates/${tid}/recipients`,
    );
    const signers = res.data?.signers || [];
    const roles = signers.map((s: any, idx: number) => ({
      roleIndex: idx + 1,
      roleName: s.roleName || `Role-${idx + 1}`,
      signerName: s.name || '',
      signerEmail: s.email || '',
      signerOrder: s.routingOrder ? Number(s.routingOrder) : idx + 1,
    }));

    return {
      success: true,
      templateId: tid,
      roles,
      raw: res.data,
    };
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
    const ccList = [...new Set((options?.ccEmails || []).map((e) => String(e).trim()).filter(Boolean))];
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
    const url = await this.createSenderViewUrl(client, accountId, eid, returnUrl);
    return { url };
  }

  private async emailCcPrefilledPdfIfConfigured(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    ccEmails: string[],
    subjectBase = 'Contract',
  ) {
    const list = [...new Set(ccEmails.map((e) => String(e).trim()).filter(Boolean))];
    if (!list.length) return { emailed: [] as string[] };
    return this.emailPrefilledContractPdfToCcRecipients(
      client,
      accountId,
      envelopeId,
      list,
      subjectBase,
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
      let ccEmails = [
        ...new Set(
          (ccEmailsOverride || [])
            .map((e) => String(e).trim())
            .filter(Boolean),
        ),
      ];
      if (!ccEmails.length) {
        ccEmails = await this.getEnvelopeCcEmailsFromApi(
          client,
          accountId,
          envelopeId,
        );
      }
      if (!ccEmails.length) {
        return { emailed: [], skippedReason: 'no_cc_addresses' };
      }
      if (!isOutboundSmtpConfigured()) {
        return { emailed: [], skippedReason: 'smtp_not_configured' };
      }
      const result = await this.emailCcPrefilledPdfIfConfigured(
        client,
        accountId,
        envelopeId,
        ccEmails,
        'Contract',
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
    const ccFromRequest = options?.ccEmails || [];
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

    const ccForEmail = ccFromRequest.length
      ? ccFromRequest
      : await this.getEnvelopeCcEmailsFromApi(client, accountId, eid);
    const ccPrefilledEmail = await this.emailCcPrefilledPdfIfConfigured(
      client,
      accountId,
      eid,
      ccForEmail,
      options?.title || 'Contract',
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

    const customFields = body?.data?.customFields as
      | { textCustomFields?: Array<{ name?: string; value?: string }> }
      | undefined;
    let applicationId =
      customFields?.textCustomFields?.find?.(
        (f) => f.name === 'crmApplicationId',
      )?.value || null;

    if (!applicationId && existingDoc?.applicationId) {
      applicationId = existingDoc.applicationId;
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
    options: { applicationId?: string; envelopeId?: string; ccEmails?: string[] },
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

    const { client, accountId } = await this.getAuthContext(userId);
    const res = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
    );
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
    );

    let ccPrefilledEmail: { emailed: string[]; skippedReason?: string } = {
      emailed: [],
    };
    if (
      incomingResolved === 'sent' &&
      priorStatus !== 'sent' &&
      priorStatus !== 'completed'
    ) {
      ccPrefilledEmail = await this.notifyCcRecipientsOnEnvelopeSent(
        userId,
        envelopeId,
        appId,
        existingDoc,
        options.ccEmails,
      );
    }

    return {
      envelopeId,
      applicationId: appId,
      docusignStatus: dsStatus,
      internalStatus: status,
      contractStatus: status
        ? internalEnvelopeStatusToContractStatusDbValue(status)
        : null,
      ccPrefilledEmail,
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
