import axios, { type AxiosInstance } from '../../types/http';
import { createHash } from 'crypto';
import type { DocuSignUserInfoResponse, OAuthTokenResponse } from '../../types/oauth-api';
import dotenv from 'dotenv';
import prisma from '../../config/prismaClient';
import { isPreferredCapitalBranding } from '../../utils/preferredCapitalBranding';
import { Prisma } from '@prisma/client';
import { resolveDocumentOwnerNumericUserId } from '../../middleware/authMiddleware';
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
  DOCUSIGN_SENDER_RETURN_URL,
  DOCUSIGN_DEFAULT_CC_EMAIL,
  formatDocusignApiErrorMessage,
  getDocusignRetryAfterMs,
  isDocuSignPollingLimitError,
} from './utils/docusign-client';
import {
  clearEnvelopePollingCooldown,
  getCachedEnvelopeCustomFields,
  getCachedEnvelopeDocumentTabs,
  getCachedEnvelopePdf,
  getCachedEnvelopeRecipients,
  getCachedEnvelopeRecipientTabs,
  getCachedEnvelopeStatus,
  getEnvelopePollingCooldownRemainingMs,
  getEnvelopeStatusSyncCache,
  invalidateCachedEnvelopePdf,
  invalidateCachedEnvelopeRecipients,
  invalidateCachedEnvelopeStatus,
  rememberEnvelopeWebhook,
  setCachedEnvelopeCustomFields,
  setCachedEnvelopeDocumentTabs,
  setCachedEnvelopePdf,
  setCachedEnvelopeRecipients,
  setCachedEnvelopeRecipientTabs,
  setCachedEnvelopeStatus,
  setEnvelopePollingCooldown,
  setEnvelopeStatusSyncCache,
  shouldSkipDocuSignPollForWebhook,
} from './utils/docusign-rate-limit';
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
  clearDocusignProfileJwtCache,
  getDocusignJwtSessionForProfile,
} from './utils/docusign-profile-jwt';
import {
  getFunderWithDocuSignCredentials,
  resolveFunderProfile,
  isPersistedFunderProfileId,
  resolveEnvelopeMailSender,
} from '../funderProfileService';
import { resolveMainContractLayoutKeyForSend } from './utils/resolve-main-contract-layout';
import {
  extractCrmApplicationIdFromWebhook,
  extractCrmEnvelopeKindFromWebhook,
  extractDocusignConnectEventName,
  extractDocusignEnvelopeId,
  extractWebhookTextCustomFields,
  internalEnvelopeStatusToContractStatusDbValue,
  mapDocusignEnvelopeStatus,
  mergeWithExistingEnvelopeStatus,
  parseDocusignWebhookBody,
  resolveDocusignWebhookEnvelopeStatus,
} from './utils/docusign-webhook';
import { decryptField, isEncrypted } from '../../utils/fieldEncryption';
import {
  buildPlatformLayoutEnvelopeDefinition,
  filterSupplementalRefs,
  resolveSupplementalRefsFromDb,
} from './utils/platform-layout-envelope';
import {
  linkStandalonePackageEnvelopeToContract,
  resolveStandaloneLinkKind,
  isStandalonePackageEnvelope,
  updateStandalonePackageDocuSignStatus,
  STANDALONE_PACKAGE_DOCUSIGN_KEY,
} from './utils/standalone-package-docusign';
import {
  archiveMainContractEnvelopeToHistory,
  contractPrefillContainsEnvelopeId,
  isCompletedEnvelopeStatus,
  persistMainContractSendPackage,
  resolveArchivedMainContractEnvelopeStatus,
  updateArchivedContractSendHistoryStatus,
} from './utils/contract-send-history';
import {
  ACH_AUTHORIZATION_DOCUSIGN_KEY,
  clearAchAuthorizationIfMatchesMainContract,
  findAchEnvelopeAuthHints,
  findApplicationIdByAchEnvelopeId,
  isStandaloneAchEnvelope,
  linkAchAuthorizationEnvelopeToContract,
  parseAchAuthorizationDocuSignFromPrefill,
  updateAchAuthorizationDocuSignStatus,
} from './utils/ach-authorization-docusign';
import { syncApplicationOnMainContractResend } from '../contractApplicationWorkflowSync';
import {
  emitContractSigningStatusRealtime,
  handleContractSigningStatusTransition,
} from '../contractSigningStatusEffects';
import {
  buildAchFormEnvelopeEmailSubject,
  buildContractEnvelopeDocumentName,
  buildContractEnvelopeEmailSubject,
  buildContractEnvelopePdfFilename,
  ensureSubjectAmountHasDollarSign,
  normalizeContractCcEmailSubject,
} from '../../utils/contractEnvelopeEmailSubject';
import {
  isDocuSignUserNotEnvelopeSenderError,
  listEnvelopeFunderAuthCandidates,
  resolveEnvelopeFunderAuthHints,
  type EnvelopeFunderAuthHints,
} from './utils/envelope-funder-auth';
import {
  archiveSignedEnvelopePdf,
  fetchStoredSignedPdfBuffer,
  getStoredEnvelopePdfArchive,
  getStoredSignedPdfUrl,
  isDocumentFullySignedStatus,
  isSignedPhaseArchiveUrl,
} from './utils/archive-signed-envelope-pdf';
import { resolveApplicationDisplayNumber } from '../../utils/applicationDisplayNumber';

/** Contract signing status labels for notifications */
const CONTRACT_STATUS_LABELS: Record<string, string> = {
  sent: 'Contract Sent',
  viewed: 'Contract Viewed',
  signed: 'Contract Signed',
  completed: 'Contract Fully Signed',
  declined: 'Contract Declined',
  revoked: 'Contract Revoked',
  expired: 'Contract Expired',
};

/** Get human-readable status label */
function getContractStatusLabel(status: string): string {
  return CONTRACT_STATUS_LABELS[status] || `Contract Status: ${status}`;
}

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

class NotFoundException extends Error {
  status = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundException';
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

class DocusignCooldownException extends Error {
  status = 429;
  retryAfterSeconds: number;

