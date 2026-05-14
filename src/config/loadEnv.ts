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

  const keyOk = !!String(process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (!keyOk) {
    console.warn(
      `[env] ANTHROPIC_API_KEY is not set.\n` +
        ` - Expected backend .env at: ${BACKEND_DOTENV_PATH}` +
        ` (${fs.existsSync(BACKEND_DOTENV_PATH) ? 'exists' : 'missing'})\n` +
        ` - First loaded dotenv path: ${loadedFrom ?? '(none)'}\n` +
        ` - Verify a line exactly: ANTHROPIC_API_KEY=sk-ant-... (no spaces around "=").`,
    );
  }
}

loadBackendEnv();
