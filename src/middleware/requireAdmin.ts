import type { Request, Response, NextFunction } from 'express';

const ADMIN_ROLES = new Set(['ADMIN', 'CONTRACTS_LOG']);

/**
 * Requires req.user to be set (use after authenticateToken) and role ADMIN or CONTRACTS_LOG.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
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
