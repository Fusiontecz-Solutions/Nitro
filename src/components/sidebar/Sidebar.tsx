import type { SvgIconProps } from "@mui/material/SvgIcon";
import Logout from "@mui/icons-material/Logout";
import Article from "@mui/icons-material/Article";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import People from "@mui/icons-material/People";
import Dashboard from "@mui/icons-material/Dashboard";
import Settings from "@mui/icons-material/Settings";
import Notifications from "@mui/icons-material/Notifications";
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
import { clearApplicationStats, clearApplicationDetail } from "@/redux/slices/applicationSlice";
import { resetOperationsDashboard } from "@/redux/slices/operationsDashboardSlice";
import { fetchOperationsDashboardSummary } from "@/redux/actions/operationsDashboardActions";
import { toast } from "react-toastify";
import { APP_SHORT_ICON_SRC, APP_SHORT_ICON_DARK_SRC, resolveAppLogoSrc } from "@/constants/appLogo";
import { useTheme } from "@/context/ThemeContext";
import { useEffect, useMemo, type ComponentType } from "react";
import { clearCrmCacheOnLogout } from "@/lib/crmCache";
import { cn } from "@/lib/utils";
import { buildOperationsPipelineApplicationsUrl } from "@/constants/dashboardApplicationsNavigation";
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
 * SETTINGS → Profile / Funders / DocuSign
 */
const sidebarSections: SidebarNavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", url: "/", icon: Dashboard },
      { label: "Notifications", url: "/notifications", icon: Notifications },
      { label: "Clients", url: "/clients", icon: People },
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
    ],
  },
  {
    title: "SETTINGS",
    items: [
      {
        label: "Settings",
        url: "/user-setting",
        icon: Settings,
        children: [
          { label: "Profile", url: "/user-setting" },
          { label: "Funders", url: "/user-setting?tab=funders" },
          { label: "DocuSign", url: "/user-setting?tab=docusign" },
        ],
      },
    ],
  },
];

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

  if (item.url === "/clients") {
    return pathname === "/clients" || pathname.startsWith("/create-clients");
  }

  if (item.url === "/notifications") {
    return pathname === "/notifications" || pathname.startsWith("/notifications/");
  }

  const childItems = item.children ?? [];
  if (childItems.length > 0) {
    return (
      childItems.some((child) => isChildNavActive(pathname, searchParams, child)) ||
      isOperationsPipelineItemActive(pathname, searchParams, item.operationsStatus) ||
      (item.url.startsWith("/user-setting") &&
        isSettingsTabHrefActive(pathname, searchParams, item.url))
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
  const navigate = useNavigate();

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

  const unreadNotificationCount = useMemo(
    () => notifications?.filter((n: Notification) => !n.isRead).length ?? 0,
    [notifications],
  );

  useEffect(() => {
    void dispatch(fetchOperationsDashboardSummary());
  }, [dispatch, pathname]);

  const handleLogout = async () => {
    try {
      const res = await dispatch(logout()).unwrap();
      if (res?.success) {
        toast.success(res.message);
      } else {
        toast.error(res?.message || "Logout failed");
      }
    } catch (err: unknown) {
      const message = typeof err === "string" ? err : (err as { message?: string })?.message;
      toast.error(message || "Logout failed");
    } finally {
      dispatch(clearApplicationStats());
      dispatch(clearApplicationDetail());
      dispatch(resetOperationsDashboard());
      clearCrmCacheOnLogout();
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("role");
      navigate("/login", { replace: true });
    }
  };

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
                alt="Company logo"
                className={`block object-contain ${isCollapsed ? "h-8 w-8 shrink-0" : "h-26 w-auto max-w-full"}`}
              />
            </div>
          </div>
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
                      : null;
                    const showPipelineCount =
                      !hasChildren && pipelineCount != null;

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
                                {item.label}
                              </span>
                            </Link>
                          </SidebarMenuButton>
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
                <SidebarMenuButton onClick={handleLogout} className={logoutButtonClass}>
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
};

export default Sidebar;
