import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireRoles } from '../middleware/requireRoles';
import { forbidRoles } from '../middleware/forbidRoles';
import { requirePermission } from '../middleware/requirePermission';
import { PERMISSIONS } from '../constants/rolePermissions';
import applicationController from '../controllers/applicationController';
import applicationWorkflowController from '../controllers/applicationWorkflowController';

/**
 * Agent / Underwriter move deals only through the dedicated workflow endpoints
 * (submit, claim, send-to-agent, return, send-to-ISO) — never raw queue/state writes.
 */
const blockWorkflowRoles = forbidRoles('AGENT', 'UNDERWRITER');

/**
 * `/approve` is used by ISO public-portal sessions (JWT carries the referring agent's role
 * plus `publicApprovalActor`). Workflow roles acting as themselves may not self-approve.
 */
const allowApproveActor: express.RequestHandler = (req, res, next) => {
    if (req.user?.publicApprovalActor) return next();
    return blockWorkflowRoles(req, res, next);
};

const router = express.Router();

/** Multer memory upload for OCR pipeline (`POST /upload`); field name must be `pdf`. */
const applicationPdfMemoryUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const ok =
            file.mimetype === 'application/pdf' ||
            file.mimetype === 'application/octet-stream' ||
            /\.pdf$/i.test(file.originalname);
        cb(null, ok);
    },
});

const applicationExcelBulkUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const name = (file.originalname || '').toLowerCase();
        const ok =
            name.endsWith('.xlsx') ||
            name.endsWith('.xls') ||
            name.endsWith('.csv') ||
            file.mimetype === 'text/csv' ||
            file.mimetype === 'application/vnd.ms-excel'  ||
            file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        cb(null, ok);
    },
});

// All application routes require authentication
router.use(authenticateToken);

// Extract routes - MUST be before all other routes to avoid conflicts
// Primary endpoint: process uploaded application PDF and extract business data (field: 'pdf')
router.post('/extract-business-details', applicationController.processPDFUpload.bind(applicationController));

// Legacy alias: /extract-pdf should behave the same as /extract-business-details
router.post('/extract-pdf', applicationController.processPDFUpload.bind(applicationController));

// Auto-create client + application directly from uploaded PDF
router.post('/auto-create-from-pdf', blockWorkflowRoles, applicationController.autoCreateFromPDF.bind(applicationController));

// OCR microservice → parse → create client + application (multipart field: `pdf`)
router.post(
    '/upload',
    blockWorkflowRoles,
    applicationPdfMemoryUpload.single('pdf'),
    applicationController.uploadApplicationPdfOcrCreate.bind(applicationController),
);

// Send approval email to client (non-blocking email send)
router.post('/send-approval-email', applicationController.sendApprovalEmail.bind(applicationController));
router.post('/reinitiate-contract', blockWorkflowRoles, applicationController.reinitiateContract.bind(applicationController));

// Funded / funds-released email (OPERATIONS only; non-blocking)
router.post('/send-funded-email', blockWorkflowRoles, applicationController.sendFundedEmail.bind(applicationController));

// Create a new application (with optional file uploads - field: 'files')
router.post(
    '/',
    requirePermission(PERMISSIONS.APPLICATION_CREATE),
    applicationController.create.bind(applicationController),
);

// Agent / Underwriter workflow: role-scoped dashboard counts + queues (before '/:id')
router.get('/workflow/summary', applicationWorkflowController.summary.bind(applicationWorkflowController));
router.get('/workflow/queue', applicationWorkflowController.queue.bind(applicationWorkflowController));

// Super Admin: historical applications import from Excel (field: `file`)
router.post(
    '/bulk-upload-excel',
    requireRoles('SUPER_ADMIN'),
    applicationExcelBulkUpload.single('file'),
    applicationController.bulkUploadApplicationsExcel.bind(applicationController),
);
router.post(
    '/bulk-upload-excel/start',
    requireRoles('SUPER_ADMIN'),
    applicationExcelBulkUpload.single('file'),
    applicationController.startBulkUploadApplicationsExcel.bind(applicationController),
);
router.get(
    '/bulk-upload-excel/progress/:jobId',
    requireRoles('SUPER_ADMIN'),
    applicationController.getBulkUploadApplicationsExcelProgress.bind(applicationController),
);

