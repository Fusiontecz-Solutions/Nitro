import express from 'express';
import notificationController from '../controllers/notificationController';
import { authenticateToken } from '../middleware/authMiddleware';
import { requireRoles } from '../middleware/requireRoles';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Send document request notification
router.post('/document-request', notificationController.sendDocumentRequest.bind(notificationController));

// Underwriter (or other workflow) sent application to Final Underwriter — notify all active Final Underwriters in-app
router.post(
    '/application-sent-to-final-underwriter',
    notificationController.notifyApplicationSentToFinalUnderwriter.bind(notificationController),
);

router.post(
    '/notify-operations-disbursement',
    requireRoles('SUPER_ADMIN', 'ADMIN'),
    notificationController.notifyOperationsDisbursement.bind(notificationController),
);

// Super Admin signals Operations team that the Funding Call is complete and disbursement may begin
router.post(
    '/notify-operations-disbursement',
    notificationController.notifyOperationsDisbursement.bind(notificationController),
);

// Get notifications for current user
router.get('/', notificationController.getNotifications.bind(notificationController));

// Get document requests for an application
router.get('/document-requests/:applicationId', notificationController.getDocumentRequestsByApplication.bind(notificationController));

// Mark notification as read
router.patch('/:id/read', notificationController.markAsRead.bind(notificationController));

// Mark all notifications as read for current user
router.patch('/read-all', notificationController.markAllAsRead.bind(notificationController));

// Delete a notification
router.delete('/:id', notificationController.deleteNotification.bind(notificationController));

export default router;

