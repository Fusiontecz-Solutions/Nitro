/** Warm the route chunk on sidebar hover so the next click does not wait on JS. */
export function prefetchCrmPage(href: string): void {
  const path = String(href || "").split("?")[0];
  if (path === "/" || path === "") {
    void import("@/pages/dashboard/OperationsDashboard");
    return;
  }
  if (path.startsWith("/applications") || path.startsWith("/application-details")) {
    void import("@/pages/applications/Applications");
    return;
  }
  if (path.startsWith("/letter-generator")) {
    void import("@/pages/applications/Applications");
    return;
  }
  if (path.startsWith("/clients")) {
    void import("@/pages/clients/Clients");
    return;
  }
  if (path.startsWith("/user-setting") || path.startsWith("/settings")) {
    void import("@/pages/Userssettings/UserSetting");
    return;
  }
  if (path.startsWith("/notifications")) {
    void import("@/pages/NotificationDashboard/NotificationDashboard");
  }
}
