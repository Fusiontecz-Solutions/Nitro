import type { Request, Response } from 'express';
import {
  getSuperAdminPlatformSnapshot,
  refreshSuperAdminPlatformSnapshot,
} from '../services/superAdminPlatformService';

class SuperAdminPlatformController {
  /** GET cached platform KPIs (refreshed on a schedule). */
  async getSnapshot(req: Request, res: Response) {
    try {
      const refreshIfMissing = String(req.query.refreshIfMissing ?? '').toLowerCase() === 'true';
      const snapshot = await getSuperAdminPlatformSnapshot({ refreshIfMissing });

      if (!snapshot) {
        return res.status(404).json({
          success: false,
          message: 'Platform metrics not initialized yet. POST /super-admin-platform/refresh or wait for the cron job.',
        });
      }

      return res.status(200).json({ success: true, data: snapshot });
    } catch (error: unknown) {
      console.error('getSuperAdminPlatformSnapshot error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      return res.status(500).json({ success: false, message });
    }
  }

  /**
   * POST force-refresh from live CRM data.
   * Query `wait=false` returns immediately with the last cached snapshot and refreshes in the background.
   */
  async refreshSnapshot(req: Request, res: Response) {
    try {
      const wait = String(req.query.wait ?? 'true').toLowerCase() !== 'false';

      if (!wait) {
        const cached =
          (await getSuperAdminPlatformSnapshot()) ??
          (await getSuperAdminPlatformSnapshot({ refreshIfMissing: true }));

        void refreshSuperAdminPlatformSnapshot().catch((err) => {
          console.error('background refreshSuperAdminPlatformSnapshot error:', err);
        });

        return res.status(202).json({
          success: true,
          refreshing: true,
          data: cached,
        });
      }

      const snapshot = await refreshSuperAdminPlatformSnapshot();
      return res.status(200).json({ success: true, data: snapshot });
    } catch (error: unknown) {
      console.error('refreshSuperAdminPlatformSnapshot error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      return res.status(500).json({ success: false, message });
    }
  }
}

export default new SuperAdminPlatformController();
