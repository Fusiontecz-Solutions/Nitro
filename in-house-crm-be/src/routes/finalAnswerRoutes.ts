import express from 'express';
import finalAnswerController from '../controllers/finalAnswerController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

// All final answer routes require authentication
router.use(authenticateToken);

// Upsert a single answer
router.post('/', finalAnswerController.upsert.bind(finalAnswerController));

// Bulk upsert answers for an application
router.post('/bulk', finalAnswerController.bulkUpsert.bind(finalAnswerController));

// Get all answers for an application
router.get('/', finalAnswerController.getByApplication.bind(finalAnswerController));

export default router;

