import type { SvgIconProps } from "@mui/material/SvgIcon";
import Logout from "@mui/icons-material/Logout";
import Article from "@mui/icons-material/Article";
import AccountBalance from "@mui/icons-material/AccountBalance";
import InsertDriveFileIcon from "@mui/icons-material/InsertDriveFile";
import Description from "@mui/icons-material/Description";
import People from "@mui/icons-material/People";
import Settings from "@mui/icons-material/Settings";
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
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { logout } from "@/redux/actions/authActions";
import { clearApplicationStats, clearApplicationDetail } from "@/redux/slices/applicationSlice";
import { toast } from "react-toastify";
import { APP_SHORT_ICON_SRC, APP_SHORT_ICON_DARK_SRC, resolveAppLogoSrc } from "@/constants/appLogo";
import { useTheme } from "@/context/ThemeContext";
import { useEffect, useState, type ComponentType } from "react";
import { clearCrmCacheOnLogout } from "@/lib/crmCache";
import { cn } from "@/lib/utils";
import { buildOperationsPipelineApplicationsUrl } from "@/constants/dashboardApplicationsNavigation";
import { getPipelineCountBadgeClass } from "@/lib/applicationsPipelineFilter";
import { SidebarPipelineActionBadge } from "@/components/sidebar/SidebarPipelineActionBadge";
import {
  resolveSidebarPipelineActionAccent,
} from "@/lib/sidebarPipelineActionBadge";
import { axiosGet } from "@/redux/axios";

type SidebarNavIcon = ComponentType<SvgIconProps>;

type PipelineAccent = "contract-pending" | "contract-sent" | "contract-signed";

type SidebarNavChildItem = {
  label: string;
  /** Pipeline stage filter (Contract → Pending / Sent / Signed). */
  operationsStatus?: string;
  pipelineAccent?: PipelineAccent;
  /** Peach/amber action pill under the label (matches screenshot). */
  actionHint?: string;
  /** Absolute or relative path including optional query (Settings tabs). */
  url?: string;
};

