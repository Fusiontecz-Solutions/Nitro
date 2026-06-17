import SvgIcon, { type SvgIconProps } from "@mui/material/SvgIcon";
import Dashboard from "@mui/icons-material/Dashboard";

import People from "@mui/icons-material/People";
import BarChart from "@mui/icons-material/BarChart";
import Settings from "@mui/icons-material/Settings";
import Logout from "@mui/icons-material/Logout";
import Chat from "@mui/icons-material/Chat";
import Description from "@mui/icons-material/Description";
import Email from "@mui/icons-material/Email";

import HighlightOff from "@mui/icons-material/HighlightOff";
import FactCheck from "@mui/icons-material/FactCheck";
import Article from "@mui/icons-material/Article";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Phone from "@mui/icons-material/Phone";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
import { useMemo, type ComponentType } from "react";
import type { Notification } from "@/redux/slices/notificationSlice";
import {
  normalizeRoleKey,
  resolveEffectiveRole,
} from "@/lib/sessionRole";
import { buildOperationsPipelineApplicationsUrl } from "@/constants/dashboardApplicationsNavigation";
import { operationsDashboardStatusTitle } from "@/constants/operationsDashboardApplications";
import {
  getPipelineCountBadgeClass,
  resolveApplicationsPipelineCount,
} from "@/lib/applicationsPipelineFilter";
import { cn } from "@/lib/utils";
import { clearCrmCacheOnLogout } from "@/lib/crmCache";
import { clearApplicationDetail } from "@/redux/slices/applicationSlice";
// import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt';
import PersonAddAlt1Icon from '@mui/icons-material/PersonAddAlt1';
import PersonIcon from '@mui/icons-material/Person';
type SidebarNavIcon = ComponentType<SvgIconProps>;

type PipelineAccent =
  | "contract-pending"
  | "contract-generated"
  | "contract-signed"
  | "final"
  | "funding-call"
  | "disbursement"
  | "funded"
  | "rejected";

type SidebarNavChildItem = {
  label: string;
  operationsStatus: string;
  pipelineAccent: PipelineAccent;
};

