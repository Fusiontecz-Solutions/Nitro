import { createAsyncThunk } from '@reduxjs/toolkit';
import { axiosGet, axiosPost, axiosPatch, axiosDelete } from '../axios';

export interface SendDocumentRequestPayload {
    applicationId: string | number;
    requestedDocuments: string[];
    requestAdditional?: boolean;
    reason?: string;
    /** Primary ISO recipient (editable in UI). */
    isoEmail?: string;
    /** Extra To addresses besides ISO. */
    additionalToEmails?: string[];
    ccEmails?: string[];
}

export interface NotifyFinalUnderwriterPayload {
    applicationId: string | number;
    underwriterName?: string;
}

// Send document request notification
export const sendDocumentRequest = createAsyncThunk(
    'notification/sendDocumentRequest',
    async (data: SendDocumentRequestPayload, { rejectWithValue }) => {
        try {
            const response = await axiosPost('/notifications/document-request', data);
            return response.data;
        } catch (error: any) {
            const message = error.response?.data?.message || error.message || 'Failed to send document request';
            console.error('Send document request error:', message, error.response?.data);
            return rejectWithValue(message);
        }
    }
);

// Notify Final Underwriter when an application is sent from Underwriter
export const notifyFinalUnderwriterOnAssignment = createAsyncThunk(
    'notification/notifyFinalUnderwriterOnAssignment',
    async (data: NotifyFinalUnderwriterPayload, { rejectWithValue }) => {
        try {
            const response = await axiosPost('/notifications/application-sent-to-final-underwriter', data);
            return response.data;
        } catch (error: any) {
            const message =
                error.response?.data?.message ||
                error.message ||
                'Failed to notify Final Underwriter';
            console.error('Notify Final Underwriter error:', message, error.response?.data);
            return rejectWithValue(message);
        }
    }
);

export interface NotifyOperationsDisbursementPayload {
    applicationId: string | number;
}

export interface NotifyOperationsDisbursementResponse {
    notified: number;
    emailsSent: number;
    recipients: Array<{ id: string; name: string; email: string }>;
}

/**
 * Super Admin → Operations: signals that the Funding Call is complete and
 * Operations may proceed with disbursement. Backend persists a notification,
 * pushes it via Socket.IO (so the bell updates immediately) and emails every
 * active Operations user that has a verified address.
 */
export const notifyOperationsForDisbursement = createAsyncThunk(
    'notification/notifyOperationsForDisbursement',
    async (data: NotifyOperationsDisbursementPayload, { rejectWithValue }) => {
        try {
            const response = await axiosPost(
                '/notifications/notify-operations-disbursement',
                data,
            );
            return response.data;
        } catch (error: any) {
            const message =
                error.response?.data?.message ||
                error.message ||
                'Failed to notify Operations for disbursement';
            console.error('Notify Operations disbursement error:', message, error.response?.data);
            return rejectWithValue(message);
        }
    },
);

// Get notifications for current user
export const getNotifications = createAsyncThunk(
    'notification/getNotifications',
    async (
        params: { isRead?: boolean; limit?: number; page?: number; personalOnly?: boolean } = {},
        { rejectWithValue },
    ) => {
        try {
            const queryParams = new URLSearchParams();
            if (params.isRead !== undefined) {
                queryParams.append('isRead', params.isRead.toString());
            }
            if (params.limit) {
                queryParams.append('limit', params.limit.toString());
            }
            if (params.page) {
                queryParams.append('page', params.page.toString());
            }
            if (params.personalOnly) {
                queryParams.append('personalOnly', 'true');
            }

            const url = `/notifications${queryParams.toString() ? `?${queryParams.toString()}` : ''}`;
            const response = await axiosGet(url);
            return response.data;
        } catch (error: any) {
            console.error('Get notifications error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch notifications'
            );
        }
    }
);

// Mark notification as read
export const markNotificationAsRead = createAsyncThunk(
    'notification/markAsRead',
    async (id: string, { rejectWithValue }) => {
        try {
            const response = await axiosPatch(`/notifications/${id}/read`);
            return response.data;
        } catch (error: any) {
            console.error('Mark notification as read error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to mark notification as read'
            );
        }
    }
);

export type MarkAllNotificationsParams = {
    /** Super Admin only: mark every notification in DB (global feed). Omit or false = current user’s inbox only. */
    allRecipients?: boolean;
}

// Mark all notifications as read (personal inbox, or entire system for Super Admin when allRecipients is true)
export const markAllNotificationsAsRead = createAsyncThunk(
    'notification/markAllAsRead',
    async (params: MarkAllNotificationsParams | undefined, { rejectWithValue }) => {
        try {
            const allRecipients = params?.allRecipients === true;
            const url = `/notifications/read-all${allRecipients ? '?allRecipients=true' : ''}`;
            const response = await axiosPatch(url);
            return response.data;
        } catch (error: any) {
            console.error('Mark all notifications as read error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to mark all notifications as read'
            );
        }
    }
);

// Delete a notification
export const deleteNotification = createAsyncThunk(
    'notification/deleteNotification',
    async (id: string, { rejectWithValue }) => {
        try {
            const response = await axiosDelete(`/notifications/${id}`);
            return response.data;
        } catch (error: any) {
            console.error('Delete notification error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to delete notification'
            );
        }
    }
);

// Get document requests for an application
export const getDocumentRequestsByApplication = createAsyncThunk(
    'notification/getDocumentRequestsByApplication',
    async (applicationId: string | number, { rejectWithValue }) => {
        try {
            const response = await axiosGet(`/notifications/document-requests/${applicationId}`);
            return response.data;
        } catch (error: any) {
            console.error('Get document requests by application error:', error);
            return rejectWithValue(
                error.response?.data?.message || 'Failed to fetch document requests'
            );
        }
    }
);

