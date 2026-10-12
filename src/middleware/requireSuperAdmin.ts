import type { Request, Response, NextFunction } from 'express';
import { hasContractsLogAccess, isSuperAdminRole } from '../constants/roles';

/**
 * Requires req.user to be set (use after authenticateToken) and role CONTRACTS_LOG or SUPER_ADMIN.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  const role = String(req.user.role || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!hasContractsLogAccess(role)) {
    res.status(403).json({ success: false, message: 'Super admin access required' });
    return;
  }
  next();
}

/**
 * Requires role SUPER_ADMIN only (CONTRACTS_LOG is rejected). Use for Super Admin-only features.
 */
export function requireSuperAdminOnly(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  if (!isSuperAdminRole(req.user.role)) {
    res.status(403).json({ success: false, message: 'Super admin access required' });
    return;
  }
  next();
}
