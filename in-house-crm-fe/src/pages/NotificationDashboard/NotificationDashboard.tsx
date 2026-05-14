import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router'
import { motion } from 'framer-motion'
import { useTheme } from '@/context/ThemeContext'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn, formatDate } from '@/lib/utils'
import { getNotifications, markAllNotificationsAsRead } from '@/redux/actions/notificationActions'
import type { AppDispatch, RootState } from '@/redux/store'
import type { Notification } from '@/redux/slices/notificationSlice'
import { markAllNotificationsReadOptimistic } from '@/redux/slices/notificationSlice'
import { axiosGet } from '@/redux/axios'
import {
  Bell,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  RefreshCcw,
} from 'lucide-react'

const filters = ['All', 'Unread', 'Doc Request', 'Status Update'] as const

/** Notifications per page — keeps DOM small for fast paint (slice only). */
const LIST_PAGE_SIZE = 15

function sortNotificationsNewestFirst(items: Notification[]): Notification[] {
  if (items.length <= 1) return items
  return [...items].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime()
    const tb = new Date(b.createdAt).getTime()
    return tb - ta
  })
}

function filterNotifications(
  items: Notification[],
  filter: (typeof filters)[number],
): Notification[] {
  if (items.length === 0) return items
  const out: Notification[] = []
  for (let i = 0; i < items.length; i += 1) {
    const n = items[i]
    if (filter === 'All') out.push(n)
    else if (filter === 'Unread' && !n.isRead) out.push(n)
    else if (filter === 'Doc Request' && n.type === 'document_request') out.push(n)
    else if (filter === 'Status Update' && n.type === 'application_update') out.push(n)
  }
  return out
}

function buildIdMap(items: Notification[]): Map<string, Notification> {
  const m = new Map<string, Notification>()
  for (let i = 0; i < items.length; i += 1) {
    const n = items[i]
    m.set(n._id, n)
  }
  return m
}

type FilterId = (typeof filters)[number]