type SidebarNavItem = {
  label: string;
  url: string;
  icon: SidebarNavIcon;
  workflow?: "offer" | "ach";
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
 * Sidebar layout matching the product screenshots:
 * MAIN (flat links) + DEAL PIPELINE with nested Contract → Pending / Sent / Signed.
 */
const contractWorkflowSections: SidebarNavSection[] = [
  {
    title: "MAIN",
    items: [
      { label: "Clients", url: "/clients", icon: People },
      {
        label: "Add Application",
        url: "/applications",
        icon: InsertDriveFileIcon,
      },
    ],
  },
  {
    title: "DEAL PIPELINE",
    items: [
      {
        label: "Create Offer",
        url: "/applications?workflow=offer",
        icon: Description,
        workflow: "offer",
      },
      {
        label: "Contract",
        url: "/applications",
        icon: Article,
        operationsStatus: "Contracted",
        children: [
          {
            label: "Pending",
            operationsStatus: "Contract_Pending",
            pipelineAccent: "contract-pending",
            actionHint: "Generate Contract",
          },
          {
            label: "Sent",
            operationsStatus: "Contract_Sent",
            pipelineAccent: "contract-sent",
            actionHint: "Send ACH Form",
          },
          {
            label: "Signed",
            operationsStatus: "Contract_Signed",
            pipelineAccent: "contract-signed",
          },
        ],
      },
      {
        label: "Send ACH Form",
        url: "/applications?workflow=ach",
        icon: AccountBalance,
        workflow: "ach",
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

function isNavChildActive(
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
  if (item.workflow) {
    return `/applications?workflow=${item.workflow}`;
  }
  if (item.operationsStatus) {
    return buildOperationsPipelineApplicationsUrl(item.operationsStatus);
  }
  return item.url;
}

function buildChildNavHref(child: SidebarNavChildItem, parent: SidebarNavItem): string {
  if (child.url) return child.url;
  if (child.operationsStatus) {
    return buildOperationsPipelineApplicationsUrl(child.operationsStatus);
  }
  return parent.url;
}

function isNavItemActive(
  pathname: string,
  searchParams: URLSearchParams,
  item: SidebarNavItem,
): boolean {
  if (item.url === "/clients") {
    return pathname === "/clients" || pathname.startsWith("/create-clients");
  }

  const childItems = item.children ?? [];
  if (childItems.length > 0) {
    return (
      childItems.some((child) => isNavChildActive(pathname, searchParams, child)) ||
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

  if (item.workflow) {
    return pathname === "/applications" && currentWorkflow === item.workflow;
  }

  // Add Application — applications list without workflow / ops stage filter
  if (item.url === "/applications" && !item.workflow && !item.operationsStatus) {
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

type ContractStageCounts = {
  Contract_Pending: number;
  Contract_Sent: number;
  Contract_Signed: number;
};

async function fetchContractStageCount(operationsStatus: string): Promise<number> {
  try {
    const res = await axiosGet("/applications", {
      params: {
        page: 1,
        limit: 1,
        fromDashboard: "operations",
        operationsStatus,
      },
    });
    const total =
      res?.data?.pagination?.total ??
      res?.data?.data?.pagination?.total ??
      res?.data?.meta?.total;
    return typeof total === "number" ? total : Number(total) || 0;
  } catch {
    return 0;
  }
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
  const [stageCounts, setStageCounts] = useState<ContractStageCounts>({
    Contract_Pending: 0,
    Contract_Sent: 0,
    Contract_Signed: 0,
  });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const [pending, sent, signed] = await Promise.all([
        fetchContractStageCount("Contract_Pending"),
        fetchContractStageCount("Contract_Sent"),
        fetchContractStageCount("Contract_Signed"),
      ]);
      if (!cancelled) {
        setStageCounts({
          Contract_Pending: pending,
          Contract_Sent: sent,
          Contract_Signed: signed,
        });
      }
    };
    void load();
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [pathname]);

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

  const mainSidebarTitleClass =
    "mt-3 text-xs font-bold uppercase tracking-wider text-muted-foreground group-data-[collapsible=icon]:hidden";

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
          <p className={mainSidebarTitleClass}>Main</p>
        </SidebarHeader>
        <SidebarContent className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto px-2 pb-2 pt-0 group-data-[collapsible=icon]:overflow-auto group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-0">
          <div className="w-full space-y-5 group-data-[collapsible=icon]:mx-auto group-data-[collapsible=icon]:w-auto">
            {contractWorkflowSections.map((section, sectionIndex) => (
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
                                <span className="mr-1 opacity-70" aria-hidden>
                                  •
                                </span>
                                {item.label}
                              </span>
                            </Link>
                          </SidebarMenuButton>
                          <SidebarMenuSub className="mx-1.5 border-l px-2">
                            {childItems.map((child) => {
                              const childTo = buildChildNavHref(child, item);
                              const childActive = isNavChildActive(
                                pathname,
                                searchParams,
                                child,
                              );
                              const childCount = child.operationsStatus
                                ? (stageCounts[
                                    child.operationsStatus as keyof ContractStageCounts
                                  ] ?? 0)
                                : 0;
                              const showChildCount = Boolean(
                                child.operationsStatus && childCount > 0,
                              );
                              const actionAccent = child.operationsStatus
                                ? resolveSidebarPipelineActionAccent(child.operationsStatus)
                                : null;

                              return (
                                <SidebarMenuSubItem key={child.label}>
                                  <SidebarMenuSubButton
                                    asChild
                                    isActive={childActive}
                                    size="md"
                                    className={cn(
                                      subNavButtonClass,
                                      child.actionHint && "py-2",
                                    )}
                                  >
                                    <Link
                                      to={childTo}
                                      className="flex w-full min-w-0 flex-col gap-1.5"
                                    >
                                      <span className="flex w-full items-center justify-between gap-2">
                                        <span className="min-w-0 flex-1 whitespace-nowrap text-sm">
                                          {child.label}
                                        </span>
                                        {showChildCount ? (
                                          <span
                                            className={cn(
                                              "shrink-0 rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none tabular-nums",
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
                                      {child.actionHint && actionAccent ? (
                                        <SidebarPipelineActionBadge accent={actionAccent}>
                                          {child.actionHint}
                                        </SidebarPipelineActionBadge>
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
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
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
