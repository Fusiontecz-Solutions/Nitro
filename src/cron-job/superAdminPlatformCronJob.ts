import cron, { validate as validateCronExpression } from 'node-cron';
import { refreshSuperAdminPlatformSnapshot } from '../services/superAdminPlatformService';

const DEFAULT_SUPER_ADMIN_PLATFORM_CRON = '*/5 * * * *';

let refreshInProgress = false;

function resolveCronExpression(): string {
  const raw = String(process.env.SUPER_ADMIN_PLATFORM_CRON ?? '').trim();
  if (!raw) return DEFAULT_SUPER_ADMIN_PLATFORM_CRON;
  if (!validateCronExpression(raw)) {
    console.warn(
      `[super-admin-platform] invalid SUPER_ADMIN_PLATFORM_CRON="${raw}"; using default ${DEFAULT_SUPER_ADMIN_PLATFORM_CRON}`,
    );
    return DEFAULT_SUPER_ADMIN_PLATFORM_CRON;
  }
  return raw;
}

async function runRefresh(): Promise<void> {
  if (refreshInProgress) {
    console.warn('[super-admin-platform] previous refresh still running; skipping tick');
    return;
  }
  refreshInProgress = true;
  try {
    await refreshSuperAdminPlatformSnapshot();
    console.log('[super-admin-platform] snapshot refreshed', new Date().toISOString());
  } catch (err) {
    console.error('[super-admin-platform] refresh failed:', err);
  } finally {
    refreshInProgress = false;
  }
}

export function startSuperAdminPlatformCronJob(): void {
  const expression = resolveCronExpression();
  console.log(`[super-admin-platform] cron scheduled: "${expression}"`);
  void runRefresh().catch((err) => {
    console.error('[super-admin-platform] initial refresh failed:', err);
  });
  cron.schedule(expression, () => {
    void runRefresh();
  });
}
