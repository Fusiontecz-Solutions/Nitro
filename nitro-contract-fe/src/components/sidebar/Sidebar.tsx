import type { SvgIconProps } from "@mui/material/SvgIcon";
import Logout from "@mui/icons-material/Logout";
import Article from "@mui/icons-material/Article";
import DeleteOutline from "@mui/icons-material/DeleteOutline";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import People from "@mui/icons-material/People";
import Dashboard from "@mui/icons-material/Dashboard";
import Settings from "@mui/icons-material/Settings";
import Notifications from "@mui/icons-material/Notifications";
import MailOutline from "@mui/icons-material/MailOutline";
import FactCheck from "@mui/icons-material/FactCheck";
import ManageAccounts from "@mui/icons-material/ManageAccounts";
import AddCircleOutline from "@mui/icons-material/AddCircleOutline";
import Inbox from "@mui/icons-material/Inbox";
import AssignmentInd from "@mui/icons-material/AssignmentInd";
import Replay from "@mui/icons-material/Replay";
import Email from "@mui/icons-material/Email";
import History from "@mui/icons-material/History";
import SpaceDashboard from "@mui/icons-material/SpaceDashboard";
import SupportAgent from "@mui/icons-material/SupportAgent";
import Gavel from "@mui/icons-material/Gavel";
import { resolveEffectiveRole } from "@/lib/sessionRole";
import { isAgentRole, isSuperAdminAppRole, isUnderwriterRole, isWorkflowRole } from "@/lib/roleAccess";
import { useQuery } from "@tanstack/react-query";
import { fetchWorkflowSummary, type WorkflowScope } from "@/lib/workflowApi";
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
import { Link, useLocation, useSearchParams } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";
import { fetchOperationsDashboardSummary } from "@/redux/actions/operationsDashboardActions";
import { useLogout } from "@/hooks/useLogout";
import { APP_SHORT_ICON_SRC, APP_SHORT_ICON_DARK_SRC, resolveAppLogoSrc } from "@/constants/appLogo";
import { useTheme } from "@/context/ThemeContext";
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import { cn } from "@/lib/utils";
import { ChevronRight, Loader2 } from "lucide-react";
import { axiosGet } from "@/redux/axios";
import { buildOperationsPipelineApplicationsUrl } from "@/constants/dashboardApplicationsNavigation";
import { prefetchCrmPage } from "@/lib/prefetchCrmPage";
import {
  getPipelineCountBadgeClass,
  resolveApplicationsPipelineCount,
} from "@/lib/applicationsPipelineFilter";
import type { Notification } from "@/redux/slices/notificationSlice";

type SidebarNavIcon = ComponentType<SvgIconProps>;

type SidebarNavChildItem = {
  label: string;
  /** Pipeline stage child (e.g. Contract → Pending / Sent / Signed). */
  operationsStatus?: string;
  /** Absolute or relative path including optional query (Settings tabs). */
  url?: string;
  icon?: SidebarNavIcon;
};

type SidebarNavItem = {
  label: string;
  url: string;
  icon: SidebarNavIcon;
  operationsStatus?: string;
  children?: SidebarNavChildItem[];
  /** Parent row toggles its children (arrow) instead of navigating. */
  collapsible?: boolean;
};

type SidebarNavSection = {
  title: string;
  items: SidebarNavItem[];
};

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

function NavIcon({ icon: Icon }: { icon: SidebarNavIcon }) {
  return <Icon sx={navIconSx} />;
}

/**
 * Sidebar layout matching product screenshots:
 * MAIN → Dashboard / Notifications / Clients
 * DEAL PIPELINE → Applications + Contract stages
 * SETTINGS → Settings (Profile / DocuSign / Funders tabs live on the page)
 */
