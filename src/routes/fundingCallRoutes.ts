import express from 'express';
import fundingCallController from '../controllers/fundingCallController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

router.use(authenticateToken);

router.post('/', fundingCallController.create.bind(fundingCallController));
router.get('/', fundingCallController.getByApplication.bind(fundingCallController));

export default router;