function formatRelativeTime(dateString: string): string {
  try {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`
    return formatDate(date, '')
  } catch {
    return ''
  }
}

function getRecipientId(n: Notification): string | null {
  const r = n.recipient
  if (typeof r === 'string') return r
  if (r && typeof r === 'object') {
    const o = r as { _id?: string; id?: string }
    return o._id || o.id || null
  }
  return null
}

function getRecipientDisplayName(notification: Notification): string | null {
  const r = notification.recipient
  if (r && typeof r === 'object') {
    const o = r as { firstName?: string; lastName?: string; email?: string }
    const name = `${o.firstName || ''} ${o.lastName || ''}`.trim()
    return name || o.email || null
  }
  return null
}

function getSenderName(notification: Notification): string {
  const actor =
    notification.createdBy && typeof notification.createdBy === 'object'
      ? notification.createdBy
      : notification.recipient && typeof notification.recipient === 'object'
        ? notification.recipient
        : null

  if (!actor) return 'Unknown'

  const fullName = `${actor.firstName || ''} ${actor.lastName || ''}`.trim()
  return fullName || actor.email || 'Unknown'
}

function typeLabel(type: Notification['type']): string {
  switch (type) {
    case 'document_request':
      return 'Document'
    case 'application_update':
      return 'Update'
    case 'system':
      return 'System'
    default:
      return 'Other'
  }
}

function typeBadgeClass(type: Notification['type'], isDark: boolean): string {
  switch (type) {
    case 'document_request':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300'
    case 'application_update':
      return 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
    case 'system':
      return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    default:
      return isDark ? 'bg-muted text-muted-foreground' : 'bg-slate-100 text-slate-700'
  }
}

function getDetailIcon(type: Notification['type']) {
  switch (type) {
    case 'document_request':
      return <FileText className="size-5 text-[#276D9C] dark:text-sky-400" />
    default:
      return <Bell className="size-5 text-muted-foreground" />
  }
}

function applicationDisplayLabel(notification: Notification): string | null {
  const app = notification.application
  if (!app || typeof app !== 'object') return null
  const a = app as { applicationId?: number; _id?: string; type?: string }
  if (a.applicationId != null) return `Application #${a.applicationId}`
  if (a._id) return 'Application'
  return null
}

export default function NotificationDashboard() {
  const dispatch = useDispatch<AppDispatch>()
  const navigate = useNavigate()
  const [selectedNotificationId, setSelectedNotificationId] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterId>('All')
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  const { data: loginData } = useSelector((state: RootState) => state.login)
  const userRole = loginData?.user?.role || localStorage.getItem('role') || ''
  const isSuperAdmin = userRole === 'SUPER_ADMIN' || userRole === 'SUPERADMIN'
  const myUserId = loginData?.user?._id || null

  const { data: notifications, loading } = useSelector((state: RootState) => state.notifications)
  const { loading: markAllLoading } = useSelector((state: RootState) => state.markAllNotificationsAsRead)

  const [adminFeed, setAdminFeed] = useState<Notification[]>([])
  const [adminLoading, setAdminLoading] = useState(false)

  const fetchAdminFeed = useCallback(async () => {
    setAdminLoading(true)
    try {
      const res = await axiosGet('/notifications?limit=500')
      const rows = res.data?.data
      setAdminFeed(Array.isArray(rows) ? rows : [])
    } catch {
      setAdminFeed([])
    } finally {
      setAdminLoading(false)
    }
  }, [])

  const feed = isSuperAdmin ? adminFeed : notifications
  const feedLoading = isSuperAdmin ? adminLoading : loading

  const unreadInFeedCount = useMemo(
    () => feed.reduce((acc, n) => acc + (n.isRead ? 0 : 1), 0),
    [feed],
  )

  const unreadOwnInFeed = useMemo(() => {
    if (!isSuperAdmin || !myUserId) return 0
    return feed.reduce(
      (acc, n) => acc + (!n.isRead && getRecipientId(n) === myUserId ? 1 : 0),
      0,
    )
  }, [feed, isSuperAdmin, myUserId])

  const hasOwnUnread = useMemo(() => {
    if (!isSuperAdmin) return notifications.some((n) => !n.isRead)
    if (!myUserId) return adminFeed.some((n) => !n.isRead)
    return adminFeed.some((n) => !n.isRead && getRecipientId(n) === myUserId)
  }, [isSuperAdmin, myUserId, notifications, adminFeed])

  /** Super Admin global feed: allow mark-all when any row is unread (API marks entire system). Others: only own inbox. */
  const canMarkAllReadOnPage = isSuperAdmin ? unreadInFeedCount > 0 : hasOwnUnread

  const sortedNotifications = useMemo(() => sortNotificationsNewestFirst(feed), [feed])

  const filteredNotifications = useMemo(
    () => filterNotifications(sortedNotifications, activeFilter),
    [sortedNotifications, activeFilter],
  )

  const feedById = useMemo(() => buildIdMap(feed), [feed])

  const [listPage, setListPage] = useState(1)
  const prevSelectedIdRef = useRef<string | null>(null)
  const prevFilterRef = useRef<FilterId>(activeFilter)

  const filteredCount = filteredNotifications.length
  const listTotalPages = Math.max(1, Math.ceil(filteredCount / LIST_PAGE_SIZE))

  useEffect(() => {
    setListPage(1)
  }, [activeFilter])

  useEffect(() => {
    if (listPage > listTotalPages) setListPage(listTotalPages)
  }, [listPage, listTotalPages])

  useEffect(() => {
    const selChanged = selectedNotificationId !== prevSelectedIdRef.current
    const filterChanged = activeFilter !== prevFilterRef.current
    prevSelectedIdRef.current = selectedNotificationId
    prevFilterRef.current = activeFilter

    if (!selChanged && !filterChanged) return
    if (!selectedNotificationId || filteredNotifications.length === 0) return

    const idx = filteredNotifications.findIndex((n) => n._id === selectedNotificationId)
    if (idx < 0) return
    const targetPage = Math.floor(idx / LIST_PAGE_SIZE) + 1
    setListPage(targetPage)
  }, [selectedNotificationId, activeFilter, filteredNotifications])

  const paginatedList = useMemo(() => {
    const start = (listPage - 1) * LIST_PAGE_SIZE
    return filteredNotifications.slice(start, start + LIST_PAGE_SIZE)
  }, [filteredNotifications, listPage])

  useEffect(() => {
    if (isSuperAdmin) {
      void fetchAdminFeed()
      const poll = setInterval(() => {
        if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
        void fetchAdminFeed()
      }, 30000)
      return () => clearInterval(poll)
    }
    dispatch(getNotifications({ limit: 50 }))
    const poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      dispatch(getNotifications({ limit: 50 }))
    }, 30000)
    return () => clearInterval(poll)
  }, [dispatch, isSuperAdmin, fetchAdminFeed])

  useEffect(() => {
    if (filteredNotifications.length === 0) {
      setSelectedNotificationId(null)
      return
    }
    const stillThere =
      selectedNotificationId &&
      filteredNotifications.some((n) => n._id === selectedNotificationId)
    if (!stillThere) {
      setSelectedNotificationId(filteredNotifications[0]._id)
    }
  }, [filteredNotifications, selectedNotificationId])

  const selectedNotification =
    selectedNotificationId != null ? feedById.get(selectedNotificationId) ?? null : null

  const refresh = () => {
    if (isSuperAdmin) void fetchAdminFeed()
    else dispatch(getNotifications({ limit: 50 }))
  }

  const handleSelect = (notification: Notification) => {
    setSelectedNotificationId(notification._id)
  }

  const handleMarkAllRead = async () => {
    const now = new Date().toISOString()
    if (isSuperAdmin) {
      setAdminFeed((prev) =>
        prev.map((n) => (!n.isRead ? { ...n, isRead: true, readAt: now } : n)),
      )
    } else {
      dispatch(markAllNotificationsReadOptimistic())
    }
    try {
      await dispatch(
        markAllNotificationsAsRead(isSuperAdmin ? { allRecipients: true } : undefined),
      ).unwrap()
      if (isSuperAdmin) {
        await fetchAdminFeed()
        dispatch(getNotifications({ limit: 50, personalOnly: true }))
      }
    } catch {
      if (isSuperAdmin) void fetchAdminFeed()
      else dispatch(getNotifications({ limit: 50 }))
    }
  }

  const openLinkedApplication = (notification: Notification) => {
    if (notification.application && typeof notification.application === 'object') {
      const app = notification.application as { applicationId?: number; _id?: string }
      const appId = app.applicationId ?? app._id
      if (appId != null) {
        navigate(`/application-details/${appId}`)
      }
    }
  }

  const displayTitle = (n: Notification) => {
    const sender = getSenderName(n)
    return (n.title || '').replace('Unknown Client', sender) || 'Notification'
  }

  const displayMessage = (n: Notification) => {
    const sender = getSenderName(n)
    return (n.message || '').replace('Unknown Client', sender) || '—'
  }

  const metaLine = (n: Notification) => {
    const datePart = formatDate(n.createdAt, '')
    const rel = formatRelativeTime(n.createdAt)
    return [datePart, rel].filter(Boolean).join(' · ')
  }

  return (
    <motion.div
      className={cn(
        'flex min-h-screen flex-1 flex-col gap-6 px-4 py-6 sm:px-6 md:px-8 md:py-8 lg:h-[calc(100dvh-4.5rem)] lg:min-h-0 lg:flex-row lg:items-start lg:gap-8',
        'bg-background',
      )}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
    >
      <aside
        className={cn(
          'flex max-h-[70vh] w-full flex-col overflow-hidden rounded-xl border shadow-sm lg:h-[calc(100dvh-4.5rem)] lg:max-h-[calc(100dvh-4.5rem)] lg:min-h-0 lg:min-w-0 lg:flex-1 lg:basis-0',
          isDark ? 'border-[#374151] bg-card' : 'border-[#E5E7EB] bg-white',
        )}
      >
        <div
          className={cn(
            'shrink-0 space-y-4 border-b p-4 sm:p-5',
            isDark ? 'border-[#374151]' : 'border-gray-100',
          )}
        >
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <div
                className={cn(
                  'flex size-11 items-center justify-center rounded-xl',
                  isDark ? 'bg-[#276D9C]/15' : 'bg-[#276D9C]/10',
                )}
              >
                <Bell className="size-6 text-[#276D9C] dark:text-sky-400" />
              </div>
              {unreadInFeedCount > 0 ? (
                <span
                  className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-background"
                  aria-label={`${unreadInFeedCount} unread`}
                >
                  {unreadInFeedCount > 99 ? '99+' : unreadInFeedCount}
                </span>
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                  Notifications
                </h1>
                {unreadInFeedCount > 0 ? (
                  <Badge
                    variant="secondary"
                    className="border-0 bg-red-500/15 text-xs font-semibold text-red-600 dark:bg-red-500/20 dark:text-red-400"
                  >
                    {unreadInFeedCount} unread
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="border-0 bg-muted text-[10px] font-medium text-muted-foreground"
                  >
                    All read
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {isSuperAdmin
                  ? 'All notifications across agents, underwriters, and final underwriters'
                  : 'Updates from your workspace'}
              </p>
              {isSuperAdmin && unreadOwnInFeed > 0 ? (
                <p className="mt-1 text-xs font-medium text-[#276D9C] dark:text-sky-400">
                  {unreadOwnInFeed} unread in your inbox
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {filters.map((filter) => {
              const label =
                filter === 'Unread' && unreadInFeedCount > 0
                  ? `Unread (${unreadInFeedCount > 99 ? '99+' : unreadInFeedCount})`
                  : filter
              return (
              <button
                key={filter}
                type="button"
                onClick={() => setActiveFilter(filter)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-all sm:text-sm',
                  activeFilter === filter
                    ? 'bg-[#276D9C] text-white shadow-sm dark:bg-[#276D9C] dark:text-white'
                    : cn(
                        'text-muted-foreground hover:bg-muted/80 hover:text-foreground',
                        isDark ? 'hover:bg-white/5' : 'hover:bg-slate-100',
                      ),
                )}
              >
                {label}
              </button>
              )
            })}
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <h2 className="text-sm font-semibold text-foreground sm:text-base">All notifications</h2>
              <p className="text-xs text-muted-foreground">
                {unreadInFeedCount > 0
                  ? `${unreadInFeedCount} unread in this list`
                  : 'No unread notifications'}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-0.5 sm:gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                title="Refresh"
                onClick={() => refresh()}
                disabled={feedLoading}
              >
                <RefreshCcw className={cn('size-4', feedLoading && 'animate-spin')} />
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 px-2 text-muted-foreground hover:text-foreground"
                title={
                  isSuperAdmin
                    ? 'Mark every notification in the system as read (all recipients)'
                    : 'Mark all as read'
                }
                onClick={() => handleMarkAllRead()}
                disabled={markAllLoading || !canMarkAllReadOnPage}
              >
                <CheckCheck className="size-4 shrink-0" />
                <span className="hidden text-xs font-medium sm:inline">Mark as read</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden p-2 sm:p-3 [scrollbar-gutter:stable]">
          {feedLoading && feed.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">Loading notifications…</div>
          ) : filteredNotifications.length > 0 ? (
            paginatedList.map((notification) => {
              const isSelected = selectedNotificationId === notification._id
              return (
                <motion.button
                  key={notification._id}
                  type="button"
                  onClick={() => handleSelect(notification)}
                  initial={false}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.15 }}
                  className={cn(
                    'flex w-full gap-3 rounded-lg border p-3 text-left transition-all sm:p-3.5',
                    isSelected
                      ? cn(
                          'border-[#276D9C]/35 shadow-md ring-2 ring-[#276D9C]/20',
                          isDark ? 'bg-[#276D9C]/10' : 'bg-card',
                        )
                      : cn(
                          'border-transparent bg-transparent hover:border-border hover:bg-muted/40',
                          isDark && 'hover:bg-white/[0.04]',
                        ),
                  )}
                >
                  

                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <h3
                          className={cn(
                            'truncate text-sm font-semibold sm:text-[15px]',
                            !notification.isRead ? 'text-foreground' : 'text-foreground/90',
                          )}
                        >
                          {displayTitle(notification)}
                        </h3>
                      </div>
                      <time className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(notification.createdAt)}
                      </time>
                    </div>
                    <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground sm:text-sm">
                      {displayMessage(notification)}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <span
                        className={cn(
                          'inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium sm:text-xs',
                          typeBadgeClass(notification.type, isDark),
                        )}
                      >
                        {typeLabel(notification.type)}
                      </span>
                      {applicationDisplayLabel(notification) ? (
                        <span className="text-xs text-muted-foreground">
                          {applicationDisplayLabel(notification)}
                        </span>
                      ) : null}
                      {isSuperAdmin && getRecipientDisplayName(notification) ? (
                        <span className="text-xs text-muted-foreground">
                          To: {getRecipientDisplayName(notification)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </motion.button>
              )
            })
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No notifications in this view.
            </div>
          )}
        </div>

        {filteredCount > 0 ? (
          <div
            className={cn(
              'flex shrink-0 flex-wrap items-center justify-between gap-2 border-t px-3 py-2.5 sm:px-4',
              isDark ? 'border-[#374151]' : 'border-gray-100',
            )}
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2"
              disabled={listPage <= 1 || feedLoading}
              onClick={() => setListPage((p) => Math.max(1, p - 1))}
              aria-label="Previous page"
            >
              <ChevronLeft className="size-4" />
              <span className="hidden sm:inline">Prev</span>
            </Button>
            <p className="min-w-0 flex-1 text-center text-[11px] text-muted-foreground sm:text-xs">
              Page {listPage} of {listTotalPages}
              <span className="hidden sm:inline">
                {' '}
                · {filteredCount} total
              </span>
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 px-2"
              disabled={listPage >= listTotalPages || feedLoading}
              onClick={() => setListPage((p) => Math.min(listTotalPages, p + 1))}
              aria-label="Next page"
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="size-4" />
            </Button>
          </div>
        ) : null}
      </aside>

      <main className="flex min-h-[50vh] w-full min-w-0 flex-1 flex-col lg:min-h-0 lg:min-w-0 lg:max-h-[calc(100dvh-4.5rem)] lg:flex-1 lg:basis-0 lg:overflow-y-auto">
        {selectedNotification ? (
          <div
            className={cn(
              'flex h-auto w-full flex-col rounded-xl border shadow-sm',
              isDark ? 'border-[#374151] bg-card' : 'border-[#E5E7EB] bg-white',
            )}
          >
            <header
              className={cn(
                'flex items-start justify-between gap-4 border-b p-5 sm:p-6',
                isDark ? 'border-[#374151]' : 'border-gray-100',
              )}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold tracking-tight sm:text-xl">
                    {displayTitle(selectedNotification)}
                  </h2>
                  {!selectedNotification.isRead && (
                    <Badge className="border-0 bg-[#276D9C]/15 text-[#276D9C] dark:bg-sky-500/20 dark:text-sky-300">
                      Unread
                    </Badge>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  <span>{metaLine(selectedNotification)}</span>
                  {applicationDisplayLabel(selectedNotification) ? (
                    <>
                      <span className="mx-1.5 text-border">·</span>
                      <span className="font-medium text-[#276D9C] dark:text-sky-400">
                        {applicationDisplayLabel(selectedNotification)}
                      </span>
                    </>
                  ) : null}
                  {isSuperAdmin && getRecipientDisplayName(selectedNotification) ? (
                    <>
                      <span className="mx-1.5 text-border">·</span>
                      <span>
                        Recipient:{' '}
                        <span className="font-medium text-foreground">
                          {getRecipientDisplayName(selectedNotification)}
                        </span>
                      </span>
                    </>
                  ) : null}
                </p>
              </div>
            </header>

            <div className="p-5 sm:p-6">
              <div className="mx-auto max-w-3xl space-y-8">
                <div
                  className={cn(
                    'flex gap-4 rounded-xl border p-5',
                    isDark
                      ? 'border-sky-900/50 bg-sky-950/30'
                      : 'border-sky-200/80 bg-gradient-to-br from-sky-50 to-white',
                  )}
                >
                  <div
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-lg',
                      isDark ? 'bg-sky-500/15' : 'bg-white shadow-sm',
                    )}
                  >
                    {getDetailIcon(selectedNotification.type)}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <h3 className="font-semibold text-foreground">
                      {typeLabel(selectedNotification.type)} notification
                    </h3>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      From <span className="font-medium text-foreground">{getSenderName(selectedNotification)}</span>
                      {isSuperAdmin && getRecipientDisplayName(selectedNotification) ? (
                        <>
                          {' '}
                          · To{' '}
                          <span className="font-medium text-foreground">
                            {getRecipientDisplayName(selectedNotification)}
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>
                </div>

                <section className="space-y-4">
                  <h3 className="text-base font-semibold text-foreground">Message</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground sm:text-[15px] whitespace-pre-wrap">
                    {displayMessage(selectedNotification)}
                  </p>

                  {selectedNotification.documentRequestDetails ? (
                    <div
                      className={cn(
                        'space-y-2 rounded-lg border p-4',
                        isDark ? 'border-[#374151] bg-muted/20' : 'border-gray-100 bg-slate-50/80',
                      )}
                    >
                      <p className="text-sm font-medium text-foreground">Requested documents</p>
                      <ul className="list-inside list-disc space-y-2 text-sm text-muted-foreground sm:text-[15px]">
                        {selectedNotification.documentRequestDetails.requestedDocuments.map((doc, idx) => (
                          <li key={idx}>{doc}</li>
                        ))}
                      </ul>
                      {selectedNotification.documentRequestDetails.requestAdditional ? (
                        <p className="text-sm italic text-muted-foreground">
                          Additional documents may be required.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </section>
              </div>
            </div>

            {selectedNotification.application && typeof selectedNotification.application === 'object' ? (
              <footer
                className={cn(
                  'flex flex-wrap items-center justify-center gap-3 border-t p-4 sm:p-5',
                  isDark ? 'border-[#374151]' : 'border-gray-100',
                )}
              >
                <Button
                  type="button"
                  className="gap-2 bg-[#276D9C] hover:bg-[#1f5a82] cursor-pointer "
                  onClick={() => openLinkedApplication(selectedNotification)}
                >
                  <ExternalLink className="size-4" />
                  Open application
                </Button>
              </footer>
            ) : null}
          </div>
        ) : (

          <div
            className={cn(
              'flex min-h-[280px] flex-1 items-center justify-center rounded-xl border p-8 text-muted-foreground shadow-sm lg:min-h-[320px] lg:flex-none',
              isDark ? 'border-[#374151] bg-card' : 'border-[#E5E7EB] bg-white',
            )}
          >
            {feedLoading ? 'Loading…' : 'Select a notification to view its details.'}
          </div>
        )}
      </main>
    </motion.div>
  )
}