const sidebarSections: SidebarNavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Clients", url: "/clients", icon: People },
      { label: "Letters", url: "/letter-generator", icon: MailOutline },
    ],
  },
  {
    title: "DEAL PIPELINE",
    items: [
      { label: "Applications", url: "/applications", icon: InsertDriveFileIcon },
      {
        label: "Contract",
        url: "/applications",
        operationsStatus: "Contracted",
        icon: Article,
        children: [
          {
            label: "Pending",
            operationsStatus: "Contract_Pending",
          },
          {
            label: "Sent",
            operationsStatus: "Contract_Sent",
          },
          {
            label: "Signed",
            operationsStatus: "Contract_Signed",
          },
        ],
      },
      {
        label: "Recently Deleted",
        url: "/applications",
        operationsStatus: "Recently_Deleted",
        icon: DeleteOutline,
      },
    ],
  },
  {
    title: "SETTINGS",
    items: [
      {
        label: "Settings",
        url: "/user-setting",
        icon: Settings,
      },
      { label: "Team & Roles", url: "/user-setting?tab=team", icon: ManageAccounts },
    ],
  },
];

const workflowSettingsSection: SidebarNavSection = {
  title: "SETTINGS",
  items: [
    { label: "Settings", url: "/user-setting", icon: Settings },
  ],
};

const agentSections: SidebarNavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "New Application", url: "/create-applications", icon: AddCircleOutline },
    ],
  },
  {
    title: "MY APPLICATIONS",
    items: [
      { label: "All Applications", url: "/pipeline?bucket=all", icon: InsertDriveFileIcon },
      { label: "Awaiting My Approval", url: "/pipeline?bucket=awaiting_my_approval", icon: FactCheck },
      { label: "Sent to ISO", url: "/pipeline?bucket=sent_to_iso", icon: MailOutline },
      { label: "Contract Pending", url: "/pipeline?bucket=contract_pending", icon: Article },
    ],
  },
  {
    title: "COMMUNICATIONS",
    items: [{ label: "Gmail", url: "/gmail", icon: Email }],
  },
  workflowSettingsSection,
];

const underwriterSections: SidebarNavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
    ],
  },
  {
    title: "UNDERWRITING",
    items: [
      { label: "Incoming", url: "/pipeline?bucket=incoming", icon: Inbox },
      { label: "My Claimed", url: "/pipeline?bucket=my_claimed", icon: AssignmentInd },
      { label: "Needs Re-Review", url: "/pipeline?bucket=needs_re_review", icon: Replay },
      { label: "Sent to Agent", url: "/pipeline?bucket=sent_to_agent", icon: FactCheck },
      { label: "Completed", url: "/pipeline?bucket=completed", icon: Article },
    ],
  },
  workflowSettingsSection,
];

/**
 * Super Admin: one DEAL PIPELINE hierarchy — All Applications, then Agent / Underwriter /
 * Contract groups that expand (arrow) to their stages — plus Super Admin-only modules.
 */
