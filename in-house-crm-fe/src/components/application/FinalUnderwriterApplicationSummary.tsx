import type { ComponentProps } from "react";
import ApplicationSummary from "./ApplicationSummary";

/**
 * Final-underwriter decision view uses the same summary card as other roles;
 * kept as a separate component for role-specific layout changes later.
 */
export default function FinalUnderwriterApplicationSummary(
  props: ComponentProps<typeof ApplicationSummary>,
) {
  return <ApplicationSummary {...props} />;
}