// Get all applications with pagination and filters (role-based visibility)
router.get('/', applicationController.getAll.bind(applicationController));

// Admin dashboard aggregated stats
router.get('/admin-dashboard-stats', applicationController.getAdminDashboardStats.bind(applicationController));

// Get application stats (counts and total amounts by queue/state, role-based)
router.get('/stats', applicationController.getStats.bind(applicationController));

// Underwriter deal-pipeline sidebar counts (scoped to logged-in underwriter)
router.get(
    '/underwriter-pipeline-counts',
    applicationController.getUnderwriterPipelineCounts.bind(applicationController),
);

// Operations dashboard: single response for all pipeline / queue stat cards (scalable vs N list calls)
router.get(
    '/operations-dashboard-summary',
    applicationController.getOperationsDashboardSummary.bind(applicationController),
);
router.get(
    '/operations-dashboard-recent-cases',
    applicationController.getOperationsDashboardRecentCases.bind(applicationController),
);
router.get(
    '/operations-dashboard-payment-performance',
    applicationController.getOperationsDashboardPaymentPerformance.bind(applicationController),
);

// Get monthly trend stats (approved & funded amounts per month)
router.get('/stats/trend', applicationController.getMonthlyTrend.bind(applicationController));

// Main dashboard aggregates (no bulk application list)
router.get(
    '/dashboard-pipeline-funnel',
    applicationController.getDashboardPipelineFunnel.bind(applicationController),
);
router.get(
    '/dashboard-trend-chart',
    applicationController.getDashboardTrendChart.bind(applicationController),
);
router.get(
    '/dashboard-recent-applications',
    applicationController.getDashboardRecentApplications.bind(applicationController),
);

// Get applications by agent ID (referringAgentId). Query: ?agentId=uuid&page=1&limit=10
router.get('/by-agent', applicationController.getApplicationsByAgentId.bind(applicationController));

// Get applications by ISO id
router.get('/by-iso/:isoId', applicationController.getByIsoId.bind(applicationController));

// Get applications by underwriter id (assigned, approved, or claimed)
router.get(
    '/by-underwriter/:underwriterId',
    applicationController.getByUnderwriterId.bind(applicationController),
);

// Get application by MongoDB ObjectId
router.get('/:id', applicationController.getById.bind(applicationController));

// Get application by numeric applicationId
router.get('/applicationId/:applicationId', applicationController.getByApplicationId.bind(applicationController));

// Get applications by client
router.get('/client/:clientId', applicationController.getByClient.bind(applicationController));

// Update application
router.put('/:id', applicationController.update.bind(applicationController));

// Add files to application (field: 'files')
router.post('/:id/files', applicationController.addFiles.bind(applicationController));

// Remove file from application
router.delete('/:id/files/:fileId', applicationController.removeFile.bind(applicationController));

// Tag an existing file with a document-request slug (fulfillment from CRM uploads)
router.patch(
    '/:id/files/:fileId',
    applicationController.updateFileDocumentType.bind(applicationController),
);

// Fill application client fields from a stored PDF (Claude / Document AI extraction)
router.post(
    '/:id/files/:fileId/fill-from-pdf',
    applicationController.fillApplicationFromPdfFile.bind(applicationController),
);

// Driver's license / voided check: upload + extract, then sync reviewed fields
router.post(
    '/:id/kyc-documents/upload',
    applicationController.uploadKycDocuments.bind(applicationController),
);
router.post(
    '/:id/kyc-documents/sync',
    applicationController.syncKycPrefill.bind(applicationController),
);

// Update application queue
router.patch('/:id/queue', blockWorkflowRoles, applicationController.updateQueue.bind(applicationController));

// Agent: move a draft into the Underwriter pool
router.post(
    '/:id/submit-to-underwriting',
    requirePermission(PERMISSIONS.APPLICATION_SUBMIT_UNDERWRITING),
    applicationWorkflowController.submitToUnderwriting.bind(applicationWorkflowController),
);
// Underwriter: underwriting complete → Agent Approval
router.post(
    '/:id/send-to-agent-approval',
    requirePermission(PERMISSIONS.UNDERWRITING_SEND_TO_AGENT),
    applicationWorkflowController.sendToAgentApproval.bind(applicationWorkflowController),
);
// Agent: request changes → back to the Underwriter
router.post(
    '/:id/return-to-underwriter',
    requirePermission(PERMISSIONS.AGENT_APPROVAL_ACT),
    applicationWorkflowController.returnToUnderwriter.bind(applicationWorkflowController),
);
// ISO approval email history (Gmail thread + recorded sends)
router.get('/:id/email-thread', applicationWorkflowController.emailThread.bind(applicationWorkflowController));

