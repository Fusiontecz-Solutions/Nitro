import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import Dashboard from "@mui/icons-material/Dashboard";

import People from "@mui/icons-material/People";
import BarChart from "@mui/icons-material/BarChart";
import Settings from "@mui/icons-material/Settings";
import Logout from "@mui/icons-material/Logout";
import Chat from "@mui/icons-material/Chat";
import Description from "@mui/icons-material/Description";
import Email from "@mui/icons-material/Email";

import TtyIcon from '@mui/icons-material/Tty';
import FactCheck from "@mui/icons-material/FactCheck";
import Article from "@mui/icons-material/Article";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Payments from "@mui/icons-material/Payments";
import Paid from "@mui/icons-material/Paid";
import AccountBalance from "@mui/icons-material/AccountBalance";
import Notifications from "@mui/icons-material/Notifications";
import PieChart from "@mui/icons-material/PieChart";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import ContentPasteSearchIcon from '@mui/icons-material/ContentPasteSearch';
import {
  Sidebar as UISidebar,
  SidebarHeader,
  SidebarContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
  SidebarFooter,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { logout } from "@/redux/actions/authActions";
import { clearApplicationStats } from "@/redux/slices/applicationSlice";
import { clearPaymentDashboard } from "@/redux/slices/paymentDashboardSlice";
import { resetOperationsDashboard } from "@/redux/slices/operationsDashboardSlice";
import { clearVoiceMicSessionFlags } from "@/voice/microphoneWarmup";
import { toast } from "react-toastify";
import { APP_SHORT_ICON_SRC, APP_SHORT_ICON_DARK_SRC ,resolveAppLogoSrc } from "@/constants/appLogo";
import { useTheme } from "@/context/ThemeContext";
import { useEffect, useMemo, useRef, type ComponentType } from "react";
import type { Notification } from "@/redux/slices/notificationSlice";
import { getNotifications } from "@/redux/actions/notificationActions";
import {
  normalizeRoleKey,
  resolveEffectiveRole,
} from "@/lib/sessionRole";
import { buildOperationsPipelineApplicationsUrl } from "@/constants/dashboardApplicationsNavigation";
import { prefetchApplicationsList } from "@/redux/actions/applicationActions";
import LinearScaleIcon from '@mui/icons-material/LinearScale';
import { APPLICATIONS_LIST_DEFAULT_SORT } from "@/lib/applicationsListParams";
// import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PersonIcon from '@mui/icons-material/Person';
type SidebarNavIcon = ComponentType<SvgIconProps>;

type SidebarNavItem = {
  label: string;
  url: string;
  icon: SidebarNavIcon;
  /** When set, links to `/applications` with `fromDashboard=operations` and this `operationsStatus`. */
  operationsStatus?: string;
};

type SidebarNavSection = {
  title: string;
  items: SidebarNavItem[];
};

/** Emotion + flex/overflow layouts can collapse MUI icons without explicit box metrics. */
const navIconSx: NonNullable<SvgIconProps["sx"]> = {
  fontSize: "1.25rem",
  width: "1.25rem",
  height: "1.25rem",
  minWidth: "1.25rem",
  minHeight: "1.25rem",
  flexShrink: 0,
  display: "block",
  color: "inherit",
};

/** Lucide `screen-share`: monitor + arrow from top-right (syndicators). */
function SyndicatorsSidebarIcon(props: SvgIconProps) {
  const { sx, ...rest } = props;
  return (
    <SvgIcon
      viewBox="0 0 24 24"
      {...rest}
      sx={[
        {
          fill: "none",
          stroke: "currentColor",
          strokeWidth: 2,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        },
        navIconSx,
        ...(sx ? (Array.isArray(sx) ? sx : [sx]) : []),
      ]}
    >
      <path d="M13 3H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3" />
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="m17 8 5-5" />
      <path d="M17 3h5v5" />
    </SvgIcon>
  );
}

function NavIcon({ icon: Icon }: { icon: SidebarNavIcon }) {
  return <Icon sx={navIconSx} />;
}

const agentSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Clients", url: "/clients", icon: People },
      { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
    ],
  },
  {
    title: "INSIGHTS",
    items: [
      { label: "Reports", url: "/reports", icon: Description },
      { label: "Commissions", url: "/commission-portal", icon: BarChart },
    ],
  },
  {
    title: "COMMUNICATIONS",
    items: [
      { label: "Team Chat", url: "/team-chat", icon: Chat },
      { label: "Gmail", url: "/gmail", icon: Email },
    ],
  },
  {
    title: "ACCOUNT",
    items: [{ label: "Settings", url: "/user-setting", icon: Settings }],
  },
];

const finalUnderwriterSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
    ],
  },
  {
    title: "COMMUNICATIONS",
    items: [{ label: "Team Chat", url: "/team-chat", icon: Chat }],
  },
  {
    title: "ACCOUNT",
    items: [{ label: "Settings", url: "/user-setting", icon: Settings }],
  },
];

const operationsSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Overview", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Deals Pipeline", url: "/deal-pipeline", icon: LinearScaleIcon },
      { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
    ],
  },
  {
    title: "OPERATIONS",
    items: [
      { label: "Reports", url: "/reports", icon: Description },
      { label: "Syndicators", url: "/syndicators/dashboard", icon: SyndicatorsSidebarIcon },
      { label: "Commissions", url: "/commission-portal", icon: BarChart },
      { label: "Accountant", url: "/payments", icon: Payments },
    ],
  },
  {
    title: "COMMUNICATIONS",

    items: [{ label: "Team Chat", url: "/team-chat", icon: Chat }, { label: "Gmail", url: "/gmail", icon: Email }],
  },
  {
    title: "ACCOUNT",
    items: [{ label: "Settings", url: "/user-setting", icon: People }],
  },
];

const accountsSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Accountant", url: "/payments", icon: Payments },
    ],
  },
];

const uwSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Clients", url: "/clients", icon: People },
      { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
     
      
    ],
  },
  {
    title: "COMMUNICATIONS",
    items: [{ label: "Team Chat", url: "/team-chat", icon: Chat }],
  },
  {
    title: "ACCOUNT",
    items: [{ label: "Settings", url: "/user-setting", icon: Settings }],
  },
];

const syndicatorSections: SidebarNavSection[] = [
  {
    title: "",
    items: [{ label: "Dashboard", url: "/", icon: Dashboard }],
  },
  {
    title: "PORTFOLIO",
    items: [
      { label: "Payouts", url: "/syndicator-payouts", icon: People },
      { label: "Funding", url: "/syndicator-funding", icon: InsertDriveFileIcon },
      { label: "Portfolio", url: "/syndicator-portfolio", icon: PieChart },
    ],
  },
  {
    title: "ACCOUNT",
    items: [{ label: "Setting", url: "/user-setting", icon: People }],
  },
];

const adminSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
    ],
  },
  {
    title: "MANAGEMENT",
    items: [
      { label: "Agents", url: "/agents", icon: PersonIcon },
      { label: "Clients", url: "/clients", icon: People },
      { label: "Syndicators", url: "/syndicators/dashboard", icon: SyndicatorsSidebarIcon },
      { label: "Underwriters", url: "/underwriters", icon: ContentPasteSearchIcon },
      { label: "Final Underwriters", url: "/final-underwriters", icon: People },
    ],
  },
  {
    title: "REPORTS & COMMISSIONS",
    items: [
      { label: "Commissions", url: "/commission-portal", icon: BarChart },
      { label: "Reports", url: "/reports", icon: Description },
    ],
  },
  {
    title: "COMMUNICATIONS",
    items: [
      { label: "Team Chat", url: "/team-chat", icon: Chat },
      { label: "Gmail", url: "/gmail", icon: Email },
    ],
  },
  {
    title: "SYSTEM",
    items: [{ label: "Settings", url: "/settings", icon: Settings }],
  },
];

const superAdminSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Deals Pipeline", url: "/deal-pipeline", icon: LinearScaleIcon },
      { label: "Clients", url: "/clients", icon: People },
      { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
    ],
  },
  {
    title: "DEAL PIPELINE",
    items: [
      { label: "Agent", url: "/applications", operationsStatus: "Agent", icon: PersonIcon },
      { label: "Underwriter", url: "/applications", operationsStatus: "Underwriter", icon: ContentPasteSearchIcon },
      {
        label: "Final Underwriter",
        url: "/applications",
        operationsStatus: "Final Underwriter",
        icon: FactCheck,
      },
      {
        label: "Contract",
        url: "/applications",
        operationsStatus: "Contracted",
        icon: Article,
      },
      { label: "Final", url: "/applications", operationsStatus: "Final", icon: CheckCircle },
      {
        label: "Funding call",
        url: "/applications",
        operationsStatus: "Funding Call",
        icon: TtyIcon,
      },
      {
        label: "Disbursement",
        url: "/applications",
        operationsStatus: "Disbursment",
        icon: AccountBalance,
      },
      { label: "Funded", url: "/applications", operationsStatus: "Funded", icon: Paid },
    ],
  },
  {
    title: "MANAGEMENT",
    items: [
      { label: "Agents", url: "/agents", icon: PersonIcon },
      { label: "Underwriters", url: "/underwriters", icon: ContentPasteSearchIcon },
      { label: "Final Underwriters", url: "/final-underwriters", icon: People },
      { label: "Syndicators", url: "/syndicators/dashboard", icon: SyndicatorsSidebarIcon },
    ],
  },
  {
    title: "OPERATIONS",
    items: [
      { label: "Accountant", url: "/payments", icon: Payments },
      { label: "Commission", url: "/commission-portal", icon: BarChart },
      { label: "Reports", url: "/reports", icon: Description },
    ],
  },
  {
    title: "COMMUNICATIONS",
    items: [
      { label: "Gmail", url: "/gmail", icon: Email },
      { label: "Team Chat", url: "/team-chat", icon: Chat },
    ],
  },
  {
    title: "ACCOUNT",
    items: [
      { label: "Invite Members", url: "/settings", icon: PersonAddAlt1Icon },
      { label: "Settings", url: "/user-setting", icon: Settings },
    ],
  },
];

function getRoleSections(role: string): SidebarNavSection[] {
  const key = normalizeRoleKey(role);
  switch (key) {
    case "ADMIN":
      return adminSections;
    case "AGENT":
      return agentSections;
    case "SYNDICATOR":
      return syndicatorSections;
    case "OPERATIONS":
      return operationsSections;
    case "FINAL_UNDERWRITER":
      return finalUnderwriterSections;
    case "UNDERWRITER":
      return uwSections;
    case "ACCOUNTS":
      return accountsSections;
    default:
      return agentSections;
  }
}

