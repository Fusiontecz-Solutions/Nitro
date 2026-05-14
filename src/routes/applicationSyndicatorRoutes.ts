import express from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import applicationSyndicatorController from '../controllers/applicationSyndicatorController';

const router = express.Router();

router.use(authenticateToken);

router.get(
  '/by-syndicator/:syndicatorId',
  applicationSyndicatorController.listBySyndicator.bind(applicationSyndicatorController),
);

router.get(
  '/:applicationId',
  applicationSyndicatorController.listByApplication.bind(applicationSyndicatorController),
);
router.post(
  '/:applicationId',
  applicationSyndicatorController.create.bind(applicationSyndicatorController),
);
router.delete('/:id', applicationSyndicatorController.remove.bind(applicationSyndicatorController));

export default router;
