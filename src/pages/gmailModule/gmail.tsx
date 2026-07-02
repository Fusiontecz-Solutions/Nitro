import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { toast } from 'react-toastify';
import { getGmailMessageDetails, getGmailAttachments, syncGmail, sendGmailCompose, fetchGmailConnection, markGmailMessageInCrmLabel } from '@/redux/actions/gmailActions';
import { parseApplicationPdfForClientPrefill } from '@/redux/actions/applicationActions';
import { getIsos } from '@/redux/actions/isoActions';
import type { GmailLabel } from '@/redux/actions/gmailActions';
import { setActiveLabel } from '@/redux/slices/gmailSlice';
import type { RootState, AppDispatch } from '@/redux/store';
import {
  Menu, Plus, Inbox, File, Send as SendIcon,
  ChevronDown, RefreshCw, ChevronLeft, ChevronRight, X, Minus,
  Maximize2, Paperclip,
  ArrowLeft, AlertCircle, Mail, User, ExternalLink,
  Search,
  Loader2,
  LogOut,
} from 'lucide-react';
import { buildGoogleOAuthConnectUrl } from '@/lib/googleOAuth';

function isGmailReconnectNeeded(message: string | null | undefined): boolean {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('invalid authentication credentials') ||
    m.includes('invalid_grant') ||
    m.includes('reconnect google') ||
    m.includes('gmail connection expired') ||
    m.includes('gmail is not connected')
  );
}
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { logout } from '@/redux/actions/authActions';
import type { user as SessionUser } from '@/redux/slices/authSlice';
import { clearApplicationStats } from '@/redux/slices/applicationSlice';
import { clearPaymentDashboard } from '@/redux/slices/paymentDashboardSlice';
import { resetOperationsDashboard } from '@/redux/slices/operationsDashboardSlice';
import { clearVoiceMicSessionFlags } from '@/voice/microphoneWarmup';
import { clearCrmCacheOnLogout } from '@/lib/crmCache';


const IconButton = ({ icon, className = "", onClick }: { icon: React.ReactNode, className?: string, onClick?: React.MouseEventHandler<HTMLButtonElement> }) => (
  <button
    onClick={onClick}
    className={`p-2 hover:bg-black/5 dark:hover:bg-white/10 rounded-full transition-colors flex items-center justify-center ${className}`}
  >
    {icon}
  </button>
);

// Extract a specific header (e.g., Subject, From, Date) from Gmail payload headers
const getHeaderValue = (headers: any[] | undefined, name: string): string => {
  if (!headers) return '';
  const h = headers.find(
    (hdr) => typeof hdr.name === 'string' && hdr.name.toLowerCase() === name.toLowerCase(),
  );
  return h?.value || '';
};

const extractEmailFromFromHeader = (fromHeader: string): string => {
  const raw = String(fromHeader || '').trim();
  if (!raw) return '';
  const angleMatch = raw.match(/<([^>]+)>/);
  return String(angleMatch?.[1] || raw).trim().toLowerCase();
};

// Walk the payload tree to extract attachment metadata (filename, size, mimeType)
type AttachmentMeta = { filename: string; mimeType: string; size: number; attachmentId: string };

const getAttachmentsFromPayload = (payload: any): AttachmentMeta[] => {
  const results: AttachmentMeta[] = [];
  const walk = (part: any) => {
    if (!part) return;
    if (part.filename && part.filename.length > 0 && part.body?.attachmentId) {
      results.push({
        filename: part.filename,
        mimeType: part.mimeType || 'application/octet-stream',
        size: part.body.size || 0,
        attachmentId: part.body.attachmentId,
      });
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) walk(p);
    }
  };
  walk(payload);
  return results;
};

const getFileIcon = (mimeType: string, filename: string) => {
  const lower = filename.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    return (
      <div className="flex-shrink-0 w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded flex items-center justify-center">
        <svg viewBox="0 0 24 24" className="w-5 h-5 text-red-600 dark:text-red-400" fill="currentColor">
          <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-8.5 7.5c0 .83-.67 1.5-1.5 1.5H9v2H7.5V7H10c.83 0 1.5.67 1.5 1.5v1zm5 2c0 .83-.67 1.5-1.5 1.5h-2.5V7H15c.83 0 1.5.67 1.5 1.5v3zm4-3H19v1h1.5V11H19v2h-1.5V7h3v1.5zM9 9.5h1v-1H9v1zM4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm10 5.5h1v-3h-1v3z" />
        </svg>
      </div>
    );
  }
  if (mimeType.startsWith('image/')) {
    return (
      <div className="flex-shrink-0 w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded flex items-center justify-center">
        <File size={18} className="text-green-600 dark:text-green-400" />
      </div>
    );
  }
  return (
    <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded flex items-center justify-center">
      <File size={18} className="text-blue-600 dark:text-blue-400" />
    </div>
  );
};

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const sanitizeEmailHtml = (rawHtml: string): string => {
  if (!rawHtml) return '';
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(rawHtml, 'text/html');

    // Prevent email styles/scripts from leaking into the app shell (sidebar/header/layout).
    doc.querySelectorAll('style,script,link[rel="stylesheet"],meta,base,title').forEach((node) => {
      node.remove();
    });

    return doc.body?.innerHTML || '';
  } catch {
    return rawHtml;
  }
};