const Sidebar = () => {
  const NOTIFICATIONS_POLL_INTERVAL_MS = 15000;
  const { state } = useSidebar();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const isCollapsed = state === "collapsed";

  const { data } = useSelector((state: RootState) => state.login);
  const { data: notifications } = useSelector(
    (state: RootState) => state.notifications,
  );
  const userRole = resolveEffectiveRole(data?.user);
  const normalizedRole = normalizeRoleKey(userRole);
  const isSuperAdmin = normalizedRole === "SUPER_ADMIN";
  const dispatch: AppDispatch = useDispatch();
  const isNotificationsFetchInFlightRef = useRef(false);

  const unreadNotificationCount = useMemo(
    () =>
      notifications?.filter((n: Notification) => !n.isRead).length ?? 0,
    [notifications],
  );

  const notificationInboxParams = useMemo(
    () => ({
      limit: 50,
      ...(isSuperAdmin ? { personalOnly: true as const } : {}),
    }),
    [isSuperAdmin],
  );

  useEffect(() => {
    void dispatch(getNotifications(notificationInboxParams));
  }, [dispatch, notificationInboxParams]);

  useEffect(() => {
    const pollNotifications = () => {
      if (document.visibilityState !== "visible") return;
      if (isNotificationsFetchInFlightRef.current) return;
      isNotificationsFetchInFlightRef.current = true;
      void dispatch(getNotifications(notificationInboxParams)).finally(() => {
        isNotificationsFetchInFlightRef.current = false;
      });
    };

    // Refresh quickly when user returns to the tab/window.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        pollNotifications();
      }
    };

    const intervalId = window.setInterval(
      pollNotifications,
      NOTIFICATIONS_POLL_INTERVAL_MS,
    );
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [dispatch, notificationInboxParams]);

  const sidebarSections: SidebarNavSection[] = isSuperAdmin
    ? superAdminSections
    : getRoleSections(userRole);

  const navigate = useNavigate();

  const handleLogout = async () => {
    try {
      const res = await dispatch(logout()).unwrap();
      if (res?.success) {
        toast.success(res.message);
      } else {
        toast.error(res?.message || "Logout failed");
      }
    } catch (err: unknown) {
      const message =
        typeof err === "string" ? err : (err as any)?.message;
      toast.error(message || "Logout failed");
    } finally {
      // Always clear client-side auth state to prevent "stuck" sessions.
      dispatch(clearApplicationStats());
      dispatch(clearPaymentDashboard());
      dispatch(resetOperationsDashboard());
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("role");
      clearVoiceMicSessionFlags();
      navigate("/login", { replace: true });
    }
  };

  const sidebarShell = isDark
    ? "bg-background border-r border-border"
    : "bg-sidebar border-r border-sidebar-border";

  const sectionHeadingClass =
    "mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground group-data-[collapsible=icon]:hidden";

  const mainSidebarTitleClass =
    "mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground group-data-[collapsible=icon]:hidden";

  const navButtonClass = isDark
    ? "w-full h-9 rounded-lg px-2 text-foreground/90 [&_svg]:text-foreground/90 hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground data-[active=true]:font-medium group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    : "w-full h-9 rounded-lg px-2 text-muted-foreground [&_svg]:text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground hover:[&_svg]:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground data-[active=true]:font-medium group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0";

  const logoutButtonClass = isDark
    ? "w-full h-9 cursor-pointer rounded-lg px-2 text-foreground hover:bg-sidebar-accent [&_svg]:text-foreground"
    : "w-full h-9 cursor-pointer rounded-lg px-2 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-sidebar-foreground";

  return (
    <UISidebar collapsible="icon" side="left">

      <div
        className={`flex h-full min-h-0 flex-col ${sidebarShell}`}
        data-sidebar-scrollbar="default"
      >
        <SidebarHeader className="p-4 mt-5 pb-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
          <div className="flex items-center justify-between">
            <div className="flex flex-col justify-center leading-tight">
              <img
                src={
                  isCollapsed
                    ? isDark
                      ? APP_SHORT_ICON_DARK_SRC
                      : APP_SHORT_ICON_SRC
                    : resolveAppLogoSrc(isDark)
                }
                alt="Company logo"
                className={`block object-contain ${isCollapsed ? "h-8 w-8 shrink-0" : "h-26 w-auto max-w-full"}`}
              />
            </div>
          </div>
          <p className={mainSidebarTitleClass}>Main</p>
        </SidebarHeader>
        <SidebarContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 pb-2 pt-0 group-data-[collapsible=icon]:overflow-auto group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <div className="w-full space-y-5 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-auto">
            {sidebarSections.map((section, sectionIndex) => (
              <div
                key={`${section.title || "section"}-${sectionIndex}`}
                className="w-full"
              >
                {section.title ? (
                  <p className={sectionHeadingClass}>{section.title}</p>
                ) : null}
                <SidebarMenu className="flex flex-col items-stretch gap-0.5 group-data-[collapsible=icon]:items-center">
                  {section.items.map((item) => {
                    const pipelineStatus = item.operationsStatus;
                    const to =
                      pipelineStatus != null && pipelineStatus !== ""
                        ? buildOperationsPipelineApplicationsUrl(pipelineStatus)
                        : item.url;
                    const isPipeline =
                      pipelineStatus != null && pipelineStatus !== "";
                    const isOperationsPipelineView =
                      pathname === "/applications" &&
                      searchParams.get("fromDashboard") === "operations" &&
                      Boolean(searchParams.get("operationsStatus"));
                    const isActive = isPipeline
                      ? pathname === "/applications" &&
                      searchParams.get("fromDashboard") === "operations" &&
                      searchParams.get("operationsStatus") === pipelineStatus
                      : !item.url || item.url === ""
                        ? false
                        : item.url === "/applications"
                          ? pathname === "/applications" && !isOperationsPipelineView
                          : item.url === "/"
                            ? pathname === "/"
                            : pathname === item.url ||
                            pathname.startsWith(`${item.url}/`);
                    const isNotificationsLink = item.url === "/notifications";
                    const isApplicationsListLink =
                      !isPipeline && item.url === "/applications";
                    const showUnreadBadge =
                      isNotificationsLink && unreadNotificationCount > 0;
                    const badgeLabel =
                      unreadNotificationCount > 9
                        ? "9+"
                        : String(unreadNotificationCount);

                    return (
                      <SidebarMenuItem key={item.label} className="w-full group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          className={
                            isNotificationsLink
                              ? `${navButtonClass} overflow-visible [&>span:last-child]:truncate-none data-[active=true]:text-white data-[active=true]:[&_svg]:text-white`
                              : navButtonClass
                          }
                        >
                          <Link
                            to={to}
                            className="flex w-full min-w-0 items-center gap-2 group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                            onMouseEnter={() => {
                              if (isPipeline && pipelineStatus) {
                                prefetchApplicationsList({
                                  page: 1,
                                  limit: 10,
                                  operationsStatus: pipelineStatus,
                                  ...APPLICATIONS_LIST_DEFAULT_SORT,
                                });
                                return;
                              }
                              if (isApplicationsListLink) {
                                prefetchApplicationsList({
                                  page: 1,
                                  limit: 10,
                                  ...APPLICATIONS_LIST_DEFAULT_SORT,
                                });
                              }
                            }}
                            onFocus={() => {
                              if (isPipeline && pipelineStatus) {
                                prefetchApplicationsList({
                                  page: 1,
                                  limit: 10,
                                  operationsStatus: pipelineStatus,
                                  ...APPLICATIONS_LIST_DEFAULT_SORT,
                                });
                                return;
                              }
                              if (isApplicationsListLink) {
                                prefetchApplicationsList({
                                  page: 1,
                                  limit: 10,
                                  ...APPLICATIONS_LIST_DEFAULT_SORT,
                                });
                              }
                            }}
                          >
                            <span className="relative shrink-0">
                              <NavIcon icon={item.icon} />
                              {showUnreadBadge && isCollapsed ? (
                                <span
                                  className="absolute -right-1 -top-0.5 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-0.5 text-[10px] font-bold leading-none !text-white shadow-sm"
                                  aria-hidden
                                >
                                  {badgeLabel}
                                </span>
                              ) : null}
                            </span>
                            {isNotificationsLink ? (
                              <span className="flex min-w-0 flex-1 items-center gap-2">
                                <span className="min-w-0 flex-1 truncate">
                                  {item.label}
                                </span>
                                {showUnreadBadge && !isCollapsed ? (
                                  <span
                                    className="shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[13px] font-semibold leading-none !text-white tabular-nums"
                                    aria-label={`${unreadNotificationCount} unread notifications`}
                                  >
                                    {badgeLabel}
                                  </span>
                                ) : null}
                              </span>
                            ) : (
                              <span className="min-w-0 flex-1 truncate">
                                {item.label}
                              </span>
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </div>
            ))}
          </div>
        </SidebarContent>
        <SidebarFooter className="mt-auto p-4 pt-2">
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={handleLogout}
                  className={logoutButtonClass}
                >
                  <Logout sx={navIconSx} />
                  <span>Logout</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarFooter>
      </div>
    </UISidebar>
  );
}

export default Sidebar;
