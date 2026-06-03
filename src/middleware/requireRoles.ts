import type { Request, Response, NextFunction } from 'express';

/**
 * Generic role-based middleware.
 *
 * Usage:
 *   router.get('/path', authenticateToken, requireRoles('ADMIN', 'UNDERWRITER'), handler);
 *
 * Hybrid auth note:
 *   A trusted Super Admin proxy request (validated at the perimeter by
 *   `verifySuperAdminProxy` via the shared secret) is a *separate-project*
 *   identity — not a tenant DB user — and is always allowed past tenant role
 *   gates. We never reject it for "wrong role" because the perimeter already
 *   established full trust for that call.
 */
export function requireRoles(...allowedRoles: string[]) {
    const allowed = new Set(allowedRoles);

    return (req: Request, res: Response, next: NextFunction): void => {
        // Trusted backend-to-backend call from the centralized Super Admin
        // service. Bypass all tenant role gates — the shared-secret check at
        // the perimeter is the authoritative authorization for this path.
        if (req.isSuperAdminProxy) {
            return next();
        }

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

