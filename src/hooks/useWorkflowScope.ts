import { useSearchParams } from "react-router";
import { resolveEffectiveRole } from "@/lib/sessionRole";
import { toAppRole } from "@/lib/roleAccess";
import type { WorkflowScope } from "@/lib/workflowApi";

/** Resolve which workflow the viewer sees. Super Admin can switch (oversight). */
export function useWorkflowScope(): { scope: WorkflowScope; canSwitch: boolean; setScope: (s: WorkflowScope) => void } {
  const [searchParams, setSearchParams] = useSearchParams();
  const role = toAppRole(resolveEffectiveRole(undefined));
  const canSwitch = role === "SUPER_ADMIN";
  const requested = searchParams.get("scope") === "underwriter" ? "underwriter" : "agent";
  const scope: WorkflowScope = role === "UNDERWRITER" ? "underwriter" : role === "AGENT" ? "agent" : requested;
  const setScope = (next: WorkflowScope) => {
    const params = new URLSearchParams(searchParams);
    params.set("scope", next);
    params.delete("bucket");
    setSearchParams(params, { replace: true });
  };
  return { scope, canSwitch, setScope };
}
