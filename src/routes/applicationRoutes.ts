import express from 'express';
import multer from 'multer';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireRoles } from '../middleware/requireRoles';
import applicationController from '../controllers/applicationController';
import schedulePaymentTrackingController from '../controllers/schedulePaymentTrackingController';

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
router.post('/auto-create-from-pdf', applicationController.autoCreateFromPDF.bind(applicationController));

// OCR microservice → parse → create client + application (multipart field: `pdf`)
router.post(
    '/upload',
    applicationPdfMemoryUpload.single('pdf'),
    applicationController.uploadApplicationPdfOcrCreate.bind(applicationController),
);

// Send approval email to client (non-blocking email send)
router.get(
    '/approval-email-payload',
    applicationController.getApprovalEmailPayload.bind(applicationController),
);
router.post('/send-approval-email', applicationController.sendApprovalEmail.bind(applicationController));

// Funded / funds-released email (OPERATIONS only; non-blocking)
router.post('/send-funded-email', applicationController.sendFundedEmail.bind(applicationController));

// Create a new application (with optional file uploads - field: 'files')
router.post('/', applicationController.create.bind(applicationController));

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

// Update application queue
router.patch('/:id/queue', applicationController.updateQueue.bind(applicationController));

// Scrubbing exclusive claim (avoids multiple scrubbers working the same deal)
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

// Update application state
router.patch('/:id/state', applicationController.updateState.bind(applicationController));

// Update document checklist (checked document labels)
router.patch('/:id/document-checklist', applicationController.updateDocumentChecklist.bind(applicationController));

// Generate a one-time 4-digit action code for edit/delete (notifies Super Admins)
router.post('/:id/action-code', applicationController.requestActionCode.bind(applicationController));

// Reject/Decline application
router.post('/:id/reject', applicationController.rejectApplication.bind(applicationController));

// Approve application (idempotent webhook-style endpoint; works for CRM users + ISO public-portal sessions)
router.post('/:id/approve', applicationController.approve.bind(applicationController));

// Application activity logs
router.get(
    '/:id/activity-logs/:logId/content',
    applicationController.getActivityLogContent.bind(applicationController),
);
router.get('/:id/activity-logs', applicationController.getActivityLogs.bind(applicationController));

// Payment workspace: mail send history (persisted)
router.get('/:id/payment-mail-logs', applicationController.getPaymentMailLogs.bind(applicationController));
router.post('/:id/payment-mail-logs', applicationController.createPaymentMailLog.bind(applicationController));
router.put(
    '/:id/payment-mail-logs/:logId',
    applicationController.updatePaymentMailLog.bind(applicationController),
);

// Disbursement review: planned debit schedule (persisted on confirm)
router.get(
    '/:id/schedule-payment-tracking',
    schedulePaymentTrackingController.listForApplication.bind(schedulePaymentTrackingController),
);
router.put(
    '/:id/schedule-payment-tracking',
    schedulePaymentTrackingController.replaceForApplication.bind(schedulePaymentTrackingController),
);


// Duplicate applications (dedupes) - UW/Admin only
router.get('/:id/duplicates', applicationController.getDuplicates.bind(applicationController));

// Delete application
router.delete('/:id', applicationController.delete.bind(applicationController));

export default router;
