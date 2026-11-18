import express from 'express';
import roleController from '../controllers/roleController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

router.use(authenticateToken);
router.get('/', roleController.getRoles.bind(roleController));
// Capability matrix for Super Admin role management (read-only; defined in constants/rolePermissions.ts)
router.get('/permissions', roleController.getPermissionMatrix.bind(roleController));

export default router;
