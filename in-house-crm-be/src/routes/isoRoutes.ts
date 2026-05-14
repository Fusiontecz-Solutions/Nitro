import express from 'express';
import isoController from '../controllers/iso.controller';
import isoCommissionController from '../controllers/isoCommission.controller';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

router.post('/', isoController.create.bind(isoController));
router.get('/', isoController.getAll.bind(isoController));

/** ISO broker deals + commission payout (must be before `/:id`) */
router.get(
  '/:id/my-deals',
  authenticateToken,
  isoCommissionController.getMyDeals.bind(isoCommissionController),
);
router.put(
  '/:id/application-payout-status',
  authenticateToken,
  isoCommissionController.upsertApplicationPayout.bind(isoCommissionController),
);

router.get('/:id', isoController.getById.bind(isoController));
router.put('/:id', isoController.update.bind(isoController));
router.delete('/:id', isoController.delete.bind(isoController));

export default router;
