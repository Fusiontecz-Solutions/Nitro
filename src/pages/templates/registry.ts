import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  TemplateCategory,
  TemplateDefinition,
  TemplateValues,
} from "./types";

// import PayOffLetter, {
//   PAY_OFF_LETTER_VARIABLES,
// } from "./PayOffLetter";
import ZeroBalanceLetter, {
  ZERO_BALANCE_LETTER_VARIABLES,
} from "./ZeroBalanceLetter";
import ApplicationApprovalEmail, {
  APPLICATION_APPROVAL_EMAIL_VARIABLES,
} from "./ApplicationApprovalEmail";
import { renderApplicationApprovalEmailHtml } from "./applicationApprovalEmailHtml";
import ApplicationRejectionEmail, {
  APPLICATION_REJECTION_EMAIL_VARIABLES,
} from "./ApplicationRejectionEmail";
import { renderApplicationRejectionEmailHtml } from "./applicationRejectionEmailHtml";

export const BUILTIN_FE_TEMPLATE_ID_PREFIX = "builtin-fe:";

const BUILTIN_REACT_DEFINITIONS: TemplateDefinition[] = [
  // {
  //   id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}payoff-wire-instructions`,
  //   name: "Payoff Wire Instructions",
  //   category: "letter",
  //   variables: PAYOFF_WIRE_INSTRUCTIONS_VARIABLES,
  //   Component: PayoffWireInstructions,
  // },
  // {
  //   id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}payoff-letter`,
  //   name: "Payoff letter",
  //   category: "letter",
  //   variables: PAY_OFF_LETTER_VARIABLES,
  //   Component: PayOffLetter,
  // },
  {
    id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}zero-balance-letter`,
    name: "Zero balance letter",
    category: "letter",
    variables: ZERO_BALANCE_LETTER_VARIABLES,
    Component: ZeroBalanceLetter,
  },
  {
    id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}application-approval-email`,
    name: "Application approval email",
    category: "email",
    description:
      "ISO pre-approval notification with calculator link and funding stips.",
    variables: APPLICATION_APPROVAL_EMAIL_VARIABLES,
    Component: ApplicationApprovalEmail,
  },
  {
    id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}application-rejection-email`,
    name: "Application rejection email",
    category: "email",
    description:
      "ISO decline notification with the primary and other reasons for decline.",
    variables: APPLICATION_REJECTION_EMAIL_VARIABLES,
    Component: ApplicationRejectionEmail,
  },
];

const byId = new Map(
  BUILTIN_REACT_DEFINITIONS.map((d) => [d.id, d] as const),
);

export function getBuiltinReactTemplateDefinition(
  id: string | undefined | null,
): TemplateDefinition | undefined {
  if (!id) return undefined;
  return byId.get(id);
}

/** True when the template id is a frontend React built-in. */
export function isBuiltinFeTemplate(id: string | undefined | null): boolean {
  return typeof id === "string" && id.startsWith(BUILTIN_FE_TEMPLATE_ID_PREFIX);
}

export function renderBuiltinReactTemplateHtml(
  id: string,
  values: Record<string, string>,
): string {
  /** Gmail / clients ignore app CSS and Vite asset URLs — use inline HTML for these letters. */
  // if (id === `${BUILTIN_FE_TEMPLATE_ID_PREFIX}zero-balance-letter`) {
  //   return renderZeroBalanceLetterEmailHtml(values as TemplateValues);
  // }
  // if (id === `${BUILTIN_FE_TEMPLATE_ID_PREFIX}payoff-letter`) {
  //   return renderPayOffLetterEmailHtml(values as TemplateValues);
  // }
  if (id === `${BUILTIN_FE_TEMPLATE_ID_PREFIX}application-approval-email`) {
    return renderApplicationApprovalEmailHtml(values as TemplateValues);
  }
  if (id === `${BUILTIN_FE_TEMPLATE_ID_PREFIX}application-rejection-email`) {
    return renderApplicationRejectionEmailHtml(values as TemplateValues);
  }
  const def = byId.get(id);
  if (!def) return "";
  const node = createElement(def.Component, {
    values: values as TemplateValues,
  });
  return renderToStaticMarkup(node);
}

/** Values for admin preview (empty user input → placeholders / labels). */
export function previewValuesForBuiltinDefinition(
  def: TemplateDefinition,
): TemplateValues {
  const out: TemplateValues = {};
  for (const variable of def.variables) {
    out[variable.key] = "";
  }
  return out;
}

const todayIso = (): string => new Date().toISOString();

/**
 * Mirrors `TemplateItem` from `paymentTemplateApi` without importing it (avoids
 * circular module graph: paymentTemplateApi → templates → paymentTemplateApi).
 */
export type BuiltinPaymentTemplateRow = {
  id: string;
  name: string;
  category: TemplateCategory;
  variables: string[];
  body: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
};

export const BUILTIN_FE_TEMPLATES: BuiltinPaymentTemplateRow[] =
  BUILTIN_REACT_DEFINITIONS.map((d) => ({
    id: d.id,
    name: d.name,
    category: d.category,
    variables: d.variables.map((v) => v.key),
    body: "",
    status: "active",
    createdAt: todayIso(),
    updatedAt: todayIso(),
  }));

export function mergeBuiltinFeTemplates(
  apiList: BuiltinPaymentTemplateRow[],
): BuiltinPaymentTemplateRow[] {
  const builtinNames = new Set(
    BUILTIN_FE_TEMPLATES.map((t) => t.name.trim().toLowerCase()),
  );
  const builtinIds = new Set(BUILTIN_FE_TEMPLATES.map((t) => t.id));
  const filteredApi = apiList.filter(
    (t) =>
      !builtinIds.has(t.id) &&
      !builtinNames.has((t.name ?? "").trim().toLowerCase()),
  );
  return [...BUILTIN_FE_TEMPLATES, ...filteredApi];
}
