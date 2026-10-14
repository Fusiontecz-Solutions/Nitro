import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  TemplateCategory,
  TemplateDefinition,
  TemplateValues,
} from "./types";
import type { LetterEmailBranding } from "./letterEmailBranding";

import ApplicationApprovalEmail, {
  APPLICATION_APPROVAL_EMAIL_VARIABLES,
} from "./ApplicationApprovalEmail";
import { renderApplicationApprovalEmailHtml } from "./applicationApprovalEmailHtml";
import ApplicationApprovedEmail, {
  APPLICATION_APPROVED_EMAIL_VARIABLES,
} from "./ApplicationApprovedEmail";
import { renderApplicationApprovedEmailHtml } from "./applicationApprovedEmailHtml";
import ApplicationRejectionEmail, {
  APPLICATION_REJECTION_EMAIL_VARIABLES,
} from "./ApplicationRejectionEmail";
import { renderApplicationRejectionEmailHtml } from "./applicationRejectionEmailHtml";
import DocumentRequestEmail, {
  DOCUMENT_REQUEST_EMAIL_VARIABLES,
} from "./DocumentRequestEmail";
import { renderDocumentRequestEmailHtml } from "./documentRequestEmailHtml";
import OfferUpdatedEmail, {
  OFFER_UPDATED_EMAIL_VARIABLES,
} from "./OfferUpdatedEmail";
import { renderOfferUpdatedEmailHtml } from "./offerUpdatedEmailHtml";
import PayOffLetter, {
  PAY_OFF_LETTER_VARIABLES,
} from "./PayOffLetter";
import { renderPayOffLetterEmailHtml } from "./payOffLetterEmailHtml";
import PayOffWireInformation, {
  PAY_OFF_WIRE_INFORMATION_VARIABLES,
} from "./PayOffWireInformation";
import { renderPayOffWireInformationEmailHtml } from "./payOffWireInformationEmailHtml";
import SignedContractEmail, {
  SIGNED_CONTRACT_EMAIL_VARIABLES,
} from "./SignedContractEmail";
import ContractSentEmail, {
  CONTRACT_SENT_EMAIL_VARIABLES,
} from "./ContractSentEmail";
import {
  buildContractSentEmailSubject,
  buildSignedContractEmailSubject,
  renderContractSentEmailTemplateHtml,
  renderSignedContractEmailTemplateHtml,
} from "./contractStatusEmailHtml";
import ZeroBalanceLetter, {
  ZERO_BALANCE_LETTER_VARIABLES,
} from "./ZeroBalanceLetter";
import { renderZeroBalanceLetterEmailHtml } from "./zeroBalanceLetterEmailHtml";

export const BUILTIN_FE_TEMPLATE_ID_PREFIX = "builtin-fe:";

/** Legacy DB letter names that the React payoff letter replaces — hide from UI. */
const RETIRED_PAYMENT_LETTER_NAMES = new Set([
  "payoff wire instructions",
  "wire information",
  "wire instructions",
]);

/** True for retired settlement / wire-instruction HTML letters (exact name match). */
export function isRetiredPaymentLetter(
  name: string | undefined | null,
): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return Boolean(n) && RETIRED_PAYMENT_LETTER_NAMES.has(n);
}

