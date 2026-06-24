import { Router } from 'express';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireSuperAdmin } from '../middleware/requireSuperAdmin';
import {
  createDocuSignProfile,
  createFunder,
  getDocuSignProfile,
  getFunder,
  listDocuSignProfileOptions,
  listDocuSignProfiles,
  listFunders,
  removeDocuSignProfile,
  removeFunder,
  updateDocuSignProfile,
  updateFunder,
} from '../controllers/integrationSettingsController';

const router = Router();

/** Contract UI — any authenticated user can list funders for dropdown. */
router.get('/funders', authenticateToken, listFunders);

/** Admin — DocuSign account profiles */
router.get('/docusign-accounts', authenticateToken, requireSuperAdmin, listDocuSignProfiles);
router.get(
  '/docusign-accounts/options',
  authenticateToken,
  requireSuperAdmin,
  listDocuSignProfileOptions,
);
router.get('/docusign-accounts/:id', authenticateToken, requireSuperAdmin, getDocuSignProfile);
router.post('/docusign-accounts', authenticateToken, requireSuperAdmin, createDocuSignProfile);
router.patch('/docusign-accounts/:id', authenticateToken, requireSuperAdmin, updateDocuSignProfile);
router.delete('/docusign-accounts/:id', authenticateToken, requireSuperAdmin, removeDocuSignProfile);

/** Super admin — funder profiles */
router.get('/funders/:id', authenticateToken, requireSuperAdmin, getFunder);
router.post('/funders', authenticateToken, requireSuperAdmin, createFunder);
router.patch('/funders/:id', authenticateToken, requireSuperAdmin, updateFunder);
router.delete('/funders/:id', authenticateToken, requireSuperAdmin, removeFunder);

export default router;
