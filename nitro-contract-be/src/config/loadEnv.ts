import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

/**
 * Directory that contains `package.json` for this backend (`in-house-crm-be`).
 * Works for `ts-node` (`src/config/…`) and `node dist/` (`dist/config/…`).
 */
export const BACKEND_PACKAGE_ROOT = path.resolve(__dirname, '..', '..');

/** Canonical `.env` next to backend `package.json`. */
export const BACKEND_DOTENV_PATH = path.join(BACKEND_PACKAGE_ROOT, '.env');

let loadEnvRan = false;

function hoistUtf8BomKeyedEnvVars(): void {
  for (const key of Object.keys(process.env)) {
    const nk = key.replace(/^\ufeff/, '');
    if (nk !== key && process.env[nk] === undefined && process.env[key] != null) {
      process.env[nk] = process.env[key];
    }
  }
}

/**
 * Loads backend `.env` before other modules read `process.env`.
 * Prefer this file over `process.cwd()` (monorepo / IDE launch often starts from repo root).
 */
export function loadBackendEnv(): void {
  if (loadEnvRan) {
    return;
  }
  loadEnvRan = true;

  // Empty string in process.env counts as “set”; dotenv would skip merging from .env unless we override/remove.
  if (process.env.ANTHROPIC_API_KEY?.trim?.() === '') {
    delete process.env.ANTHROPIC_API_KEY;
  }

  const candidates = [
    BACKEND_DOTENV_PATH,
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'in-house-crm-be', '.env'),
  ];

  let loadedFrom: string | null = null;

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) {
      continue;
    }
    const result = dotenv.config({ path: envPath, override: true });
    if (result.error) {
      console.warn(`[env] Failed to parse ${envPath}:`, result.error.message);
      continue;
    }
    loadedFrom = envPath;
    break;
  }

  hoistUtf8BomKeyedEnvVars();
  hydrateBootstrapSecretFromDotenv(loadedFrom);

  const bootstrapSecretLen = String(process.env.BOOTSTRAP_SUPER_ADMIN_SECRET ?? '').trim().length;
  console.log(
    `[env] BOOTSTRAP_SUPER_ADMIN_SECRET ${bootstrapSecretLen >= 24 ? 'loaded' : 'MISSING'} (${bootstrapSecretLen} chars) from ${loadedFrom ?? '(none)'}`,
  );

  const docAiProcessorId = String(
    process.env.DOCUMENT_AI_PROCESSOR_ID || process.env.DOCAI_PROCESSOR_ID || '',
  ).trim();
  const docAiOk =
    !!String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '').trim() &&
    !!docAiProcessorId;
  const provider = String(process.env.PDF_EXTRACTION_PROVIDER || 'claude').trim().toLowerCase();
  const useClaude = provider !== 'documentai' && provider !== 'document_ai' && provider !== 'google';
  const keyOk = useClaude
    ? !!String(process.env.ANTHROPIC_API_KEY ?? '').trim()
    : docAiOk;

  if (!keyOk) {
    console.warn(
      useClaude
        ? `[env] ANTHROPIC_API_KEY is not set (PDF_EXTRACTION_PROVIDER=claude).\n` +
            ` - Expected backend .env at: ${BACKEND_DOTENV_PATH}` +
            ` (${fs.existsSync(BACKEND_DOTENV_PATH) ? 'exists' : 'missing'})\n` +
            ` - First loaded dotenv path: ${loadedFrom ?? '(none)'}`
        : `[env] Document AI is not configured (PDF_EXTRACTION_PROVIDER=documentai).\n` +
            ` - Set GOOGLE_CLOUD_PROJECT and DOCUMENT_AI_PROCESSOR_ID in ${BACKEND_DOTENV_PATH}\n` +
            ` - Optional: DOCUMENT_AI_KYC_PROCESSOR_ID, DOCUMENT_AI_OCR_PROCESSOR_ID, DOCUMENT_AI_LOCATION\n` +
            ` - Auth: GOOGLE_APPLICATION_CREDENTIALS or Application Default Credentials\n` +
            ` - Default is Claude; remove PDF_EXTRACTION_PROVIDER=documentai to use Claude`,
    );
  } else if (!useClaude) {
    const credRaw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim();
    const credResolved = credRaw
      ? path.isAbsolute(credRaw)
        ? credRaw
        : fs.existsSync(path.resolve(process.cwd(), credRaw))
          ? path.resolve(process.cwd(), credRaw)
          : path.resolve(BACKEND_PACKAGE_ROOT, credRaw)
      : '';
    console.log(
      `[env] Document AI ready (provider=documentai, project=${String(process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT_ID || '').trim()}, processor=${docAiProcessorId}, creds=${credResolved && fs.existsSync(credResolved) ? 'file-ok' : 'missing-or-adc'})`,
    );
  }
}

/**
 * dotenv can miss this key if another `.env` loaded first without override,
 * or if the running process was started before the var was added.
 * Always re-read it from the backend `.env` file.
 */
function hydrateBootstrapSecretFromDotenv(preferredPath: string | null): void {
  const candidates = [preferredPath, BACKEND_DOTENV_PATH, path.resolve(process.cwd(), '.env')].filter(
    (p): p is string => !!p,
  );

  for (const envPath of candidates) {
    if (!fs.existsSync(envPath)) continue;
    const parsed = dotenv.parse(fs.readFileSync(envPath));
    const value = String(parsed.BOOTSTRAP_SUPER_ADMIN_SECRET ?? '').trim();
    if (value) {
      process.env.BOOTSTRAP_SUPER_ADMIN_SECRET = value;
      return;
    }
  }
}

export function getBootstrapSuperAdminSecret(): string {
  const fromEnv = String(process.env.BOOTSTRAP_SUPER_ADMIN_SECRET ?? '').trim();
  if (fromEnv) return fromEnv;

  hydrateBootstrapSecretFromDotenv(null);
  return String(process.env.BOOTSTRAP_SUPER_ADMIN_SECRET ?? '').trim();
}

loadBackendEnv();
