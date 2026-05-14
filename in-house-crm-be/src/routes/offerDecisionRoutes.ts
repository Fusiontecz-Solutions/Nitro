import express from 'express';
import offerDecisionController from '../controllers/offerDecisionController';

const router = express.Router();

// GET /api/v1/offer-decisions?application={id or numeric}
router.get('/', (req, res) => offerDecisionController.getByApplication(req, res));

// POST /api/v1/offer-decisions  (approve / save)
router.post('/', (req, res) => offerDecisionController.upsert(req, res));

// POST /api/v1/offer-decisions/decline
router.post('/decline', (req, res) => offerDecisionController.decline(req, res));

export default router;

