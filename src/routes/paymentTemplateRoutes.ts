import express from 'express';
import paymentTemplateController from '../controllers/paymentTemplateController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin';

/** Email / letter / contract templates used by the Gmail workspace (Contracts Log + Super Admin). */
const router = express.Router();

router.use(authenticateToken, requireSuperAdmin);

router.get('/', paymentTemplateController.getAll.bind(paymentTemplateController));
router.post('/', paymentTemplateController.create.bind(paymentTemplateController));
router.put('/:id', paymentTemplateController.update.bind(paymentTemplateController));
router.delete('/:id', paymentTemplateController.delete.bind(paymentTemplateController));

export default router;
