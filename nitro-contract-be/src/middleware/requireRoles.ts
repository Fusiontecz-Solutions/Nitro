import type { Request, Response, NextFunction } from 'express';

/**
 * Generic role-based middleware.
 *
 * Usage:
 *   router.get('/path', authenticateToken, requireRoles('ADMIN', 'SCRUBBING'), handler);
 */
export function requireRoles(...allowedRoles: string[]) {
    const allowed = new Set(allowedRoles);
    // SUPER_ADMIN sits above CONTRACTS_LOG, so it passes every CONTRACTS_LOG gate.
    if (allowed.has('CONTRACTS_LOG')) allowed.add('SUPER_ADMIN');

    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }

        if (!allowed.has(req.user.role)) {
            res.status(403).json({ success: false, message: 'Forbidden: insufficient role' });
            return;
        }

        next();
    };
}

