import type { Request, Response, NextFunction } from 'express';
import prisma from '../config/prismaClient';

const normalizeRoleKey = (role: unknown): string =>
    String(role ?? '')
        .trim()
        .toUpperCase()
        .replace(/-/g, '_');

/**
 * Underwriting data (offer decision, bank analysis, terms offers) for the Agent's APPROVAL tab.
 *
 * Agents may only READ the list endpoint (`GET /?application=<id>`) — or decline via `POST /decline` —
 * for an application they own (referring agent or creator). Every other Agent request — writes, lookups by record id, lists
 * without an application — is refused. Other roles pass straight through.
 */
export function agentOwnApplicationReadOnly() {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        if (!req.user) {
            res.status(401).json({ success: false, message: 'Authentication required' });
            return;
        }
        if (normalizeRoleKey(req.user.role) !== 'AGENT') return next();

        const forbid = () => {
            res.status(403).json({ success: false, message: 'Forbidden: your role cannot access this resource' });
        };

        // Reads: `GET /?application=<id>`. Writes: only `POST /decline` (Agent declining their own deal).
        const method = req.method.toUpperCase();
        const isDecline = method === 'POST' && req.path === '/decline';
        const applicationRef = String(
            (isDecline ? req.body?.applicationId : req.query.application) ?? '',
        ).trim();
        if (!applicationRef || (!isDecline && (method !== 'GET' || req.path !== '/'))) return forbid();

        try {
            const app = await prisma.application.findFirst({
                where: /^\d+$/.test(applicationRef)
                    ? { applicationId: Number(applicationRef) }
                    : { id: applicationRef },
                select: { referringAgentId: true, createdById: true },
            });
            const userId = req.user.id;
            if (!app || (app.referringAgentId !== userId && app.createdById !== userId)) return forbid();
            next();
        } catch (error) {
            console.error('agentOwnApplicationReadOnly error:', error);
            res.status(500).json({ success: false, message: 'Internal server error' });
        }
    };
}
