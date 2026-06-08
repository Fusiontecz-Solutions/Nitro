import { useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router";
import type { AppDispatch, RootState } from "@/redux/store";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
    DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { getNotifications, markNotificationAsRead, markAllNotificationsAsRead } from "@/redux/actions/notificationActions";
import { useTheme } from "@/context/ThemeContext";
import type { Notification } from "@/redux/slices/notificationSlice";
import { formatDate } from "@/lib/utils";

const NotificationDropdown = () => {
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const dispatch = useDispatch<AppDispatch>();
    const navigate = useNavigate();
    const [open, setOpen] = useState(false);
    
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const userRole = loginData?.user?.role || localStorage.getItem("role") || "";
    const isSuperAdmin = userRole === "SUPER_ADMIN" || userRole === "SUPERADMIN";
    const inboxParams = useMemo(
        () => ({ limit: 50, ...(isSuperAdmin ? { personalOnly: true as const } : {}) }),
        [isSuperAdmin],
    );

    const { data: notifications, loading } = useSelector((state: RootState) => state.notifications);
  
    const { loading: markAsReadLoading } = useSelector((state: RootState) => state.markNotificationAsRead);
    
    // Get unread count
    const unreadCount = notifications?.filter((notif: Notification) => !notif.isRead).length || 0;

    // Refresh when dropdown opens (inbox sync runs at app shell via NotificationsSync)
    useEffect(() => {
        if (open) {
            dispatch(getNotifications(inboxParams));
        }
    }, [open, dispatch, inboxParams]);

    const handleNotificationClick = async (notification: Notification) => {
        if (!notification.isRead) {
            try {
                await dispatch(markNotificationAsRead(notification._id)).unwrap();
            } catch (error) {
                console.error('Failed to mark notification as read:', error);
            }
        }
        
        // If notification has an application, navigate to it
        if (notification.application && typeof notification.application === 'object') {
            const appId = (notification.application as any).applicationId || (notification.application as any)._id;
            if (appId) {
                // Navigate to application details page
                navigate(`/application-details/${appId}`);
            }
        }
    
        setOpen(false);
    }
    const handleMarkAllAsRead = async () => {
        try {
            await dispatch(markAllNotificationsAsRead()).unwrap();
            // Refresh not
            dispatch(getNotifications(inboxParams));
        } catch (error) {
            console.error('Failed to mark all notifications as read:', error);
        }
    };

    const formatTime = (dateString: string) => {
        try {
            const date = new Date(dateString);
            const now = new Date();
            const diffMs = now.getTime() - date.getTime();
            const diffMins = Math.floor(diffMs / 60000);
            const diffHours = Math.floor(diffMs / 3600000);
            const diffDays = Math.floor(diffMs / 86400000);

            if (diffMins < 1) return 'just now';
            if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
            if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
            if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
            
            // For older dates, show formatted date
            return formatDate(date, "");
        } catch {
            return '';
        }
    };

    const getNotificationIcon = (type: string) => {
        switch (type) {
            case 'document_request':
                return '📄';
            case 'application_update':
                return '📋';
            case 'contract_signing':
                return '✍️';
            case 'system':
                return '⚙️';
            default:
                return '🔔';
        }
    };

    const getSenderName = (notification: Notification): string => {
        const actor =
            notification.createdBy && typeof notification.createdBy === "object"
                ? notification.createdBy
                : notification.recipient && typeof notification.recipient === "object"
                    ? notification.recipient
                    : null;

        if (!actor) return "Unknown";

        const fullName = `${actor.firstName || ""} ${actor.lastName || ""}`.trim();
        return fullName || actor.email || "Unknown";
    };

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="sm"
                    className="relative p-2 rounded-full hover:bg-accent text-muted-foreground"
                    aria-label="notifications"
                >
                    <Bell className="h-5 w-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-0 right-0 h-4 w-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                            {unreadCount > 9 ? '9+' : unreadCount}
                        </span>
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className={`w-80 max-h-[500px] overflow-y-auto ${isDark ? 'bg-card border-border' : 'bg-white border-gray-200'}`}
            >
                <div className={`flex items-center justify-between px-3 py-2 border-b ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
                    <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>
                        Notifications
                    </h3>
                    {unreadCount > 0 && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleMarkAllAsRead}
                            disabled={markAsReadLoading}
                            className="text-xs h-auto py-1 px-2 text-blue-600 hover:text-blue-700"
                        >
                            Mark all as read
                        </Button>
                    )}
                </div>

                {loading ? (
                    <div className="p-4 text-center text-sm text-muted-foreground">
                        Loading notifications...
                    </div>
                ) : notifications && notifications.length > 0 ? (
                    <div className="py-1">
                        {notifications.map((notification: Notification) => {
                            const senderName = getSenderName(notification);
                            const title =
                                notification.title?.replace("Unknown Client", senderName) ||
                                notification.title ||
                                "";
                            const message =
                                notification.message?.replace("Unknown Client", senderName) ||
                                notification.message ||
                                "";

                            return (
                            <DropdownMenuItem
                                key={notification._id}
                                className={`cursor-pointer p-3 border-b last:border-b-0 ${isDark ? 'border-gray-700 hover:bg-gray-800' : 'border-gray-100 hover:bg-gray-50'} ${
                                    !notification.isRead ? (isDark ? 'bg-blue-950/20' : 'bg-blue-50') : ''
                                }`}
                                onClick={() => handleNotificationClick(notification)}
                            >
                                <div className="flex items-start gap-3 w-full">
                                    <div className="text-xl mt-0.5">
                                        {getNotificationIcon(notification.type)}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-start justify-between gap-2">
                                            <p className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-900'}`}>
                                                {title}
                                            </p>
                                            {!notification.isRead && (
                                                <div className="h-2 w-2 rounded-full bg-blue-500 shrink-0 mt-1.5" />
                                            )}
                                        </div>
                                        <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'} line-clamp-2`}>
                                            {message}
                                        </p>
                                        {notification.documentRequestDetails && (
                                            <div className={`mt-2 p-2 rounded text-xs ${isDark ? 'bg-gray-800' : 'bg-gray-100'}`}>
                                                <p className={`font-medium mb-1 ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                                                    Requested Documents:
                                                </p>
                                                <ul className={`list-disc list-inside space-y-0.5 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                                    {notification.documentRequestDetails.requestedDocuments.map((doc, idx) => (
                                                        <li key={idx}>{doc}</li>
                                                    ))}
                                                </ul>
                                                {notification.documentRequestDetails.requestAdditional && (
                                                    <p className={`mt-1 italic ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
                                                        Additional documents may be required
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        <p className={`text-xs mt-2 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                                            {formatTime(notification.createdAt)}
                                        </p>
                                    </div>
                                </div>
                            </DropdownMenuItem>
                        )})}
                    </div>
                ) : (
                    <div className="p-6 text-center">
                        <Bell className={`h-8 w-8 mx-auto mb-2 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} />
                        <p className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                            No notifications
                        </p>
                        <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                            You're all caught up!
                        </p>
                    </div>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
};

export default NotificationDropdown;

