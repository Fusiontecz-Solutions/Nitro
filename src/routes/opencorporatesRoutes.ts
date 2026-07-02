import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { opencorporatesController } from '../controllers/opencorporatesController';

const opencorporatesRouter = Router({ mergeParams: true });

opencorporatesRouter.use(authenticateToken);
opencorporatesRouter.post(
  '/applications/:applicationId/import',
  opencorporatesController.importForApplication,
);

export default opencorporatesRouter;
