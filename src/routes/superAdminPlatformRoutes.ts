import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireRoles } from '../middleware/requireRoles';
import superAdminPlatformController from '../controllers/superAdminPlatformController';

const router = express.Router();

router.use(authenticateToken);
router.use(requireRoles('SUPER_ADMIN'));

router.get('/', superAdminPlatformController.getSnapshot.bind(superAdminPlatformController));
router.get('/refresh', superAdminPlatformController.refresh.bind(superAdminPlatformController));
router.post('/refresh', superAdminPlatformController.refresh.bind(superAdminPlatformController));

export default router;
