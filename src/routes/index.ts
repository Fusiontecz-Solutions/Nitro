import express from 'express';
const router = express.Router();

import authRoutes from './authRoutes';
import roleRoutes from './roleRoutes';
import clientRoutes from './clientRoutes';
import applicationRoutes from './applicationRoutes';
import publicApprovalRoutes from './publicApprovalRoutes';
import userRoutes from './userRoutes';
import uploadRoutes from './uploadRoutes';
import contractTemplateRoutes from './contractTemplateRoutes';
import commentRoutes from './commentRoutes';
import positionRoutes from './positionRoutes';
import termsOfferRoutes from './termsOfferRoutes';
import noteRoutes from './noteRoutes';
import applicationQuestionRoutes from './applicationQuestionRoutes';
import bankDetailRoutes from './bankDetailRoutes';
import finalAnswerRoutes from './finalAnswerRoutes';
import monthRoutes from './monthRoutes';
import transactionRoutes from './transactionRoutes';
import bankAnalysisRoutes from './bankAnalysisRoutes';
import offerDecisionRoutes from './offerDecisionRoutes';
import docusignRoutes from '../services/docusign/docusign.routes';
import boldsignRoutes from '../services/boldsign/boldsign.routes';
import contractRoutes from './contractRoutes';
import isoRoutes from './isoRoutes';
import mailRoutes from './mailRoutes';
import integrationSettingsRoutes from './integrationSettingsRoutes';
import sendgridWebhookRoutes from './sendgridWebhookRoutes';
import backgroundCheckRoutes from './backgroundCheckRoutes';
import opencorporatesRoutes from './opencorporatesRoutes';
import backgroundCheckReportRoutes from './backgroundCheckReportRoutes';
import notificationRoutes from './notificationRoutes';

/**
 * Contract-workflow API surface.
 * Keeps offer/contract/ACH dependencies (positions, bank analysis, etc.) while
 * omitting payments, syndicators, chat, gmail, commissions, letters, and similar modules.
 */
router.use('/auth', authRoutes);
router.use('/roles', roleRoutes);
router.use('/clients', clientRoutes);
router.use('/applications', applicationRoutes);
router.use('/public', publicApprovalRoutes);
router.use('/users', userRoutes);
router.use('/uploads', uploadRoutes);
router.use('/contract-templates', contractTemplateRoutes);
router.use('/comments', commentRoutes);
router.use('/positions', positionRoutes);
router.use('/terms-offers', termsOfferRoutes);
router.use('/notes', noteRoutes);
router.use('/application-questions', applicationQuestionRoutes);
router.use('/bank-details', bankDetailRoutes);
router.use('/final-answers', finalAnswerRoutes);
router.use('/months', monthRoutes);
router.use('/transactions', transactionRoutes);
router.use('/bank-analysis', bankAnalysisRoutes);
router.use('/docusign', docusignRoutes);
router.use('/boldsign', boldsignRoutes);
router.use('/offer-decisions', offerDecisionRoutes);
router.use('/contract', contractRoutes);
router.use('/iso', isoRoutes);
router.use('/sendgrid', sendgridWebhookRoutes);
router.use('/mail', mailRoutes);
router.use('/integration-settings', integrationSettingsRoutes);
router.use('/background-checks', backgroundCheckRoutes);
router.use('/opencorporates', opencorporatesRoutes);
router.use('/background-check-report', backgroundCheckReportRoutes);
router.use('/notifications', notificationRoutes);

export default router;