const superAdminSections: SidebarNavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Clients", url: "/clients", icon: People },
      { label: "Letters", url: "/letter-generator", icon: MailOutline },
      { label: "New Application", url: "/create-applications", icon: AddCircleOutline },
    ],
  },
  {
    title: "DEAL PIPELINE",
    items: [
      { label: "All Applications", url: "/applications", icon: InsertDriveFileIcon },
      {
        label: "Agent",
        url: "/workflow-dashboard?scope=agent",
        icon: SupportAgent,
        collapsible: true,
        children: [
          { label: "All Applications", url: "/pipeline?scope=agent&bucket=all", icon: InsertDriveFileIcon },
          { label: "Awaiting My Approval", url: "/pipeline?scope=agent&bucket=awaiting_my_approval", icon: FactCheck },
          { label: "Sent to ISO", url: "/pipeline?scope=agent&bucket=sent_to_iso", icon: MailOutline },
          { label: "Contract Pending", url: "/pipeline?scope=agent&bucket=contract_pending", icon: Article },
        ],
      },
      {
        label: "Underwriter",
        url: "/workflow-dashboard?scope=underwriter",
        icon: Gavel,
        collapsible: true,
        children: [
          { label: "Dashboard", url: "/workflow-dashboard?scope=underwriter", icon: SpaceDashboard },
          { label: "Incoming", url: "/pipeline?scope=underwriter&bucket=incoming", icon: Inbox },
          { label: "Claimed", url: "/pipeline?scope=underwriter&bucket=my_claimed", icon: AssignmentInd },
          { label: "Needs Re-Review", url: "/pipeline?scope=underwriter&bucket=needs_re_review", icon: Replay },
          { label: "Sent to Agent", url: "/pipeline?scope=underwriter&bucket=sent_to_agent", icon: FactCheck },
          { label: "Completed", url: "/pipeline?scope=underwriter&bucket=completed", icon: Article },
        ],
      },
      {
        label: "Contract",
        url: "/applications",
        operationsStatus: "Contracted",
        icon: Article,
        collapsible: true,
        children: [
          { label: "Pending", operationsStatus: "Contract_Pending" },
          { label: "Sent", operationsStatus: "Contract_Sent" },
          { label: "Signed", operationsStatus: "Contract_Signed" },
        ],
      },
      {
        label: "Recently Deleted",
        url: "/applications",
        operationsStatus: "Recently_Deleted",
        icon: DeleteOutline,
      },
    ],
  },
  {
    title: "COMMUNICATIONS",
    items: [
      { label: "Gmail", url: "/gmail", icon: Email },
      { label: "Activity Logs", url: "/activity-logs", icon: History },
    ],
  },
  {
    title: "SETTINGS",
    items: [
      { label: "Settings", url: "/user-setting", icon: Settings },
      { label: "Team & Roles", url: "/user-setting?tab=team", icon: ManageAccounts },
    ],
  },
];

const EXPANDED_GROUPS_STORAGE_KEY = "sidebar:expanded-groups";

function readExpandedGroups(): Record<string, boolean> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_GROUPS_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

