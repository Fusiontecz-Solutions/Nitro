import type { Request, Response } from 'express';
import {
  getSuperAdminPlatformSnapshot,
  refreshSuperAdminPlatformSnapshot,
} from '../services/superAdminPlatformService';

export class SuperAdminPlatformController {
  async getSnapshot(req: Request, res: Response): Promise<Response> {
    try {
      const refreshIfMissing =
        String(req.query.refreshIfMissing ?? '').toLowerCase() === 'true';

      let data = await getSuperAdminPlatformSnapshot();
      if (!data && refreshIfMissing) {
        data = await refreshSuperAdminPlatformSnapshot();
      }

      if (!data) {
        return res.status(404).json({
          success: false,
          message: 'Platform snapshot not found. POST /super-admin-platform/refresh to build it.',
        });
      }

      return res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      console.error('[super-admin-platform] getSnapshot error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      return res.status(500).json({ success: false, message });
    }
  }

  async refresh(req: Request, res: Response): Promise<Response> {
    try {
      const data = await refreshSuperAdminPlatformSnapshot();
      return res.status(200).json({ success: true, data });
    } catch (error: unknown) {
      console.error('[super-admin-platform] refresh error:', error);
      const message = error instanceof Error ? error.message : 'Internal server error';
      return res.status(500).json({ success: false, message });
    }
  }
}

const superAdminPlatformController = new SuperAdminPlatformController();
export default superAdminPlatformController;
