import crypto from 'crypto';

const ENCRYPTION_PREFIX = 'enc:v1:';

function getKey(): Buffer {
  const raw = process.env.FIELD_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error('FIELD_ENCRYPTION_KEY is not set');
  }

  // Derive a stable 32-byte key from the provided secret.
  // This accepts arbitrary length secrets while producing an AES-256 key.
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

export function isEncrypted(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(ENCRYPTION_PREFIX);
}

export function encryptField(value: string): string {
  const plaintext = String(value ?? '').trim();
  if (!plaintext) return plaintext;
  if (isEncrypted(plaintext)) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(12); // recommended IV length for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return (
    ENCRYPTION_PREFIX +
    `${iv.toString('base64')}.${tag.toString('base64')}.${ciphertext.toString('base64')}`
  );
}

export function decryptField(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  if (!isEncrypted(value)) return value;

  const payload = value.slice(ENCRYPTION_PREFIX.length);
  const [ivB64, tagB64, ciphertextB64] = payload.split('.');
  if (!ivB64 || !tagB64 || !ciphertextB64) {
    // If the stored value is malformed, return it as-is rather than crashing responses.
    return value;
  }

  const key = getKey();
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);

  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString('utf8');
}

