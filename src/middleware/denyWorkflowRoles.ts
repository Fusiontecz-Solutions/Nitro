import type { Request, Response, NextFunction, RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { WORKFLOW_ROLES, normalizeRoleValue } from '../constants/roles';

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Router-level role guard that works in front of routers which also host public webhooks
 * (so it cannot require auth itself). It only rejects a request whose bearer/cookie JWT is
 * valid AND carries one of `roles`; anything else falls through to the router's own auth.
 */
export function denyRolesByToken(roles: readonly string[], options: { writesOnly?: boolean } = {}): RequestHandler {
    const denied = new Set(roles.map(normalizeRoleValue));
    return (req: Request, res: Response, next: NextFunction): void => {
        if (req.isSuperAdminProxy) return next();
        if (options.writesOnly && READ_METHODS.has(req.method.toUpperCase())) return next();
        const header = req.headers.authorization;
        const token = (header?.startsWith('Bearer ') ? header.slice(7) : undefined) || (req as any).cookies?.token;
        if (!token || !process.env.JWT_SECRET) return next();
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET) as { role?: string };
            if (denied.has(normalizeRoleValue(decoded?.role))) {
                res.status(403).json({ success: false, message: 'Forbidden: your role cannot perform this action' });
                return;
            }
        } catch {
            // Invalid / expired token — let the downstream auth middleware answer.
        }
        next();
    };
}

/** Super Admin–only modules (contracts, DocuSign, SignNow, templates, integrations, payment mail). */
export const denyWorkflowRoles = denyRolesByToken(WORKFLOW_ROLES);

/**
 * Underwriting data (offers, positions, bank analysis…) is written by Underwriters / Super Admin.
 * Agents (and ISO approval-link sessions, which carry the Agent role) may only read it.
 */
export const denyAgentWrites = denyRolesByToken(['AGENT'], { writesOnly: true });