// Walk the payload tree to find the first text/html part and decode it
const getHtmlBodyFromPayload = (payload: any): string => {
  if (!payload) return '';

  const findHtmlPart = (part: any): string | null => {
    if (!part) return null;
    if (part.mimeType === 'text/html' && part.body?.data) {
      return part.body.data as string;
    }
    if (Array.isArray(part.parts)) {
      for (const p of part.parts) {
        const res = findHtmlPart(p);
        if (res) return res;
      }
    }
    return null;
  };

  const encoded = findHtmlPart(payload);
  if (!encoded) return '';

  try {
    // Gmail uses base64url encoding
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    return sanitizeEmailHtml(decoded);
  } catch {
    return '';
  }
};

const GoogleOAuthButton = ({
  onClick,
  className = '',
}: {
  onClick: () => void;
  className?: string;
}) => (
  <button
    type="button"
    onClick={onClick}
    className={`flex items-center justify-center gap-3 py-2.5 px-4 rounded-full border border-gray-300 bg-white hover:bg-gray-50 text-sm font-semibold text-gray-700 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300 cursor-pointer ${className}`}
  >
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
      <path fill="none" d="M0 0h48v48H0z" />
    </svg>
    Connect to Gmail
  </button>
);

const GmailPage = () => {
  const dispatch = useDispatch<AppDispatch>();
  const navigate = useNavigate();
  const {
    messages,
    selectedMessage,
    loadingList,
    loadingDetail,
    detailError,
    syncError,
    nextPageToken,
    activeLabel,
    autoCreating,
    sendingEmail,
    gmailConnected,
    gmailEmail,
    connectionLoading,
    connectionChecked,
  } = useSelector((state: RootState) => state.gmail);
  const { data: loginData } = useSelector((state: RootState) => state.login);
  const userRole =
    loginData?.user?.role ||
    (typeof window !== "undefined" ? localStorage.getItem("role") : "") ||
    "";
  const isOperationsRole =
    String(userRole || "").replace(/-/g, "_").toUpperCase() === "OPERATIONS";

  // View States
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'detail'>('list');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isRecipientDetailsOpen, setIsRecipientDetailsOpen] = useState(false);

  // Compose States
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [isComposeMinimized, setIsComposeMinimized] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [isBypassProcessing, setIsBypassProcessing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isAccountSwitcherOpen, setIsAccountSwitcherOpen] = useState(false);
  const [sessionUser, setSessionUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    const u = loginData?.user;
    if (u && typeof u === 'object' && (u as SessionUser)?.email) {
      setSessionUser(u as SessionUser);
      return;
    }
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem('user');
      if (raw) {
        const parsed = JSON.parse(raw) as SessionUser;
        if (parsed?.email) setSessionUser(parsed);
        else setSessionUser(null);
      } else setSessionUser(null);
    } catch {
      setSessionUser(null);
    }
  }, [loginData]);

  const accountInitials = useMemo(() => {
    const fn = String(sessionUser?.firstName || '').trim();
    const ln = String(sessionUser?.lastName || '').trim();
    if (fn && ln) return `${fn[0]!}${ln[0]!}`.toUpperCase();
    if (fn.length >= 2) return fn.slice(0, 2).toUpperCase();
    if (fn.length === 1) return fn.toUpperCase();
    const em = String(sessionUser?.email || '').trim();
    if (em.length >= 2) return em.slice(0, 2).toUpperCase();
    return 'U';
  }, [sessionUser]);

  const accountDisplayName = useMemo(() => {
    const fn = String(sessionUser?.firstName || '').trim();
    const ln = String(sessionUser?.lastName || '').trim();
    const full = `${fn} ${ln}`.trim();
    if (full) return full;
    return sessionUser?.email || 'User';
  }, [sessionUser]);

  const accountEmail = sessionUser?.email?.trim() || '';

  const [signingOut, setSigningOut] = useState(false);

  const filteredMessages = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m: any) => {
      const from = String(m?.from || '').toLowerCase();
      const to = String(m?.to || '').toLowerCase();
      const subject = String(m?.subject || '').toLowerCase();
      const snippet = String(m?.snippet || '').toLowerCase();
      return from.includes(q) || to.includes(q) || subject.includes(q) || snippet.includes(q);
    });
  }, [messages, searchQuery]);

  useEffect(() => {
    dispatch(fetchGmailConnection());
  }, [dispatch]);

  useEffect(() => {
    if (!connectionChecked || connectionLoading) return;
    if (!gmailConnected) return;
    dispatch(syncGmail({ label: activeLabel }));
  }, [dispatch, activeLabel, connectionChecked, connectionLoading, gmailConnected]);

  const cleanEmailAddress = (email: string): string =>
    email.replace(/[<>]/g, '').trim()

  const handleLoadMore = () => {
    if (!nextPageToken) return;
    dispatch(syncGmail({ label: activeLabel, pageToken: nextPageToken }));
  };


  const handleLabelChange = (label: GmailLabel) => {
    dispatch(setActiveLabel(label));
    setViewMode('list');
    setSelectedMessageId(null);
  };

  const sidebarItems: { icon: any; label: string; value: GmailLabel }[] = [
    { icon: Inbox, label: 'Inbox', value: 'INBOX' },
    // { icon: Star, label: 'Starred', value: 'STARRED' },
    { icon: SendIcon, label: 'Sent', value: 'SENT' },
    { icon: File, label: 'Drafts', value: 'DRAFT' },
    { icon: AlertCircle, label: 'Important', value: 'IMPORTANT' },
  ];

  const handleSelectMessage = async (id: string) => {
    console.log("MESSAGES:------------------------------------------>", messages);
    console.log("CLICKED MESSAGE ID:------------------------------------------>", id);
    setSelectedMessageId(id);
    setViewMode('detail');

    try {
      // Fetch message details
      await dispatch(getGmailMessageDetails(id)).unwrap();

      // Fetch attachments for the message
      try {
        await dispatch(getGmailAttachments(id)).unwrap();
      } catch (attachmentErr) {
        // Attachments are optional, so we don't show error if they fail
        console.warn('Failed to fetch attachments:', attachmentErr);
      }
    } catch (error) {
      console.error('Failed to fetch message details:', error);
    }
  };

  useEffect(() => {
    setIsRecipientDetailsOpen(false);
  }, [selectedMessageId]);

  const handleSendCompose = async () => {
    const to = composeTo.trim();
    const body = composeBody.trim();
    const subject = composeSubject.trim();

    if (!to) {
      toast.error('Please add at least one recipient');
      return;
    }
    if (!body) {
      toast.error('Email body cannot be empty');
      return;
    }

    try {
      await dispatch(
        sendGmailCompose({
          to,
          subject: subject || '(no subject)',
          body,
        }),
      ).unwrap();

      toast.success('Email sent successfully');
      setComposeTo('');
      setComposeSubject('');
      setComposeBody('');
      setIsComposeOpen(false);
    } catch (error: any) {
      toast.error(error || 'Failed to send email');
    }
  };

  const handlePreviousMessage = () => {
    if (!selectedMessageId || filteredMessages.length === 0) return;
    const currentIndex = filteredMessages.findIndex((m) => m.id === selectedMessageId);
    if (currentIndex > 0) {
      handleSelectMessage(filteredMessages[currentIndex - 1].id);
    }
  };

  const handleNextMessage = () => {
    if (!selectedMessageId || filteredMessages.length === 0) return;
    const currentIndex = filteredMessages.findIndex((m) => m.id === selectedMessageId);
    if (currentIndex >= 0 && currentIndex < filteredMessages.length - 1) {
      handleSelectMessage(filteredMessages[currentIndex + 1].id);
    }
  };

  const handleGoogleConnect = () => {
    const apiBase =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:4000/api/v1";
    window.location.href = buildGoogleOAuthConnectUrl(apiBase);
  };

  const handleConnectGmailFromSwitcher = () => {
    setIsAccountSwitcherOpen(false);
    handleGoogleConnect();
  };

  const handleAccountLogout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const res = await dispatch(logout()).unwrap();
      if ((res as { success?: boolean })?.success) {
        toast.success((res as { message?: string }).message || 'Signed out');
      } else {
        toast.error((res as { message?: string })?.message || 'Sign out failed');
      }
    } catch (err: unknown) {
      const message =
        typeof err === 'string' ? err : (err as { message?: string })?.message;
      toast.error(message || 'Sign out failed');
    } finally {
      dispatch(clearApplicationStats());
      dispatch(clearPaymentDashboard());
      dispatch(resetOperationsDashboard());
      clearCrmCacheOnLogout();
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      localStorage.removeItem('role');
      clearVoiceMicSessionFlags();
      setIsAccountSwitcherOpen(false);
      navigate('/login', { replace: true });
      setSigningOut(false);
    }
  };

  return (
    <div className="h-[calc(100vh-64px)] min-h-[600px] flex flex-col bg-background text-foreground">

      {/* --- TOP HEADER --- */}
      <header className="flex items-center justify-between gap-4 px-4 py-3 border-b border-border bg-card/70 backdrop-blur supports-[backdrop-filter]:bg-card/60">
        <div className="flex items-center gap-3 min-w-[220px]">
          <Button variant="ghost" size="icon" className="rounded-lg" onClick={() => setIsSidebarOpen(!isSidebarOpen)}>
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            {/* <img src="https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico" alt="Gmail" className="w-6 h-6" /> */}
            <span className="text-lg font-semibold tracking-tight">Welcome !</span>
          </div>
        </div>

        <div className="flex-1 max-w-3xl">
          <div className="flex items-center gap-3 w-full rounded-lg border border-border bg-background px-4 py-2.5 transition-colors focus-within:border-[var(--brand)]">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search mail"
              className="w-full bg-transparent text-sm outline-none border-none placeholder:text-muted-foreground"
            />
          </div>
        </div>




        <div className="flex items-center gap-2 ml-2 shrink-0">
          <button
            type="button"
            onClick={() => setIsAccountSwitcherOpen(true)}
            className="h-8 w-8 shrink-0 rounded-full bg-[var(--brand)] flex items-center justify-center text-white text-[10px] font-semibold cursor-pointer ring-offset-2 ring-offset-background transition-shadow hover:ring-2 hover:ring-[var(--brand)]/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]"
            title="Google account"
            aria-label="Open account menu"
          >
            {accountInitials}
          </button>
        </div>
      </header>

      <Dialog open={isAccountSwitcherOpen} onOpenChange={setIsAccountSwitcherOpen}>
        <DialogContent
          className="max-w-[420px] gap-0 overflow-hidden rounded-2xl border-0 bg-slate-100 p-0 shadow-2xl dark:bg-slate-900 sm:rounded-2xl sm:max-w-[420px]"
          showCloseButton={false}
        >
          <DialogTitle className="sr-only">Account switcher</DialogTitle>
          <div className="relative border-b border-slate-200/80 bg-slate-100 px-4 py-3 dark:border-slate-700 dark:bg-slate-900">
            <div className="flex items-center gap-2 pr-10">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[10px] font-semibold text-white">
                {accountInitials}
              </div>
              <span className="min-w-0 truncate text-center text-sm font-medium text-slate-800 dark:text-slate-100">
                {accountEmail || accountDisplayName}
              </span>
            </div>
            <button
              type="button"
              className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-white/70 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
              aria-label="Close account menu"
              onClick={() => setIsAccountSwitcherOpen(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-4 px-6 pb-6 pt-5">
            <div className="flex flex-col items-center text-center">
              <div className="relative mb-3 flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-[var(--brand)] text-2xl font-semibold text-white shadow-md ring-2 ring-slate-200 dark:ring-slate-700">
                {accountInitials.slice(0, 1)}
              </div>
              <p className="text-xl font-normal text-slate-800 dark:text-slate-100">
                Hi, {sessionUser?.firstName?.trim() || accountEmail.split('@')[0] || 'there'}!
              </p>
              <p className="mt-0.5 max-w-[280px] text-xs text-slate-600 dark:text-slate-400">
                {gmailConnected && gmailEmail
                  ? `Connected as ${gmailEmail}`
                  : accountEmail}
              </p>
              <a
                href="https://myaccount.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center justify-center rounded-full border border-[#1a73e8] px-5 py-2 text-sm font-medium text-[#1a73e8] transition-colors hover:bg-[#1a73e8]/10"
              >
                Manage your Google Account
                <ExternalLink className="ml-2 h-3.5 w-3.5 opacity-70" aria-hidden />
              </a>
            </div>

            <div className="rounded-2xl border border-slate-200/90 bg-white p-1 shadow-sm dark:border-slate-700 dark:bg-slate-950">
              <div className="px-3 pb-2 pt-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  Accounts
                </p>
              </div>
              <div className="space-y-0.5 pb-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
                  onClick={handleConnectGmailFromSwitcher}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand)]/15 text-[var(--brand)]">
                    <Plus className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      Add another account
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Link Gmail via Google — opens secure sign-in
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
                  onClick={() => {
                    setIsAccountSwitcherOpen(false);
                    navigate('/user-setting');
                  }}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    <User className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold text-slate-900 dark:text-slate-100">
                      CRM profile &amp; settings
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                      Name, password, preferences in Finexus CRM
                    </span>
                  </span>
                </button>
              </div>
              <div className="mx-3 border-t border-slate-100 dark:border-slate-800" />
              <button
                type="button"
                disabled={signingOut}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm text-red-600 transition-colors hover:bg-red-50 disabled:opacity-60 dark:text-red-400 dark:hover:bg-red-950/30"
                onClick={() => void handleAccountLogout()}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/40">
                  <LogOut className="h-4 w-4" />
                </span>
                <span className="font-semibold">
                  {signingOut ? 'Signing out…' : 'Sign out of CRM'}
                </span>
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex flex-1 overflow-hidden p-3 gap-3">
        {/* --- SIDEBAR --- */}
        <aside className={`transition-all duration-300 flex flex-col rounded-xl border border-border bg-card ${isSidebarOpen ? 'w-64' : 'w-20'} p-2`}>
          <div className="px-1 py-1">
            <button
              className={`w-full flex items-center gap-3 transition-all hover:shadow-sm border border-[var(--brand)]/25 ${isSidebarOpen ? 'px-4 py-3 rounded-lg bg-[var(--brand)]/10 text-[var(--brand)]' : 'p-3 rounded-lg bg-[var(--brand)]/10 justify-center'}`}
              onClick={() => { setIsComposeOpen(true); setIsComposeMinimized(false); }}
            >
              <Plus className="h-5 w-5" />
              {isSidebarOpen && <span className="font-semibold text-sm">Compose</span>}
            </button>
          </div>
          <nav className="flex-1 mt-3 space-y-1">
            {sidebarItems.map((item) => {
              const isActive = activeLabel === item.value;
              return (
                <div
                  key={item.value}
                  onClick={() => handleLabelChange(item.value)}
                  className={`flex items-center gap-3 cursor-pointer text-sm rounded-md transition-colors ${isSidebarOpen ? 'px-3 py-2' : 'px-2 py-2 justify-center'} ${isActive
                    ? 'bg-[var(--brand)] text-white font-semibold'
                    : 'text-foreground/80 hover:bg-muted'
                    }`}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  {isSidebarOpen && (
                    <div className="flex justify-between w-full">
                      <span>{item.label}</span>
                      {isActive && messages.length > 0 && (
                        <span className="text-xs opacity-80">{messages.length}</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* --- MAIN CONTENT --- */}
        <main className="flex-1 flex flex-col rounded-xl overflow-hidden border border-border bg-card shadow-sm">

          {viewMode === 'list' ? (
            <>
              {/* List Toolbar */}
              <div className="flex items-center justify-between p-2.5 border-b border-border bg-muted/30">
                <div className="flex items-center gap-1">
                  {/* <IconButton icon={<Square className="h-4 w-4 opacity-60" />} /> */}
                  <IconButton icon={<RefreshCw className={`h-4 w-4 opacity-60 ${loadingList && 'animate-spin'}`} />} onClick={() => dispatch(syncGmail({ label: activeLabel }))} />
                  {/* <IconButton icon={<MoreVertical className="h-4 w-4 opacity-60" />} /> */}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground px-2">
                  <span>
                    {filteredMessages.length > 0 ? `1-${filteredMessages.length}` : 0} of {messages.length}
                  </span>
                  <IconButton icon={<ChevronLeft className="h-4 w-4" />} />
                  <IconButton icon={<ChevronRight className="h-4 w-4" />} />
                </div>
              </div>

              {gmailConnected && syncError && messages.length > 0 && (
                <div className="flex items-center justify-between gap-3 border-b border-amber-200/80 bg-amber-50 px-4 py-2 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                  <div className="flex min-w-0 items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span className="truncate">Sync failed — showing last loaded mail. {syncError}</span>
                  </div>
                  {isGmailReconnectNeeded(syncError) ? (
                    <GoogleOAuthButton onClick={handleGoogleConnect} className="shrink-0" />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      onClick={() => dispatch(syncGmail({ label: activeLabel }))}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto bg-background">
                {connectionLoading && !connectionChecked ? (
                  <div className="flex items-center justify-center py-16">
                    <RefreshCw className="h-5 w-5 animate-spin opacity-50 mr-2" />
                    <span className="text-sm opacity-60">Checking Gmail connection…</span>
                  </div>
                ) : connectionChecked && !gmailConnected ? (
                  <div className="flex flex-col items-center justify-center py-16 px-4 min-h-[min(60vh,420px)]">
                    <div className="flex flex-col items-center text-center opacity-60">
                      <Mail className="h-10 w-10 mb-3 opacity-40" />
                      <span className="text-sm mb-2">Connect Gmail to view your inbox</span>
                      <span className="text-xs opacity-50 mb-6 max-w-xs">
                        Sign in with the Google account linked to your CRM email.
                      </span>
                    </div>
                    <GoogleOAuthButton onClick={handleGoogleConnect} className="w-full max-w-sm" />
                  </div>
                ) : loadingList && messages.length === 0 ? (
                  <div className="flex items-center justify-center py-16">
                    <RefreshCw className="h-5 w-5 animate-spin opacity-50 mr-2" />
                    <span className="text-sm opacity-60">Loading {activeLabel.toLowerCase()} mails…</span>
                  </div>
                ) : syncError && messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 px-4 min-h-[min(60vh,420px)]">
                    <div className="flex flex-col items-center text-center opacity-60">
                      <AlertCircle className="h-10 w-10 mb-3 text-red-400" />
                      <span className="text-sm text-red-500 mb-2">
                        {isGmailReconnectNeeded(syncError) ? 'Gmail connection expired' : 'Sync failed'}
                      </span>
                      <span className="text-xs opacity-50 mb-2 max-w-xs">{syncError}</span>
                      {gmailEmail && !isGmailReconnectNeeded(syncError) && (
                        <span className="text-xs text-muted-foreground mb-6">
                          Connected as {gmailEmail}
                        </span>
                      )}
                    </div>
                    {isGmailReconnectNeeded(syncError) ? (
                      <GoogleOAuthButton onClick={handleGoogleConnect} className="w-full max-w-sm" />
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full max-w-sm"
                        onClick={() => dispatch(syncGmail({ label: activeLabel }))}
                      >
                        Retry sync
                      </Button>
                    )}
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 opacity-50">
                    <Mail className="h-12 w-12 mb-3 opacity-30" />
                    <span className="text-sm">
                      {searchQuery.trim() ? 'No matching emails found' : `No messages in ${activeLabel.toLowerCase()}`}
                    </span>
                  </div>
                ) : (
                  <>
                    {filteredMessages.map((m: any) => (
                      <div key={m.id} onClick={() => handleSelectMessage(m.id)} className={`group flex items-center px-4 py-2.5 border-b border-border cursor-pointer transition-colors ${selectedMessageId === m.id ? 'bg-[var(--brand)]/10' : 'hover:bg-muted/70'}`}>
                        {/* <Square className="h-4 w-4 mr-4 opacity-20 group-hover:opacity-60" /> */}
                        {/* <Star className="h-4 w-4 mr-4 opacity-20 group-hover:opacity-60" /> */}
                        <div className={`w-64 truncate text-sm mr-4 ${m.isRead ? 'font-normal text-muted-foreground' : 'font-semibold text-foreground'}`}>
                          {activeLabel === 'SENT' ? (m.to || 'Unknown') : (m.from || 'Unknown')}
                        </div>
                        <div className="flex-1 truncate text-sm">
                          <span className={m.isRead ? 'font-normal' : 'font-bold'}>{m.subject}</span>
                          <span className="opacity-60"> — {m.snippet}</span>
                        </div>
                        <div className="text-xs ml-4 min-w-[60px] text-right text-muted-foreground">{m.date || '12:00 PM'}</div>
                      </div>
                    ))}

                    {/* Load More */}
                    {nextPageToken && (
                      <div className="flex justify-center py-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleLoadMore}
                          disabled={loadingList}
                          className="text-xs"
                        >
                          {loadingList ? (
                            <>
                              <RefreshCw className="h-3 w-3 animate-spin mr-1.5" />
                              Loading…
                            </>
                          ) : (
                            'Load More'
                          )}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            /* --- MESSAGE DETAIL VIEW --- */
            <div className="flex flex-col h-full bg-background relative">
              {/* Floating Send to CRM Button */}
              <button
                onClick={async () => {
                  if (!selectedMessageId) {
                    toast.error('No message selected');
                    return;
                  }

                  try {
                    setIsBypassProcessing(true);
                    const headers = (selectedMessage as any)?.payload?.headers as any[] | undefined;
                    const fromHeader = getHeaderValue(headers, 'From');
                    const senderEmail = extractEmailFromFromHeader(fromHeader);

                    let isoId: string | undefined = undefined;
                    if (senderEmail) {
                      try {
                        const isoRes = await dispatch(getIsos()).unwrap();
                        const isoList: any[] = Array.isArray((isoRes as any)?.data)
                          ? (isoRes as any).data
                          : Array.isArray(isoRes)
                            ? (isoRes as any)
                            : [];
                        const matchedIso = isoList.find((iso: any) =>
                          String(iso?.email || '').trim().toLowerCase() === senderEmail
                        );
                        if (matchedIso?.id) {
                          isoId = String(matchedIso.id);
                        }
                      } catch {
                        // Non-blocking; application creation still works without ISO mapping.
                      }
                    }
                    // 1) Get attachments for the selected message
                    const att = await dispatch(getGmailAttachments(selectedMessageId)).unwrap();

                    // Note: current getGmailAttachments returns a single { blob, filename } object
                    if (!att || !att.blob) {
                      toast.error("No attachments found");
                      return;
                    }

                    // Prefer Gmail payload metadata — response headers are often hidden by CORS without exposedHeaders
                    const payloadList = getAttachmentsFromPayload((selectedMessage as any)?.payload);
                    const pdfFromPayload =
                      payloadList.find((a) => a.filename.toLowerCase().endsWith('.pdf')) ||
                      payloadList[0];
                    const nameFromPayload = pdfFromPayload?.filename?.trim();

                    // 2) Convert Blob -> File (assume PDF if filename ends with .pdf)
                    const filename: string =
                      (nameFromPayload && nameFromPayload.length > 0 ? nameFromPayload : null) ||
                      (att.filename && att.filename !== 'attachment' ? att.filename : null) ||
                      'application.pdf';
                    const inferredType = filename.toLowerCase().endsWith('.pdf')
                      ? 'application/pdf'
                      : 'application/octet-stream';
                    const FileCtor = (globalThis as any).File;
                    const file: any = FileCtor
                      ? new FileCtor([att.blob], filename, { type: inferredType })
                      : att.blob;

                    // 3) Send to auto-create (parse + create client/application)
                    const autoCreateResult = await dispatch(
                      parseApplicationPdfForClientPrefill({
                        pdfFile: file,
                        applicationType: isOperationsRole ? "Bypass" : undefined,
                        isoId,
                      }),
                    ).unwrap();

                    try {
                      await dispatch(markGmailMessageInCrmLabel(selectedMessageId)).unwrap();
                      void dispatch(syncGmail({ label: 'INBOX' }));
                    } catch (labelError) {
                      console.warn('Application created but Gmail in-crm label failed:', labelError);
                    }

                    toast.success("Application created successfully");

                    if (isOperationsRole) {
                      const createdApplication =
                        (autoCreateResult as any)?.data?.application;
                      const createdApplicationId =
                        createdApplication?._id ||
                        createdApplication?.id ||
                        createdApplication?.applicationId;

                      if (createdApplicationId) {
                        navigate(`/applications/${String(createdApplicationId)}/contract`);
                      } else {
                        toast.warning("Application created, but unable to open Contract tab automatically.");
                      }
                    }
                  } catch (err) {
                    console.error("Error auto-creating applications:", err);
                    toast.error("Failed to auto-create applications");
                  } finally {
                    setIsBypassProcessing(false);
                  }
                }}
                disabled={autoCreating || isBypassProcessing}
                className="absolute cursor-pointer bottom-6 right-6 z-40 flex items-center gap-2 px-5 py-2.5 bg-[var(--brand)] hover:bg-[var(--brand-hover)] disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg shadow-lg hover:shadow-xl transition-all"
              >
                {autoCreating || isBypassProcessing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <ExternalLink size={16} />
                    {isOperationsRole ? "Bypass Application" : "Send to CRM"}
                  </>
                )}
              </button>

              <div className="flex items-center justify-between p-2.5 border-b border-border bg-muted/30">
                <IconButton icon={<ArrowLeft className="h-5 w-5 opacity-70" />} onClick={() => setViewMode('list')} />
                {/* <div className="flex items-center gap-1">
                  <IconButton icon={<Archive size={18} className="opacity-70" />} />
                  <IconButton icon={<AlertCircle size={18} className="opacity-70" />} />
                  <IconButton icon={<Trash2 size={18} className="opacity-70" />} />
                  <div className="w-[1px] h-5 bg-border mx-1" />
                  <IconButton icon={<Mail size={18} className="opacity-70" />} />
                  <IconButton icon={<Clock size={18} className="opacity-70" />} />
                  <IconButton icon={<Square size={18} className="opacity-70" />} />
                  <div className="w-[1px] h-5 bg-border mx-1" />
                  <IconButton icon={<File size={18} className="opacity-70" />} />
                  <IconButton icon={<MoreVertical size={18} className="opacity-70" />} />
                </div>  */}
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {selectedMessageId ? messages.findIndex(m => m.id === selectedMessageId) + 1 : 0} of {messages.length}
                  </span>
                  <IconButton
                    icon={<ChevronLeft size={16} />}
                    onClick={handlePreviousMessage}
                    className={selectedMessageId && filteredMessages.findIndex(m => m.id === selectedMessageId) <= 0 ? 'opacity-30 cursor-not-allowed' : ''}
                  />
                  <IconButton
                    icon={<ChevronRight size={16} />}
                    onClick={handleNextMessage}
                    className={selectedMessageId && filteredMessages.findIndex(m => m.id === selectedMessageId) >= filteredMessages.length - 1 ? 'opacity-30 cursor-not-allowed' : ''}
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 px-8 bg-card">
                {selectedMessage && (
                  (() => {
                    const headers = (selectedMessage as any)?.payload?.headers as any[] | undefined;
                    const subjectHeader = getHeaderValue(headers, 'Subject');
                    const fromHeader = getHeaderValue(headers, 'From');
                    const dateHeader = getHeaderValue(headers, 'Date');
                    const htmlBody = getHtmlBodyFromPayload((selectedMessage as any)?.payload);
                    const payloadAttachments = getAttachmentsFromPayload((selectedMessage as any)?.payload);
                    const [rawFromName, rawFromEmail] = fromHeader
                      ? fromHeader.split('<')
                      : ['Unknown sender', ''];
                    const fromName = rawFromName.trim();
                    const fromEmail = cleanEmailAddress(rawFromEmail || '');
                    const toHeader = getHeaderValue(headers, 'To');
                    const ccHeader = getHeaderValue(headers, 'Cc');
                    const bccHeader = getHeaderValue(headers, 'Bcc');

                    return (
                      <>
                        <div className="flex items-center justify-between mb-6">
                          <div className="flex items-center gap-4">
                            <h2 className="text-2xl font-normal">
                              {subjectHeader || selectedMessage.subject || '(no subject)'}
                            </h2>
                            <span className="bg-muted text-[11px] px-1.5 rounded text-muted-foreground capitalize">
                              {activeLabel.toLowerCase()}
                            </span>
                          </div>
                          {/* <div className="flex items-center gap-4">
                            <IconButton icon={<Printer size={18} className="opacity-70" />} />
                            <IconButton icon={<ExternalLink size={18} className="opacity-70" />} />
                          </div> */}
                        </div>

                        <div className="flex items-start justify-between mb-8">
                          <div className="flex gap-3">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <User className="opacity-40" />
                            </div>
                            <div className="flex flex-col">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-sm">
                                  {fromName.trim() || 'Unknown sender'}
                                </span>
                                {fromEmail && (
                                  <span className="text-xs opacity-60">
                                    {'<'}
                                    {fromEmail}
                                  </span>
                                )}
                              </div>
                              <div
                                className="text-xs text-muted-foreground mt-0.5 inline-flex items-center gap-1 cursor-pointer hover:opacity-80"
                                onClick={() => setIsRecipientDetailsOpen((prev) => !prev)}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    setIsRecipientDetailsOpen((prev) => !prev);
                                  }
                                }}
                              >
                                to me
                                <ChevronDown
                                  size={14}
                                  className={`inline transition-transform ${isRecipientDetailsOpen ? 'rotate-180' : ''}`}
                                />
                              </div>
                              {isRecipientDetailsOpen && (
                                <div className="mt-2 text-xs text-muted-foreground space-y-1.5 rounded-md bg-muted/40 px-2 py-1.5">
                                  <div>
                                    <span className="font-medium text-foreground/80">From: </span>
                                    <span>{fromHeader || 'N/A'}</span>
                                  </div>
                                  <div>
                                    <span className="font-medium text-foreground/80">To: </span>
                                    <span>{toHeader || 'N/A'}</span>
                                  </div>
                                  {ccHeader && (
                                    <div>
                                      <span className="font-medium text-foreground/80">Cc: </span>
                                      <span>{ccHeader}</span>
                                    </div>
                                  )}
                                  {bccHeader && (
                                    <div>
                                      <span className="font-medium text-foreground/80">Bcc: </span>
                                      <span>{bccHeader}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <span>{dateHeader || selectedMessage.date}</span>
                            {/* <IconButton icon={<Star size={18} />} /> */}
                            {/* <IconButton icon={<Smile size={18} />} />
                            <IconButton icon={<CornerUpLeft size={18} />} onClick={handleReply} />
                            <IconButton icon={<MoreVertical size={18} />} /> */}
                          </div>
                        </div>

                        {loadingDetail ? (
                          <div className="flex items-center justify-center py-12">
                            <div className="text-sm opacity-60">Loading message...</div>
                          </div>
                        ) : detailError ? (
                          <div className="flex items-center justify-center py-12">
                            <div className="text-sm text-red-500">Error loading message: {detailError}</div>
                          </div>
                        ) : (
                          <>
                            <div className="text-sm leading-relaxed mb-6 min-h-[100px] whitespace-pre-wrap">
                              {htmlBody ? (
                                <div
                                  className="prose prose-sm dark:prose-invert max-w-full overflow-x-auto break-words [&_img]:max-w-full [&_table]:w-full"
                                  dangerouslySetInnerHTML={{ __html: htmlBody }}
                                />
                              ) : (
                                selectedMessage.snippet || 'No preview available.'
                              )}
                            </div>

                            {/* Attachments Section */}
                            {payloadAttachments.length > 0 && (
                              <div className="mb-6 border-t border-border pt-4">
                                <div className="flex items-center gap-2 mb-3">
                                  <Paperclip size={16} className="opacity-60" />
                                  <span className="text-sm font-medium">Attachments ({payloadAttachments.length})</span>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                  {payloadAttachments.map((att, index) => (
                                    <div
                                      key={att.attachmentId || index}
                                      className="flex items-center gap-3 p-3 border border-border rounded-lg hover:bg-muted/60 transition-colors group cursor-pointer"
                                      onClick={async () => {
                                        if (!selectedMessageId) return;
                                        try {
                                          const result = await dispatch(getGmailAttachments(selectedMessageId)).unwrap();
                                          const blob = result.blob instanceof Blob
                                            ? result.blob
                                            : new Blob([result.blob], { type: att.mimeType });
                                          const url = window.URL.createObjectURL(blob);
                                          const a = document.createElement('a');
                                          a.href = url;
                                          a.download = att.filename || result.filename || 'attachment';
                                          document.body.appendChild(a);
                                          a.click();
                                          a.remove();
                                          window.URL.revokeObjectURL(url);
                                        } catch (err) {
                                          console.error('Download failed:', err);
                                          toast.error('Failed to download attachment');
                                        }
                                      }}
                                    >
                                      {getFileIcon(att.mimeType, att.filename)}
                                      <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium truncate group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                          {att.filename}
                                        </div>
                                        <div className="text-xs opacity-60">
                                          {formatFileSize(att.size)}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()
                )}

                {/* <div className="flex items-center gap-3">
                  <button onClick={handleReply} className="flex items-center gap-2 px-6 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted">
                    <CornerUpLeft size={18} /> Reply
                  </button>
                  <button className="flex items-center gap-2 px-6 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted">
                    <CornerUpRight size={18} /> Forward
                  </button>
                  <button className="flex items-center gap-2 px-4 py-2.5 border border-border rounded-lg text-sm font-medium hover:bg-muted">
                    <MessageSquare size={18} /> Share in chat <span className="bg-[#0b57d0] text-white text-[10px] px-1.5 rounded-full">New</span>
                  </button>
                </div> */}
              </div>
            </div>
          )}
        </main>

        {/* <aside className="w-14 rounded-xl border border-border bg-card flex flex-col items-center py-4 gap-6 text-muted-foreground">
          <img src="https://www.gstatic.com/companion/icon_assets/calendar_2020q4_2x.png" className="w-5 h-5 cursor-pointer" alt="Cal" />
          <img src="https://www.gstatic.com/companion/icon_assets/keep_2020q4_v3_2x.png" className="w-5 h-5 cursor-pointer" alt="Keep" />
          <img src="https://www.gstatic.com/companion/icon_assets/tasks_2021_2x.png" className="w-5 h-5 cursor-pointer" alt="Tasks" />
          <div className="h-[1px] w-6 bg-border" />
          <Plus className="h-5 w-5 cursor-pointer" />
        </aside> */}
      </div>

      {/* --- COMPOSE WINDOW --- */}
      {isComposeOpen && (
        <div className={`fixed right-8 bottom-0 z-50 w-[510px] shadow-2xl transition-all ${isComposeMinimized ? 'h-10' : 'h-auto'}`}>
          <div className="rounded-t-lg border border-b-0 border-border bg-card">
            <div className="flex items-center justify-between px-3 py-2 rounded-t-lg cursor-pointer bg-muted/50" onClick={() => setIsComposeMinimized(!isComposeMinimized)}>
              <span className="text-[14px] font-medium text-foreground">New Message</span>
              <div className="flex items-center">
                <IconButton
                  icon={<Minus size={16} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsComposeMinimized((prev) => !prev);
                  }}
                />
                <IconButton icon={<Maximize2 size={14} />} />
                <IconButton
                  icon={<X size={16} />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setIsComposeOpen(false);
                  }}
                />
              </div>
            </div>

            {!isComposeMinimized && (
              <div className="flex flex-col">
                <div className="px-4 py-1.5 border-b border-border flex items-center">
                  <span className="text-sm text-muted-foreground w-6">To</span>
                  <input type="text" value={composeTo} onChange={(e) => setComposeTo(e.target.value)} className="flex-1 bg-transparent outline-none text-sm py-1" />
                </div>
                <div className="px-4 border-b border-border">
                  <input type="text" placeholder="Subject" value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} className="w-full bg-transparent outline-none text-sm py-2.5" />
                </div>
                <div className="px-4 py-3 h-72">
                  <textarea value={composeBody} onChange={(e) => setComposeBody(e.target.value)} className="w-full h-full resize-none bg-transparent outline-none text-[14px]" />
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center">
                      <button
                        className="bg-[#1a73e8] hover:bg-[#1557b0] disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-medium px-6 py-2 rounded-full transition-colors"
                        onClick={handleSendCompose}
                        disabled={sendingEmail}
                      >
                        {sendingEmail ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                    {/* <IconButton icon={<Type size={20} />} />
                    <IconButton icon={<Paperclip size={18} />} />
                    <IconButton icon={<Link2 size={18} />} />
                    <IconButton icon={<Smile size={18} />} /> */}
                  </div>
                  {/* <IconButton icon={<Trash2 size={18} />} onClick={() => setIsComposeOpen(false)} /> */}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default GmailPage;