type SidebarNavItem = {
  label: string;
  url: string;
  icon: SidebarNavIcon;
  /** When set, links to `/applications``fromDashboard=operations` and this `operationsStatus`. */
  operationsStatus?: string;
  /** Nested contract workflow links shown under a parent row. */
  children?: SidebarNavChildItem[];
  /** Accent + count badge for top-level deal-pipeline rows. */
  pipelineAccent?: PipelineAccent;
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

function isOperationsPipelineItemActive(
  pathname: string,
  searchParams: URLSearchParams,
  operationsStatus: string | undefined,
): boolean {
  if (!operationsStatus) return false;
  return (
    pathname === "/applications" &&
    searchParams.get("fromDashboard") === "operations" &&
    searchParams.get("operationsStatus") === operationsStatus
  );
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

const dealPipelineSection: SidebarNavSection = {
  title: "DEAL PIPELINE",
  items: [
    { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
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
      children: [
        {
          label: operationsDashboardStatusTitle("Contract_Pending"),
          operationsStatus: "Contract_Pending",
          pipelineAccent: "contract-pending",
        },
        {
          label: operationsDashboardStatusTitle("Contract_Generated"),
          operationsStatus: "Contract_Generated",
          pipelineAccent: "contract-generated",
        },
        {
          label: operationsDashboardStatusTitle("Contract_Signed"),
          operationsStatus: "Contract_Signed",
          pipelineAccent: "contract-signed",
        },
      ],
    },
    {
      label: "Final",
      url: "/applications",
      operationsStatus: "Final",
      icon: CheckCircle,
      pipelineAccent: "final",
    },
    {
      label: "Funding Call",
      url: "/applications",
      operationsStatus: "Funding Call",
      icon: Phone,
      pipelineAccent: "funding-call",
    },
    {
      label: "Disbursement",
      url: "/applications",
      operationsStatus: "Disbursment",
      icon: AccountBalance,
      pipelineAccent: "disbursement",
    },
    { label: "Funded", url: "/applications", operationsStatus: "Funded", icon: Paid, pipelineAccent: "funded" },
    { label: "Rejected", url: "/applications", operationsStatus: "Declined", icon: HighlightOff, pipelineAccent: "rejected" },
  ],
};

const operationsSections: SidebarNavSection[] = [
  {
    title: "",
    items: [
      { label: "Overview", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
    ],
  },
  dealPipelineSection,
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
      { label: "Clients", url: "/clients", icon: People },
    ],
  },
  dealPipelineSection,
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
  const operationsSummaryCounts = useSelector(
    (state: RootState) => state.operationsDashboard.summaryCounts,
  );
  const operationsCaseStageCounts = useSelector(
    (state: RootState) => state.operationsDashboard.caseStageCounts,
  );
  const rejectedApplicationCount = useSelector(
    (state: RootState) => state.applicationStats.data?.rejected?.count ?? 0,
  );
  const userRole = resolveEffectiveRole(data?.user);
  const normalizedRole = normalizeRoleKey(userRole);
  const dispatch: AppDispatch = useDispatch();

  const unreadNotificationCount = useMemo(
    () =>
      notifications?.filter((n: Notification) => !n.isRead).length ?? 0,
    [notifications],
  );

  const sidebarSections: SidebarNavSection[] = normalizedRole === "SUPER_ADMIN"
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
      dispatch(clearApplicationDetail());
      clearCrmCacheOnLogout();
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
    ? "w-full h-9 rounded-lg px-2 text-[15px] text-foreground/90 [&_svg]:text-foreground/90 hover:bg-sidebar-accent data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground data-[active=true]:font-medium group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
    : "w-full h-9 rounded-lg px-2 text-[15px] text-muted-foreground [&_svg]:text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground hover:[&_svg]:text-sidebar-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground data-[active=true]:font-medium group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0";

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
                    const childItems = item.children ?? [];
                    const hasChildren = childItems.length > 0;
                    const to =
                      pipelineStatus != null && pipelineStatus !== ""
                        ? buildOperationsPipelineApplicationsUrl(pipelineStatus)
                        : item.url;
                    const isOperationsPipelineView =
                      pathname === "/applications" &&
                      searchParams.get("fromDashboard") === "operations" &&
                      Boolean(searchParams.get("operationsStatus"));
                    const isChildActive = hasChildren
                      ? childItems.some((child) =>
                          isOperationsPipelineItemActive(
                            pathname,
                            searchParams,
                            child.operationsStatus,
                          ),
                        )
                      : false;
                    const isActive = hasChildren
                      ? isChildActive ||
                        isOperationsPipelineItemActive(
                          pathname,
                          searchParams,
                          pipelineStatus,
                        )
                      : pipelineStatus != null && pipelineStatus !== ""
                        ? isOperationsPipelineItemActive(
                            pathname,
                            searchParams,
                            pipelineStatus,
                          )
                        : !item.url || item.url === ""
                          ? false
                          : item.url === "/applications"
                            ? pathname === "/applications" && !isOperationsPipelineView
                            : item.url === "/"
                              ? pathname === "/"
                              : pathname === item.url ||
                                pathname.startsWith(`${item.url}/`);
                    const isNotificationsLink = item.url === "/notifications";
                    const showUnreadBadge =
                      isNotificationsLink && unreadNotificationCount > 0;
                    const badgeLabel =
                      unreadNotificationCount > 9
                        ? "9+"
                        : String(unreadNotificationCount);

                    if (hasChildren) {
                      return (
                        <SidebarMenuItem
                          key={item.label}
                          className="w-full group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center"
                        >
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            className={navButtonClass}
                          >
                            <Link
                              to={to}
                              className="flex w-full min-w-0 items-center gap-2 group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                            >
                              <span className="relative shrink-0">
                                <NavIcon icon={item.icon} />
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                <span className="mr-1 text-muted-foreground" aria-hidden>
                                  •
                                </span>
                                {item.label}
                              </span>
                            </Link>
                          </SidebarMenuButton>
                          <SidebarMenuSub className="mx-1.5 border-l px-2">
                            {childItems.map((child) => {
                              const childTo = buildOperationsPipelineApplicationsUrl(
                                child.operationsStatus,
                              );
                              const childActive = isOperationsPipelineItemActive(
                                pathname,
                                searchParams,
                                child.operationsStatus,
                              );
                              const childCount = resolveApplicationsPipelineCount(
                                child.operationsStatus,
                                operationsSummaryCounts,
                                operationsCaseStageCounts,
                                rejectedApplicationCount,
                              );
                              const showChildCount =
                                childCount != null && childCount > 0;
                              const childCountLabel = String(childCount ?? "");

                              return (
                                <SidebarMenuSubItem key={child.label}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={childActive}
                                    size="md"
                                    className="!h-auto min-h-8 items-center overflow-visible py-1.5 text-sm leading-snug [&>span:last-child]:truncate-none"
                                  >
                                    <Link
                                      to={childTo}
                                      className="flex w-full items-center justify-between gap-2"
                                    >
                                      <span className="min-w-0 flex-1 whitespace-nowrap text-sm">
                                        {child.label}
                                      </span>
                                      {showChildCount ? (
                                        <span
                                          className={cn(
                                            "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
                                            getPipelineCountBadgeClass(),
                                          )}
                                          aria-label={`${childCount} applications in ${child.label}`}
                                        >
                                          {childCountLabel}
                                        </span>
                                      ) : null}
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </SidebarMenuItem>
                      );
                    }

                    const isPipelineItem =
                      pipelineStatus != null && pipelineStatus !== "";
                    const pipelineCount = resolveApplicationsPipelineCount(
                      pipelineStatus,
                      operationsSummaryCounts,
                      operationsCaseStageCounts,
                      rejectedApplicationCount,
                    );
                    const showPipelineCount =
                      pipelineCount != null && pipelineCount > 0;
                    const pipelineCountLabel = String(pipelineCount ?? "");

                    return (
                      <SidebarMenuItem key={item.label} className="w-full group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          className={cn(
                            isNotificationsLink
                              ? `${navButtonClass} overflow-visible [&>span:last-child]:truncate-none data-[active=true]:text-white data-[active=true]:[&_svg]:text-white`
                              : navButtonClass,
                            isPipelineItem
                              ? "!h-auto min-h-9 items-center overflow-visible py-1.5 leading-snug [&>span:last-child]:truncate-none"
                              : undefined,
                          )}
                        >
                          <Link
                            to={to}
                            className="flex w-full min-w-0 items-center gap-2 group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
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
                            ) : isPipelineItem ? (
                              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                                <span className="min-w-0 flex-1 whitespace-nowrap text-sm">
                                  {item.label}
                                </span>
                                {showPipelineCount ? (
                                  <span
                                    className={cn(
                                      "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
                                      getPipelineCountBadgeClass(),
                                    )}
                                    aria-label={`${pipelineCount} applications in ${item.label}`}
                                  >
                                    {pipelineCountLabel}
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
