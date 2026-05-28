import type { Request, Response, NextFunction } from 'express';

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/**
 * Requires req.user to be set (use after authenticateToken) and role ADMIN or SUPER_ADMIN.
 *
 * Hybrid auth note:
 *   A trusted Super Admin proxy request (validated at the perimeter by
 *   `verifySuperAdminProxy` via the shared secret) is treated as fully
 *   authorized and skips the tenant role check entirely — Super Admin lives
 *   in a separate centralized project, not in the tenant `User` table.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.isSuperAdminProxy) {
    return next();
  }
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  if (!ADMIN_ROLES.has(req.user.role)) {
    res.status(403).json({ success: false, message: 'Admin access required' });
    return;
  }
  next();
}
