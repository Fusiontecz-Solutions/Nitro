import { createPublicPortalToken } from './publicPortalTokenService';
import {
    buildPublicApplicationStatusPortalUrl,
    resolveCrmFrontendBaseUrl,
} from '../utils/crmFrontendUrl';

/**
 * Absolute public application status portal URL (status + ISO comments) for email CTAs.
 * `GET /public/application/:token/portal-status` only accepts signed table tokens, so no
 * URL is returned when a token cannot be minted (a raw application UUID would 404).
 */
export async function resolvePublicApplicationStatusPortalUrl(
    applicationUuid: string,
    options?: { expiresInDays?: number },
): Promise<string | undefined> {
    const appId = String(applicationUuid || '').trim();
    if (!appId) return undefined;

    const baseUrl = resolveCrmFrontendBaseUrl()?.replace(/\/$/, '');
    if (!baseUrl) return undefined;

    try {
        const portalToken = await createPublicPortalToken(appId, {
            expiresInDays: options?.expiresInDays ?? 90,
        });
        if (portalToken) return buildPublicApplicationStatusPortalUrl(baseUrl, portalToken);
    } catch (tokenErr) {
        console.error('[statusPortalUrl] token generation failed:', tokenErr);
    }
    return undefined;
}
