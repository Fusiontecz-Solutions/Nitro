import type { Request, Response, NextFunction } from 'express';

/**
 * Inverse of requireRoles — blocks users whose role is in the forbidden set.
 *
 * Usage:
 *   router.post('/path', authenticateToken, forbidRoles('AGENT'), handler);
 */
export function forbidRoles(...forbiddenRoles: string[]) {
  const forbidden = new Set(forbiddenRoles);

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    if (forbidden.has(req.user.role)) {
      res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
      return;
    }

    next();
  };
}
