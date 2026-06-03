import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../config/prismaClient';

// Extend Express Request type to include user
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: string;
                name: string;
                email: string;
                role: string;
                publicApprovalActor?: 'CLIENT';
            };
        }
    }
}

/**
 * Sentinel identity used when a request was authenticated via the trusted
 * Super Admin proxy path (signed headers) rather than a tenant JWT.
 *
 * The tenant DB knows nothing about Super Admin users — they live in a
 * separate centralized backend — so we never attempt to look them up here.
 * We just construct a synthetic principal with SUPER_ADMIN role so existing
 * role gates (requireRoles / requireAdmin) keep working.
 */
const SUPER_ADMIN_PROXY_SENTINEL_ID = '00000000-0000-0000-0000-000000000000';

const buildSuperAdminProxyUser = (req: Request) => {
    const ctx = req.superAdminContext || {};
    return {
        id: ctx.actorId || SUPER_ADMIN_PROXY_SENTINEL_ID,
        name: ctx.actorName || 'Super Admin (proxy)',
        email: ctx.actorEmail || 'super-admin@proxy.internal',
        role: 'SUPER_ADMIN',
    };
};

/**
 * User id safe for tenant DB foreign keys (e.g. Application.createdById).
 * Super Admin proxy principals are synthetic and have no row in User — return null.
 */
export function resolveTenantUserId(req: Request): string | null {
    if (req.isSuperAdminProxy) return null;
    return req.user?.id ?? null;
}

export const authenticateToken = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<Response | void> => {
    try {
        // Trusted internal call from the centralized Super Admin backend.
        // `verifySuperAdminProxy` has already validated the shared secret
        // (constant-time compared against SUPER_ADMIN_SECRET) before this
        // middleware runs, so we MUST NOT try to validate a tenant JWT here.
        if (req.isSuperAdminProxy) {
            req.user = buildSuperAdminProxyUser(req);
            return next();
        }

        // Get token from Authorization header or cookies
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1] || req.cookies?.token;

        if (!token) {
            return res.status(401).json({
                success: false,
                message: 'Authentication token required',
            });
        }

        // Verify JWT token
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
            id: string;
            name: string;
            email: string;
            role: string;
            publicApprovalActor?: 'CLIENT';
        };

        // Check if token exists in AccessToken table and is not expired
        const accessToken = await prisma.accessToken.findFirst({
            where: {
                token,
                userId: decoded.id,
            },
        });

        if (!accessToken) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired token',
            });
        }

        // Check if token is expired
        if (accessToken.expiresAt < new Date()) {
            // Optionally delete expired token
            await prisma.accessToken.deleteMany({ where: { token } });
            return res.status(401).json({
                success: false,
                message: 'Token has expired',
            });
        }

        // Set user info in request object
        req.user = {
            id: decoded.id,
            name: decoded.name,
            email: decoded.email,
            role: decoded.role,
            publicApprovalActor: decoded.publicApprovalActor,
        };

        next();
    } catch (error: any) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token',
            });
        }
        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                message: 'Token has expired',
            });
        }
        console.error('Authentication error:', error);
        res.status(500).json({
            success: false,
            message: 'Authentication error',
        });
        return;
    }
};

