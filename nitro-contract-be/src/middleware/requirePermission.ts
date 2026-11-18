import type { Request, Response, NextFunction } from 'express';
import { roleHasPermission, type Permission } from '../constants/rolePermissions';

/**
 * Capability-based guard (see `constants/rolePermissions.ts`).
 * Use after `authenticateToken`. Passes when the role holds ANY of the listed permissions.
 * Public-portal sessions (ISO / client approval links) never pass — they carry the
 * referring agent's role but are not the agent.
 */
export function requirePermission(...permissions: Permission[]) {
    return (req: Request, res: Response, next: NextFunction): void => {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }
        if (req.user.publicApprovalActor) {
            res.status(403).json({ success: false, message: 'Forbidden for approval-link sessions' });
            return;
        }
        const allowed = permissions.some((p) => roleHasPermission(req.user!.role, p));
        if (!allowed) {
            res.status(403).json({ success: false, message: 'Forbidden: your role cannot perform this action' });
            return;
        }
        next();
    };
}