const BUILTIN_REACT_DEFINITIONS: TemplateDefinition[] = [
  {
    id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}payoff-letter`,
    name: "Payoff letter",
    category: "letter",
    description: "Payoff amount and wire instructions for a merchant account.",
    variables: PAY_OFF_LETTER_VARIABLES,
    Component: PayOffLetter,
    renderHtml: renderPayOffLetterEmailHtml,
  },
  {
    id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}payoff-wire-information`,
    name: "Payoff Wire Information",
    category: "letter",
    description: "Standalone payoff wire instructions letter.",
    variables: PAY_OFF_WIRE_INFORMATION_VARIABLES,
    Component: PayOffWireInformation,
    renderHtml: renderPayOffWireInformationEmailHtml,
  },
  {
    id: `${BUILTIN_FE_TEMPLATE_ID_PREFIX}zero-balance-letter`,
    name: "Zero balance letter",
    category: "letter",
    description: "Zero-balance confirmation sent to a merchant.",
    variables: ZERO_BALANCE_LETTER_VARIABLES,
    Component: ZeroBalanceLetter,
    renderHtml: renderZeroBalanceLetterEmailHtml,
  },
  {
    id: "application-rejection-email",
    name: "Application Rejection Email",
    category: "email",
    description:
      "Email sent to a client / ISO when an application is rejected during underwriting.",
    variables: APPLICATION_REJECTION_EMAIL_VARIABLES,
    Component: ApplicationRejectionEmail,
    renderHtml: renderApplicationRejectionEmailHtml,
  },
  {
    id: "document-request-email",
    name: "Document Request Email",
    category: "email",
    description:
      "Email sent to an ISO / client requesting documents be uploaded via the public portal.",
    variables: DOCUMENT_REQUEST_EMAIL_VARIABLES,
    Component: DocumentRequestEmail,
    renderHtml: renderDocumentRequestEmailHtml,
  },
  {
    id: "application-approval-email",
    name: "Application Approval Email",
    category: "email",
    description:
      "Email sent to an ISO when an application is approved, with the offer terms inline and an Approve button that moves the deal to Contract Pending.",
    variables: APPLICATION_APPROVAL_EMAIL_VARIABLES,
    Component: ApplicationApprovalEmail,
    renderHtml: renderApplicationApprovalEmailHtml,
  },
  {
    id: "application-approved-email",
    name: "Application Approved Email",
    category: "email",
    description:
      "Email sent when an application is approved, with full offer terms inline (no portal link).",
    variables: APPLICATION_APPROVED_EMAIL_VARIABLES,
    Component: ApplicationApprovedEmail,
    renderHtml: renderApplicationApprovedEmailHtml,
  },
  {
    id: "offer-updated-email",
    name: "Offer Updated Email",
    category: "email",
    description:
      "Email sent to an ISO / client when approved offer values are updated, with a link to review the new offer.",
    variables: OFFER_UPDATED_EMAIL_VARIABLES,
    Component: OfferUpdatedEmail,
    renderHtml: renderOfferUpdatedEmailHtml,
  },
  {
    id: "contract-sent-email",
    name: "Contract Sent Email",
    category: "email",
    description:
      "Email sent to the deal's agent when the contract goes out for signature, with the package attached. Subject: {Funder}: {Merchant}: Contract Sent.",
    variables: CONTRACT_SENT_EMAIL_VARIABLES,
    Component: ContractSentEmail,
    renderHtml: renderContractSentEmailTemplateHtml,
    renderSubject: (values) =>
      buildContractSentEmailSubject(
        values.book_name || "Obsidian Capital Group",
        values.merchant_name || "Acme LLC",
      ),
  },
  {
    id: "signed-contract-email",
    name: "Signed Contract Email",
    category: "email",
    description:
      "Email sent to the inbox, CC list, signers, agent and sender once every signer completes the contract. Subject: {Funder}: {Merchant}: Signed Contract.",
    variables: SIGNED_CONTRACT_EMAIL_VARIABLES,
    Component: SignedContractEmail,
    renderHtml: renderSignedContractEmailTemplateHtml,
    renderSubject: (values) =>
      buildSignedContractEmailSubject(
        values.book_name || "Obsidian Capital Group",
        values.merchant_name || "Acme LLC",
      ),
  },
];

/**
 * Central registry of every template in this folder. Add new templates here
 * so they automatically show up in the Template Playground (`/template/playground`).
 */
export const TEMPLATE_REGISTRY: TemplateDefinition[] = BUILTIN_REACT_DEFINITIONS;

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
  branding?: LetterEmailBranding | null,
): string {
  /** Gmail / clients ignore app CSS and Vite asset URLs — use inline HTML for these letters. */
  if (id === `${BUILTIN_FE_TEMPLATE_ID_PREFIX}zero-balance-letter`) {
    return renderZeroBalanceLetterEmailHtml(values as TemplateValues, branding);
  }
  if (id === `${BUILTIN_FE_TEMPLATE_ID_PREFIX}payoff-letter`) {
    return renderPayOffLetterEmailHtml(values as TemplateValues, branding);
  }
  if (id === `${BUILTIN_FE_TEMPLATE_ID_PREFIX}payoff-wire-information`) {
    return renderPayOffWireInformationEmailHtml(values as TemplateValues, branding);
  }
  const def = byId.get(id);
  if (!def) return "";
  if (def.renderHtml) return def.renderHtml(values as TemplateValues);
  if (!def.Component) return "";
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
 * Mirrors `TemplateItem` from the letter template API without importing it.
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
  BUILTIN_REACT_DEFINITIONS.filter((d) => d.category === "letter").map((d) => ({
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
      !builtinNames.has((t.name ?? "").trim().toLowerCase()) &&
      !isRetiredPaymentLetter(t.name),
  );
  return [...BUILTIN_FE_TEMPLATES, ...filteredApi];
}
