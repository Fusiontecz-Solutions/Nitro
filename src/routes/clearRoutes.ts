import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { clearController } from '../controllers/clearController';

const clearRouter = Router({ mergeParams: true });

clearRouter.use(authenticateToken);
clearRouter.post(
  '/applications/:applicationId/sync-business-to-client',
  clearController.syncBusinessToClient,
);
clearRouter.post(
  '/applications/:applicationId/sync-person-to-owner',
  clearController.syncPersonToOwner,
);

export default clearRouter;
