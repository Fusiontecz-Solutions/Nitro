/**
 * Refresh tokens are stored AES-256-GCM encrypted; legacy plain-text values still
 * read; a value that cannot be decrypted reads as "no token" (reconnect), never throws.
 */
import { decryptRefreshToken, encryptRefreshToken, isEncryptedToken } from './gmailTokenCrypto';

const ORIGINAL_KEY = process.env.FIELD_ENCRYPTION_KEY;
const TOKEN = '1//0g-test-refresh-token-value';

describe('gmailTokenCrypto', () => {
    beforeEach(() => {
        process.env.FIELD_ENCRYPTION_KEY = 'unit-test-key-A';
    });
    afterAll(() => {
        process.env.FIELD_ENCRYPTION_KEY = ORIGINAL_KEY;
    });

    it('round-trips and never stores the plain token', () => {
        const stored = encryptRefreshToken(TOKEN);
        expect(isEncryptedToken(stored)).toBe(true);
        expect(stored).not.toContain(TOKEN);
        expect(decryptRefreshToken(stored)).toBe(TOKEN);
    });

    it('uses a fresh IV per encryption', () => {
        expect(encryptRefreshToken(TOKEN)).not.toBe(encryptRefreshToken(TOKEN));
    });

    it('does not double-encrypt an encrypted value', () => {
        const stored = encryptRefreshToken(TOKEN);
        expect(encryptRefreshToken(stored)).toBe(stored);
    });

    it('reads legacy plain-text tokens unchanged', () => {
        expect(decryptRefreshToken(TOKEN)).toBe(TOKEN);
        expect(decryptRefreshToken(null)).toBeNull();
        expect(decryptRefreshToken('  ')).toBeNull();
    });

    it('returns null (reconnect) when the key changed, without logging the token', () => {
        const stored = encryptRefreshToken(TOKEN);
        process.env.FIELD_ENCRYPTION_KEY = 'unit-test-key-B';
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        expect(decryptRefreshToken(stored)).toBeNull();
        expect(warn.mock.calls.flat().join(' ')).not.toContain(TOKEN);
        warn.mockRestore();
    });

    it('refuses to store without an encryption key', () => {
        delete process.env.FIELD_ENCRYPTION_KEY;
        expect(() => encryptRefreshToken(TOKEN)).toThrow(/FIELD_ENCRYPTION_KEY/);
    });
});
