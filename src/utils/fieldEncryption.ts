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
  let plaintext = String(value ?? '').trim();
  if (!plaintext) return plaintext;
  if (isEncrypted(plaintext)) {
    const decrypted = decryptSensitiveField(plaintext);
    if (!decrypted) {
      throw new Error(
        'Bank field is encrypted with a different FIELD_ENCRYPTION_KEY. Re-enter the account or routing number and save again.',
      );
    }
    plaintext = decrypted;
  }

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

/**
 * Decrypt when value is `enc:v1:`; otherwise return unchanged. Never throws.
 * On key mismatch / corruption returns `null` so APIs do not leak ciphertext to the UI.
 */
export function decryptSensitiveField(value: string | null | undefined): string | null | undefined {
  if (value == null) return value;
  if (!isEncrypted(value)) return value;
  try {
    return decryptField(value);
  } catch (err) {
    console.warn(
      '[fieldEncryption] Decryption failed (FIELD_ENCRYPTION_KEY may not match data encrypted in DB). Re-enter and save bank details.',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/** Recursively decrypt any encrypted string leaves in JSON (e.g. contractPrefillOverrides). */
export function decryptEncryptedStringsInJson<T>(value: T): T {
  if (typeof value === 'string') {
    return decryptSensitiveField(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => decryptEncryptedStringsInJson(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        decryptEncryptedStringsInJson(v),
      ]),
    ) as T;
  }
  return value;
}

const ACH_API_BANK_KEYS = ['accountNumber', 'routingNumber'] as const;

export function mapAchRecordForApi<T extends Record<string, unknown>>(ach: T): T {
  const out: Record<string, unknown> = { ...ach };
  for (const key of ACH_API_BANK_KEYS) {
    if (key in out && typeof out[key] === 'string') {
      out[key] = decryptSensitiveField(out[key] as string);
    }
  }
  return out as T;
}

const CONTRACT_API_BANK_SCALAR_KEYS = [
  'authorizationClientBankAccount',
  'authorizationClientBankRouting',
] as const;

export function mapContractRecordForApi<T extends Record<string, unknown>>(contract: T): T {
  const out: Record<string, unknown> = { ...contract };
  for (const key of CONTRACT_API_BANK_SCALAR_KEYS) {
    if (key in out && typeof out[key] === 'string') {
      out[key] = decryptSensitiveField(out[key] as string);
    }
  }
  if (out.contractPrefillOverrides != null) {
    out.contractPrefillOverrides = decryptEncryptedStringsInJson(out.contractPrefillOverrides);
  }
  if (Array.isArray(out.achs)) {
    out.achs = out.achs.map((row) => mapAchRecordForApi(row as Record<string, unknown>));
  }
  return out as T;
}

export function mapBankDetailRecordForApi<T extends Record<string, unknown>>(bank: T): T {
  const out: Record<string, unknown> = { ...bank };
  for (const key of ACH_API_BANK_KEYS) {
    if (key in out && typeof out[key] === 'string') {
      out[key] = decryptSensitiveField(out[key] as string);
    }
  }
  return out as T;
}

