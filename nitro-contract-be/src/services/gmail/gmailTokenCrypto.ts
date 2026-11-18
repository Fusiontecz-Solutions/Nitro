/**
 * Encryption for Google OAuth refresh tokens (users and funder mailboxes).
 *
 * Reuses `utils/fieldEncryption` (AES-256-GCM, `enc:v1:` prefix, FIELD_ENCRYPTION_KEY).
 * Token values are never logged or put in error messages.
 */
import { decryptField, encryptField, isEncrypted } from '../../utils/fieldEncryption';

export { isEncrypted as isEncryptedToken };

/** Encrypt a plain refresh token for storage. Throws when FIELD_ENCRYPTION_KEY is missing. */
export function encryptRefreshToken(plainToken: string): string {
    const token = String(plainToken ?? '').trim();
    if (!token) throw new Error('Refresh token is empty');
    if (isEncrypted(token)) return token;
    return encryptField(token);
}

/**
 * Plain refresh token from a stored value (encrypted or legacy plain text).
 * Returns null when it cannot be decrypted (wrong key / corrupt) — the caller
 * treats that as "reconnect needed".
 */
export function decryptRefreshToken(stored: string | null | undefined): string | null {
    const value = String(stored ?? '').trim();
    if (!value) return null;
    if (!isEncrypted(value)) return value;
    try {
        const plain = decryptField(value);
        const token = String(plain ?? '').trim();
        return token && !isEncrypted(token) ? token : null;
    } catch {
        console.warn('[gmail-token] stored refresh token could not be decrypted (check FIELD_ENCRYPTION_KEY)');
        return null;
    }
}
