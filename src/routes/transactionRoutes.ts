import express from 'express';
import transactionController from '../controllers/transactionController';
import multer from 'multer';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// All transaction routes require authentication
router.use(authenticateToken);

// Add a single transaction
router.post('/', transactionController.addTransaction.bind(transactionController));

// Bulk add multiple transactions
router.post('/bulk', transactionController.bulkAddTransactions.bind(transactionController));

// Get all transactions for a specific month
router.get('/', transactionController.getTransactionsByMonth.bind(transactionController));

// Get transaction by MongoDB ObjectId
router.get('/:id', transactionController.getTransactionById.bind(transactionController));

// Update transaction
router.put('/:id', transactionController.updateTransaction.bind(transactionController));

// Delete transaction
router.delete('/:id', transactionController.deleteTransaction.bind(transactionController));

export default router;
