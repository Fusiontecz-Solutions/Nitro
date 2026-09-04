import express from 'express';
import notificationController from '../controllers/notificationController';
import { authenticateToken } from '../middleware/authMiddleware';

const router = express.Router();

router.use(authenticateToken);

router.post('/document-request', notificationController.sendDocumentRequest.bind(notificationController));
router.post(
    '/application-sent-to-final-scrubbing',
    notificationController.notifyApplicationSentToFinalUnderwriter.bind(notificationController),
);
router.get('/', notificationController.getNotifications.bind(notificationController));
router.get('/summary', notificationController.getSummary.bind(notificationController));
router.get(
    '/document-requests/:applicationId',
    notificationController.getDocumentRequestsByApplication.bind(notificationController),
);
router.patch('/bulk', notificationController.bulkUpdate.bind(notificationController));
router.patch('/read-all', notificationController.markAllAsRead.bind(notificationController));
router.patch('/:id/state', notificationController.updateNotificationState.bind(notificationController));
router.patch('/:id/read', notificationController.markAsRead.bind(notificationController));
router.delete('/:id', notificationController.deleteNotification.bind(notificationController));

export default router;