  constructor(retryAfterMs: number) {
    const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    super(
      `DocuSign rate-limit cooldown is active for this envelope. Retry after ${seconds} seconds.`,
    );
    this.name = 'DocusignCooldownException';
    this.retryAfterSeconds = seconds;
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
  /**
   * Dedupes CC PDF downloads across Connect webhooks / sync for the same envelope.
   * Without this, recipient-sent events can burn dozens of DocuSign API calls each.
   */
  private readonly ccNotifyAttemptedAt = new Map<string, number>();
  private readonly ccNotifyInFlight = new Set<string>();
  private static readonly CC_NOTIFY_COOLDOWN_MS = 60 * 60 * 1000;
  /** Coalesce simultaneous cold-cache recipient reads for the same account/envelope. */
  private readonly recipientsInFlight = new Map<string, Promise<any>>();
  /** Negative cache after DocuSign 429 so callers cannot hammer a limited envelope. */
  private readonly recipientsCooldownUntil = new Map<string, number>();
  /** Coalesce cold document/recipient tab reads used by draft prefill. */
  private readonly envelopeDocumentTabsInFlight = new Map<
    string,
    Promise<DocusignTextTabRef[]>
  >();
  private readonly envelopeRecipientTabsInFlight = new Map<
    string,
    Promise<DocusignTextTabRef[]>
  >();
  /** Serialize and dedupe prefill mutations for each envelope. */
  private readonly prefillQueue = new Map<string, Promise<void>>();
  private readonly successfulPrefill = new Map<
    string,
    {
      signature: string;
      result: { applied: number; attempted: number };
      expiresAt: number;
    }
  >();
  private readonly prefillCooldownUntil = new Map<string, number>();
  private static readonly PREFILL_DEDUPE_TTL_MS = 5 * 60_000;
  /** Coalesce concurrent PDF preview downloads for the same envelope. */
  private readonly envelopePdfDownloadInFlight = new Map<string, Promise<Buffer | null>>();

  private assertEnvelopePollingAllowed(envelopeId: string): void {
    const remaining = getEnvelopePollingCooldownRemainingMs(envelopeId);
    if (remaining > 0) {
      throw new DocusignCooldownException(remaining);
    }
  }

  private rememberEnvelopePollingLimit(envelopeId: string, err: unknown): void {
    if (!isDocuSignPollingLimitError(err)) return;
    setEnvelopePollingCooldown(envelopeId, getDocusignRetryAfterMs(err));
  }

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

  private createRestClient(
    accessToken: string,
    baseUri: string,
    _accountId: string,
  ): AxiosInstance {
    return axios.create({
      baseURL: baseUri,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Cached GET /envelopes/{id}/recipients — DocuSign counts each call toward the 250/hour
   * envelope polling budget. After local mutations, prefer patching the cache (see
   * `rememberEnvelopeRecipients`) instead of invalidate + refetch.
   */
  private async getEnvelopeRecipients(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<any> {
    const eid = String(envelopeId || '').trim();
    const key = `${String(accountId || '').trim().toLowerCase()}::${eid}`;
    const blockedUntil = this.recipientsCooldownUntil.get(key) || 0;
    if (blockedUntil > Date.now()) {
      throw new DocusignCooldownException(blockedUntil - Date.now());
    }
    if (blockedUntil) this.recipientsCooldownUntil.delete(key);

    if (!options?.forceRefresh) {
      const cached = getCachedEnvelopeRecipients(accountId, eid);
      if (cached != null) return cached;
    }

    const existing = this.recipientsInFlight.get(key);
    if (existing) return existing;

    const request = (async () => {
      try {
        const res = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${eid}/recipients`,
        );
        setCachedEnvelopeRecipients(accountId, eid, res.data);
        this.recipientsCooldownUntil.delete(key);
        return res.data;
      } catch (err) {
        if (isDocuSignPollingLimitError(err)) {
          const retryAfterMs = getDocusignRetryAfterMs(err);
          this.recipientsCooldownUntil.set(key, Date.now() + retryAfterMs);
          this.rememberEnvelopePollingLimit(eid, err);
          console.warn(
            `[DocuSign] GetRecipients cooldown ${Math.ceil(retryAfterMs / 1000)}s for envelope ${eid}`,
          );
        }
        throw err;
      }
    })();
    this.recipientsInFlight.set(key, request);
    try {
      return await request;
    } finally {
      if (this.recipientsInFlight.get(key) === request) {
        this.recipientsInFlight.delete(key);
      }
    }
  }

  /** Keep recipients in cache in sync after PUT/DELETE so the send flow needs one GET. */
  private rememberEnvelopeRecipients(
    accountId: string,
    envelopeId: string,
    data: unknown,
  ): void {
    if (data == null) return;
    setCachedEnvelopeRecipients(accountId, envelopeId, data);
  }

  private cloneRecipientsData<T>(data: T): T {
    return JSON.parse(JSON.stringify(data ?? {})) as T;
  }

  private async getJwtAuthContext() {
    try {
      const { accessToken, accountId, baseUri } = await getDocusignJwtSession();
      return {
        user: null as any,
        accountId,
        client: this.createRestClient(accessToken, baseUri, accountId),
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
    const accountId = user.docusignAccountId as string;
    return {
      user,
      accountId,
      client: this.createRestClient(user.docusignAccessToken, baseUri, accountId),
    };
  }

  private async getJwtAuthContextForFunderProfile(funderProfileId: string) {
    const profileId = String(funderProfileId || '').trim();
    if (!isPersistedFunderProfileId(profileId)) {
      throw new ServiceConfigException(`Invalid funder profile id "${profileId}".`);
    }
    const row = await prisma.funderProfile.findUnique({
      where: { id: profileId },
      include: { docusignAccountProfile: true },
    });
    const dsProfile = row?.docusignAccountProfile;
    if (!row || !dsProfile?.id || dsProfile.isActive === false) {
      throw new ServiceConfigException(
        `Funder profile "${profileId}" has no active linked DocuSign account.`,
      );
    }
    try {
      const { accessToken, accountId, baseUri } = await getDocusignJwtSessionForProfile(
        String(dsProfile.id),
        {
          integrationKey: dsProfile.integrationKey,
          impersonatedUserId: dsProfile.impersonatedUserId,
          rsaPrivateKey: dsProfile.rsaPrivateKey,
          accountId: dsProfile.accountId,
          baseUri: dsProfile.baseUri,
        },
      );
      return {
        user: null as any,
        accountId,
        client: this.createRestClient(accessToken, baseUri, accountId),
        docusignProfileId: String(dsProfile.id),
      };
    } catch (error: any) {
      clearDocusignProfileJwtCache(String(dsProfile.id));
      const detail = error?.response?.data?.error_description || error?.message || String(error);
      if (isDocusignJwtConfigured()) {
        console.warn(
          `[DocuSign] Funder profile "${row.name}" linked DocuSign JWT failed (${detail}); falling back to platform JWT.`,
        );
        return this.getJwtAuthContext();
      }
      throw new ServiceConfigException(
        `DocuSign JWT failed for funder profile "${row.name}". ${detail}`,
      );
    }
  }

  private async getJwtAuthContextForFunder(
    funderName?: string | null,
    contractState?: string | null,
  ) {
    const name = String(funderName || '').trim();
    if (!name) return this.getJwtAuthContext();

    const linked = await getFunderWithDocuSignCredentials(name, contractState);
    const profile = linked?.docusignProfile;
    if (!profile?.id || profile.isActive === false) {
      return this.getJwtAuthContext();
    }

    try {
      const { accessToken, accountId, baseUri } = await getDocusignJwtSessionForProfile(
        String(profile.id),
        {
          integrationKey: profile.integrationKey,
          impersonatedUserId: profile.impersonatedUserId,
          rsaPrivateKey: profile.rsaPrivateKey,
          accountId: profile.accountId,
          baseUri: profile.baseUri,
        },
      );
      return {
        user: null as any,
        accountId,
        client: this.createRestClient(accessToken, baseUri, accountId),
        docusignProfileId: String(profile.id),
      };
    } catch (error: any) {
      clearDocusignProfileJwtCache(String(profile.id));
      const detail = error?.response?.data?.error_description || error?.message || String(error);
      // Misconfigured funder DocuSign profiles (e.g. user_not_found) must not block
      // contract send when the platform demo/prod JWT still works.
      if (isDocusignJwtConfigured()) {
        console.warn(
          `[DocuSign] Funder "${name}" profile "${profile.name}" JWT failed (${detail}); falling back to platform JWT.`,
        );
        return this.getJwtAuthContext();
      }
      throw new ServiceConfigException(
        `DocuSign JWT failed for funder "${name}" (profile "${profile.name}"). ${detail}`,
      );
    }
  }

  private async getAuthContext(
    userId: string,
    options?: {
      funderName?: string | null;
      funderProfileId?: string | null;
      contractState?: string | null;
      usePlatformDefault?: boolean;
      /** When true, do not silently fall back to platform JWT if funder has no DocuSign link. */
      requireFunderCredentials?: boolean;
    },
  ) {
    if (resolveDocusignAuthMode() === 'jwt') {
      if (options?.usePlatformDefault) {
        if (!isDocusignJwtConfigured()) {
          throw new ServiceConfigException(
            'DocuSign JWT is not configured. Set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_IMPERSONATED_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY.',
          );
        }
        return this.getJwtAuthContext();
      }

      const funderProfileId = String(options?.funderProfileId || '').trim();
      if (funderProfileId && isPersistedFunderProfileId(funderProfileId)) {
        try {
          return await this.getJwtAuthContextForFunderProfile(funderProfileId);
        } catch (err) {
          const funderName = String(options?.funderName || '').trim();
          if (!funderName || options?.requireFunderCredentials) throw err;
        }
      }
      const funderName = String(options?.funderName || '').trim();
      if (funderName) {
        const linked = await getFunderWithDocuSignCredentials(
          funderName,
          options?.contractState,
        );
        if (linked?.docusignProfile?.id && linked.docusignProfile.isActive !== false) {
          return this.getJwtAuthContextForFunder(funderName, options?.contractState);
        }
        if (options?.requireFunderCredentials) {
          throw new ServiceConfigException(
            `Funder "${funderName}" has no active linked DocuSign account in Settings.`,
          );
        }
      }
      if (options?.requireFunderCredentials) {
        throw new ServiceConfigException(
          'No funder DocuSign credentials available for this envelope sender candidate.',
        );
      }
      if (!isDocusignJwtConfigured()) {
        throw new ServiceConfigException(
          'DocuSign JWT is not configured. Set DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_IMPERSONATED_USER_ID, and DOCUSIGN_RSA_PRIVATE_KEY, or link this funder to a DocuSign account in Settings.',
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
    const cached = getCachedEnvelopeDocumentTabs<DocusignTextTabRef[]>(
      accountId,
      envelopeId,
    );
    if (cached) return cached;

    const requestKey = `${String(accountId).trim().toLowerCase()}::${String(envelopeId).trim()}`;
    const existing = this.envelopeDocumentTabsInFlight.get(requestKey);
    if (existing) return existing;

    const request = (async () => {
      const merged: DocusignTextTabRef[] = [];
      const seen = new Set<string>();

      try {
        this.assertEnvelopePollingAllowed(envelopeId);
        const docsRes = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents`,
        );
        clearEnvelopePollingCooldown(envelopeId);
        const docs = docsRes.data?.envelopeDocuments || docsRes.data?.documents || [];
        const contentDocs = this.filterEnvelopeContentDocuments(
          docs.length ? docs : [{ documentId: '1' }],
        );
        const toFetch = contentDocs.length ? contentDocs : [{ documentId: '1' }];

        for (const doc of toFetch) {
          const docId = String(doc?.documentId ?? '1');
          try {
            this.assertEnvelopePollingAllowed(envelopeId);
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
            // Never keep polling after DocuSign's 250/hour envelope GET budget is exhausted.
            if (isDocuSignPollingLimitError(docErr)) {
              this.rememberEnvelopePollingLimit(envelopeId, docErr);
              throw docErr;
            }
            console.warn(
              `[DocuSign] fetchEnvelopeDocumentTextTabs document ${docId} failed:`,
              docErr,
            );
          }
        }
      } catch (err) {
        if (isDocuSignPollingLimitError(err)) {
          this.rememberEnvelopePollingLimit(envelopeId, err);
          throw err;
        }
        console.warn('[DocuSign] fetchEnvelopeDocumentTextTabs failed:', err);
      }

      setCachedEnvelopeDocumentTabs(accountId, envelopeId, merged);
      return merged;
    })();

    this.envelopeDocumentTabsInFlight.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (this.envelopeDocumentTabsInFlight.get(requestKey) === request) {
        this.envelopeDocumentTabsInFlight.delete(requestKey);
      }
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
    const data = await this.getEnvelopeRecipients(client, accountId, envelopeId);
    const signers = (data?.signers || []).filter(
      (s: { email?: string }) => String(s.email || '').trim(),
    );
    if (signers.length) return signers;

    if (templateId) {
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

    throw new BadRequestException(
      'DocuSign envelope has no signers with email. Provide roles with signerEmail for each signer.',
    );
  }

  private async fetchEnvelopeSignerTextTabs(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    recipientId: string,
  ): Promise<DocusignTextTabRef[]> {
    const cached = getCachedEnvelopeRecipientTabs<DocusignTextTabRef[]>(
      accountId,
      envelopeId,
      recipientId,
    );
    if (cached) return cached;

    const requestKey =
      `${String(accountId).trim().toLowerCase()}::${String(envelopeId).trim()}` +
      `::${String(recipientId).trim()}`;
    const existing = this.envelopeRecipientTabsInFlight.get(requestKey);
    if (existing) return existing;

    const request = (async () => {
      try {
        const tabsRes = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
        );
        const tabs = (tabsRes.data?.textTabs || []) as DocusignTextTabRef[];
        setCachedEnvelopeRecipientTabs(accountId, envelopeId, recipientId, tabs);
        return tabs;
      } catch (err) {
        if (isDocuSignPollingLimitError(err)) throw err;
        console.warn('[DocuSign] fetchEnvelopeSignerTextTabs failed:', err);
        return [];
      }
    })();

    this.envelopeRecipientTabsInFlight.set(requestKey, request);
    try {
      return await request;
    } finally {
      if (this.envelopeRecipientTabsInFlight.get(requestKey) === request) {
        this.envelopeRecipientTabsInFlight.delete(requestKey);
      }
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
    const ax = err as { response?: { data?: { errorCode?: string } } };
    const code = ax?.response?.data?.errorCode;
    const message = formatDocusignApiErrorMessage(err);
    console.warn(`[DocuSign] ${context}${code ? ` (${code})` : ''}: ${message}`);
  }

  private normalizeSenderReturnUrl(returnUrl: string): string {
    const raw = String(returnUrl || '').trim();
    if (!raw) return DOCUSIGN_SENDER_RETURN_URL;
    try {
      const u = new URL(raw);
      const host = u.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        u.protocol === 'http:'
      ) {
        return DOCUSIGN_SENDER_RETURN_URL;
      }
      return raw;
    } catch {
      return DOCUSIGN_SENDER_RETURN_URL;
    }
  }

  /**
   * DocuSign demo REST rejects per-recipient PUT .../recipients/{id} (INVALID_API_VERSION).
   * Bulk PUT .../recipients with { signers: [...] } is the supported update path.
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
    // Patch cache instead of invalidate — avoids a fresh GETRecipient for CC/finalize.
    const cached = getCachedEnvelopeRecipients(accountId, envelopeId) as
      | { signers?: Array<Record<string, unknown>>; [k: string]: unknown }
      | null;
    if (cached && Array.isArray(cached.signers)) {
      const byId = new Map(
        signerUpdates.map((s) => [String(s.recipientId), s] as const),
      );
      const next = this.cloneRecipientsData(cached);
      next.signers = (cached.signers || []).map((s) => {
        const rid = String(s.recipientId || '');
        const u = byId.get(rid);
        if (!u) return s;
        return {
          ...s,
          email: u.email,
          name: u.name,
          roleName: u.roleName ?? s.roleName,
          routingOrder: u.routingOrder ?? s.routingOrder,
        };
      });
      this.rememberEnvelopeRecipients(accountId, envelopeId, next);
    } else {
      invalidateCachedEnvelopeRecipients(accountId, envelopeId);
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
        // Contract / addendum / disclosure text on the PDF must be ALL CAPS.
        return { id, value: value.toUpperCase() };
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
   * One cached GETRecipient; per-signer tabs GETs (required for multi-signer Data Labels);
   * one document-tabs pass for leftover labels. Aborts immediately on polling 429.
   */
  private async applyPrefillToEnvelope(
    userId: string,
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    templateId: string | undefined,
    prefillFields?: PrefillField[],
  ): Promise<{ applied: number; attempted: number }> {
    const fields = this.sanitizePrefillFieldsForDocuSign(prefillFields);
    if (!fields.length) return { applied: 0, attempted: 0 };

    const queueKey = `${String(accountId).trim().toLowerCase()}::${String(envelopeId).trim()}`;
    const signature = createHash('sha256')
      .update(
        JSON.stringify(
          [...fields].sort(
            (a, b) => a.id.localeCompare(b.id) || a.value.localeCompare(b.value),
          ),
        ),
      )
      .digest('hex');
    const readSuccessfulResult = () => {
      const hit = this.successfulPrefill.get(queueKey);
      if (!hit) return null;
      if (Date.now() >= hit.expiresAt) {
        this.successfulPrefill.delete(queueKey);
        return null;
      }
      return hit.signature === signature ? hit.result : null;
    };

    const cached = readSuccessfulResult();
    if (cached) return cached;

    const previous = this.prefillQueue.get(queueKey) || Promise.resolve();
    const request = previous.catch(() => undefined).then(async () => {
      const blockedUntil = this.prefillCooldownUntil.get(queueKey) || 0;
      if (blockedUntil > Date.now()) {
        throw new DocusignCooldownException(blockedUntil - Date.now());
      }
      if (blockedUntil) this.prefillCooldownUntil.delete(queueKey);

      const queuedCacheHit = readSuccessfulResult();
      if (queuedCacheHit) return queuedCacheHit;

      try {
        const result = await this.applyPrefillToEnvelopeNow(
          userId,
          client,
          accountId,
          envelopeId,
          templateId,
          fields,
        );
        this.successfulPrefill.set(queueKey, {
          signature,
          result,
          expiresAt: Date.now() + DocusignService.PREFILL_DEDUPE_TTL_MS,
        });
        this.prefillCooldownUntil.delete(queueKey);
        return result;
      } catch (err) {
        if (isDocuSignPollingLimitError(err)) {
          this.prefillCooldownUntil.set(
            queueKey,
            Date.now() + getDocusignRetryAfterMs(err),
          );
          this.rememberEnvelopePollingLimit(envelopeId, err);
        }
        throw err;
      }
    });
    const queueTail = request.then(
      () => undefined,
      () => undefined,
    );
    this.prefillQueue.set(queueKey, queueTail);

    try {
      return await request;
    } finally {
      if (this.prefillQueue.get(queueKey) === queueTail) {
        this.prefillQueue.delete(queueKey);
      }
    }
  }

  private async applyPrefillToEnvelopeNow(
    _userId: string,
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    templateId: string | undefined,
    prefillFields?: PrefillField[],
  ): Promise<{ applied: number; attempted: number }> {
    const fields = this.sanitizePrefillFieldsForDocuSign(prefillFields);
    if (!fields.length) return { applied: 0, attempted: 0 };

    const recipientsData = await this.getEnvelopeRecipients(
      client,
      accountId,
      envelopeId,
    );
    const signers = recipientsData?.signers || [];
    if (!signers.length) {
      console.warn(`[DocuSign] prefill skipped: no signers on envelope ${envelopeId}`);
      return { applied: 0, attempted: fields.length };
    }

    // Document tab catalog once — needed so leftover Data Labels still map correctly.
    const envelopeDocTabs = await this.fetchEnvelopeDocumentTextTabs(
      client,
      accountId,
      envelopeId,
    );

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
        invalidateCachedEnvelopePdf(envelopeId);
        console.log(
          `[DocuSign] prefill recipient ${recipientId}: ${n} tab(s) on envelope ${envelopeId}`,
        );
      } catch (recipientErr) {
        if (isDocuSignPollingLimitError(recipientErr)) throw recipientErr;
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
          if (isDocuSignPollingLimitError(recipientErr)) throw recipientErr;
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

  /** Default Woodmere CC unless funder profile overrides; then user-added addresses (deduped). */
  private normalizeCcEmails(
    ccEmails?: string[] | null,
    options?: { includeDefault?: boolean; extraDefaults?: string[] | null },
  ): string[] {
    const includeDefault = options?.includeDefault !== false;
    const funderDefaults = (options?.extraDefaults || [])
      .map((e) => String(e).trim())
      .filter(Boolean);
    const merged = new Map<string, string>();
    const add = (raw: string) => {
      const trimmed = String(raw || '').trim();
      if (!trimmed) return;
      const key = trimmed.toLowerCase();
      if (!merged.has(key)) merged.set(key, trimmed);
    };
    const seeds = funderDefaults.length
      ? funderDefaults
      : includeDefault
        ? [DOCUSIGN_DEFAULT_CC_EMAIL]
        : [];
    for (const e of seeds) add(e);
    for (const e of ccEmails || []) add(String(e));
    return [...merged.values()];
  }

  private includeDefaultCcForEnvelopeKind(envelopeKind: string | null | undefined): boolean {
    return String(envelopeKind || '').trim().toLowerCase() !== 'standalone_ach';
  }

  private async fetchEnvelopeTextCustomFields(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    options?: { forceRefresh?: boolean },
  ): Promise<Array<{ name?: string; value?: string; show?: string }>> {
    const eid = String(envelopeId || '').trim();
    if (!options?.forceRefresh) {
      const cached = getCachedEnvelopeCustomFields(accountId, eid);
      if (cached) return cached;
    }
    const res = await client.get(
      `/v2.1/accounts/${accountId}/envelopes/${eid}/custom_fields`,
    );
    const list =
      (res.data?.textCustomFields ||
        res.data?.customFields?.textCustomFields ||
        []) as Array<{ name?: string; value?: string; show?: string }>;
    setCachedEnvelopeCustomFields(accountId, eid, list);
    return list;
  }

  private async upsertEnvelopeTextCustomFields(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    updates: Record<string, string>,
    existingFields?: Array<{ name?: string; value?: string; show?: string }>,
  ): Promise<void> {
    if (!Object.keys(updates).length) return;
    let existing = existingFields;
    if (!existing) {
      try {
        existing = await this.fetchEnvelopeTextCustomFields(client, accountId, envelopeId);
      } catch {
        existing = [];
      }
    }
    const byName = new Map(
      (existing || [])
        .filter((f) => f.name)
        .map((f) => [
          String(f.name),
          { name: String(f.name), value: String(f.value ?? ''), show: f.show || 'false' },
        ]),
    );
    for (const [name, value] of Object.entries(updates)) {
      byName.set(name, { name, value, show: 'false' });
    }
    const next = [...byName.values()];
    await client.put(
      `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/custom_fields`,
      { textCustomFields: next },
    );
    setCachedEnvelopeCustomFields(accountId, envelopeId, next);
  }

  private parseCustomFieldValue(
    fields: Array<{ name?: string; value?: string }>,
    name: string,
  ): string {
    const hit = fields.find((f) => f.name === name)?.value;
    return hit != null ? String(hit).trim() : '';
  }

  private isCcAlreadyEmailedFromFields(
    fields: Array<{ name?: string; value?: string }>,
    envelopeId: string,
  ): boolean {
    const done = Boolean(this.parseCustomFieldValue(fields, 'crmCcEmailedAt'));
    if (done) this.ccNotifyAttemptedAt.set(String(envelopeId).trim(), Date.now());
    return done;
  }

  private crmKindFromFields(
    fields: Array<{ name?: string; value?: string }>,
  ): string | null {
    const kind = this.parseCustomFieldValue(fields, 'crmEnvelopeKind').toLowerCase();
    return kind || null;
  }

  private ccEmailsFromFields(
    fields: Array<{ name?: string; value?: string }>,
  ): string[] {
    const raw = this.parseCustomFieldValue(fields, 'crmCcEmails');
    if (!raw) return [];
    return [...new Set(raw.split(',').map((e) => e.trim()).filter(Boolean))];
  }

  private async isEnvelopeCcAlreadyEmailed(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<boolean> {
    const eid = String(envelopeId || '').trim();
    if (!eid) return false;
    try {
      const list = await this.fetchEnvelopeTextCustomFields(client, accountId, eid);
      return this.isCcAlreadyEmailedFromFields(list, eid);
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) {
        this.ccNotifyAttemptedAt.set(eid, Date.now());
        return true;
      }
      return false;
    }
  }

  private shouldSkipCcNotify(envelopeId: string): boolean {
    const eid = String(envelopeId || '').trim();
    if (!eid) return true;
    if (this.ccNotifyInFlight.has(eid)) return true;
    const last = this.ccNotifyAttemptedAt.get(eid);
    if (last == null) return false;
    return Date.now() - last < DocusignService.CC_NOTIFY_COOLDOWN_MS;
  }

  private markCcNotifyAttempted(envelopeId: string): void {
    const eid = String(envelopeId || '').trim();
    if (!eid) return;
    this.ccNotifyAttemptedAt.set(eid, Date.now());
  }

  private async resolveClientDisplayNameForApplication(
    applicationId?: string | null,
  ): Promise<string> {
    const appId = String(applicationId || '').trim();
    if (!appId) return 'Client';
    try {
      const app = await prisma.application.findUnique({
        where: { id: appId },
        select: {
          client: {
            select: {
              businessName: true,
              ownerFirstName: true,
              ownerLastName: true,
            },
          },
        },
      });
      const c = app?.client;
      const business = String(c?.businessName || '').trim();
      if (business) return business;
      const owner = `${c?.ownerFirstName || ''} ${c?.ownerLastName || ''}`.trim();
      if (owner) return owner;
    } catch {
      /* fall through */
    }
    return 'Client';
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
          purchaseAmount: true,
          purchasePrice: true,
        },
      });

      let businessName = String(
        contract?.legalName || contract?.doingBusinessAs || contract?.clientName || '',
      ).trim();

      const app = await prisma.application.findUnique({
        where: { id: applicationId },
        select: {
          dealDisplayName: true,
          client: {
            select: { businessName: true },
          },
          OfferDecision: {
            select: { offer: true, decision: true },
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

      // Live OfferDecision is source of truth; Contract.approvedAmount can lag after edits.
      const decisionNorm = String(app?.OfferDecision?.decision ?? '')
        .trim()
        .toLowerCase();
      const fromOfferDecision =
        decisionNorm !== 'declined' && app?.OfferDecision?.offer != null
          ? Number(app.OfferDecision.offer)
          : null;
      const fromContract =
        contract?.approvedAmount != null ? Number(contract.approvedAmount) : null;
      const fromTerms =
        app?.termsOffers?.[0]?.approvedAmount != null
          ? Number(app.termsOffers[0].approvedAmount)
          : null;
      const fromPurchaseAmount =
        contract?.purchaseAmount != null
          ? Number(String(contract.purchaseAmount).replace(/[$,\s]/g, ''))
          : null;
      const fromPurchasePrice =
        contract?.purchasePrice != null
          ? Number(String(contract.purchasePrice).replace(/[$,\s]/g, ''))
          : null;

      let offerAmount: number | null =
        fromOfferDecision != null && Number.isFinite(fromOfferDecision)
          ? fromOfferDecision
          : fromContract != null && Number.isFinite(fromContract)
            ? fromContract
            : fromTerms != null && Number.isFinite(fromTerms)
              ? fromTerms
              : fromPurchaseAmount != null && Number.isFinite(fromPurchaseAmount)
                ? fromPurchaseAmount
                : fromPurchasePrice != null && Number.isFinite(fromPurchasePrice)
                  ? fromPurchasePrice
                  : null;

      return {
        businessName: businessName || null,
        offerAmount: offerAmount != null && Number.isFinite(offerAmount) ? offerAmount : null,
      };
    } catch {
      return { businessName: null, offerAmount: null };
    }
  }

  private resolveContractContextFromPrefillFields(
    prefillFields?: PrefillField[],
  ): { businessName: string | null; offerAmount: number | string | null } {
    if (!prefillFields?.length) {
      return { businessName: null, offerAmount: null };
    }
    const map = new Map<string, string>();
    for (const field of prefillFields) {
      const id = String(field.id || '').trim();
      const value = String(field.value ?? '').trim();
      if (id && value) map.set(id.toLowerCase(), value);
    }
    const pick = (...keys: string[]) => {
      for (const key of keys) {
        const v = map.get(key.toLowerCase());
        if (v) return v;
      }
      return '';
    };
    const businessName =
      pick(
        'client_legal_name',
        'client_name',
        'legal_name',
        'business_legal_name',
        'merchant_legal_name',
        'doing_business_as',
        'dba',
      ) || null;
    const offerAmount =
      pick(
        'approved_amount',
        'approvedamount',
        'net_to_merchant',
        'netfundprovided',
        'net_fund_provided',
        'funding_provided',
        'total_amount_business_fund',
        'purchase_amount',
        'purchased_amount',
        'purchase_price',
        'purchaseprice',
        'total_amount_tobe_paid_to_provider',
        'disclosure_amount_financed',
      ) || null;
    return { businessName, offerAmount };
  }

  private async resolveContractEnvelopeTitle(options: {
    applicationId?: string;
    title?: string;
    prefillFields?: PrefillField[];
    funderName?: string | null;
  }): Promise<string> {
    const fromPrefill = this.resolveContractContextFromPrefillFields(options.prefillFields);
    const appId = String(options.applicationId || '').trim();
    const lenderName = String(options.funderName || '').trim() || undefined;

    if (appId) {
      const ctx = await this.resolveApplicationContractEmailContext(appId);
      const businessName = ctx.businessName || fromPrefill.businessName;
      const offerAmount = ctx.offerAmount ?? fromPrefill.offerAmount;
      if (businessName) {
        return buildContractEnvelopeEmailSubject(businessName, offerAmount, lenderName);
      }
    }

    if (fromPrefill.businessName) {
      return buildContractEnvelopeEmailSubject(
        fromPrefill.businessName,
        fromPrefill.offerAmount,
        lenderName,
      );
    }

    const override = String(options.title || '').trim();
    if (override) return ensureSubjectAmountHasDollarSign(override);

    const clientName = await this.resolveClientDisplayNameForApplication(appId);
    return buildContractEnvelopeEmailSubject(clientName, fromPrefill.offerAmount, lenderName);
  }

  /** Standalone ACH subject / PDF name: {FunderName}: BusinessName - ACH */
  private async resolveAchFormEnvelopeTitle(options: {
    applicationId?: string;
    title?: string;
    prefillFields?: PrefillField[];
    funderName?: string | null;
  }): Promise<string> {
    const override = String(options.title || '').trim();
    if (override) return override;

    const fromPrefill = this.resolveContractContextFromPrefillFields(options.prefillFields);
    const appId = String(options.applicationId || '').trim();
    const lenderName = String(options.funderName || '').trim() || undefined;

    if (appId) {
      const ctx = await this.resolveApplicationContractEmailContext(appId);
      const businessName = ctx.businessName || fromPrefill.businessName;
      if (businessName) {
        return buildAchFormEnvelopeEmailSubject(businessName, null, lenderName);
      }
    }

    if (fromPrefill.businessName) {
      return buildAchFormEnvelopeEmailSubject(fromPrefill.businessName, null, lenderName);
    }

    const clientName = await this.resolveClientDisplayNameForApplication(appId);
    return buildAchFormEnvelopeEmailSubject(clientName, null, lenderName);
  }

  private async resolveEnvelopeEmailSubject(
    _client: AxiosInstance,
    _accountId: string,
    _envelopeId: string,
    applicationId?: string | null,
    titleOverride?: string,
  ): Promise<string> {
    const override = String(titleOverride || '').trim();
    if (override) return ensureSubjectAmountHasDollarSign(override);
    // CRM-only — never GET /envelopes/{id} just for a subject (counts as envelope polling).
    const appId = String(applicationId || '').trim();
    if (appId) {
      const ctx = await this.resolveApplicationContractEmailContext(appId);
      if (ctx.businessName) {
        return buildContractEnvelopeEmailSubject(ctx.businessName, ctx.offerAmount);
      }
    }
    const clientName = await this.resolveClientDisplayNameForApplication(applicationId);
    return buildContractEnvelopeEmailSubject(
      clientName && clientName !== 'Client' ? clientName : 'Client',
      null,
    );
  }

  private buildEnvelopeTextCustomFields(
    applicationId?: string,
    ccEmails?: string[],
    envelopeKind: 'contract' | 'standalone_ach' = 'contract',
  ): Array<{ name: string; value: string; show: string }> {
    const fields: Array<{ name: string; value: string; show: string }> = [];
    fields.push({ name: 'crmEnvelopeKind', value: envelopeKind, show: 'false' });
    const appId = String(applicationId || '').trim();
    if (appId) {
      fields.push({ name: 'crmApplicationId', value: appId, show: 'false' });
    }
    const cc = this.normalizeCcEmails(ccEmails, {
      includeDefault: this.includeDefaultCcForEnvelopeKind(envelopeKind),
    });
    if (cc.length) {
      fields.push({ name: 'crmCcEmails', value: cc.join(','), show: 'false' });
    }
    return fields;
  }

  private async getEnvelopeCrmKindFromApi(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string | null> {
    try {
      const list = await this.fetchEnvelopeTextCustomFields(client, accountId, envelopeId);
      return this.crmKindFromFields(list);
    } catch {
      return null;
    }
  }

  /** True when envelope has left draft / pre-send (CC PDF already applicable). */
  private isSentLikeEnvelopeStatus(status: string): boolean {
    const s = String(status || '').trim().toLowerCase();
    return ['sent', 'delivered', 'viewed', 'signed', 'completed'].includes(s);
  }

  /** Read last stored CRM status for an envelope (ACH mapping blob or send history). */
  private async getStoredEnvelopeStatusFromContract(
    applicationId: string,
    envelopeId: string,
  ): Promise<string> {
    const appId = String(applicationId || '').trim();
    const eid = String(envelopeId || '').trim();
    if (!appId || !eid) return '';
    try {
      const contract = await prisma.contract.findUnique({
        where: { applicationId: appId },
        select: { contractPrefillOverrides: true },
      });
      const prefill = contract?.contractPrefillOverrides;
      if (!prefill || typeof prefill !== 'object' || Array.isArray(prefill)) return '';
      const raw = prefill as Record<string, unknown>;
      const achMeta = parseAchAuthorizationDocuSignFromPrefill(raw);
      if (achMeta && String(achMeta.envelopeId).trim() === eid) {
        switch (achMeta.status) {
          case 'SIGNED':
            return 'completed';
          case 'VIEWED':
            return 'viewed';
          case 'SENT':
            return 'sent';
          case 'VOIDED':
            return 'revoked';
          default:
            return 'draft';
        }
      }
      const envelopeMap = raw.documentTemplateEnvelopeByMappingId;
      if (envelopeMap && typeof envelopeMap === 'object' && !Array.isArray(envelopeMap)) {
        for (const meta of Object.values(envelopeMap)) {
          if (!meta || typeof meta !== 'object') continue;
          if (String((meta as Record<string, unknown>).envelopeId ?? '').trim() === eid) {
            return String((meta as Record<string, unknown>).status ?? '')
              .trim()
              .toLowerCase();
          }
        }
      }
      const history = raw.documentSendHistory;
      if (Array.isArray(history)) {
        for (const row of history) {
          if (!row || typeof row !== 'object') continue;
          const r = row as Record<string, unknown>;
          if (String(r.envelopeId ?? '').trim() === eid) {
            return String(r.status ?? '').trim().toLowerCase();
          }
        }
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  /** True when envelopeId is stored on contract prefill as standalone ACH (legacy envelopes). */
  private async isAchStandaloneEnvelopeOnContract(
    applicationId: string,
    envelopeId: string,
  ): Promise<boolean> {
    const appId = String(applicationId || '').trim();
    const eid = String(envelopeId || '').trim();
    if (!appId || !eid) return false;
    const contract = await prisma.contract.findUnique({
      where: { applicationId: appId },
      select: { contractPrefillOverrides: true },
    });
    const prefill = contract?.contractPrefillOverrides;
    if (!prefill || typeof prefill !== 'object' || Array.isArray(prefill)) return false;
    const raw = prefill as Record<string, unknown>;
    const envelopeMap = raw.documentTemplateEnvelopeByMappingId;
    if (envelopeMap && typeof envelopeMap === 'object' && !Array.isArray(envelopeMap)) {
      for (const meta of Object.values(envelopeMap)) {
        if (!meta || typeof meta !== 'object') continue;
        if (String((meta as Record<string, unknown>).envelopeId ?? '').trim() === eid) {
          return true;
        }
      }
    }
    const history = raw.documentSendHistory;
    if (Array.isArray(history)) {
      for (const row of history) {
        if (!row || typeof row !== 'object') continue;
        const r = row as Record<string, unknown>;
        if (
          String(r.documentKind ?? '').toLowerCase() === 'ach' &&
          String(r.envelopeId ?? '').trim() === eid
        ) {
          return true;
        }
      }
    }
    return false;
  }

  /** Only the main contract envelope may update Contract.status / application workflow. */
  private async shouldSyncContractSigningStatus(
    applicationId: string | null,
    envelopeId: string,
    envelopeKind: string | null,
  ): Promise<boolean> {
    const appId = String(applicationId || '').trim();
    const eid = String(envelopeId || '').trim();
    if (!appId || !eid) return false;
    const kind = String(envelopeKind || '').trim().toLowerCase();
    if (kind === 'standalone_ach') return false;
    if (await this.isAchStandaloneEnvelopeOnContract(appId, eid)) return false;
    return this.isPrimaryContractEnvelope(appId, eid);
  }

  private parseCcEmailsFromWebhookCustomFields(
    customFields: { textCustomFields?: Array<{ name?: string; value?: string }> } | undefined,
    body?: unknown,
  ): string[] {
    const list =
      customFields?.textCustomFields?.length
        ? customFields.textCustomFields
        : extractWebhookTextCustomFields(body);
    const raw = list.find((f) => f.name === 'crmCcEmails')?.value;
    if (!raw) return [];
    return [...new Set(String(raw).split(',').map((e) => e.trim()).filter(Boolean))];
  }

  private async getEnvelopeCcEmailsFromApi(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string[]> {
    try {
      const list = await this.fetchEnvelopeTextCustomFields(client, accountId, envelopeId);
      return this.ccEmailsFromFields(list);
    } catch {
      return [];
    }
  }

  /** Highest numeric recipientId across all recipient types on an envelope. */
  private getMaxRecipientIdFromRecipientsData(
    data: Record<string, unknown> | null | undefined,
  ): number {
    let max = 0;
    const types = [
      'signers',
      'carbonCopies',
      'certifiedDeliveries',
      'inPersonSigners',
      'agents',
      'editors',
      'intermediaries',
    ];
    for (const type of types) {
      const list = (data?.[type] || []) as Array<{ recipientId?: string }>;
      for (const r of list) {
        const n = parseInt(String(r.recipientId || ''), 10);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return max;
  }

  /**
   * Sync DocuSign carbon-copy recipients on the envelope (default + user-added CC emails).
   */
  private async applyEnvelopeCarbonCopies(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    ccEmails: string[],
  ): Promise<{ synced: number }> {
    const list = this.normalizeCcEmails(ccEmails);

    const recData = this.cloneRecipientsData(
      (await this.getEnvelopeRecipients(
        client,
        accountId,
        envelopeId,
      )) as Record<string, unknown>,
    );
    const signers = (recData.signers || []) as Array<{
      email?: string;
      routingOrder?: string;
    }>;
    let existingCc = (recData.carbonCopies || []) as Array<{
      email?: string;
      recipientId?: string;
    }>;

    const signerEmails = new Set(
      signers.map((s) => String(s.email || '').trim().toLowerCase()).filter(Boolean),
    );
    const desired = list.filter((e) => !signerEmails.has(e.toLowerCase()));
    const desiredSet = new Set(desired.map((e) => e.toLowerCase()));

    const removedIds = new Set<string>();
    for (const cc of existingCc) {
      const email = String(cc.email || '').trim().toLowerCase();
      const rid = String(cc.recipientId || '').trim();
      if (!rid) continue;
      if (!desiredSet.has(email)) {
        try {
          await client.delete(
            `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${rid}`,
          );
          removedIds.add(rid);
        } catch (delErr) {
          if (isDocuSignPollingLimitError(delErr)) throw delErr;
          this.logDocusignApiError('applyEnvelopeCarbonCopies remove', delErr);
        }
      }
    }

    if (removedIds.size) {
      existingCc = existingCc.filter(
        (cc) => !removedIds.has(String(cc.recipientId || '').trim()),
      );
      recData.carbonCopies = existingCc;
      this.rememberEnvelopeRecipients(accountId, envelopeId, recData);
    }

    // Reuse in-memory recipients — never forceRefresh GET after CC deletes.
    const signersAfter = (recData.signers || []) as Array<{
      routingOrder?: string;
    }>;
    const existingEmails = new Set(
      existingCc.map((cc) => String(cc.email || '').trim().toLowerCase()).filter(Boolean),
    );
    const toAdd = desired.filter((e) => !existingEmails.has(e.toLowerCase()));
    if (!toAdd.length) {
      return { synced: desired.length };
    }

    const maxSignerOrder = Math.max(
      ...signersAfter.map((s) => parseInt(String(s.routingOrder || '1'), 10) || 1),
      1,
    );
    const ccRoutingOrder = String(maxSignerOrder + 1);
    let nextRecipientId = this.getMaxRecipientIdFromRecipientsData(recData) + 1;
    const carbonCopies = toAdd.map((email) => ({
      email,
      name: email.split('@')[0],
      recipientId: String(nextRecipientId++),
      routingOrder: ccRoutingOrder,
    }));

    try {
      await client.post(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
        { carbonCopies },
      );
      recData.carbonCopies = [...existingCc, ...carbonCopies];
      this.rememberEnvelopeRecipients(accountId, envelopeId, recData);
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) throw err;
      throw new BadRequestException(formatDocusignApiErrorMessage(err));
    }
    console.log(
      `[DocuSign] carbon copy on ${envelopeId}: ${toAdd.join(', ')} (routing ${ccRoutingOrder})`,
    );
    return { synced: desired.length };
  }

  private async removeEnvelopeCarbonCopies(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<number> {
    const data = this.cloneRecipientsData(
      await this.getEnvelopeRecipients(client, accountId, envelopeId),
    ) as {
      carbonCopies?: Array<{ recipientId?: string }>;
      [k: string]: unknown;
    };
    const existingCc = (data.carbonCopies || []) as Array<{
      recipientId?: string;
    }>;
    let removed = 0;
    const removedIds = new Set<string>();
    for (const cc of existingCc) {
      const rid = String(cc.recipientId || '').trim();
      if (!rid) continue;
      try {
        await client.delete(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients/${rid}`,
        );
        removed++;
        removedIds.add(rid);
      } catch (delErr) {
        if (isDocuSignPollingLimitError(delErr)) throw delErr;
        this.logDocusignApiError('removeEnvelopeCarbonCopies', delErr);
      }
    }
    if (removed) {
      data.carbonCopies = existingCc.filter(
        (cc) => !removedIds.has(String(cc.recipientId || '').trim()),
      );
      this.rememberEnvelopeRecipients(accountId, envelopeId, data);
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

  /** CRM primary signer from platform layout slots — no DocuSign template API. */
  private async buildCrmRolesFromPlatformSlots(
    applicationId?: string,
  ): Promise<SignerRoleInput[]> {
    const resolved = await this.resolveSignerEmailForApplication(applicationId);
    const clientEmail = resolved?.email || '';
    const clientName = resolved?.name || clientEmail.split('@')[0] || 'Signer';
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

  /** @deprecated Prefer buildCrmRolesFromPlatformSlots — DocuSign Admin templates are unused. */
  private async buildCrmRolesForEnvelope(
    client: AxiosInstance,
    accountId: string,
    templateId: string,
    applicationId?: string,
  ): Promise<SignerRoleInput[]> {
    void client;
    void accountId;
    void templateId;
    return this.buildCrmRolesFromPlatformSlots(applicationId);
  }

  /**
   * Map CRM signer rows onto envelope slots without reusing the same CRM row twice.
   * Duplicate template role names (e.g. two "Owner" slots) must map by position, not
   * always to normalized[0].
   */
  private matchCrmSignersToEnvelopeSlots(
    envelopeSigners: Array<{ roleName?: string; routingOrder?: string }>,
    normalized: Array<{
      roleName: string;
      name: string;
      email: string;
      routingOrder: string;
    }>,
  ): Array<{
    roleName: string;
    name: string;
    email: string;
  } | null> {
    const used = new Set<number>();

    const takeFirstUnused = (
      predicate: (row: (typeof normalized)[number], idx: number) => boolean,
    ) => {
      const idx = normalized.findIndex((row, ni) => !used.has(ni) && predicate(row, ni));
      if (idx < 0) return null;
      used.add(idx);
      return normalized[idx];
    };

    const findByRoleReusable = (roleKey: string) => {
      if (!roleKey) return null;
      const idx = normalized.findIndex(
        (row, ni) => !used.has(ni) && row.roleName.toLowerCase() === roleKey,
      );
      if (idx < 0) return null;
      used.add(idx);
      return normalized[idx];
    };

    return envelopeSigners.map((signer, slotIdx) => {
      const roleKey = String(signer.roleName || '').trim().toLowerCase();
      const routingOrder = String(signer.routingOrder || slotIdx + 1).trim();

      return (
        takeFirstUnused((row) => row.roleName.toLowerCase() === roleKey) ||
        /** Composite merges may repeat the same role (e.g. two "Signer" slots) — reuse CRM email. */
        findByRoleReusable(roleKey) ||
        takeFirstUnused((row) => row.routingOrder === routingOrder) ||
        takeFirstUnused((_, ni) => ni === slotIdx) ||
        takeFirstUnused(() => true) ||
        null
      );
    });
  }

  /**
   * Apply CRM signer emails onto the draft envelope (bulk recipients PUT).
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

    const recData = await this.getEnvelopeRecipients(client, accountId, envelopeId);
    const signers = (recData?.signers || []) as Array<{
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

    const matched = this.matchCrmSignersToEnvelopeSlots(signers, normalized);
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
      const match = matched[i];
      let email = String(match?.email || '').trim();
      if (!email) {
        email = String(signer.email || '').trim();
      }
      const rid = String(signer.recipientId || '').trim();
      if (!rid) continue;

      if (!email) {
        missingRoles.push(String(signer.roleName || `Signer ${i + 1}`));
        continue;
      }

      const nextName =
        match?.name ||
        String(signer.name || '').trim() ||
        email.split('@')[0];
      const currentEmail = String(signer.email || '').trim().toLowerCase();
      const currentName = String(signer.name || '').trim();
      if (
        currentEmail === email.toLowerCase() &&
        (!nextName || currentName === nextName)
      ) {
        continue;
      }

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
          `[DocuSign] signer ${u.roleName} on ${envelopeId} → ${u.email}`,
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
      const recData = await this.getEnvelopeRecipients(client, accountId, envelopeId);
      const signers = (recData?.signers || []) as Array<{
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
      if (isDocuSignPollingLimitError(err)) throw err;
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
   * Sync signer emails + DocuSign carbon-copy CC list before Sender View or send.
   * Always includes DOCUSIGN_DEFAULT_CC_EMAIL plus any user-added addresses from the contract modal.
   */
  async syncEnvelopeCcEmails(
    userId: string,
    envelopeId: string,
    ccEmails: string[],
    applicationId?: string,
    signerEmail?: string,
    signerName?: string,
    roles?: SignerRoleInput[],
    authHints?: {
      contractId?: number | null;
      funderName?: string | null;
      contractState?: string | null;
    },
  ) {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      throw new BadRequestException('envelopeId is required');
    }
    const { client, accountId } = await this.getAuthContextForEnvelope(userId, eid, {
      applicationId,
      contractId: authHints?.contractId,
      funderName: authHints?.funderName,
      contractState: authHints?.contractState,
    });

    // Platform layouts: never look up DocuSign Admin templates for roles.
    // Prefer CRM-passed roles, then signerEmail arg, then application primary email.
    let rolesToApply: SignerRoleInput[] = Array.isArray(roles) ? roles : [];
    const primaryEmail = String(signerEmail || '').trim();
    if (primaryEmail && !rolesToApply.length) {
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
    if (!rolesToApply.length) {
      rolesToApply = await this.buildCrmRolesFromPlatformSlots(applicationId);
    }

    let { updated, missingRoles } = await this.applyCrmRolesToEnvelopeSigners(
      client,
      accountId,
      eid,
      rolesToApply,
    );

    // Prefer CRM envelope kind — avoid custom_fields GET (counts toward polling budget).
    let envelopeKind: string | null = null;
    const appIdHint = String(applicationId || '').trim();
    if (appIdHint) {
      if (await this.isAchStandaloneEnvelopeOnContract(appIdHint, eid)) {
        envelopeKind = 'standalone_ach';
      } else {
        envelopeKind = 'contract';
      }
    } else {
      envelopeKind = await this.getEnvelopeCrmKindFromApi(client, accountId, eid);
    }
    const includeDefaultCc = this.includeDefaultCcForEnvelopeKind(envelopeKind);
    const list = this.normalizeCcEmails(ccEmails, { includeDefault: includeDefaultCc });

    await this.removeEnvelopeCarbonCopies(client, accountId, eid);

    // Cache should already hold patched signers/CCs from roles + remove — no forceRefresh.
    const recAfterData = await this.getEnvelopeRecipients(client, accountId, eid);
    const signersAfter = ((recAfterData?.signers || []) as Array<{ email?: string }>).filter(
      (s) => String(s.email || '').trim(),
    );
    if (!signersAfter.length) {
      throw new BadRequestException(
        'DocuSign envelope has no signers with email after sync. Create a new draft.',
      );
    }
    if (missingRoles.length) {
      throw new BadRequestException(
        `Envelope requires email for signer role(s): ${missingRoles.join(', ')}. ` +
          'Add signer emails in CRM before opening Sender View or sending.',
      );
    }
    const textCustomFields = this.buildEnvelopeTextCustomFields(
      applicationId,
      list,
      envelopeKind === 'standalone_ach' ? 'standalone_ach' : 'contract',
    );
    if (!textCustomFields.some((f) => f.name === 'crmCcEmails')) {
      textCustomFields.push({ name: 'crmCcEmails', value: list.join(','), show: 'false' });
    }
    if (textCustomFields.length) {
      try {
        await client.put(
          `/v2.1/accounts/${accountId}/envelopes/${eid}/custom_fields`,
          { textCustomFields },
        );
        setCachedEnvelopeCustomFields(accountId, eid, textCustomFields);
      } catch (err) {
        this.logDocusignApiError('syncEnvelopeCcEmails custom_fields', err);
      }
    }

    const envelopeSigners = ((recAfterData?.signers || []) as Array<{
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
      preloadedRoleNames?.length
        ? preloadedRoleNames
        : (
            await import('./platform-document-registry')
          ).PLATFORM_SIGNER_SLOTS.map((s) => s.roleName);

    void client;
    void accountId;
    void templateId;

    return signers.map((s, idx) => {
      const crmRole = String(s.roleName || '').trim();
      const templateRoleAtIdx = templateRoleNames[idx];
      const crmMatchesTemplate =
        crmRole &&
        templateRoleNames.some((n) => n.toLowerCase() === crmRole.toLowerCase());
      const roleName =
        templateRoleAtIdx ||
        (crmMatchesTemplate ? crmRole : '') ||
        crmRole ||
        templateRoleNames[0] ||
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

  /** True when envelopeId is the main contract envelope on Application.document (not standalone ACH). */
  private async isPrimaryContractEnvelope(
    applicationId: string,
    envelopeId: string,
  ): Promise<boolean> {
    const appId = String(applicationId || '').trim();
    const eid = String(envelopeId || '').trim();
    if (!appId || !eid) return false;
    const doc = await prisma.document.findUnique({
      where: { applicationId: appId },
      select: { envelopeId: true },
    });
    if (!doc?.envelopeId) return false;
    return String(doc.envelopeId).trim() === eid;
  }

  private async linkEnvelopeToApplication(
    userId: string,
    applicationId: string,
    envelopeId: string,
  ) {
    const newEnvelopeId = String(envelopeId).trim();
    const existingDoc = await prisma.document.findUnique({
      where: { applicationId },
      select: {
        envelopeId: true,
        status: true,
        sentAt: true,
        completedAt: true,
        signedPdfUrl: true,
        signedPdfPublicId: true,
        userId: true,
      },
    });

    // Super Admin proxy sessions use a sentinel / Master UUID — not a tenant User.
    // Fall back to application creator / sales rep (same pattern as other proxy FK writes).
    const documentOwnerUserId = await resolveDocumentOwnerNumericUserId(
      userId,
      applicationId,
      existingDoc?.userId,
    );
    if (documentOwnerUserId == null) {
      throw new BadRequestException(
        'Cannot link DocuSign envelope: CRM user record not found for this session.',
      );
    }

    const priorEnvelopeId = String(existingDoc?.envelopeId ?? '').trim();
    if (priorEnvelopeId && priorEnvelopeId !== newEnvelopeId) {
      const contractRow = await prisma.contract.findUnique({
        where: { applicationId },
        select: { id: true, status: true },
      });
      const archiveStatus = resolveArchivedMainContractEnvelopeStatus(
        existingDoc?.status,
        contractRow?.status,
      );
      const priorWasCompleted = isCompletedEnvelopeStatus(
        existingDoc?.status,
        contractRow?.status,
      );

      await archiveMainContractEnvelopeToHistory(applicationId, {
        envelopeId: priorEnvelopeId,
        status: archiveStatus,
        sentAt: existingDoc?.sentAt,
        completedAt:
          existingDoc?.completedAt ??
          (priorWasCompleted ? new Date() : null),
        signedPdfUrl: existingDoc?.signedPdfUrl,
        signedPdfPublicId: existingDoc?.signedPdfPublicId,
      });

      await syncApplicationOnMainContractResend(prisma, applicationId, {
        source: 'docusign.linkEnvelopeToApplication',
        contractId: contractRow?.id,
        contractStatusPrevious: String(contractRow?.status ?? ''),
        contractStatusNew: 'DRAFT',
      });
    }

    await clearAchAuthorizationIfMatchesMainContract(applicationId, newEnvelopeId);

    await prisma.document.upsert({
      where: { applicationId },
      create: {
        applicationId,
        envelopeId: newEnvelopeId,
        status: 'draft',
        userId: documentOwnerUserId,
      },
      update: {
        envelopeId: newEnvelopeId,
        status: 'draft',
        sentAt: null,
        completedAt: null,
        // Prior send's archive is stored on contractSendHistory — do not keep it on the new envelope.
        signedPdfUrl: null,
        signedPdfPublicId: null,
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
    options?: {
      envelopeKind?: string | null;
      webhookBody?: unknown;
      client?: AxiosInstance;
      accountId?: string;
      contractId?: number;
    },
  ) {
    const achLookup = {
      applicationId: applicationId ?? undefined,
      contractId: options?.contractId,
    };

    if (await updateAchAuthorizationDocuSignStatus(envelopeId, incomingResolved, achLookup)) {
      return incomingResolved;
    }

    if (await updateStandalonePackageDocuSignStatus(envelopeId, incomingResolved, achLookup)) {
      return incomingResolved;
    }

    if (
      !existingDoc &&
      options?.contractId &&
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
          options.contractId,
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

    const status = mergeWithExistingEnvelopeStatus(existingDoc?.status, incomingResolved);
    if (!status) return status;

    const updateData: Record<string, unknown> = { status };
    if (status === 'sent') {
      updateData.sentAt = existingDoc?.sentAt ?? new Date();
    } else if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    const docUpdate = await prisma.document.updateMany({
      where: { envelopeId: String(envelopeId) },
      data: updateData as any,
    });

    const appId = applicationId || existingDoc?.applicationId || null;
    if (docUpdate.count === 0) {
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

      if (await updateStandalonePackageDocuSignStatus(envelopeId, incomingResolved, achLookup)) {
        return incomingResolved;
      }

      console.warn('[DocuSign] webhook: no Document row updated for envelope', {
        envelopeId,
        incoming: incomingResolved,
        applicationId: appId,
      });
    }

    if (appId) {
      const mainDoc = await prisma.document.findUnique({
        where: { applicationId: String(appId) },
        select: { envelopeId: true },
      });
      const mainEid = String(mainDoc?.envelopeId ?? '').trim();
      const eid = String(envelopeId).trim();
      if (eid !== mainEid) {
        if (await updateStandalonePackageDocuSignStatus(eid, incomingResolved, achLookup)) {
          return incomingResolved;
        }
        if (await updateAchAuthorizationDocuSignStatus(eid, incomingResolved, achLookup)) {
          return incomingResolved;
        }
        return status;
      }

      let envelopeKind = options?.envelopeKind ?? null;
      if (!envelopeKind && options?.webhookBody) {
        envelopeKind = extractCrmEnvelopeKindFromWebhook(options.webhookBody);
      }
      if (!envelopeKind && options?.client && options?.accountId) {
        envelopeKind = await this.getEnvelopeCrmKindFromApi(
          options.client,
          options.accountId,
          envelopeId,
        );
      }

      if (await this.shouldSyncContractSigningStatus(String(appId), envelopeId, envelopeKind)) {
        await this.syncContractSigningStatus(String(appId), status);
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

  /** Map envelope status → application contract workflow (Generated / Sent / Signed / Cancelled). */
  private async syncApplicationWorkflowOnContractSigning(
    applicationId: string,
    internalStatus: string,
  ) {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    const { syncApplicationWorkflowFromContractEnvelopeStatus } = await import(
      '../contractApplicationWorkflowSync'
    );
    await syncApplicationWorkflowFromContractEnvelopeStatus(
      prisma,
      appId,
      internalStatus,
      { source: 'docusign.syncApplicationWorkflowOnContractSigning' },
    );
  }

  /**
   * Create notifications for contract status changes.
   * Notifies the referring agent, sales representative, and relevant users about the status change.
   */
  private async createContractStatusNotification(
    applicationId: string,
    newStatus: string,
    previousStatus: string | null,
    envelopeId: string,
  ): Promise<void> {
    const appId = String(applicationId || '').trim();
    if (!appId) return;

    try {
      const application = await prisma.application.findUnique({
        where: { id: appId },
        select: {
          id: true,
          applicationId: true,
          dealId: true,
          referringAgentId: true,
          salesRepresentativeId: true,
          client: {
            select: {
              businessName: true,
              ownerFirstName: true,
              ownerLastName: true,
            },
          },
        },
      });

      if (!application) {
        console.warn(`[DocuSign] Cannot create notification: application ${appId} not found`);
        return;
      }

      const clientName =
        application.client?.businessName ||
        `${application.client?.ownerFirstName || ''} ${application.client?.ownerLastName || ''}`.trim() ||
        'Client';
      const appIdNumber = resolveApplicationDisplayNumber(application) || 'N/A';

      const statusLabel = getContractStatusLabel(newStatus);
      const title = statusLabel;
      const message = `${statusLabel} for Application #${appIdNumber} - ${clientName}. DocuSign envelope status has been updated.`;

      const recipientIds = new Set<string>();
      if (application.referringAgentId) {
        recipientIds.add(application.referringAgentId);
      }
      if (application.salesRepresentativeId) {
        recipientIds.add(application.salesRepresentativeId);
      }

      const underwriters = await prisma.user.findMany({
        where: {
          role: { in: ['UNDERWRITER'] },
          isActive: true,
        },
        select: { id: true },
      });
      underwriters.forEach((u) => recipientIds.add(u.id));

      if (recipientIds.size === 0) {
        console.warn(`[DocuSign] No recipients to notify for application ${appId}`);
        return;
      }

      const notificationData = recipientIds.size > 0
        ? Array.from(recipientIds).map((recipientId) => ({
            title,
            message,
            type: 'contract_status_update',
            recipientId,
            applicationId: application.id,
          }))
        : [];

      if (notificationData.length > 0) {
        await prisma.notification.createMany({
          data: notificationData,
        });
        console.log(
          `[DocuSign] Contract status notifications created for ${recipientIds.size} recipient(s) - status: ${newStatus}, envelope: ${envelopeId}`,
        );
      }
    } catch (error) {
      console.error('[DocuSign] Failed to create contract status notification:', error);
    }
  }

  /**
   * Create an audit log entry for contract status changes.
   */
  private async createContractStatusAuditLog(
    applicationId: string,
    newStatus: string,
    previousStatus: string | null,
    envelopeId: string,
  ): Promise<void> {
    const appId = String(applicationId || '').trim();
    if (!appId) return;

    try {
      const application = await prisma.application.findUnique({
        where: { id: appId },
        select: {
          id: true,
          currentQueue: true,
          currentState: true,
        },
      });

      if (!application) {
        console.warn(`[DocuSign] Cannot create audit log: application ${appId} not found`);
        return;
      }

      const statusLabel = getContractStatusLabel(newStatus);
      const actionType = `CONTRACT_${newStatus.toUpperCase()}`;
      const actionDescription = `DocuSign contract ${statusLabel.toLowerCase()}. Envelope ID: ${envelopeId}`;

      const previousStatusLabel = previousStatus
        ? getContractStatusLabel(previousStatus)
        : 'N/A';
      const currentStatusStr = `${application.currentQueue} / ${application.currentState}`;

      await prisma.applicationActivityLog.create({
        data: {
          applicationId: application.id,
          userId: null,
          userRole: 'SYSTEM',
          actionType,
          actionDescription,
          previousStatus: previousStatus ? previousStatusLabel : null,
          currentStatus: currentStatusStr,
          metadata: {
            envelopeId,
            contractStatus: newStatus,
            previousContractStatus: previousStatus,
            statusLabel,
            timestamp: new Date().toISOString(),
          } as any,
        },
      });

      console.log(
        `[DocuSign] Audit log created - actionType: ${actionType}, envelope: ${envelopeId}`,
      );
    } catch (error) {
      console.error('[DocuSign] Failed to create contract status audit log:', error);
    }
  }

  /**
   * Webhook / sync status change: realtime UI push (always) + inbox/audit for tracked stages.
   * DocuSign Connect is the primary path; FE should not poll DocuSign unless this is missed.
   */
  private async handleContractStatusChange(
    applicationId: string,
    newStatus: string,
    previousStatus: string | null,
    envelopeId: string,
  ): Promise<void> {
    const normalizedNew = String(newStatus || '').trim().toLowerCase();
    const normalizedPrev = previousStatus ? String(previousStatus).trim().toLowerCase() : null;

    if (normalizedNew === normalizedPrev) {
      return;
    }

    await handleContractSigningStatusTransition({
      applicationId,
      priorStatus: normalizedPrev,
      newStatus: normalizedNew,
      envelopeId,
      documentName: 'Contract',
      provider: 'docusign',
    });
  }

  /** After auto-send: mark linked `Document` row and `Contract.status` as SENT. */
  private async markEnvelopeSent(applicationId: string, envelopeId: string) {
    const appId = String(applicationId || '').trim();
    if (!appId) return;
    await prisma.document.updateMany({
      where: { envelopeId: String(envelopeId), applicationId: appId },
      data: { status: 'sent', sentAt: new Date() } as any,
    });
    if (await this.shouldSyncContractSigningStatus(appId, envelopeId, 'contract')) {
      await this.syncContractSigningStatus(appId, 'sent');
    }
  }

  private async getEnvelopeStatus(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<string> {
    const cached = getCachedEnvelopeStatus(accountId, envelopeId);
    if (cached != null) return cached;
    if (getEnvelopePollingCooldownRemainingMs(envelopeId) > 0) {
      return '';
    }
    try {
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
      );
      clearEnvelopePollingCooldown(envelopeId);
      const status = String(res.data?.status || '').toLowerCase();
      if (status) setCachedEnvelopeStatus(accountId, envelopeId, status);
      return status;
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) {
        this.rememberEnvelopePollingLimit(envelopeId, err);
      }
      // Wrong funder account — bubble up so download can try the next JWT candidate.
      if (isDocuSignUserNotEnvelopeSenderError(err)) throw err;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403 || status === 404) throw err;
      return '';
    }
  }

  private async downloadEnvelopeCombinedPdf(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    showChanges: boolean,
  ): Promise<Buffer | null> {
    try {
      this.assertEnvelopePollingAllowed(envelopeId);
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/combined`,
        {
          responseType: 'arraybuffer',
          params: showChanges ? { show_changes: 'true' } : undefined,
        },
      );
      clearEnvelopePollingCooldown(envelopeId);
      const buf = Buffer.from(res.data);
      // DocuSign sometimes returns JSON error bodies with 200 — reject non-PDF payloads.
      if (buf?.length && buf.slice(0, 4).toString('utf8') !== '%PDF') {
        console.warn(
          `[DocuSign] combined download for ${envelopeId} was not a PDF (${buf.length} bytes)`,
        );
        return null;
      }
      return buf?.length ? buf : null;
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) {
        this.rememberEnvelopePollingLimit(envelopeId, err);
        throw err;
      }
      // Let caller try the next funder DocuSign account.
      if (isDocuSignUserNotEnvelopeSenderError(err)) throw err;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403 || status === 404) throw err;
      console.warn('[DocuSign] download combined PDF failed:', err);
      return null;
    }
  }

  /**
   * Fallback when combined PDF is unavailable — first content document only.
   * Skips GET /documents (list) which burns the per-envelope 250/hour polling budget;
   * DocuSign content docs almost always use documentId "1".
   */
  private async downloadEnvelopeFirstContentPdf(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    showChanges: boolean,
  ): Promise<Buffer | null> {
    try {
      this.assertEnvelopePollingAllowed(envelopeId);
      const res = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/1`,
        {
          responseType: 'arraybuffer',
          params: showChanges ? { show_changes: 'true' } : undefined,
        },
      );
      clearEnvelopePollingCooldown(envelopeId);
      const buf = Buffer.from(res.data);
      if (buf?.length && buf.slice(0, 4).toString('utf8') !== '%PDF') {
        console.warn(
          `[DocuSign] document/1 download for ${envelopeId} was not a PDF (${buf.length} bytes)`,
        );
        return null;
      }
      return buf?.length ? buf : null;
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) {
        this.rememberEnvelopePollingLimit(envelopeId, err);
        throw err;
      }
      if (isDocuSignUserNotEnvelopeSenderError(err)) throw err;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403 || status === 404) throw err;
      console.warn('[DocuSign] download first content PDF failed:', err);
      return null;
    }
  }

  /**
   * Download envelope PDF (combined, then document 1 as fallback).
   * One GET for completed; at most two for draft/sent (show_changes then plain) — never both
   * variants plus list-documents (that pattern burned the 250/hour per-envelope poll budget).
   */
  private async downloadEnvelopePdfBuffer(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    knownStatus?: string,
  ): Promise<Buffer | null> {
    const status =
      knownStatus || (await this.getEnvelopeStatus(client, accountId, envelopeId));
    const cacheVariant = status === 'completed' ? 'completed' : 'preview';
    const cached = getCachedEnvelopePdf(envelopeId, cacheVariant);
    if (cached?.length) return cached;

    const inFlightKey = `${String(accountId).trim().toLowerCase()}::${envelopeId}::${cacheVariant}`;
    const existing = this.envelopePdfDownloadInFlight.get(inFlightKey);
    if (existing) return existing;

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

    const request = (async () => {
      try {
        let buf: Buffer | null;
        if (status === 'completed') {
          buf = await downloadPdf(false);
        } else {
          // Prefer show_changes once; only fall back to plain if empty (do not fetch both always).
          buf = await downloadPdf(true);
          if (!buf?.length) {
            buf = await downloadPdf(false);
          }
        }
        if (buf?.length) {
          setCachedEnvelopePdf(envelopeId, cacheVariant, buf);
        }
        return buf;
      } catch (err) {
        this.rememberEnvelopePollingLimit(envelopeId, err);
        throw err;
      }
    })();

    this.envelopePdfDownloadInFlight.set(inFlightKey, request);
    try {
      return await request;
    } finally {
      if (this.envelopePdfDownloadInFlight.get(inFlightKey) === request) {
        this.envelopePdfDownloadInFlight.delete(inFlightKey);
      }
    }
  }

  /**
   * CRM draft preview: tab values are on the envelope via API, but DocuSign often does not flatten
   * them into a downloadable draft PDF (account setting may be required). Do not scan raw PDF bytes
   * for text — compressed PDFs fail that check even when the Sender View shows values.
   */
  /**
   * Download combined envelope PDF for CC email (contract + addendum when merged).
   * Keep DocuSign API usage minimal — Connect webhooks must not burn the hourly quota.
   */
  private async downloadEnvelopePdfBufferForCcEmail(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
  ): Promise<Buffer | null> {
    const maxAttempts = 2;
    const delayMs = 2500;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (attempt > 0) {
        await this.sleep(delayMs);
      }

      try {
        const buf = await this.downloadEnvelopeCombinedPdf(
          client,
          accountId,
          envelopeId,
          false,
        );
        if (buf?.length) {
          console.log(
            `[DocuSign] CC PDF ready for ${envelopeId}: ${buf.length} bytes (attempt ${attempt + 1})`,
          );
          // Sent/prefilled PDF only — never poison the completed/signed cache.
          setCachedEnvelopePdf(envelopeId, 'preview', buf);
          return buf;
        }
      } catch (err) {
        if (isDocuSignPollingLimitError(err)) {
          console.warn(
            `[DocuSign] CC PDF aborted for ${envelopeId}: DocuSign API hourly limit exceeded`,
          );
          return null;
        }
        console.warn(`[DocuSign] CC PDF download attempt ${attempt + 1} failed:`, err);
      }
    }

    console.warn(
      `[DocuSign] CC PDF not available after ${maxAttempts} attempt(s) for envelope ${envelopeId}`,
    );
    return null;
  }

  private async downloadEnvelopePdfBufferForPreview(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    knownStatus?: string,
  ): Promise<Buffer | null> {
    const status =
      knownStatus || (await this.getEnvelopeStatus(client, accountId, envelopeId));
    // Single download attempt — the caller / frontend already retries, so we must not
    // multiply DocuSign API calls here (prefill sample polling was purely informational).
    return this.downloadEnvelopePdfBuffer(client, accountId, envelopeId, status);
  }

  /**
   * Archive envelope PDF under `ih-crm/signed-contracts/{funder}/` for CRM preview.
   * - sent: prefilled package (try show_changes so field values are visible)
   * - completed: replace with fully signed PDF
   */
  private async archiveEnvelopePdfToCloudinary(args: {
    envelopeId: string;
    applicationId?: string | null;
    userId?: string;
    phase: 'sent' | 'completed';
  }): Promise<void> {
    const eid = String(args.envelopeId || '').trim();
    const phase = args.phase === 'completed' ? 'completed' : 'sent';
    if (!eid) return;

    if (phase === 'sent') {
      const existingUrl = await getStoredSignedPdfUrl(eid);
      if (existingUrl) return;
    }

    try {
      const userId = String(args.userId || '').trim() || 'system';
      let buf: Buffer | null = null;

      if (phase === 'sent') {
        // Prefer show_changes so CRM preview shows prefilled / filled tab values.
        const { client, accountId } = await this.getAuthContextForEnvelope(userId, eid);
        buf =
          (await this.downloadEnvelopeCombinedPdf(client, accountId, eid, true)) ||
          getCachedEnvelopePdf(eid, 'preview') ||
          (await this.downloadEnvelopeCombinedPdf(client, accountId, eid, false));
      } else {
        // Completed/signed: always pull live DocuSign combined PDF.
        // Never reuse preview/sent caches — those are the unsigned package.
        invalidateCachedEnvelopePdf(eid);
        const { client, accountId } = await this.getAuthContextForEnvelope(userId, eid);
        buf = await this.downloadEnvelopeCombinedPdf(client, accountId, eid, false);
        if (!buf?.length) {
          buf = await this.downloadEnvelopePdfBuffer(client, accountId, eid, 'completed');
        }
      }

      if (!buf?.length) {
        console.warn(
          `[DocuSign] ${phase} archive skipped: empty PDF for envelope ${eid}`,
        );
        return;
      }
      if (phase === 'sent') {
        setCachedEnvelopePdf(eid, 'preview', buf);
      } else {
        setCachedEnvelopePdf(eid, 'completed', buf);
      }
      await archiveSignedEnvelopePdf({
        envelopeId: eid,
        pdf: buf,
        applicationId: args.applicationId,
        phase,
        replaceExisting: phase === 'completed',
      });
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) {
        this.rememberEnvelopePollingLimit(eid, err);
        console.warn(
          `[DocuSign] ${phase} archive aborted for ${eid}: DocuSign polling limit`,
        );
        return;
      }
      console.warn(`[DocuSign] ${phase} archive failed for ${eid}:`, err);
    }
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

    const pdf = await this.downloadEnvelopePdfBufferForCcEmail(
      client,
      accountId,
      envelopeId,
    );
    if (!pdf?.length) {
      console.warn(`[DocuSign] No PDF for envelope ${envelopeId}; CC email skipped.`);
      return { emailed: [] };
    }

    const subject = normalizeContractCcEmailSubject(
      subjectBase.trim() || buildContractEnvelopeEmailSubject('Business', null),
    );
    const pdfFilename = buildContractEnvelopePdfFilename(subject);
    const emailed: string[] = [];
    // Sent as the contract's funder (its stored sender identity), else the .env default.
    const from = resolveEnvelopeMailSender(envelopeId).then((sender) => sender ?? undefined);
    for (const to of list) {
      try {
        await sendMail({
          from: await from,
          to,
          subject,
          html: '<p>Please find the signed contract package attached for your records.</p>',
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

  private async createSenderViewUrl(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    returnUrl: string,
  ): Promise<string> {
    const normalizedReturnUrl = this.normalizeSenderReturnUrl(returnUrl);
    try {
      const res = await client.post(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/sender`,
        { returnUrl: normalizedReturnUrl },
      );
      const url = res.data?.url;
      if (!url) throw new BadRequestException('DocuSign did not return sender view URL');
      return url;
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) throw err;
      throw new BadRequestException(formatDocusignApiErrorMessage(err));
    }
  }

  private async finalizeEnvelopeFlow(
    userId: string,
    envelopeId: string,
    options: {
      applicationId?: string;
      contractId?: number;
      funderName?: string | null;
      funderProfileId?: string | null;
      /** Standalone ACH / package — do not overwrite the main contract envelope on Application.document. */
      skipApplicationEnvelopeLink?: boolean;
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
      /** CRM values already burned into uploaded PDFs — skip post-create tab GETs/PUTs. */
      prefillFlattenedInPdf?: boolean;
      client: AxiosInstance;
      accountId: string;
    },
  ) {
    const appId = String(options.applicationId || '').trim();
    if (appId && !options.skipApplicationEnvelopeLink) {
      await this.linkEnvelopeToApplication(userId, appId, envelopeId);
      const contractIdNum = Number(options.contractId);
      await persistMainContractSendPackage(
        appId,
        envelopeId,
        options.sendPackage ?? { includeMainContract: true },
        Number.isFinite(contractIdNum) && contractIdNum > 0 ? contractIdNum : undefined,
        {
          funderName: options.funderName,
          funderProfileId: options.funderProfileId,
        },
      );
    } else if (appId && options.skipApplicationEnvelopeLink) {
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

    const includeDefaultCc = !options.skipApplicationEnvelopeLink;
    const normalizedCc = this.normalizeCcEmails(options.ccEmails, {
      includeDefault: includeDefaultCc,
    });
    await this.removeEnvelopeCarbonCopies(
      options.client,
      options.accountId,
      envelopeId,
    );

    let ccPrefilledEmail: { emailed: string[] } | null = null;

    let envelopeSigners: Array<{ roleName?: string; email?: string; name?: string }> = [];
    try {
      // Expect cache hit after assert/prefill/remove CC — no extra GETRecipient HTTP.
      const recData = await this.getEnvelopeRecipients(
        options.client,
        options.accountId,
        envelopeId,
      );
      envelopeSigners = (recData?.signers || []).map((s: any) => ({
        roleName: s.roleName,
        email: s.email,
        name: s.name,
      }));
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) throw err;
      /* omit non-fatal signer summary failures */
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
        setCachedEnvelopeStatus(options.accountId, envelopeId, 'sent');
        invalidateCachedEnvelopeRecipients(options.accountId, envelopeId);
        envelopeStatus = 'sent';
        if (prefillApplied.applied > 0) {
          await this.sleep(6000);
        }
        if (appId && !options.skipApplicationEnvelopeLink) {
          await this.markEnvelopeSent(appId, envelopeId);
        } else {
          await prisma.document.updateMany({
            where: { envelopeId: String(envelopeId) },
            data: { status: 'sent', sentAt: new Date() } as any,
          });
        }
        if (normalizedCc.length) {
          ccPrefilledEmail = await this.notifyCcRecipientsOnEnvelopeSent(
            userId,
            envelopeId,
            appId || undefined,
            null,
            normalizedCc,
            options.title,
          );
        }
        await this.archiveEnvelopePdfToCloudinary({
          envelopeId: String(envelopeId),
          applicationId: appId || undefined,
          userId,
          phase: 'sent',
        });
      } catch (sendErr) {
        console.error('[DocuSign] auto-send failed:', sendErr);
      }
    }

    const returnUrl = this.normalizeSenderReturnUrl(
      options.redirectUrl || DOCUSIGN_SENDER_RETURN_URL,
    );

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
    return resolveSupplementalRefsFromDb(filters);
  }

  private decoratePlatformLayoutEnvelope(
    envelopeDefinition: Record<string, unknown>,
    options: {
      applicationId?: string;
      ccEmails?: string[];
      skipApplicationEnvelopeLink?: boolean;
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
    const envelopeKind = options.skipApplicationEnvelopeLink ? 'standalone_ach' : 'contract';
    const textCustomFields = this.buildEnvelopeTextCustomFields(
      appIdForEnvelope,
      options.ccEmails,
      envelopeKind,
    );
    if (textCustomFields.length) {
      (envelopeDefinition as any).customFields = { textCustomFields };
    }

    const connectNotification = this.buildEnvelopeConnectNotification();
    if (connectNotification) {
      (envelopeDefinition as any).eventNotification = connectNotification;
    }
  }

  private async resolveContractFunderAndState(contractId?: number): Promise<{
    funderName?: string | null;
    contractState?: string | null;
  }> {
    const id = Number(contractId);
    if (!Number.isFinite(id) || id <= 0) return {};
    const row = await prisma.contract.findUnique({
      where: { id },
      select: { funderName: true, state: true },
    });
    if (!row) return {};
    return {
      funderName: row.funderName,
      contractState: row.state,
    };
  }

  private async resolveFunderAuthOptionsForEnvelope(
    envelopeId?: string | null,
    hints?: {
      applicationId?: string | null;
      contractId?: number | null;
      funderName?: string | null;
      funderProfileId?: string | null;
      contractState?: string | null;
    },
  ): Promise<{
    funderName?: string | null;
    funderProfileId?: string | null;
    contractState?: string | null;
  }> {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      return {
        funderName: String(hints?.funderName || '').trim() || null,
        funderProfileId: String(hints?.funderProfileId || '').trim() || null,
        contractState: String(hints?.contractState || '').trim() || null,
      };
    }
    const resolved = await resolveEnvelopeFunderAuthHints(eid, {
      applicationId: hints?.applicationId,
      contractId: hints?.contractId ?? undefined,
      funderName: hints?.funderName,
      funderProfileId: hints?.funderProfileId,
      contractState: hints?.contractState,
    });
    return {
      funderName: resolved.funderName,
      funderProfileId: resolved.funderProfileId,
      contractState: resolved.contractState,
    };
  }

  private async getAuthContextForEnvelope(
    userId: string,
    envelopeId?: string | null,
    hints?: {
      applicationId?: string | null;
      contractId?: number | null;
      funderName?: string | null;
      funderProfileId?: string | null;
      contractState?: string | null;
    },
  ) {
    const funderOpts = await this.resolveFunderAuthOptionsForEnvelope(envelopeId, hints);
    return this.getAuthContext(userId, funderOpts);
  }

  private async applyVoidOrDeleteOnDocuSign(
    client: AxiosInstance,
    accountId: string,
    envelopeId: string,
    voidReason: string,
    crmDsStatus: string,
  ): Promise<void> {
    if (['voided', 'declined', 'deleted'].includes(crmDsStatus)) {
      return;
    }

    /**
     * Envelope PUT status may only be: created | sent | voided | correct.
     * Drafts cannot be voided — move them to recyclebin via Folders API.
     * Never PUT status "deleted" (invalid parameter; causes INVALID_REQUEST_PARAMETER).
     */
    const moveEnvelopeToRecycleBin = async () => {
      await client.put(`/v2.1/accounts/${accountId}/folders/recyclebin`, {
        envelopeIds: [envelopeId],
      });
    };
    const voidEnvelope = async () => {
      await client.put(`/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
        status: 'voided',
        voidedReason: voidReason,
      });
    };

    if (crmDsStatus === 'created') {
      try {
        await moveEnvelopeToRecycleBin();
      } catch (deleteErr: unknown) {
        // CRM may mis-label a sent envelope as created — try void as fallback.
        try {
          await voidEnvelope();
        } catch {
          throw deleteErr;
        }
      }
      return;
    }

    try {
      await voidEnvelope();
    } catch (voidErr: unknown) {
      const voidMsg = formatDocusignApiErrorMessage(voidErr).toLowerCase();
      if (
        voidMsg.includes('created') ||
        voidMsg.includes('draft') ||
        (voidMsg.includes('invalid_request_parameter') && voidMsg.includes('status'))
      ) {
        await moveEnvelopeToRecycleBin();
        return;
      }
      throw voidErr;
    }
  }

  private async sendEnvelopeFromPlatformLayouts(
    userId: string,
    options: {
      supplementalRefs?: string[];
      standaloneDocumentRefs?: string[];
      includeMainContract?: boolean;
      mainContractLayoutKey?: string;
      funderProfileId?: string | null;
      funderName?: string | null;
      contractState?: string | null;
      redirectUrl?: string;
      title?: string;
      message?: string;
      roles: SignerRoleInput[];
      prefillFields?: PrefillField[];
      ccEmails?: string[];
      applicationId?: string;
      contractId?: number;
      skipApplicationEnvelopeLink?: boolean;
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
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
    const contractContext = await this.resolveContractFunderAndState(options.contractId);
    const funderName = options.funderName ?? contractContext.funderName ?? null;
    const contractState = options.contractState ?? contractContext.contractState ?? null;
    const funderProfile = await resolveFunderProfile({
      funderProfileId: options.funderProfileId,
      funderName,
      state: contractState,
    });
    const funderDefaultCcEmail = String(funderProfile?.defaultCcEmail ?? '').trim() || null;
    const docusignAccountId = String(funderProfile?.docusignAccountProfileId ?? '').trim();
    let docusignDefaultCcEmail: string | null = null;
    if (docusignAccountId) {
      const ds = await prisma.docuSignAccountProfile.findUnique({
        where: { id: docusignAccountId },
        select: { defaultCcEmail: true },
      });
      docusignDefaultCcEmail = String(ds?.defaultCcEmail ?? '').trim() || null;
    }
    const funderDefaultCcList = (docusignDefaultCcEmail || funderDefaultCcEmail)
      ? String(docusignDefaultCcEmail || funderDefaultCcEmail)
          .split(/[,;\n]+/)
          .map((part) => part.trim())
          .filter(Boolean)
      : [];
    const { client, accountId } = await this.getAuthContext(userId, {
      funderName,
      contractState,
    });

    const supplementalRefs = options.supplementalRefs || [];
    const standaloneRefs = options.standaloneDocumentRefs || [];
    const standaloneLinkKind = resolveStandaloneLinkKind(
      standaloneRefs.length ? standaloneRefs : supplementalRefs,
      options.includeMainContract,
    );
    const isStandaloneOnly =
      standaloneRefs.length > 0 && supplementalRefs.length === 0;

    let built;
    try {
      const sendImmediately = options.autoSend === true;
      const envelopeFunderLabel =
        String(funderName || funderProfile?.name || funderProfile?.displayName || '').trim() ||
        null;
      const envelopeSubject = isStandaloneOnly
        ? await this.resolveAchFormEnvelopeTitle({
            applicationId: options.applicationId,
            title: options.title,
            prefillFields: options.prefillFields,
            funderName: envelopeFunderLabel,
          })
        : await this.resolveContractEnvelopeTitle({
            applicationId: options.applicationId,
            title: options.title,
            prefillFields: options.prefillFields,
            funderName: envelopeFunderLabel,
          });
      const layoutKeyForSend = await resolveMainContractLayoutKeyForSend({
        mainContractLayoutKey: options.mainContractLayoutKey,
        funderName,
        funderProfileId: options.funderProfileId,
        state: contractState,
      });

      built = await buildPlatformLayoutEnvelopeDefinition({
        supplementalRefs,
        standaloneDocumentRefs: standaloneRefs,
        includeMainContract: options.includeMainContract,
        mainContractLayoutKey: layoutKeyForSend,
        funderProfileId: options.funderProfileId,
        funderName,
        contractState,
        roles: options.roles,
        prefillFields: options.prefillFields,
        ownerCount: options.ownerCount,
        guarantorCount: options.guarantorCount,
        title: envelopeSubject,
        message: options.message,
        documentName: buildContractEnvelopeDocumentName(envelopeSubject),
        flattenPrefillInPdf: sendImmediately,
        lockDataTabs: sendImmediately,
        contractId: options.contractId,
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

      // Seed custom_fields cache from create payload — avoids GET on first CC notify.
      const seededCustomFields = (
        (envelopeDefinition as { customFields?: { textCustomFields?: Array<{ name?: string; value?: string; show?: string }> } })
          ?.customFields?.textCustomFields || []
      ) as Array<{ name?: string; value?: string; show?: string }>;
      if (seededCustomFields.length) {
        setCachedEnvelopeCustomFields(accountId, String(envelopeId), seededCustomFields);
      }

      await this.assertEnvelopeHasSigners(client, accountId, envelopeId);

      const result = await this.finalizeEnvelopeFlow(userId, envelopeId, {
        applicationId: options.applicationId,
        contractId: options.contractId,
        funderName,
        funderProfileId: options.funderProfileId,
        skipApplicationEnvelopeLink: options.skipApplicationEnvelopeLink,
        standaloneLinkKind:
          options.skipApplicationEnvelopeLink && standaloneLinkKind !== 'main'
            ? standaloneLinkKind
            : undefined,
        sendPackage: options.sendPackage,
        redirectUrl: options.redirectUrl,
        ccEmails: this.normalizeCcEmails(options.ccEmails, {
          includeDefault: !isStandaloneOnly,
          extraDefaults: funderDefaultCcList,
        }),
        title: built.envelopeDefinition.emailSubject as string | undefined,
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
      /** When true (or DOCUSIGN_AUTO_SEND_ENVELOPE), emails signers without opening sender view. */
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

  // ─── Merge multiple templates (composite) ───────────────────────────────────

  async mergeAndSendTemplates(
    userId: string,
    options: {
      templates?: Array<{ templateId: string }>;
      templateIds?: string[];
      supplementalDocumentRefs?: string[];
      /** ACH / other standalone docs — envelope contains only these PDFs (no main contract). */
      standaloneDocumentRefs?: string[];
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
      /** Standalone ACH — envelope id is stored on contract mapping, not Application.document. */
      skipApplicationEnvelopeLink?: boolean;
      includeMainContract?: boolean;
      contractId?: number;
      sendPackage?: {
        includeMainContract?: boolean;
        includeAddendum?: boolean;
        includeDisclosure?: boolean;
      };
      supplementalLayoutKeys?: string[];
      mainContractLayoutKey?: string;
      funderProfileId?: string | null;
      funderName?: string | null;
      contractState?: string | null;
    },
  ) {
    if (!options?.roles?.length) {
      throw new BadRequestException('At least one role is required');
    }

    let supplementalRefs: string[] = [];
    if (options.supplementalLayoutKeys?.length) {
      supplementalRefs = await filterSupplementalRefs(
        options.supplementalLayoutKeys.map((id) => String(id).trim()).filter(Boolean),
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

    let standaloneRefs: string[] = [];
    if (options.standaloneDocumentRefs?.length) {
      standaloneRefs = await filterSupplementalRefs(
        options.standaloneDocumentRefs.map((id) => String(id).trim()).filter(Boolean),
      );
      if (!standaloneRefs.length) {
        throw new BadRequestException(
          'No standalone document templates resolved. Ensure BoldSignTemplate rows have pdfUrl and layoutKey.',
        );
      }
    }

    return this.sendEnvelopeFromPlatformLayouts(userId, {
      supplementalRefs,
      standaloneDocumentRefs: standaloneRefs,
      includeMainContract: options.includeMainContract,
      mainContractLayoutKey: options.mainContractLayoutKey,
      funderProfileId: options.funderProfileId,
      funderName: options.funderName,
      contractState: options.contractState,
      contractId: options.contractId,
      sendPackage: options.sendPackage,
      roles: options.roles,
      prefillFields: options.prefillFields,
      redirectUrl: options.redirectUrl,
      applicationId: options.applicationId,
      skipApplicationEnvelopeLink: options.skipApplicationEnvelopeLink,
      ccEmails: options.ccEmails,
      title: options.title,
      message: options.message,
      ownerCount: options.ownerCount,
      guarantorCount: options.guarantorCount,
      autoSend: options.autoSend,
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
    const { client, accountId } = await this.getAuthContextForEnvelope(userId, documentId);
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
    const { client, accountId } = await this.getAuthContextForEnvelope(userId, documentId);
    const url = await this.createSenderViewUrl(client, accountId, documentId, redirectUrl);
    return { sendUrl: url, url };
  }

  async getEmbeddedSignLink(
    userId: string,
    envelopeId: string,
    signerEmail: string,
    returnUrl: string,
  ) {
    const { client, accountId } = await this.getAuthContextForEnvelope(userId, envelopeId);
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

  async voidDocument(
    userId: string,
    documentId: string,
    reason: string,
    hints?: Partial<EnvelopeFunderAuthHints>,
  ) {
    const envelopeId = String(documentId || '').trim();
    if (!envelopeId) {
      throw new BadRequestException('Missing documentId');
    }
    const voidReason = String(reason || '').trim() || 'Voided by user';

    const crmStatus = await this.resolveCrmEnvelopeInternalStatus(envelopeId);
    const crmDsStatus = this.mapCrmInternalToDocuSignEnvelopeStatus(crmStatus);

    if (crmDsStatus === 'completed') {
      throw new BadRequestException(
        'This document is already completed in DocuSign and cannot be voided. Send a new envelope instead.',
      );
    }

    const candidates = [...(await listEnvelopeFunderAuthCandidates(envelopeId, hints))];
    let lastErr: unknown;
    let voidApplied = ['voided', 'declined', 'deleted'].includes(crmDsStatus);
    const tried: string[] = [];

    if (!voidApplied) {
      if (!candidates.length) {
        candidates.push({ usePlatformDefault: true });
      }
      for (const candidate of candidates) {
        const label = candidate.usePlatformDefault
          ? 'platform-default'
          : String(candidate.funderProfileId || candidate.funderName || 'unknown');
        tried.push(label);
        try {
          const { client, accountId } = await this.getAuthContext(userId, {
            ...candidate,
            requireFunderCredentials: !candidate.usePlatformDefault,
          });
          await this.applyVoidOrDeleteOnDocuSign(
            client,
            accountId,
            envelopeId,
            voidReason,
            crmDsStatus,
          );
          voidApplied = true;
          lastErr = null;
          console.info('[DocuSign] void succeeded with sender candidate', {
            envelopeId,
            candidate: label,
            tried,
          });
          break;
        } catch (err: unknown) {
          lastErr = err;
          if (isDocuSignPollingLimitError(err)) {
            throw new BadRequestException(
              'DocuSign polling limit reached. Wait about an hour, then void again — or void from the DocuSign console.',
            );
          }
          if (isDocuSignUserNotEnvelopeSenderError(err)) {
            console.warn('[DocuSign] void USER_NOT_ENVELOPE_SENDER — trying next funder account', {
              envelopeId,
              candidate: label,
            });
            continue;
          }
          // Skip funders with no DocuSign link and keep trying others.
          const msg = formatDocusignApiErrorMessage(err);
          if (/no active linked DocuSign|no funder DocuSign credentials/i.test(msg)) {
            console.warn('[DocuSign] void skip candidate without DocuSign credentials', {
              envelopeId,
              candidate: label,
            });
            continue;
          }
          throw new BadRequestException(msg);
        }
      }
    }

    if (!voidApplied && lastErr) {
      throw new BadRequestException(
        `${formatDocusignApiErrorMessage(lastErr)} Tried sender accounts: ${tried.join(', ') || 'none'}. ` +
          'Link the funder that originally sent this envelope to its DocuSign account in Settings, then void again.',
      );
    }

    const isAchEnvelope = await isStandaloneAchEnvelope(envelopeId);
    if (isAchEnvelope) {
      await updateAchAuthorizationDocuSignStatus(envelopeId, 'revoked');
      return { success: true, achAuthorization: true, docusignStatus: crmDsStatus || 'voided' };
    }

    const isPackageEnvelope = await isStandalonePackageEnvelope(envelopeId);
    if (isPackageEnvelope) {
      await updateStandalonePackageDocuSignStatus(envelopeId, 'revoked');
      return { success: true, standalonePackage: true, docusignStatus: crmDsStatus || 'voided' };
    }

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId },
      select: {
        applicationId: true,
        sentAt: true,
        completedAt: true,
        status: true,
      },
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
      // Keep voided send in Contracts Generated history (do not reset Contract to DRAFT).
      const alreadyArchived = await updateArchivedContractSendHistoryStatus(
        appId,
        envelopeId,
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
        await archiveMainContractEnvelopeToHistory(appId, {
          envelopeId,
          status: 'revoked',
          sentAt: existingDoc?.sentAt,
          completedAt: existingDoc?.completedAt,
          resetContractToDraft: false,
        });
      }
    }
    return { success: true, achAuthorization: false, docusignStatus: crmDsStatus || 'voided' };
  }

  /** CRM-only envelope status for void/delete — avoids DocuSign status GET (polling quota). */
  private async resolveCrmEnvelopeInternalStatus(envelopeId: string): Promise<string> {
    const eid = String(envelopeId || '').trim();
    if (!eid) return '';

    const resolvePackageOrAchStatus = async (): Promise<string | null> => {
      const achContracts = await prisma.contract.findMany({
        where: {
          contractPrefillOverrides: {
            path: [ACH_AUTHORIZATION_DOCUSIGN_KEY, 'envelopeId'],
            equals: eid,
          },
        },
        select: { contractPrefillOverrides: true },
        take: 1,
      });
      for (const row of achContracts) {
        const ach = parseAchAuthorizationDocuSignFromPrefill(row.contractPrefillOverrides);
        if (ach?.envelopeId === eid) {
          if (ach.status === 'SIGNED') return 'completed';
          if (ach.status === 'VIEWED') return 'viewed';
          if (ach.status === 'SENT') return 'sent';
          if (ach.status === 'VOIDED') return 'revoked';
          return 'draft';
        }
      }

      const packageContracts = await prisma.contract.findMany({
        where: {
          contractPrefillOverrides: {
            path: [STANDALONE_PACKAGE_DOCUSIGN_KEY, 'envelopeId'],
            equals: eid,
          },
        },
        select: { contractPrefillOverrides: true },
        take: 1,
      });
      for (const row of packageContracts) {
        const raw = row.contractPrefillOverrides;
        if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const blob = (raw as Record<string, unknown>)[STANDALONE_PACKAGE_DOCUSIGN_KEY];
        if (blob == null || typeof blob !== 'object' || Array.isArray(blob)) continue;
        const o = blob as Record<string, unknown>;
        if (String(o.envelopeId ?? '').trim() !== eid) continue;
        const statusRaw = String(o.status ?? 'DRAFT').trim().toUpperCase();
        if (statusRaw === 'SIGNED') return 'completed';
        if (statusRaw === 'VIEWED') return 'viewed';
        if (statusRaw === 'SENT') return 'sent';
        if (statusRaw === 'VOIDED') return 'revoked';
        return 'draft';
      }
      return null;
    };

    const doc = await prisma.document.findFirst({
      where: { envelopeId: eid },
      select: { status: true },
    });
    const docStatus = doc?.status ? String(doc.status).trim().toLowerCase() : '';
    // Prefer package/ACH capsule when Document is missing or still draft — supplemental
    // envelopes are often tracked only on contractPrefillOverrides.
    if (!docStatus || docStatus === 'draft' || docStatus === 'created') {
      const fromCapsule = await resolvePackageOrAchStatus();
      if (fromCapsule && fromCapsule !== 'draft') return fromCapsule;
      if (docStatus) return docStatus;
      if (fromCapsule) return fromCapsule;
      return '';
    }
    return docStatus;
  }

  private mapCrmInternalToDocuSignEnvelopeStatus(crmStatus: string): string {
    const k = String(crmStatus || '').trim().toLowerCase();
    if (!k) return '';
    if (['voided', 'revoked', 'declined', 'deleted', 'expired'].includes(k)) return 'voided';
    if (['completed', 'signed'].includes(k)) return 'completed';
    if (['viewed', 'delivered'].includes(k)) return 'delivered';
    if (['sent', 'processing'].includes(k)) return 'sent';
    if (['draft', 'created'].includes(k)) return 'created';
    return k;
  }

  async getDocumentProperties(userId: string, documentId: string) {
    const { client, accountId } = await this.getAuthContextForEnvelope(userId, documentId);
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

  /**
   * Ensure the envelope is known to this tenant DB before calling DocuSign.
   * Main contracts live on Document; ACH / standalone / archived sends may only be in prefill JSON.
   * Prefer `contractId` / `applicationId` when the FE already knows which contract owns the envelope
   * (prior sends after resend are only in that contract's history, not on Document).
   */
  private async assertTenantEnvelopeKnown(
    envelopeId: string,
    options?: {
      requireDocument?: boolean;
      contractId?: number | null;
      applicationId?: string | null;
    },
  ): Promise<void> {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      throw new BadRequestException('envelopeId is required');
    }
    const eidLower = eid.toLowerCase();

    const document = await prisma.document.findFirst({
      where: {
        OR: [
          { envelopeId: eid },
          ...(eidLower !== eid ? [{ envelopeId: eidLower }] : []),
        ],
      },
      select: { id: true },
    });
    if (document) return;

    // Case-insensitive Document match (DocuSign / DB casing can differ).
    const docCaseHits = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT d.id
      FROM "Document" d
      WHERE d."envelopeId" IS NOT NULL
        AND LOWER(d."envelopeId") = ${eidLower}
      LIMIT 1
    `;
    if (docCaseHits.length > 0) return;

    if (options?.requireDocument) {
      throw new NotFoundException(
        `Unknown envelope: no Document record found for envelopeId "${eid}" in this tenant`,
      );
    }

    const hintContractId = Number(options?.contractId);
    const hintApplicationId = String(options?.applicationId ?? '').trim();

    const loadContractPrefill = async (where: {
      id?: number;
      applicationId?: string;
    }) => {
      const row = await prisma.contract.findUnique({
        where: where.id
          ? { id: where.id }
          : { applicationId: String(where.applicationId) },
        select: {
          id: true,
          applicationId: true,
          contractPrefillOverrides: true,
          application: {
            select: {
              document: { select: { envelopeId: true } },
            },
          },
        },
      });
      return row;
    };

    const contractMatchesEnvelope = (
      row: {
        contractPrefillOverrides: unknown;
        application?: { document?: { envelopeId?: string | null } | null } | null;
      } | null,
    ): boolean => {
      if (!row) return false;
      const docEid = String(row.application?.document?.envelopeId ?? '')
        .trim()
        .toLowerCase();
      if (docEid && docEid === eidLower) return true;
      return contractPrefillContainsEnvelopeId(row.contractPrefillOverrides, eid);
    };

    // Scoped lookup: FE always has the contract when viewing send-history rows.
    if (Number.isFinite(hintContractId) && hintContractId > 0) {
      const byId = await loadContractPrefill({ id: hintContractId });
      if (contractMatchesEnvelope(byId)) return;
    }
    if (hintApplicationId) {
      // Prefer Application UUID (Contract.applicationId).
      try {
        const byApp = await loadContractPrefill({ applicationId: hintApplicationId });
        if (contractMatchesEnvelope(byApp)) return;
      } catch {
        // Invalid UUID for findUnique — fall through to display-id lookup.
      }

      // Numeric display applicationId (URL param) → Application.id UUID → Contract.
      const displayId = Number(hintApplicationId);
      if (Number.isFinite(displayId) && displayId > 0) {
        const app = await prisma.application.findFirst({
          where: { applicationId: displayId },
          select: {
            id: true,
            document: { select: { envelopeId: true } },
            contract: { select: { contractPrefillOverrides: true } },
          },
        });
        if (
          String(app?.document?.envelopeId ?? '').trim().toLowerCase() === eidLower ||
          contractPrefillContainsEnvelopeId(app?.contract?.contractPrefillOverrides, eid)
        ) {
          return;
        }
      }
    }

    const achHints = await findAchEnvelopeAuthHints(eid);
    if (achHints) return;

    const standalone = await prisma.contract.findFirst({
      where: {
        contractPrefillOverrides: {
          path: [STANDALONE_PACKAGE_DOCUSIGN_KEY, 'envelopeId'],
          equals: eid,
        },
      },
      select: { id: true },
    });
    if (standalone) return;

    const dsEnvelope = await prisma.docuSignEnvelope.findUnique({
      where: { envelopeId: eid },
      select: { id: true },
    });
    if (dsEnvelope) return;

    // Archived history: targeted JSON text search (avoids brittle take:N global scan).
    const historyHits = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT c.id
      FROM "Contract" c
      WHERE c."contractPrefillOverrides" IS NOT NULL
        AND (
          c."contractPrefillOverrides"::text ILIKE ${'%' + eid + '%'}
          OR c."contractPrefillOverrides"::text ILIKE ${'%' + eidLower + '%'}
        )
      ORDER BY c.id DESC
      LIMIT 25
    `;
    for (const hit of historyHits) {
      const row = await prisma.contract.findUnique({
        where: { id: hit.id },
        select: { contractPrefillOverrides: true },
      });
      if (contractPrefillContainsEnvelopeId(row?.contractPrefillOverrides, eid)) {
        return;
      }
      // ILIKE already proved the UUID is in this tenant's contract JSON.
      if (row?.contractPrefillOverrides != null) return;
    }

    // FE send-history / session can retain an envelope id after prefill meta was rebuilt
    // without that id. Authenticated callers always pass contractId for Contracts Generated.
    if (Number.isFinite(hintContractId) && hintContractId > 0) {
      const hinted = await prisma.contract.findUnique({
        where: { id: hintContractId },
        select: { id: true },
      });
      if (hinted) {
        console.warn(
          `[DocuSign] envelope ${eid} not in Document/prefill; allowing via contractId=${hintContractId}`,
        );
        return;
      }
    }

    throw new NotFoundException(
      `Unknown envelope: "${eid}" is not linked to a Document or contract package in this tenant`,
    );
  }

  async downloadDocumentPdfByEnvelopeId(
    userId: string,
    envelopeId: string,
    options?: {
      requireDocument?: boolean;
      contractId?: number | null;
      applicationId?: string | null;
      funderName?: string | null;
      funderProfileId?: string | null;
      contractState?: string | null;
    },
  ) {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      throw new BadRequestException('envelopeId is required');
    }

    await this.assertTenantEnvelopeKnown(eid, options);

    // Prefer durable Cloudinary archive (per-funder folder) — zero DocuSign GETs.
    // Skip when Document is completed/signed but archive is still the sent (unsigned) package.
    const storedArchive = await getStoredEnvelopePdfArchive(eid);
    const storedUrl = storedArchive?.url || null;
    const docFullySigned = isDocumentFullySignedStatus(storedArchive?.status);
    const archiveIsSigned = isSignedPhaseArchiveUrl(storedUrl);
    const staleSentArchive = Boolean(storedUrl && docFullySigned && !archiveIsSigned);

    if (storedUrl && !staleSentArchive) {
      const cacheVariant = archiveIsSigned || docFullySigned ? 'completed' : 'preview';
      const cached = getCachedEnvelopePdf(eid, cacheVariant);
      if (cached?.length) return cached;
      const fromCloud = await fetchStoredSignedPdfBuffer(storedUrl);
      if (fromCloud?.length) {
        setCachedEnvelopePdf(eid, cacheVariant, fromCloud);
        return fromCloud;
      }
    } else if (staleSentArchive) {
      console.warn(
        `[DocuSign] stale sent archive for completed envelope ${eid}; refetching signed PDF from DocuSign`,
      );
      invalidateCachedEnvelopePdf(eid);
    }

    this.assertEnvelopePollingAllowed(eid);

    const authHints = {
      applicationId: options?.applicationId,
      contractId: options?.contractId,
      funderName: options?.funderName,
      funderProfileId: options?.funderProfileId,
      contractState: options?.contractState,
    };
    const candidates = [...(await listEnvelopeFunderAuthCandidates(eid, authHints))];
    if (!candidates.length) {
      candidates.push({ usePlatformDefault: true });
    }

    let lastErr: unknown;
    const tried: string[] = [];

    for (const candidate of candidates) {
      const label = candidate.usePlatformDefault
        ? 'platform-default'
        : String(candidate.funderProfileId || candidate.funderName || 'unknown');
      tried.push(label);
      try {
        const { client, accountId } = await this.getAuthContext(userId, {
          ...candidate,
          requireFunderCredentials: !candidate.usePlatformDefault,
        });

        const status = await this.getEnvelopeStatus(client, accountId, eid);
        const buf = await this.downloadEnvelopePdfBufferForPreview(
          client,
          accountId,
          eid,
          status,
        );
        if (!buf?.length) {
          // Wrong account often surfaces as empty/null after a DocuSign error —
          // keep trying other funder JWT candidates instead of aborting the loop.
          console.warn('[DocuSign] empty PDF for candidate — trying next funder account', {
            envelopeId: eid,
            candidate: label,
            status,
          });
          lastErr = new BadRequestException(
            'Could not download PDF from DocuSign (empty or unavailable combined document)',
          );
          continue;
        }

        const statusLower = String(status || '').toLowerCase();
        const phase =
          statusLower === 'completed' || statusLower === 'signed' ? 'completed' : 'sent';
        const shouldArchive =
          !storedUrl ||
          staleSentArchive ||
          (phase === 'completed' && !archiveIsSigned);
        if (
          shouldArchive &&
          (phase === 'completed' ||
            statusLower === 'sent' ||
            statusLower === 'delivered')
        ) {
          void archiveSignedEnvelopePdf({
            envelopeId: eid,
            pdf: buf,
            phase,
            replaceExisting: phase === 'completed',
            applicationId: options?.applicationId
              ? String(options.applicationId)
              : undefined,
            funderName: options?.funderName ? String(options.funderName) : undefined,
            funderProfileId: options?.funderProfileId
              ? String(options.funderProfileId)
              : undefined,
          }).catch((err) =>
            console.warn(`[DocuSign] lazy ${phase} PDF archive failed for ${eid}:`, err),
          );
        }
        if (tried.length > 1) {
          console.info('[DocuSign] download succeeded with sender candidate', {
            envelopeId: eid,
            candidate: label,
            tried,
          });
        }
        return buf;
      } catch (err: any) {
        lastErr = err;
        this.rememberEnvelopePollingLimit(eid, err);
        if (isDocuSignPollingLimitError(err)) {
          throw new BadRequestException(
            'DocuSign polling limit reached. Wait about an hour, then try again.',
          );
        }
        if (isDocuSignUserNotEnvelopeSenderError(err)) {
          console.warn(
            '[DocuSign] download USER_NOT_ENVELOPE_SENDER — trying next funder account',
            { envelopeId: eid, candidate: label },
          );
          continue;
        }
        const msg = formatDocusignApiErrorMessage(err);
        if (/no active linked DocuSign|no funder DocuSign credentials/i.test(msg)) {
          console.warn('[DocuSign] download skip candidate without DocuSign credentials', {
            envelopeId: eid,
            candidate: label,
          });
          continue;
        }
        const dsStatus = err?.response?.status;
        if (dsStatus === 401 || dsStatus === 403) {
          console.warn('[DocuSign] download auth rejected — trying next funder account', {
            envelopeId: eid,
            candidate: label,
            status: dsStatus,
          });
          continue;
        }
        if (dsStatus === 404) {
          // Envelope may live on another linked DocuSign account — try next.
          console.warn('[DocuSign] download envelope not found on account — trying next', {
            envelopeId: eid,
            candidate: label,
          });
          continue;
        }
        if (
          err?.name === 'BadRequestException' &&
          /empty or unavailable combined document/i.test(String(err?.message || ''))
        ) {
          continue;
        }
        if (err?.status && err.status >= 400 && err.status < 600) {
          throw err;
        }
        throw new BadRequestException(msg || 'DocuSign PDF download failed');
      }
    }

    const failMsg =
      lastErr instanceof Error && /empty or unavailable/i.test(lastErr.message)
        ? lastErr.message
        : formatDocusignApiErrorMessage(lastErr);
    throw new BadRequestException(
      `${failMsg || 'DocuSign PDF download failed'} Tried sender accounts: ${tried.join(', ') || 'none'}. ` +
        'Open this envelope with the funder DocuSign account that originally sent it.',
    );
  }

  /**
   * Download a template PDF for preview.
   * Prefers CRM `BoldSignTemplate.pdfUrl` (platform / funder Cloudinary PDFs) when
   * `templateId` is a layout key (e.g. `contract`, `funder_<uuid>`). Falls back to
   * DocuSign remote template download only for real DocuSign template UUIDs.
   */
  async downloadTemplatePdf(
    userId: string,
    templateId: string,
    options?: {
      funderName?: string;
      funderProfileId?: string;
      state?: string;
    },
  ) {
    const rawRef = String(templateId || '').trim();
    if (!rawRef) {
      throw new BadRequestException('templateId is required');
    }

    let resolvedRef = rawRef;
    const funderName = String(options?.funderName || '').trim();
    const funderProfileId = String(options?.funderProfileId || '').trim();
    const state = String(options?.state || '').trim() || null;

    if (funderName || funderProfileId) {
      try {
        resolvedRef = await this.resolveTemplateRefForFunder(rawRef, {
          funderName,
          funderProfileId,
          state,
        });
      } catch {
        resolvedRef = rawRef;
      }
    }

    let crmPdfUrl = await this.findCrmTemplatePdfUrl(resolvedRef);
    // Funder uses the platform template (no own PDF for this document) — fall back
    // to the original layout key so the preview still resolves the platform PDF.
    if (!crmPdfUrl && resolvedRef !== rawRef) {
      crmPdfUrl = await this.findCrmTemplatePdfUrl(rawRef);
      if (crmPdfUrl) {
        resolvedRef = rawRef;
      }
    }
    if (crmPdfUrl) {
      const res = await fetch(crmPdfUrl);
      if (!res.ok) {
        throw new BadRequestException(
          `Failed to download CRM template PDF (${res.status}) for "${resolvedRef}"`,
        );
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const stampKey = [resolvedRef, rawRef].find((k) =>
        String(k || '').toLowerCase().includes('case_takeover'),
      );
      if (stampKey) {
        try {
          const { getDocumentLayout } = await import('./layouts/document-layout.registry');
          const { stampFunderLogoOnPdfBase64 } = await import('./utils/stamp-funder-logo');
          const { resolveFunderProfile } = await import('../funderProfileService');
          const { isDocumentLayoutKey } = await import('./platform-document-registry');
          const layoutKey = isDocumentLayoutKey(stampKey)
            ? stampKey
            : 'case_takeover_addendum';
          const layout = getDocumentLayout(layoutKey as any);
          const profile = await resolveFunderProfile({
            funderProfileId: options?.funderProfileId,
            funderName: options?.funderName,
            state: options?.state,
          });
          const logoUrl = String(profile?.logoUrl || '').trim();
          if (layout?.branding?.logo && logoUrl) {
            const stamped = await stampFunderLogoOnPdfBase64(
              buf.toString('base64'),
              logoUrl,
              layout.branding.logo,
            );
            return Buffer.from(stamped, 'base64');
          }
        } catch {
          /* return unstamped */
        }
      }
      return buf;
    }

    // Platform layout keys with bundled defaults (e.g. case_takeover_addendum).
    try {
      const { isDocumentLayoutKey, loadPlatformDocumentPdfBase64 } = await import(
        './platform-document-registry'
      );
      const { getDocumentLayout } = await import('./layouts/document-layout.registry');
      const { stampFunderLogoOnPdfBase64 } = await import('./utils/stamp-funder-logo');
      const { resolveFunderProfile } = await import('../funderProfileService');

      const stampCaseTakeoverLogo = async (b64: string, layoutKey: string): Promise<Buffer> => {
        const layout = getDocumentLayout(layoutKey as any);
        const logoBox = layout?.branding?.logo;
        if (!logoBox) return Buffer.from(b64, 'base64');
        const profile = await resolveFunderProfile({
          funderProfileId: options?.funderProfileId,
          funderName: options?.funderName,
          state: options?.state,
        });
        const logoUrl = String(profile?.logoUrl || '').trim();
        if (!logoUrl) return Buffer.from(b64, 'base64');
        const stamped = await stampFunderLogoOnPdfBase64(b64, logoUrl, logoBox);
        return Buffer.from(stamped, 'base64');
      };

      if (isDocumentLayoutKey(resolvedRef)) {
        const b64 = await loadPlatformDocumentPdfBase64(resolvedRef);
        if (b64) {
          if (String(resolvedRef).includes('case_takeover')) {
            return stampCaseTakeoverLogo(b64, resolvedRef);
          }
          return Buffer.from(b64, 'base64');
        }
      }
      if (resolvedRef !== rawRef && isDocumentLayoutKey(rawRef)) {
        const b64 = await loadPlatformDocumentPdfBase64(rawRef);
        if (b64) {
          if (String(rawRef).includes('case_takeover')) {
            return stampCaseTakeoverLogo(b64, rawRef);
          }
          return Buffer.from(b64, 'base64');
        }
      }
    } catch {
      /* fall through */
    }

    // DocuSign template UUIDs only — layout keys like `contract` / `funder_*` are CRM-sourced.
    const looksLikeDocusignUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedRef);
    if (!looksLikeDocusignUuid) {
      throw new BadRequestException(
        `No CRM PDF found for template "${resolvedRef}". Upload the funder contract PDF or set BoldSignTemplate.pdfUrl.`,
      );
    }

    const { client, accountId } = await this.getAuthContext(userId);
    const listRes = await client.get(
      `/v2.1/accounts/${accountId}/templates/${resolvedRef}/documents`,
    );
    const docs = listRes.data?.templateDocuments || listRes.data?.documents || [];
    const docId = docs[0]?.documentId || '1';
    const res = await client.get(
      `/v2.1/accounts/${accountId}/templates/${resolvedRef}/documents/${docId}`,
      { responseType: 'arraybuffer' },
    );
    return Buffer.from(res.data);
  }

  /**
   * Resolve the funder-specific template ref for a preview download.
   *
   * Supplemental documents (ACH authorization, addendum, balance transfer) map to
   * the funder-scoped supplemental key `funder_<id>_<type>`, while the main contract
   * uses the contract layout resolver. Funders that use platform documents keep the
   * original layout key so the platform template is used.
   */
  private async resolveTemplateRefForFunder(
    rawRef: string,
    options: {
      funderName?: string;
      funderProfileId?: string;
      state?: string | null;
    },
  ): Promise<string> {
    const funderName = String(options.funderName || '').trim();
    const funderProfileId = String(options.funderProfileId || '').trim();
    const state = options.state ?? null;

    const { getFunderProfileById, getFunderProfileByName } = await import(
      '../funderProfileService'
    );
    let profile = funderProfileId ? await getFunderProfileById(funderProfileId) : null;
    if (!profile && funderName) {
      profile = await getFunderProfileByName(funderName, state);
    }

    const {
      resolveFunderSupplementalStorageType,
      funderSupplementalLayoutKeyForDocument,
      FUNDER_SUPPLEMENTAL_LAYOUT_TYPES,
    } = await import('../../utils/funderContractLayout');
    const supplementalType = resolveFunderSupplementalStorageType(rawRef);
    const isSupplemental = (
      FUNDER_SUPPLEMENTAL_LAYOUT_TYPES as readonly string[]
    ).includes(supplementalType);

    if (isSupplemental) {
      // Standalone/supplemental docs must NOT resolve to the funder's main contract key.
      if (!profile) return rawRef;
      const { resolveDocumentsLayoutFunderId } = await import(
        '../../utils/funderDocumentSource'
      );
      const layoutFunderId = resolveDocumentsLayoutFunderId(profile);
      // Platform-document funders (or Woodmere) keep the platform layout key —
      // Woodmere ACH lives on layoutKey `ach_authorization`, not funder_<id>_….
      if (!layoutFunderId) return rawRef;
      const nameTokens = [
        profile.name,
        (profile as { displayName?: string | null }).displayName,
        (profile as { organization?: string | null }).organization,
        (profile as { legalName?: string | null }).legalName,
      ]
        .map((v) =>
          String(v || '')
            .trim()
            .toLowerCase()
            .replace(/\s+/g, ' '),
        )
        .filter(Boolean);
      const isWoodmere = nameTokens.some(
        (t) =>
          t === 'woodmere' ||
          t === 'woodmere financial' ||
          t === 'nitro advance' ||
          t === 'harbor view' ||
          t === 'harbor view capital' ||
          (t.includes('nitro advance') && !t.includes('texas')) ||
          (t.includes('harbor view') && !t.includes('texas')) ||
          (t.includes('woodmere') && !t.includes('texas')),
      );
      if (isWoodmere) return rawRef;

      const scoped = funderSupplementalLayoutKeyForDocument(layoutFunderId, rawRef);
      // Only switch to the funder-scoped key when that PDF actually exists.
      const scopedPdf = await this.findCrmTemplatePdfUrlExact(scoped);
      return scopedPdf ? scoped : rawRef;
    }

    const { resolveMainContractLayoutKeyForSend } = await import(
      './utils/resolve-main-contract-layout'
    );
    const nameForResolve = String(profile?.name || funderName || '').trim();
    return resolveMainContractLayoutKeyForSend({
      mainContractLayoutKey: rawRef,
      funderName: nameForResolve || undefined,
      state,
    });
  }

  /** Exact BoldSignTemplate.pdfUrl match (no platform-layout aliasing). */
  private async findCrmTemplatePdfUrlExact(templateRef: string): Promise<string | null> {
    const ref = String(templateRef || '').trim();
    if (!ref) return null;

    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);

    // `BoldSignTemplate.id` is a UUID column — never query it with layout keys like `funder_<uuid>`.
    const rows = await prisma.boldSignTemplate.findMany({
      where: {
        OR: [
          { layoutKey: ref },
          { templateId: ref },
          ...(isUuid ? [{ id: ref }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { pdfUrl: true, name: true, originalFileName: true },
    });
    for (const row of rows) {
      if (
        isPreferredCapitalBranding(row.name) ||
        isPreferredCapitalBranding(row.originalFileName) ||
        isPreferredCapitalBranding(row.pdfUrl)
      ) {
        continue;
      }
      const url = String(row.pdfUrl || '').trim();
      if (!url || url.startsWith('platform://')) continue;
      if (/^https?:\/\//i.test(url)) return url;
    }
    return null;
  }

  /**
   * Resolve Cloudinary (or HTTPS) pdfUrl from BoldSignTemplate by layoutKey / templateId / row id.
   * Platform layout keys also use the send-path resolver (incl. standalone ACH → ach_authorization).
   */
  private async findCrmTemplatePdfUrl(templateRef: string): Promise<string | null> {
    const ref = String(templateRef || '').trim();
    if (!ref) return null;

    const exact = await this.findCrmTemplatePdfUrlExact(ref);
    if (exact) return exact;

    const { isDocumentLayoutKey, findBoldSignTemplatePdfUrlForLayout } = await import(
      './platform-document-registry'
    );
    if (isDocumentLayoutKey(ref)) {
      return findBoldSignTemplatePdfUrlForLayout(ref);
    }
    return null;
  }

  async downloadSignedPdf(
    userId: string,
    documentId: string,
    options?: {
      requireDocument?: boolean;
      contractId?: number | null;
      applicationId?: string | null;
      funderName?: string | null;
      funderProfileId?: string | null;
      contractState?: string | null;
    },
  ) {
    return this.downloadDocumentPdfByEnvelopeId(userId, documentId, options);
  }

  async fetchSignedDocumentPdf(
    userId: string,
    envelopeId: string,
    options?: {
      requireDocument?: boolean;
      contractId?: number | null;
      applicationId?: string | null;
      funderName?: string | null;
      funderProfileId?: string | null;
      contractState?: string | null;
    },
  ) {
    return this.downloadSignedPdf(userId, envelopeId, options);
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

  /**
   * Signer roles for UI / send — always from platform layout slots.
   * Does not call DocuSign Admin templates (envelopes are code-built).
   */
  async getTemplateRecipients(_userId: string, templateId?: string) {
    const { getPlatformTemplateRecipients } = await import('./platform-document-registry');
    const platform = getPlatformTemplateRecipients();
    const tid = String(templateId || '').trim();
    return {
      ...platform,
      templateId: tid || null,
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
      contractId?: number;
      funderName?: string | null;
      contractState?: string | null;
    },
  ) {
    const eid = String(envelopeId || '').trim();
    const authHints = {
      applicationId: options?.applicationId,
      contractId: options?.contractId,
      funderName: options?.funderName,
      contractState: options?.contractState,
    };
    await this.syncEnvelopeCcEmails(
      userId,
      eid,
      options?.ccEmails || [],
      options?.applicationId,
      options?.signerEmail,
      options?.signerName,
      options?.roles,
      authHints,
    );
    const { client, accountId } = await this.getAuthContextForEnvelope(userId, eid, authHints);
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

  /**
   * Email CC recipients via CRM when the envelope first becomes sent.
   * DocuSign carbon copies are not used (they notify after signing, not on send).
   */
  private async notifyCcRecipientsOnEnvelopeSent(
    userId: string,
    envelopeId: string,
    applicationId?: string | null,
    existingDoc?: { userId?: number | null } | null,
    ccEmailsOverride?: string[],
    titleOverride?: string,
    knownEnvelopeKind?: string | null,
  ): Promise<{ emailed: string[]; skippedReason?: string }> {
    const eid = String(envelopeId || '').trim();
    if (!eid) return { emailed: [], skippedReason: 'missing_envelope' };

    if (this.shouldSkipCcNotify(eid)) {
      return { emailed: [], skippedReason: 'already_attempted_or_in_flight' };
    }

    const appIdHint = String(applicationId || '').trim();
    let knownKind = String(knownEnvelopeKind || '').trim().toLowerCase() || null;
    if (!knownKind && appIdHint) {
      if (await this.isAchStandaloneEnvelopeOnContract(appIdHint, eid)) {
        knownKind = 'standalone_ach';
      }
    }

    // Standalone ACH: no default CC and usually no CRM CC list — skip before any DocuSign GET.
    if (knownKind === 'standalone_ach') {
      const earlyCc = this.normalizeCcEmails(ccEmailsOverride, { includeDefault: false });
      if (!earlyCc.length) {
        this.markCcNotifyAttempted(eid);
        return { emailed: [], skippedReason: 'standalone_ach_no_cc' };
      }
    }

    this.ccNotifyInFlight.add(eid);
    try {
      let authUserId = String(userId || '').trim();
      if (!authUserId && existingDoc?.userId != null) {
        const owner = await prisma.user.findFirst({
          where: { userId: existingDoc.userId },
          select: { id: true },
        });
        authUserId = owner?.id || '';
      }
      const { client, accountId } = await this.getAuthContextForEnvelope(authUserId, eid, {
        applicationId,
      });

      let customFields: Array<{ name?: string; value?: string; show?: string }> = [];
      try {
        customFields = await this.fetchEnvelopeTextCustomFields(client, accountId, eid);
      } catch (err) {
        if (isDocuSignPollingLimitError(err)) {
          this.markCcNotifyAttempted(eid);
          return { emailed: [], skippedReason: 'api_limit_exceeded' };
        }
        throw err;
      }

      if (this.isCcAlreadyEmailedFromFields(customFields, eid)) {
        this.markCcNotifyAttempted(eid);
        return { emailed: [], skippedReason: 'already_emailed' };
      }

      // Claim this envelope before PDF downloads so concurrent webhooks bail out.
      this.markCcNotifyAttempted(eid);

      const envelopeKind = this.crmKindFromFields(customFields) || knownKind;
      const includeDefaultCc = this.includeDefaultCcForEnvelopeKind(envelopeKind);
      let ccEmails = this.normalizeCcEmails(ccEmailsOverride, { includeDefault: includeDefaultCc });
      if (!ccEmails.length) {
        ccEmails = this.normalizeCcEmails(this.ccEmailsFromFields(customFields), {
          includeDefault: includeDefaultCc,
        });
      }
      if (!ccEmails.length) {
        return { emailed: [], skippedReason: 'no_cc_addresses' };
      }
      if (!isOutboundSmtpConfigured()) {
        return { emailed: [], skippedReason: 'smtp_not_configured' };
      }

      const subject = await this.resolveEnvelopeEmailSubject(
        client,
        accountId,
        eid,
        applicationId,
        titleOverride,
      );
      const result = await this.emailPrefilledContractPdfToCcRecipients(
        client,
        accountId,
        eid,
        ccEmails,
        subject,
      );
      if (result.emailed.length) {
        await this.upsertEnvelopeTextCustomFields(
          client,
          accountId,
          eid,
          { crmCcEmailedAt: new Date().toISOString() },
          customFields,
        );
        console.log(
          `[DocuSign] CC contract emailed to ${result.emailed.join(', ')} (envelope ${eid}, subject "${subject}")`,
        );
      }
      return result;
    } catch (err) {
      if (isDocuSignPollingLimitError(err)) {
        console.warn(
          '[DocuSign] notifyCcRecipientsOnEnvelopeSent aborted: hourly API limit exceeded',
        );
        return { emailed: [], skippedReason: 'api_limit_exceeded' };
      }
      console.warn('[DocuSign] notifyCcRecipientsOnEnvelopeSent failed:', err);
      return { emailed: [], skippedReason: 'error' };
    } finally {
      this.ccNotifyInFlight.delete(eid);
    }
  }

  async sendEnvelope(
    userId: string,
    envelopeId: string,
    options?: {
      applicationId?: string;
      ccEmails?: string[];
      title?: string;
      contractId?: number;
      funderName?: string | null;
      contractState?: string | null;
    },
  ) {
    const eid = String(envelopeId || '').trim();
    if (!eid) {
      throw new BadRequestException('envelopeId is required');
    }
    const authHints = {
      applicationId: options?.applicationId,
      contractId: options?.contractId,
      funderName: options?.funderName,
      contractState: options?.contractState,
    };
    const { client, accountId } = await this.getAuthContextForEnvelope(userId, eid, authHints);
    const appId = String(options?.applicationId || '').trim();
    const ccFromRequest = options?.ccEmails || [];
    const priorStatus = await this.getEnvelopeStatus(client, accountId, eid);

    await this.syncEnvelopeCcEmails(
      userId,
      eid,
      ccFromRequest,
      appId || undefined,
      undefined,
      undefined,
      undefined,
      authHints,
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
    setCachedEnvelopeStatus(accountId, eid, 'sent');
    invalidateCachedEnvelopeRecipients(accountId, eid);
    if (appId) {
      await this.markEnvelopeSent(appId, eid);
    } else {
      await prisma.document.updateMany({
        where: { envelopeId: eid },
        data: { status: 'sent', sentAt: new Date() } as any,
      });
    }

    const ccPrefilledEmail = await this.notifyCcRecipientsOnEnvelopeSent(
      userId,
      eid,
      appId || undefined,
      null,
      ccFromRequest,
      options?.title,
    );

    await this.archiveEnvelopePdfToCloudinary({
      envelopeId: eid,
      applicationId: appId || undefined,
      userId,
      phase: 'sent',
    });

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

    let priorStatus = String(existingDoc?.status || '').toLowerCase();
    if (!priorStatus && applicationId) {
      priorStatus = await this.getStoredEnvelopeStatusFromContract(
        String(applicationId),
        envelopeId,
      );
    }
    const envelopeKind = extractCrmEnvelopeKindFromWebhook(body);
    const status = await this.applySigningStatusUpdate(
      envelopeId,
      incomingResolved,
      applicationId,
      existingDoc,
      { envelopeKind, webhookBody: body },
    );

    if (incomingResolved === 'sent' || incomingResolved === 'completed') {
      // CC PDF download hits DocuSign REST heavily — only on first envelope-level
      // sent/completed, never on recipient-* Connect events (those map to "sent" too).
      const eventLower = String(eventName || '').trim().toLowerCase();
      const isRecipientEvent = eventLower.startsWith('recipient-');
      const alreadySentLike = this.isSentLikeEnvelopeStatus(priorStatus);
      const isStandaloneAch =
        String(envelopeKind || '').trim().toLowerCase() === 'standalone_ach' ||
        (Boolean(applicationId) &&
          (await this.isAchStandaloneEnvelopeOnContract(
            String(applicationId),
            String(envelopeId),
          )));
      if (
        !isRecipientEvent &&
        !alreadySentLike &&
        !isStandaloneAch &&
        !this.shouldSkipCcNotify(String(envelopeId))
      ) {
        await this.notifyCcRecipientsOnEnvelopeSent(
          '',
          envelopeId,
          applicationId,
          existingDoc,
          undefined,
          undefined,
          envelopeKind,
        );
      }

      // Archive sent (prefilled) and completed (signed) packages under
      // ih-crm/signed-contracts/{funder}/ so CRM preview skips DocuSign GETs.
      if (!isRecipientEvent && !isStandaloneAch) {
        if (incomingResolved === 'sent' && !alreadySentLike) {
          await this.archiveEnvelopePdfToCloudinary({
            envelopeId: String(envelopeId),
            applicationId,
            phase: 'sent',
          });
        } else if (
          incomingResolved === 'completed' &&
          priorStatus !== 'completed'
        ) {
          await this.archiveEnvelopePdfToCloudinary({
            envelopeId: String(envelopeId),
            applicationId,
            phase: 'completed',
          });
        }
      }
    }

    rememberEnvelopeWebhook(String(envelopeId));

    if (applicationId && status && priorStatus !== status) {
      if (
        await this.shouldSyncContractSigningStatus(applicationId, envelopeId, envelopeKind)
      ) {
        await this.handleContractStatusChange(
          applicationId,
          status,
          priorStatus || null,
          envelopeId,
        );
      } else {
        // ACH / package capsules: still push realtime so open CRM UIs refresh instantly.
        await emitContractSigningStatusRealtime({
          applicationId,
          envelopeId,
          status,
          priorStatus: priorStatus || null,
          provider: 'docusign',
          envelopeKind: envelopeKind ?? null,
        });
      }
    }

    console.info('[DocuSign] webhook processed', {
      envelopeId,
      event: eventName,
      incoming: incomingResolved,
      stored: status,
      applicationId: applicationId || existingDoc?.applicationId,
    });
  }

  /** CRM-only status snapshot — used when Connect is fresh or polling is exhausted. */
  private async buildCrmEnvelopeSyncPayload(
    envelopeId: string,
    applicationId?: string | null,
  ): Promise<Record<string, unknown> | null> {
    const eid = String(envelopeId || '').trim();
    if (!eid) return null;
    const appIdHint = String(applicationId || '').trim();

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId: eid },
    });
    const appId = appIdHint || existingDoc?.applicationId || null;

    if (appId) {
      const stored = await this.getStoredEnvelopeStatusFromContract(String(appId), eid);
      if (stored) {
        let contractStatus: string | null = null;
        try {
          const contract = await prisma.contract.findFirst({
            where: { applicationId: String(appId) },
            orderBy: { createdAt: 'desc' },
            select: { status: true },
          });
          contractStatus = contract?.status ? String(contract.status) : null;
        } catch {
          /* omit */
        }
        return {
          envelopeId: eid,
          applicationId: appId,
          docusignStatus: stored,
          internalStatus: stored,
          contractStatus,
          ccPrefilledEmail: { emailed: [], skippedReason: 'crm_snapshot' },
          skippedDocuSign: true,
        };
      }
    }

    if (!existingDoc) return null;
    const docStatus = String(existingDoc.status || 'draft').trim().toLowerCase() || 'draft';
    return {
      envelopeId: eid,
      applicationId: appId,
      docusignStatus: docStatus,
      internalStatus: docStatus,
      contractStatus: docStatus
        ? internalEnvelopeStatusToContractStatusDbValue(docStatus)
        : null,
      ccPrefilledEmail: { emailed: [], skippedReason: 'crm_snapshot' },
      skippedDocuSign: true,
    };
  }

  /** Poll DocuSign for current envelope status (manual Refresh / stale Connect only). */
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
    const forceRefresh = options.force === true;

    if (!envelopeId && applicationId) {
      envelopeId = (await this.getEnvelopeIdForApplication(applicationId)) || '';
    }
    if (!envelopeId) {
      throw new BadRequestException(
        'No DocuSign envelope linked. Provide envelopeId or applicationId.',
      );
    }

    const cachedSync = !forceRefresh ? getEnvelopeStatusSyncCache(envelopeId) : null;
    if (cachedSync) {
      return {
        ...cachedSync.payload,
        cached: true,
        source: (cachedSync.payload.source as string | undefined) ?? 'cache',
      };
    }

    // Webhook-first: return CRM state without DocuSign GET while Connect is fresh.
    if (shouldSkipDocuSignPollForWebhook(envelopeId, forceRefresh)) {
      const crmPayload = await this.buildCrmEnvelopeSyncPayload(envelopeId, applicationId);
      if (crmPayload) {
        const payload = { ...crmPayload, source: 'webhook' };
        setEnvelopeStatusSyncCache(envelopeId, payload);
        return payload;
      }
    }

    const { client, accountId } = await this.getAuthContextForEnvelope(userId, envelopeId, {
      applicationId,
      contractId: options.contractId,
    });

    let dsStatus = getCachedEnvelopeStatus(accountId, envelopeId) || '';
    if (!dsStatus || forceRefresh) {
      if (forceRefresh) {
        invalidateCachedEnvelopeStatus(accountId, envelopeId);
      }
      try {
        const res = await client.get(
          `/v2.1/accounts/${accountId}/envelopes/${envelopeId}`,
        );
        dsStatus = String(res.data?.status || '').toLowerCase();
        if (dsStatus) setCachedEnvelopeStatus(accountId, envelopeId, dsStatus);
      } catch (err) {
        if (isDocuSignPollingLimitError(err)) {
          const crmFallback = await this.buildCrmEnvelopeSyncPayload(envelopeId, applicationId);
          if (crmFallback) {
            return { ...crmFallback, rateLimited: true, source: 'crm' };
          }
        }
        throw err;
      }
    }

    const incomingResolved = mapDocusignEnvelopeStatus(dsStatus);
    if (!incomingResolved) {
      throw new BadRequestException(
        `DocuSign returned unrecognized envelope status: ${String(dsStatus)}`,
      );
    }

    const existingDoc = await prisma.document.findFirst({
      where: { envelopeId: String(envelopeId) },
    });

    const appId = applicationId || existingDoc?.applicationId || null;
    let priorStatus = String(existingDoc?.status || '').toLowerCase();
    if (!priorStatus && appId) {
      priorStatus = await this.getStoredEnvelopeStatusFromContract(String(appId), envelopeId);
    }
    // Prefer CRM-derived kind — avoid extra custom_fields GET (counts as envelope polling).
    let envelopeKind: string | null = null;
    if (appId) {
      if (await this.isAchStandaloneEnvelopeOnContract(String(appId), envelopeId)) {
        envelopeKind = 'standalone_ach';
      } else if (await this.isPrimaryContractEnvelope(String(appId), envelopeId)) {
        envelopeKind = 'contract';
      }
    }
    const contractIdHint = Number(options.contractId);
    const status = await this.applySigningStatusUpdate(
      envelopeId,
      incomingResolved,
      appId,
      existingDoc,
      {
        envelopeKind,
        client,
        accountId,
        contractId:
          Number.isFinite(contractIdHint) && contractIdHint > 0 ? contractIdHint : undefined,
      },
    );

    const ccPrefilledEmail = {
      emailed: [] as string[],
      skippedReason: 'deferred_to_send_or_webhook',
    };

    if (appId && status && priorStatus !== status) {
      if (
        await this.shouldSyncContractSigningStatus(String(appId), envelopeId, envelopeKind)
      ) {
        await this.handleContractStatusChange(
          appId,
          status,
          priorStatus || null,
          envelopeId,
        );
      } else {
        await emitContractSigningStatusRealtime({
          applicationId: String(appId),
          envelopeId,
          status,
          priorStatus: priorStatus || null,
          provider: 'docusign',
          envelopeKind: envelopeKind ?? null,
        });
      }
    }

    const payload = {
      envelopeId,
      applicationId: appId,
      docusignStatus: dsStatus,
      internalStatus: status,
      contractStatus: status
        ? internalEnvelopeStatusToContractStatusDbValue(status)
        : null,
      ccPrefilledEmail,
      source: 'docusign_poll',
    };
    setEnvelopeStatusSyncCache(envelopeId, payload);
    return payload;
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
