import express from 'express';
import activityLogController from '../controllers/activityLogController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireSuperAdminOnly } from '../middleware/requireSuperAdmin';

const router = express.Router();

// System-wide audit log is Super Admin only (CONTRACTS_LOG is rejected).
router.use(authenticateToken);
router.use(requireSuperAdminOnly);

router.get('/', activityLogController.list.bind(activityLogController));
router.get('/:id/content', activityLogController.getContent.bind(activityLogController));

export default router;
