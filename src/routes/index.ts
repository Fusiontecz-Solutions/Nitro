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
import signnowWebhookRoutes from './signnowWebhookRoutes';
import backgroundCheckRoutes from './backgroundCheckRoutes';
import opencorporatesRoutes from './opencorporatesRoutes';
import backgroundCheckReportRoutes from './backgroundCheckReportRoutes';
import notificationRoutes from './notificationRoutes';
import gmailRoutes, { googleOAuthCallbackRouter } from './gmailRoutes';
import paymentTemplateRoutes from './paymentTemplateRoutes';
import { denyAgentWrites, denyWorkflowRoles } from '../middleware/denyWorkflowRoles';

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
router.use('/contract-templates', denyWorkflowRoles, contractTemplateRoutes);
router.use('/comments', commentRoutes);
router.use('/positions', denyAgentWrites, positionRoutes);
router.use('/terms-offers', denyAgentWrites, termsOfferRoutes);
router.use('/notes', noteRoutes);
router.use('/application-questions', applicationQuestionRoutes);
router.use('/bank-details', denyAgentWrites, bankDetailRoutes);
router.use('/final-answers', denyAgentWrites, finalAnswerRoutes);
router.use('/months', denyAgentWrites, monthRoutes);
router.use('/transactions', denyAgentWrites, transactionRoutes);
router.use('/bank-analysis', denyAgentWrites, bankAnalysisRoutes);
router.use('/docusign', denyWorkflowRoles, docusignRoutes);
router.use('/boldsign', denyWorkflowRoles, boldsignRoutes);
router.use('/offer-decisions', denyAgentWrites, offerDecisionRoutes);
router.use('/contract', denyWorkflowRoles, contractRoutes);
router.use('/iso', isoRoutes);
router.use('/sendgrid', sendgridWebhookRoutes);
router.use('/signnow', denyWorkflowRoles, signnowWebhookRoutes);
router.use('/mail', denyWorkflowRoles, mailRoutes);
router.use('/integration-settings', denyWorkflowRoles, integrationSettingsRoutes);
router.use('/background-checks', backgroundCheckRoutes);
router.use('/opencorporates', opencorporatesRoutes);
router.use('/background-check-report', backgroundCheckReportRoutes);
router.use('/notifications', notificationRoutes);
// Per-user Gmail connection (Agent ISO approval mail). Callback is public; identity is in signed state.
router.use('/google', googleOAuthCallbackRouter);
router.use('/gmail', gmailRoutes);
// Email / letter / contract templates (Gmail workspace compose + "New template").
router.use('/payment-templates', paymentTemplateRoutes);

export default router;
