import type { Request, Response, NextFunction } from 'express';

/**
 * Requires req.user to be set (use after authenticateToken) and role CONTRACTS_LOG.
 */
export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Authentication required' });
    return;
  }
  const role = String(req.user.role || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (role !== 'CONTRACTS_LOG' && role !== 'CONTRACTSLOG') {
    res.status(403).json({ success: false, message: 'Super admin access required' });
    return;
  }
  next();
}
