import type { Request, Response } from 'express';
import type { Role } from '@prisma/client';
import prisma from '../config/prismaClient';
import { deleteUserCompletely } from '../services/userDeletionService';
import * as userService from '../services/userService';
import { isManageableRole, isValidRole, MANAGEABLE_ROLES, normalizeRoleValue } from '../constants/roles';

const ADMIN_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

const isAdminActor = (req: Request): boolean =>
    ADMIN_ROLES.has(normalizeRoleValue((req as any).user?.role));

/** Fields any signed-in user may change on their own profile. */
const SELF_EDITABLE_USER_FIELDS = new Set(['firstName', 'lastName', 'phone', 'profilePicture']);

/** Revoke every session of a user (deactivation / role change must take effect immediately). */
async function revokeUserSessions(userId: string): Promise<void> {
    try {
        await prisma.accessToken.deleteMany({ where: { userId } });
    } catch (err) {
        console.error('Failed to revoke user sessions:', err);
    }
}

const toLiteUser = (user: any) => ({
    _id: user.id,
    id: user.id,
    userId: user.userId,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
});

/** Full profile for admins / self; lite fields for everyone else. Secrets are never returned. */
const shapeUserForViewer = (req: Request, user: any) => {
    const viewerId = String((req as any).user?.id ?? '');
    if (!isAdminActor(req) && viewerId !== user.id) return toLiteUser(user);
    return {
        ...user,
        _id: user.id,
        password: undefined,
        otp: undefined,
        otpExpiry: undefined,
        docusignAccessToken: undefined,
        docusignRefreshToken: undefined,
        googleRefreshToken: undefined,
        gmailConnected: Boolean(user.googleRefreshToken),
    };
};