function writeExpandedGroups(groups: Record<string, boolean>) {
  try {
    window.localStorage.setItem(EXPANDED_GROUPS_STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // Storage unavailable (private window) — expansion just isn't remembered.
  }
}

/** Live (not deleted) application total, read from the list endpoint's pagination. */
async function fetchApplicationsTotal(): Promise<number> {
  const response = await axiosGet("/applications?page=1&limit=1", { skipCache: true });
  const p = (response.data as { pagination?: { totalItems?: number; total?: number } })?.pagination;
  return Number(p?.totalItems ?? p?.total ?? 0);
}

function sectionsForRole(role: string): SidebarNavSection[] {
  if (isSuperAdminAppRole(role)) return superAdminSections;
  if (isAgentRole(role)) return agentSections;
  if (isUnderwriterRole(role)) return underwriterSections;
  return sidebarSections;
}

/** `/pipeline` and `/workflow-dashboard` links with `?bucket=` / `?scope=`: active only for the matching query value. */
function isPipelineHrefActive(pathname: string, searchParams: URLSearchParams, href: string): boolean {
  const target = parseNavHref(href);
  if (pathname !== target.pathname) return false;
  for (const key of ["bucket", "scope"]) {
    const wanted = target.searchParams.get(key);
    if (wanted && (searchParams.get(key) || (key === "scope" ? "agent" : "")) !== wanted) return false;
  }
  return true;
}

function buildChildHref(child: SidebarNavChildItem): string {
  if (child.url) return child.url;
  if (child.operationsStatus) {
    return buildOperationsPipelineApplicationsUrl(child.operationsStatus);
  }
  return "#";
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

function parseNavHref(href: string): { pathname: string; searchParams: URLSearchParams } {
  const [pathPart, queryPart = ""] = href.split("?");
  return {
    pathname: pathPart || "/",
    searchParams: new URLSearchParams(queryPart),
  };
}

function isSettingsTabHrefActive(
  pathname: string,
  searchParams: URLSearchParams,
  href: string,
): boolean {
  const target = parseNavHref(href);
  if (pathname !== target.pathname && !pathname.startsWith(`${target.pathname}/`)) {
    return false;
  }
  if (target.pathname !== "/user-setting") {
    return pathname === target.pathname || pathname.startsWith(`${target.pathname}/`);
  }
  const currentTab = (searchParams.get("tab") || "profile").toLowerCase();
  const targetTab = (target.searchParams.get("tab") || "profile").toLowerCase();
  return currentTab === targetTab;
}

function isChildNavActive(
  pathname: string,
  searchParams: URLSearchParams,
  child: SidebarNavChildItem,
): boolean {
  if (child.operationsStatus) {
    return isOperationsPipelineItemActive(pathname, searchParams, child.operationsStatus);
  }
  if (child.url?.startsWith("/pipeline") || child.url?.startsWith("/workflow-dashboard")) {
    return isPipelineHrefActive(pathname, searchParams, child.url);
  }
  if (child.url) {
    return isSettingsTabHrefActive(pathname, searchParams, child.url);
  }
  return false;
}

function buildNavHref(item: SidebarNavItem): string {
  if (item.operationsStatus) {
    return buildOperationsPipelineApplicationsUrl(item.operationsStatus);
  }
  return item.url;
}

function isNavItemActive(
  pathname: string,
  searchParams: URLSearchParams,
  item: SidebarNavItem,
): boolean {
  if (item.url === "/") {
    return pathname === "/";
  }

  if (item.collapsible) {
    return (item.children ?? []).some((child) => isChildNavActive(pathname, searchParams, child)) ||
      isOperationsPipelineItemActive(pathname, searchParams, item.operationsStatus);
  }

  if (item.url === "/clients") {
    return pathname === "/clients" || pathname.startsWith("/create-clients");
  }

  if (item.url === "/gmail") {
    return pathname === "/gmail";
  }

  if (item.url === "/notifications") {
    return pathname === "/notifications" || pathname.startsWith("/notifications/");
  }

  if (item.url === "/letter-generator") {
    return pathname === "/letter-generator" || pathname.startsWith("/letter-generator/");
  }

  if (item.url === "/user-setting") {
    return (
      (pathname === "/user-setting" || pathname.startsWith("/user-setting/")) &&
      !["email", "team"].includes((searchParams.get("tab") || "").toLowerCase())
    );
  }

  if (item.url.startsWith("/pipeline") || item.url.startsWith("/workflow-dashboard")) {
    return isPipelineHrefActive(pathname, searchParams, item.url);
  }

  if (item.url === "/create-applications") {
    return pathname === "/create-applications" || pathname.startsWith("/create-applications/");
  }

  const childItems = item.children ?? [];
  if (childItems.length > 0) {
    return (
      childItems.some((child) => isChildNavActive(pathname, searchParams, child)) ||
      isOperationsPipelineItemActive(pathname, searchParams, item.operationsStatus)
    );
  }

  const currentWorkflow = searchParams.get("workflow");
  const isOpsView =
    pathname === "/applications" &&
    searchParams.get("fromDashboard") === "operations" &&
    Boolean(searchParams.get("operationsStatus"));

  if (item.operationsStatus) {
    return isOperationsPipelineItemActive(pathname, searchParams, item.operationsStatus);
  }

  // Applications — list without workflow / ops stage filter
  if (item.url === "/applications" && !item.operationsStatus) {
    return (
      (pathname === "/applications" && !currentWorkflow && !isOpsView) ||
      pathname.startsWith("/create-applications")
    );
  }

  if (item.url.includes("?")) {
    return isSettingsTabHrefActive(pathname, searchParams, item.url);
  }

  return pathname === item.url || pathname.startsWith(`${item.url}/`);
}

const Sidebar = () => {
  const { state } = useSidebar();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const isCollapsed = state === "collapsed";
  const dispatch: AppDispatch = useDispatch();

  const { data: notifications } = useSelector(
    (state: RootState) => state.notifications,
  );
  const operationsSummaryCounts = useSelector(
    (state: RootState) => state.operationsDashboard.summaryCounts,
  );
  const lastSummaryFetchedAt = useSelector(
    (state: RootState) => state.operationsDashboard.lastSummaryFetchedAt,
  );
  const operationsCaseStageCounts = useSelector(
    (state: RootState) => state.operationsDashboard.caseStageCounts,
  );
  const rejectedApplicationCount = useSelector(
    (state: RootState) => state.applicationStats.data?.rejected?.count ?? 0,
  );

  const unreadNotificationCount = useMemo(
    () => notifications?.filter((n: Notification) => !n.isRead).length ?? 0,
    [notifications],
  );

  const sessionRole = resolveEffectiveRole(undefined);
  const workflowViewer = isWorkflowRole(sessionRole);
  const superAdmin = isSuperAdminAppRole(sessionRole);
  const navSections = useMemo(() => sectionsForRole(sessionRole), [sessionRole]);

  // Agent / Underwriter queue badges (same query + cache key as the dashboard, all-time range).
  // Super Admin sees both workflows, so it loads both scopes.
  const summaryQuery = (scope: WorkflowScope, enabled: boolean) => ({
    queryKey: ["workflow-summary", scope, "", ""],
    queryFn: () => fetchWorkflowSummary(scope, { startDate: "", endDate: "" }),
    enabled,
    staleTime: 15_000,
    // Socket / focus / fallback-poll refreshes all come from PipelineCountsSync,
    // which invalidates this key; a second poll here only doubled the traffic.
    refetchOnWindowFocus: false,
  });
  const agentSummary = useQuery(summaryQuery("agent", superAdmin || isAgentRole(sessionRole)));
  const underwriterSummary = useQuery(summaryQuery("underwriter", superAdmin || isUnderwriterRole(sessionRole)));
  const workflowBucketCount = (url: string): number | null => {
    if ((!workflowViewer && !superAdmin) || !url.startsWith("/pipeline?")) return null;
    const params = new URLSearchParams(url.split("?")[1]);
    const bucket = params.get("bucket");
    if (!bucket) return null;
    const scope = params.get("scope") ?? (isUnderwriterRole(sessionRole) ? "underwriter" : "agent");
    const summary = scope === "underwriter" ? underwriterSummary.data : agentSummary.data;
    const n = summary?.counts?.[bucket];
    return typeof n === "number" ? n : null;
  };

  // Super Admin "All Applications" badge — same total the Applications list paginates over.
  const applicationsTotal = useQuery({
    queryKey: ["sidebar-applications-total"],
    queryFn: fetchApplicationsTotal,
    enabled: superAdmin,
    staleTime: 15_000,
    // Refreshed by PipelineCountsSync (invalidates ["sidebar-applications-total"]).
    refetchOnWindowFocus: false,
  });

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(readExpandedGroups);
  const toggleGroup = useCallback((label: string, currentlyOpen: boolean) => {
    setExpandedGroups((prev) => {
      const next = { ...prev, [label]: !currentlyOpen };
      writeExpandedGroups(next);
      return next;
    });
  }, []);

  useEffect(() => {
    // Contract pipeline counts are a Super Admin concern — Agents / Underwriters use workflow counts.
    if (workflowViewer) return;
    if (lastSummaryFetchedAt && Date.now() - lastSummaryFetchedAt < 60_000) return;
    void dispatch(fetchOperationsDashboardSummary());
  }, [dispatch, lastSummaryFetchedAt, workflowViewer]);

  const { loggingOut, handleLogout } = useLogout();

  const sidebarShell = isDark
    ? "bg-background border-r border-border"
    : "bg-sidebar border-r border-sidebar-border";

  const sectionHeadingClass =
    "mb-2 px-2 text-sm font-bold uppercase tracking-wider text-muted-foreground group-data-[collapsible=icon]:hidden";

  const navHoverClass =
    "hover:text-primary hover:[&_svg]:text-primary hover:[&_*]:text-primary";

  const navButtonClass = isDark
    ? `w-full h-9 rounded-lg px-2 text-[15px] text-foreground/90 [&_svg]:text-foreground/90 hover:bg-sidebar-accent ${navHoverClass} data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground data-[active=true]:font-medium group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0`
    : `w-full h-9 rounded-lg px-2 text-[15px] text-muted-foreground [&_svg]:text-muted-foreground hover:bg-sidebar-accent/60 ${navHoverClass} data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground data-[active=true]:[&_svg]:text-sidebar-accent-foreground data-[active=true]:font-medium group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0`;

  const subNavButtonClass = `!h-auto min-h-8 items-center overflow-visible py-1.5 text-sm leading-snug [&>span:last-child]:truncate-none hover:bg-sidebar-accent/60 ${navHoverClass}`;

  const logoutButtonClass = isDark
    ? `w-full h-9 cursor-pointer rounded-lg px-2 text-foreground hover:bg-sidebar-accent [&_svg]:text-foreground ${navHoverClass}`
    : `w-full h-9 cursor-pointer rounded-lg px-2 text-muted-foreground hover:bg-sidebar-accent/60 [&_svg]:text-muted-foreground ${navHoverClass}`;

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
                alt="Nitro Advance"
                className={`block object-contain ${isCollapsed ? "h-8 w-8 shrink-0" : "h-14 w-auto max-w-full"}`}
              />
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 pb-2 pt-0 group-data-[collapsible=icon]:overflow-auto group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <div className="w-full space-y-5 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-auto">
            {navSections.map((section, sectionIndex) => (
              <div
                key={`${section.title || "section"}-${sectionIndex}`}
                className="w-full"
              >
                {section.title ? (
                  <p className={sectionHeadingClass}>{section.title}</p>
                ) : null}
                <SidebarMenu className="flex flex-col items-stretch gap-0.5 group-data-[collapsible=icon]:items-center">
                  {section.items.map((item) => {
                    const childItems = item.children ?? [];
                    const hasChildren = childItems.length > 0;
                    const to = buildNavHref(item);
                    const isActive = isNavItemActive(pathname, searchParams, item);
                    const isNotificationsLink = item.url === "/notifications";
                    const showUnreadBadge =
                      isNotificationsLink && unreadNotificationCount > 0;
                    const badgeLabel =
                      unreadNotificationCount > 9
                        ? "9+"
                        : String(unreadNotificationCount);

                    const pipelineCount = item.operationsStatus
                      ? resolveApplicationsPipelineCount(
                          item.operationsStatus,
                          operationsSummaryCounts,
                          operationsCaseStageCounts,
                          rejectedApplicationCount,
                        )
                      : superAdmin && item.url === "/applications"
                        ? (applicationsTotal.data ?? null)
                        : workflowBucketCount(item.url);
                    const showPipelineCount =
                      !hasChildren && pipelineCount != null;

                    if (hasChildren) {
                      const isToggle = Boolean(item.collapsible) && !isCollapsed;
                      // Remembered choice wins; otherwise open the group holding the current page.
                      const isOpen = !item.collapsible || (expandedGroups[item.label] ?? isActive);
                      return (
                        <SidebarMenuItem
                          key={item.label}
                          className="w-full group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center"
                        >
                          {isToggle ? (
                            <SidebarMenuButton
                              isActive={isActive && !isOpen}
                              className={navButtonClass}
                              aria-expanded={isOpen}
                              onClick={() => toggleGroup(item.label, isOpen)}
                            >
                              <span className="relative shrink-0">
                                <NavIcon icon={item.icon} />
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {item.label}
                              </span>
                              <ChevronRight
                                aria-hidden
                                className={cn(
                                  "!size-4 shrink-0 transition-transform duration-200",
                                  isOpen && "rotate-90",
                                )}
                              />
                            </SidebarMenuButton>
                          ) : (
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            className={navButtonClass}
                          >
                            <Link
                              to={to}
                              onMouseEnter={() => prefetchCrmPage(to)}
                              className="flex w-full min-w-0 items-center gap-2 group-data-[collapsible=icon]:w-auto group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0"
                            >
                              <span className="relative shrink-0">
                                <NavIcon icon={item.icon} />
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {item.label}
                              </span>
                            </Link>
                          </SidebarMenuButton>
                          )}
                          {isOpen ? (
                          <SidebarMenuSub className="mx-1.5 border-l px-2">
                            {childItems.map((child) => {
                              const childTo = buildChildHref(child);
                              const childActive = isChildNavActive(
                                pathname,
                                searchParams,
                                child,
                              );
                              const isLinkChild = Boolean(child.url);
                              const childCount = child.operationsStatus
                                ? resolveApplicationsPipelineCount(
                                    child.operationsStatus,
                                    operationsSummaryCounts,
                                    operationsCaseStageCounts,
                                    rejectedApplicationCount,
                                  )
                                : child.url
                                  ? workflowBucketCount(child.url)
                                  : null;
                              const showChildCount = childCount != null;

                              return (
                                <SidebarMenuSubItem key={child.label}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={childActive}
                                    size="md"
                                    className={subNavButtonClass}
                                  >
                                    <Link
                                      to={childTo}
                                      className={cn(
                                        "flex w-full min-w-0 gap-1.5",
                                        isLinkChild
                                          ? "flex-row items-center"
                                          : "flex-row items-center",
                                      )}
                                    >
                                      {isLinkChild ? (
                                        <>
                                          {child.icon ? (
                                            <span className="relative shrink-0 [&_svg]:!h-4 [&_svg]:!w-4">
                                              <NavIcon icon={child.icon} />
                                            </span>
                                          ) : null}
                                          <span className="min-w-0 flex-1 whitespace-nowrap text-sm">
                                            {child.label}
                                          </span>
                                          {showChildCount ? (
                                            <span
                                              className={cn(
                                                "ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none tabular-nums group-data-[collapsible=icon]:hidden",
                                                getPipelineCountBadgeClass(),
                                                childActive &&
                                                  "bg-primary/15 text-primary",
                                              )}
                                              aria-label={`${childCount} applications in ${child.label}`}
                                            >
                                              {childCount}
                                            </span>
                                          ) : null}
                                        </>
                                      ) : (
                                        <span className="flex w-full items-center justify-between gap-2">
                                          <span className="min-w-0 flex-1 whitespace-nowrap text-sm">
                                            {child.label}
                                          </span>
                                          {showChildCount ? (
                                            <span
                                              className={cn(
                                                "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none tabular-nums group-data-[collapsible=icon]:hidden",
                                                getPipelineCountBadgeClass(),
                                                childActive &&
                                                  "bg-primary/15 text-primary",
                                              )}
                                              aria-label={`${childCount} applications in ${child.label}`}
                                            >
                                              {childCount}
                                            </span>
                                          ) : null}
                                        </span>
                                      )}
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                          ) : null}
                        </SidebarMenuItem>
                      );
                    }

                    return (
                      <SidebarMenuItem
                        key={item.label}
                        className="w-full group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center"
                      >
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          className={cn(
                            isNotificationsLink
                              ? `${navButtonClass} overflow-visible [&>span:last-child]:truncate-none`
                              : navButtonClass,
                          )}
                        >
                          <Link
                            to={to}
                            onMouseEnter={() => prefetchCrmPage(to)}
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
                            ) : (
                              <>
                                <span className="min-w-0 flex-1 truncate">
                                  {item.label}
                                </span>
                                {showPipelineCount ? (
                                  <span
                                    className={cn(
                                      "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none tabular-nums group-data-[collapsible=icon]:hidden",
                                      getPipelineCountBadgeClass(),
                                      isActive && "bg-primary/15 text-primary",
                                    )}
                                    aria-label={`${pipelineCount} applications in ${item.label}`}
                                  >
                                    {pipelineCount}
                                  </span>
                                ) : null}
                              </>
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
                  onClick={() => void handleLogout()}
                  className={logoutButtonClass}
                  disabled={loggingOut}
                  aria-busy={loggingOut}
                >
                  {loggingOut ? (
                    <Loader2 className="size-5 animate-spin" aria-hidden />
                  ) : (
                    <Logout sx={navIconSx} />
                  )}
                  <span>{loggingOut ? "Logging out..." : "Logout"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarFooter>
      </div>
    </UISidebar>
  );
};

export default Sidebar;
