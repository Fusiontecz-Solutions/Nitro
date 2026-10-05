import express from 'express';
import isoController from '../controllers/iso.controller';
import isoCommissionController from '../controllers/isoCommission.controller';
import { authenticateToken } from '../middleware/authMiddleware';
import { forbidRoles } from '../middleware/forbidRoles';
import { requireRoles } from '../middleware/requireRoles';

/** ISO records are managed by admins; Agents / Underwriters only read them (ISO picker). */
const requireIsoManager = requireRoles('SUPER_ADMIN', 'ADMIN', 'OPERATIONS');

const router = express.Router();

router.post('/', authenticateToken, requireIsoManager, isoController.create.bind(isoController));
router.get('/', authenticateToken, isoController.getAll.bind(isoController));

/** ISO broker deals + commission payout (must be before `/:id`) */
router.get(
  '/:id/my-deals',
  authenticateToken,
  forbidRoles('AGENT', 'UNDERWRITER'),
  isoCommissionController.getMyDeals.bind(isoCommissionController),
);
router.put(
  '/:id/application-payout-status',
  authenticateToken,
  forbidRoles('AGENT', 'UNDERWRITER'),
  isoCommissionController.upsertApplicationPayout.bind(isoCommissionController),
);

router.get('/:id', authenticateToken, isoController.getById.bind(isoController));
router.put('/:id', authenticateToken, requireIsoManager, isoController.update.bind(isoController));
router.delete('/:id', authenticateToken, requireIsoManager, isoController.delete.bind(isoController));

export default router;