class UserController {
    // Create user (Admin only). Uses service layer with bcrypt.
    async create(req: Request, res: Response) {
        try {
            const { firstName, lastName, email, password, role, isActive, phone } = req.body;

            if (!firstName || !lastName || !email || !password || !role) {
                return res.status(400).json({
                    success: false,
                    message: 'firstName, lastName, email, password, and role are required',
                });
            }

            const normalizedRequestedRole = String(role).toUpperCase().replace(/-/g, '_');
            const actingRole = String((req as any).user?.role ?? '')
                .toUpperCase()
                .replace(/-/g, '_');
            if (normalizedRequestedRole === 'SUPER_ADMIN' && actingRole !== 'SUPER_ADMIN') {
                return res.status(403).json({
                    success: false,
                    message: 'Only Super Admin can assign the Super Admin role',
                });
            }
            if (!isManageableRole(normalizedRequestedRole)) {
                return res.status(400).json({
                    success: false,
                    message: `Role must be one of: ${MANAGEABLE_ROLES.join(', ')}`,
                });
            }

            const user = await userService.createUser({
                firstName,
                lastName,
                email,
                password,
                role,
                isActive,
                phone,
            });

            return res.status(201).json({
                success: true,
                message: 'User created successfully',
                data: {
                    _id: user.id,
                    id: user.id,
                    userId: user.userId,
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email,
                    role: user.role,
                    isActive: user.isActive,
                    createdAt: user.createdAt,
                },
            });
        } catch (error: any) {
            const msg = error?.message || 'Internal server error';
            if (msg.includes('already exists') || msg.includes('email')) {
                return res.status(409).json({ success: false, message: msg });
            }
            if (msg.includes('Invalid') || msg.includes('required') || msg.includes('Password')) {
                return res.status(400).json({ success: false, message: msg });
            }
            console.error('Create user error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }
    // Get all users with optional role filter and pagination
    async getAll(req: Request, res: Response) {
        try {
            const { role } = req.query;

            // Build filter query - only filter by role if provided
            const filter: any = {};
            if (role) {
                // Normalize role to match Prisma enum (uppercase, underscores)
                const normalizedRole = String(role).toUpperCase().replace(/-/g, '_');

                // Validate against allowed roles to avoid Prisma validation errors
                if (!isValidRole(normalizedRole)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid role',
                    });
                }

                filter.role = normalizedRole;
            }

            const statusFilter = String(req.query.status ?? '').trim().toLowerCase();
            if (statusFilter === 'active') filter.isActive = true;
            if (statusFilter === 'inactive') filter.isActive = false;

            const search = String(req.query.search ?? '').trim();
            if (search) {
                filter.OR = [
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ];
            }

            const adminActor = isAdminActor(req);
            // Non-admin roles (Agent / Underwriter) only need active users for pickers.
            if (!adminActor) filter.isActive = true;

            const users = await prisma.user.findMany({
                where: filter,
                orderBy: { createdAt: 'desc' },
            });

            const shaped = adminActor
                ? users.map((user: any) => ({
                    ...user,
                    _id: user.id,
                    password: undefined,
                    otp: undefined,
                    otpExpiry: undefined,
                    docusignAccessToken: undefined,
                    docusignRefreshToken: undefined,
                    googleRefreshToken: undefined,
                    gmailConnected: Boolean(user.googleRefreshToken),
                }))
                : users.map(toLiteUser);

            console.log(`Get users by role: ${role}, found ${users.length} users`);

            return res.status(200).json({
                success: true,
                data: shaped,
            });
        } catch (error) {
            console.error('Get all users error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Get user by MongoDB ObjectId
    async getById(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const user = await prisma.user.findUnique({ where: { id } });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.status(200).json({
                success: true,
                data: shapeUserForViewer(req, user),
            });
        } catch (error) {
            console.error('Get user by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Get user by numeric userId
    async getByUserId(req: Request, res: Response) {
        try {
            const { userId } = req.params;

            const user = await prisma.user.findUnique({ where: { userId: Number(userId) } });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            return res.status(200).json({
                success: true,
                data: shapeUserForViewer(req, user),
            });
        } catch (error) {
            console.error('Get user by userId error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Update user
    async update(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { firstName, lastName, email, phone, role, isActive, isVerified, profilePicture } = req.body;

            const adminActor = isAdminActor(req);
            const actorId = String((req as any).user?.id ?? '');
            if (!adminActor) {
                // Non-admins may only edit their own basic profile fields.
                const requestedKeys = Object.keys(req.body ?? {}).filter(
                    (k) => (req.body as Record<string, unknown>)[k] !== undefined,
                );
                const touchesRestricted = requestedKeys.some((k) => !SELF_EDITABLE_USER_FIELDS.has(k));
                if (actorId !== id || touchesRestricted) {
                    return res.status(403).json({
                        success: false,
                        message: 'Admin access required to change this user',
                    });
                }
            }

            const user = await prisma.user.findUnique({ where: { id } });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            if (adminActor && actorId === id) {
                const demotingSelf =
                    role !== undefined && normalizeRoleValue(role) !== normalizeRoleValue(user.role);
                if (demotingSelf || isActive === false) {
                    return res.status(400).json({
                        success: false,
                        message: 'You cannot change your own role or deactivate your own account',
                    });
                }
            }

            // Check if email is being changed and if it already exists
            if (email && email !== user.email) {
                const existingUser = await prisma.user.findFirst({
                    where: {
                        email,
                        NOT: { id },
                    },
                });
                if (existingUser) {
                    return res.status(409).json({
                        success: false,
                        message: 'Email already in use by another user',
                    });
                }
            }

            let normalizedRoleUpdate: Role | undefined;
            if (role !== undefined) {
                const nr = String(role).toUpperCase().replace(/-/g, '_');
                const actingRole = String((req as any).user?.role ?? '')
                    .toUpperCase()
                    .replace(/-/g, '_');
                if (nr === 'SUPER_ADMIN' && actingRole !== 'SUPER_ADMIN') {
                    return res.status(403).json({
                        success: false,
                        message: 'Only Super Admin can assign the Super Admin role',
                    });
                }
                // Keep legacy roles as-is, but new assignments must be supported by this app.
                if (nr !== normalizeRoleValue(user.role) && !isManageableRole(nr)) {
                    return res.status(400).json({
                        success: false,
                        message: `Role must be one of: ${MANAGEABLE_ROLES.join(', ')}`,
                    });
                }
                normalizedRoleUpdate = nr as Role;
            }

            // Update fields if provided
            const updatedUser = await prisma.user.update({
                where: { id },
                data: {
                    ...(firstName !== undefined && { firstName }),
                    ...(lastName !== undefined && { lastName }),
                    ...(email !== undefined && { email }),
                    ...(phone !== undefined && { phone }),
                    ...(normalizedRoleUpdate !== undefined && { role: normalizedRoleUpdate }),
                    ...(isActive !== undefined && { isActive }),
                    ...(isVerified !== undefined && { isVerified }),
                    ...(profilePicture !== undefined && { profilePicture }),
                },
            });

            const roleChanged =
                normalizedRoleUpdate !== undefined &&
                normalizeRoleValue(normalizedRoleUpdate) !== normalizeRoleValue(user.role);
            if ((isActive === false && user.isActive) || roleChanged) {
                await revokeUserSessions(updatedUser.id);
            }

            return res.status(200).json({
                success: true,
                message: 'User updated successfully',
                data: shapeUserForViewer(req, updatedUser),
            });
        } catch (error) {
            console.error('Update user error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Delete user (and linked Syndicator profile + syndication joins when applicable)
    async delete(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const existing = await prisma.user.findUnique({ where: { id } });
            if (!existing) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            const actingUserId = (req as any).user?.id as string | undefined;
            await deleteUserCompletely(id, actingUserId);

            return res.status(200).json({
                success: true,
                message: 'User deleted successfully',
            });
        } catch (error: any) {
            console.error('Delete user error:', error);
            const code = error?.code;
            const statusCode = error?.statusCode;
            if (code === 'P2025' || statusCode === 404) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }
            if (statusCode === 409) {
                return res.status(409).json({
                    success: false,
                    message: error?.message ?? 'Cannot delete user',
                });
            }
            return res.status(500).json({
                success: false,
                message:
                    process.env.NODE_ENV === 'development' ? error?.message ?? 'Internal server error' : 'Internal server error',
            });
        }
    }

    // Toggle user active status
    async toggleActive(req: Request, res: Response) {
        try {
            const { id } = req.params;

            const user = await prisma.user.findUnique({ where: { id } });

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: 'User not found',
                });
            }

            if (String((req as any).user?.id ?? '') === id) {
                return res.status(400).json({
                    success: false,
                    message: 'You cannot deactivate your own account',
                });
            }

            const updatedUser = await prisma.user.update({
                where: { id },
                data: { isActive: !user.isActive },
            });

            if (!updatedUser.isActive) {
                await revokeUserSessions(updatedUser.id);
            }

            return res.status(200).json({
                success: true,
                message: `User ${updatedUser.isActive ? 'activated' : 'deactivated'} successfully`,
                data: shapeUserForViewer(req, updatedUser),
            });
        } catch (error) {
            console.error('Toggle user active error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async impersonateUser(req: Request, res: Response) {
        try {

            const adminId = (req as any).user.id;
            const { userId } = req.body;

            const result = await userService.impersonateUserService(adminId, userId);

            const options = {
                expires: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
                httpOnly: true,
            };

            return res
                .cookie("token", result.token, options)
                .status(200)
                .json({
                    success: true,
                    ...result
                });

        } catch (error: any) {
            return res.status(500).json({
                success: false,
                message: error.message
            });
        }
    };
}

const userController = new UserController();
export default userController;