// Scrubbing exclusive claim (avoids multiple underwriters working the same deal)
router.post(
    '/:id/scrubbing-claim',
    requireRoles('SCRUBBING'),
    applicationController.claimUnderwriterDeal.bind(applicationController),
);
router.post(
    '/:id/underwriter-claim',
    requireRoles('UNDERWRITER'),
    applicationController.claimFinalUnderwriterDeal.bind(applicationController),
);
router.post(
    '/:id/scrubbing-release',
    // Only Admin can take back a deal from the Scrubbing queue.
    requireRoles('ADMIN', 'SUPER_ADMIN'),
    applicationController.releaseUnderwriterDeal.bind(applicationController),
);

// Super Admin / Scrubbing: assign application to a specific Underwriter (in-app notification)
router.post(
    '/:id/assign-underwriter',
    requireRoles('SUPER_ADMIN', 'SCRUBBING'),
    applicationController.assignApplicationToUnderwriter.bind(applicationController),
);

// Super Admin / Operations: send deal to the approving Underwriter for final approval
router.post(
    '/:id/send-final-underwriter-approval',
    requireRoles('SUPER_ADMIN', 'OPERATIONS'),
    applicationController.sendForFinalUnderwriterApproval.bind(applicationController),
);

// Super Admin / Scrubbing: assign application to a specific Underwriter (in-app notification)
router.post(
    '/:id/assign-underwriter',
    requireRoles('SUPER_ADMIN', 'SCRUBBING'),
    applicationController.assignApplicationToUnderwriter.bind(applicationController),
);

// Super Admin / Operations: send Underwriter Approved deal to the approving Underwriter for final approval
router.post(
    '/:id/send-final-underwriter-approval',
    requireRoles('SUPER_ADMIN', 'OPERATIONS'),
    applicationController.sendForFinalUnderwriterApproval.bind(applicationController),
);

// Update application state
router.patch('/:id/state', blockWorkflowRoles, applicationController.updateState.bind(applicationController));

// Update document checklist (checked document labels)
router.patch('/:id/document-checklist', applicationController.updateDocumentChecklist.bind(applicationController));

// Reject/Decline application
// Agents may decline their own deals (access is scoped in the controller via getApplicationForUser).
router.post('/:id/reject', applicationController.rejectApplication.bind(applicationController));

// Approve application (idempotent webhook-style endpoint; works for CRM users + ISO public-portal sessions)
router.post('/:id/approve', allowApproveActor, applicationController.approve.bind(applicationController));

// Application activity logs
router.get(
    '/:id/activity-logs/:logId/content',
    applicationController.getActivityLogContent.bind(applicationController),
);
router.get('/:id/activity-logs', applicationController.getActivityLogs.bind(applicationController));

// Payment workspace: mail send history (persisted)
router.get('/:id/contract-email-history', applicationController.getContractEmailHistory.bind(applicationController));
router.get('/:id/payment-mail-logs',applicationController.getPaymentMailLogs.bind(applicationController));
router.post('/:id/payment-mail-logs', applicationController.createPaymentMailLog.bind(applicationController));

// Disbursement review: planned debit schedule (persisted on confirm)

// Duplicate applications (dedupes) - UW/Admin only
router.get('/:id/duplicates', applicationController.getDuplicates.bind(applicationController));

// Recently Deleted: restore to previous queue/state (Super Admin / Operations)
router.post(
    '/:id/restore',
    requireRoles('SUPER_ADMIN', 'OPERATIONS'),
    applicationController.restoreApplication.bind(applicationController),
);

// Recently Deleted: permanent removal (Super Admin / Operations)
router.delete(
    '/:id/permanent',
    requireRoles('SUPER_ADMIN', 'OPERATIONS'),
    applicationController.permanentlyDelete.bind(applicationController),
);

// Soft-delete application (moves to Recently Deleted)
router.delete('/:id', blockWorkflowRoles, applicationController.delete.bind(applicationController));

export default router;
