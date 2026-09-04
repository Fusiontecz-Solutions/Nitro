import type { TemplateCategory } from "@/pages/templates/types";
import { TEMPLATE_CATEGORY_LABELS } from "@/pages/templates/types";
import {
  BUILTIN_FE_TEMPLATES,
  type BuiltinPaymentTemplateRow,
} from "@/pages/templates/registry";

export type { TemplateCategory };
export { TEMPLATE_CATEGORY_LABELS };

export type TemplateItem = BuiltinPaymentTemplateRow;

let cachedTemplates: TemplateItem[] | undefined;

export function readPaymentTemplatesCache(): TemplateItem[] | undefined {
  return cachedTemplates;
}

export function writePaymentTemplatesCache(list: TemplateItem[]) {
  cachedTemplates = list;
}

export function prefetchPaymentTemplates() {
  void getPaymentTemplates(undefined, { force: true }).catch(() => {});
}

/**
 * Nitro uses frontend built-in letter templates (ZBL / Payoff / Wire).
 * There is no payment-templates CRUD API — return the built-ins only.
 */
export async function getPaymentTemplates(
  category?: "all" | TemplateCategory,
  _opts?: { force?: boolean },
): Promise<TemplateItem[]> {
  const list = [...BUILTIN_FE_TEMPLATES];
  writePaymentTemplatesCache(list);
  if (!category || category === "all") return list;
  return list.filter((t) => t.category === category);
}
