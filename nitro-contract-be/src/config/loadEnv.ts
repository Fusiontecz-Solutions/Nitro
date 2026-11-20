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

  // All document extraction (application creation, driver's license, voided check)
  // runs on OpenAI; Google Document AI is not used.
  const openAiKey = String(
    process.env.OPEN_AI_KEY ||
      process.env.OPENAI_API_KEY ||
      process.env.OPENAI_KEY ||
      process.env.OPEN_AI_API_KEY ||
      '',
  ).trim();
  if (openAiKey) {
    console.log(
      `[env] OpenAI extraction ready (key ${openAiKey.slice(0, 7)}…, ${openAiKey.length} chars; model=${String(process.env.OPENAI_PDF_MODEL || '').trim() || 'gpt-4o'}) from ${loadedFrom ?? '(none)'}`,
    );
  } else {
    console.warn(
      '[env] OPEN_AI_KEY is NOT set — application creation, driver\'s license and voided check scans will fail.\n' +
        ` - Add OPEN_AI_KEY=... to ${BACKEND_DOTENV_PATH} (${fs.existsSync(BACKEND_DOTENV_PATH) ? 'exists' : 'missing'})\n` +
        ` - First loaded dotenv path: ${loadedFrom ?? '(none)'}`,
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
