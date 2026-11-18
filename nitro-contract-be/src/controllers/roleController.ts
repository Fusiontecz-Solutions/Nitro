import type { Request, Response } from 'express';
import * as roleService from '../services/roleService';
import { MANAGEABLE_ROLES } from '../constants/roles';
import { PERMISSIONS, PERMISSION_LABELS, ROLE_PERMISSIONS } from '../constants/rolePermissions';

class RoleController {
  async getRoles(req: Request, res: Response): Promise<Response> {
    try {
      const roles = await roleService.getRoles();
      return res.status(200).json({
        success: true,
        data: roles,
      });
    } catch (error) {
      console.error('Get roles error:', error);
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  }

  /** Roles this app supports with their capabilities (drives Super Admin role management UI). */
  async getPermissionMatrix(_req: Request, res: Response): Promise<Response> {
    const permissions = Object.values(PERMISSIONS).map((key) => ({
      key,
      label: PERMISSION_LABELS[key],
    }));
    const roles = MANAGEABLE_ROLES.map((role) => ({
      role,
      permissions: [...(ROLE_PERMISSIONS[role] ?? [])],
    }));
    return res.status(200).json({ success: true, data: { permissions, roles } });
  }
}

const roleController = new RoleController();
export default roleController;
