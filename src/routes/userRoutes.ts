import express from 'express';
import userController from '../controllers/userController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireAdmin } from '../middleware/requireAdmin';

const router = express.Router();

router.use(authenticateToken);

// Create user (Admin only)
router.post('/', requireAdmin, userController.create.bind(userController));

// Get all users with optional role filter (?role=AGENT)
router.get('/', userController.getAll.bind(userController));

// Get user by MongoDB ObjectId
router.get('/:id', userController.getById.bind(userController));

// Get user by numeric userId
router.get('/userId/:userId', userController.getByUserId.bind(userController));

// Update user (admins: any field; everyone else: own basic profile only — enforced in controller)
router.put('/:id', userController.update.bind(userController));

// Toggle user active status (Admin only)
router.patch('/:id/toggle-active', requireAdmin, userController.toggleActive.bind(userController));

// Delete user (Admin only)
router.delete('/:id', requireAdmin, userController.delete.bind(userController));

// Impersonate user (Admin only; service re-checks the actor)
router.post('/impersonate', requireAdmin, userController.impersonateUser.bind(userController));

export default router;

