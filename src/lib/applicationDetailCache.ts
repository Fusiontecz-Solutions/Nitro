import type { Application } from "@/types/applicationTypes";
import { axiosGet } from "@/redux/axios";
import { isNumericApplicationRouteParam } from "@/lib/applicationRouteMatch";
import {
  CRM_CACHE_NS,
  crmCacheClearNamespace,
  crmCacheGet,
  crmCacheSet,
} from "@/lib/crmCache";

const NS = CRM_CACHE_NS.APPLICATIONS_DETAIL;

/** All route-param keys that resolve to the same application row. */
export function applicationDetailCacheKeysForApp(app: Application): string[] {
  const keys = new Set<string>();
  const row = app as Application & { id?: string };
  const pk = row._id ?? row.id;
  if (pk != null && String(pk).trim()) keys.add(String(pk).trim());
  if (row.applicationId != null && String(row.applicationId).trim()) {
    keys.add(String(row.applicationId).trim());
  }
  return [...keys];
}

export function writeApplicationDetailCache(app: Application) {
  for (const key of applicationDetailCacheKeysForApp(app)) {
    crmCacheSet(NS, key, app);
  }
}

export function readApplicationDetailCache(
  routeParam: string,
): Application | undefined {
  const key = String(routeParam).trim();
  if (!key) return undefined;
  return crmCacheGet<Application>(NS, key);
}

export function isApplicationDetailCacheStale(routeParam: string): boolean {
  return readApplicationDetailCache(routeParam) === undefined;
}

export function invalidateApplicationDetailCache() {
  crmCacheClearNamespace(NS);
}

function detailUrl(routeParam: string): string {
  if (isNumericApplicationRouteParam(routeParam)) {
    return `/applications/applicationId/${routeParam}`;
  }
  return `/applications/${routeParam}`;
}

/** Warm detail cache before navigation (hover / row click). */
export function prefetchApplicationDetail(routeParam: string): void {
  const key = String(routeParam).trim();
  if (!key) return;
  if (readApplicationDetailCache(key) !== undefined) return;
  void axiosGet(detailUrl(key))
    .then((res) => {
      const body = res?.data;
      const app =
        body?.data && typeof body.data === "object"
          ? (body.data as Application)
          : (body as Application);
      if (app && (app._id || (app as Application & { id?: string }).id)) {
        writeApplicationDetailCache(app);
      }
    })
    .catch(() => {
      /* prefetch only */
    });
}
