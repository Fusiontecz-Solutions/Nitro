import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { useSelector } from "react-redux";
import { useDispatch } from "react-redux";
import { toast } from "react-toastify";

import type { AppDispatch, RootState } from "@/redux/store";
import type { Application } from "@/types/applicationTypes";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { savePaymentMailLogEntry } from "./paymentMailLogStorage";
import {
  getPaymentTemplates,
  readPaymentTemplatesCache,
  TEMPLATE_CATEGORY_LABELS,
  type TemplateCategory,
  type TemplateItem as ApiTemplateItem,
} from "./paymentTemplateApi";
import { sendPaymentMail } from "@/redux/actions/paymentMailActions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import { clearBankDetails } from "@/redux/slices/bankDetailSlice";
import { resolveOfferDecisionFundedAmount } from "@/lib/offerDecisionFees";
import { cn, formatCurrency } from "@/lib/utils";
import { FileText, Mail, RotateCcw, Send } from "lucide-react";
import type { TermsOffer } from "@/types/termsOfferTypes";
import type { BankDetail } from "@/types/bankDetailTypes";
import {
  getBuiltinReactTemplateDefinition,
  isBuiltinFeTemplate,
  mergeBuiltinFeTemplates,
  renderBuiltinReactTemplateHtml,
} from "@/pages/templates";
import { LetterHtmlPreviewFrame } from "@/pages/templates/LetterHtmlPreviewFrame";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { Address } from "@/types/clientTypes";

type ApplicationFundingExtras = Application & {
  termsOffers?: Array<{ approvedAmount?: unknown }>;
  OfferDecision?: Record<string, unknown>;
};

type LetterFundingSources = {
  offerDecision?: Record<string, unknown> | null;
  termsOffers?: TermsOffer[];
  /** Merchant bank account number resolved from the application's bank details. */
  merchantAccountNumber?: string;
};

/** Ordered unique placeholder keys from template body (without `{{` `}}`). */
function placeholderKeysFromBody(body: string): string[] {
  const re = /\{\{\s*([^}]+?)\s*\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const k = m[1].trim();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  }
  return out;
}

function normalizeMergeKey(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const m = /^\{\{\s*([^}]+?)\s*\}\}$/.exec(t);
  return (m ? m[1] : t.replace(/^\{\{|\}\}$/g, "")).trim();
}

/** Use both body placeholders and template.variables so fields still render for plain-text bodies. */
function templateMergeKeys(template: ApiTemplateItem): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string) => {
    const k = normalizeMergeKey(raw);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(k);
  };
  for (const k of placeholderKeysFromBody(template.body)) push(k);
  for (const k of template.variables ?? []) push(String(k ?? ""));
  return out;
}

/** Trimmed string for merge fields (values may be non-strings at runtime). */
function mergeFieldStr(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  return String(v).trim();
}

/** True when a value looks like an email (not an account/phone number). */
function isLikelyEmail(value: string): boolean {
  const v = value.trim();
  if (!v || !v.includes("@")) return false;
  const local = v.split("@")[0]?.replace(/\./g, "") ?? "";
  if (/^\d+$/.test(local)) return false;
  return true;
}

/** Account numbers and digit-only strings must not populate Merchant Email. */
function isInvalidMerchantEmail(value: string, accountNumber = ""): boolean {
  const v = value.trim();
  if (!v) return false;
  const acct = accountNumber.trim();
  if (acct && v === acct) return true;
  if (/^\d+$/.test(v)) return true;
  return false;
}

function resolveMerchantEmail(
  application: Application | null | undefined,
  accountNumberToExclude = ""
): string {
  const client = application?.client;
  if (typeof client !== "object" || !client) return "";
  const exclude = accountNumberToExclude.trim();
  for (const raw of [client.owner?.email, client.business?.email]) {
    const email = mergeFieldStr(raw);
    if (!isLikelyEmail(email)) continue;
    if (exclude && email === exclude) continue;
    return email;
  }
  return "";
}

/** Keep typed email; never keep account numbers in the merchant email field. */
function coalesceRecipientEmail(
  current: string,
  candidate: string,
  accountNumber = ""
): string {
  const trimmed = current.trim();
  if (trimmed && !isInvalidMerchantEmail(trimmed, accountNumber)) {
    return trimmed;
  }
  const next = candidate.trim();
  if (isLikelyEmail(next) && next !== accountNumber.trim()) return next;
  return "";
}

/** UI label for a merge token key (snake_case → Title Case). */
function mergeFieldLabel(key: string): string {
  return key
    .split(/_+/)
    .filter(Boolean)
    .map(
      (word) =>
        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join(" ");
}

function mergeFieldLabelForTemplate(
  key: string,
  template: ApiTemplateItem | null
): string {
  if (template && isBuiltinFeTemplate(template.id)) {
    const def = getBuiltinReactTemplateDefinition(template.id);
    const variable = def?.variables.find((v) => v.key === key);
    if (variable?.label) return variable.label;
  }
  return mergeFieldLabel(key);
}

function formatAddressLine2(addr: Address | undefined): string {
  if (!addr) return "";
  return [addr.city, addr.state, addr.zipCode].filter(Boolean).join(", ");
}

function addDaysUsShortDate(days: number, from = new Date()): string {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return formatUsShortDate(d.toISOString());
}

function escapeHtmlForMerge(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the template uses HTML (e.g. table layout for email). */
function templateBodyIsHtml(body: string): boolean {
  return /<\/?(?:table|html|div|p|pre|br|span|strong|ul|ol|li)\b/i.test(body);
}

function mergeTemplate(
  body: string,
  values: Record<string, unknown>,
  escapeValueHtml: boolean,
  mergeKeys: string[] = []
) {
  const tokenRegex = /\{\{\s*([^}]+?)\s*\}\}/g;
  if (tokenRegex.test(body)) {
    return body.replace(tokenRegex, (_, rawKey: string) => {
      const key = rawKey.trim();
      const s = mergeFieldStr(values[key]);
      if (s === "") {
        const label = mergeFieldLabel(key);
        return escapeValueHtml ? escapeHtmlForMerge(label) : label;
      }
      return escapeValueHtml ? escapeHtmlForMerge(s) : s;
    });
  }

  // Fallback for plain-text templates that use human words but have variables list.
  let out = body;
  for (const key of mergeKeys) {
    const value = mergeFieldStr(values[key]);
    if (!value) continue;
    const keyPattern = new RegExp(`\\b${escapeRegex(key)}\\b`, "gi");
    out = out.replace(keyPattern, value);

    const label = mergeFieldLabel(key);
    if (label) {
      const labelPattern = new RegExp(`\\b${escapeRegex(label)}\\b`, "gi");
      out = out.replace(labelPattern, value);
    }
  }
  return out;
}

function decodeDealLabel(raw: string | undefined) {
  if (!raw?.trim()) return "N/A";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function formatUsShortDate(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
}

function isPayoffOrZeroBalanceLetter(templateName: string): boolean {
  const n = templateName.trim().toLowerCase();
  return (
    n === "zero balance letter" ||
    n.includes("zero balance") ||
    n.includes("payoff") ||
    n.includes("pay off")
  );
}

function letterTypeLabelForSubject(templateName: string): string {
  const n = templateName.trim().toLowerCase();
  if (n === "zero balance letter" || n.includes("zero balance")) {
    return "Zero Balance Letter";
  }
  if (n.includes("payoff") || n.includes("pay off")) {
    return "Pay off Letter";
  }
  return templateName;
}

function letterFundedAmountForSubject(values: Record<string, string>): string {
  return (
    values.original_funded?.trim() ||
    values.advance_amount?.trim() ||
    values.offer_amount?.trim() ||
    ""
  );
}

function offerDecisionBelongsToApplication(
  offerDecision: Record<string, unknown> | null | undefined,
  applicationUuid: string
): boolean {
  if (!offerDecision || !applicationUuid) return false;
  const appRef = offerDecision.application ?? offerDecision.applicationId;
  return String(appRef) === applicationUuid;
}

function termsOfferBelongsToApplication(
  termsOffer: TermsOffer,
  applicationUuid: string
): boolean {
  if (!applicationUuid) return false;
  const app = termsOffer.application;
  if (typeof app === "string") return app === applicationUuid;
  if (app && typeof app === "object") {
    const id = (app as { _id?: string; id?: string })._id ?? (app as { id?: string }).id;
    return id != null && String(id) === applicationUuid;
  }
  return true;
}

function bankDetailBelongsToApplication(
  bankDetail: BankDetail,
  applicationUuid: string
): boolean {
  if (!applicationUuid) return false;
  const app = bankDetail.application;
  if (typeof app === "string") return app === applicationUuid;
  if (app && typeof app === "object") {
    return app._id != null && String(app._id) === applicationUuid;
  }
  return false;
}

/** First non-empty bank account number from the application's saved bank details. */
function resolveMerchantAccountNumber(
  bankDetails: BankDetail[],
  applicationUuid: string
): string {
  for (const detail of bankDetails) {
    if (!bankDetailBelongsToApplication(detail, applicationUuid)) continue;
    const acct = mergeFieldStr(detail.accountNumber);
    if (acct) return acct;
  }
  return "";
}

function resolveFundedAmountFromOfferDecision(
  offerDecision: Record<string, unknown> | null | undefined
): number | null {
  if (!offerDecision || typeof offerDecision !== "object") return null;
  if (String(offerDecision.decision ?? "").toLowerCase() === "declined") {
    return null;
  }
  return resolveOfferDecisionFundedAmount(offerDecision);
}

/** Payoff / zero-balance letters: `Client Name: Letter Type - Funded Amount`. */
function buildLetterEmailSubject(
  templateName: string,
  values: Record<string, string>
): string {
  const clientName =
    values.business_name?.trim() ||
    values.client_name?.trim() ||
    values.merchant_name?.trim() ||
    "Client";
  const letterType = letterTypeLabelForSubject(templateName);
  const fundedAmount = letterFundedAmountForSubject(values);
  return fundedAmount
    ? `${clientName}: ${letterType} - ${fundedAmount}`
    : `${clientName}: ${letterType}`;
}

function resolveFundedAmount(
  application: Application | null | undefined,
  funding: LetterFundingSources = {}
): number {
  const direct = Number(application?.loanAmount);
  if (Number.isFinite(direct) && direct > 0) return direct;

  const ext = application as ApplicationFundingExtras | null | undefined;
  const fetchedTermsAmt = Number(funding.termsOffers?.[0]?.approvedAmount);
  const embeddedTermsAmt = Number(ext?.termsOffers?.[0]?.approvedAmount);
  const termsAmt = Number.isFinite(fetchedTermsAmt) && fetchedTermsAmt > 0
    ? fetchedTermsAmt
    : embeddedTermsAmt;
  if (Number.isFinite(termsAmt) && termsAmt > 0) return termsAmt;

  const fromFetchedOffer = resolveFundedAmountFromOfferDecision(
    funding.offerDecision
  );
  if (fromFetchedOffer != null && fromFetchedOffer > 0) return fromFetchedOffer;

  const fromEmbeddedOffer = resolveFundedAmountFromOfferDecision(
    ext?.OfferDecision
  );
  if (fromEmbeddedOffer != null && fromEmbeddedOffer > 0) return fromEmbeddedOffer;

  return 0;
}

/** Default wire destination shown in payoff letter merge fields (edit per send if needed). */
const DEFAULT_PAYOFF_WIRE_DETAILS = {
  beneficiary_name: "KATAN CAPITAL LLC",
  bank_name: "OPTIMUM BANK",
  bank_address_line1: "652 N Broad St, Suite 201",
  bank_city_state_zip: "Middletown, DE 19709",
  routing_number: "067015096",
  account_number: "0210047692",
} as const;

function buildDefaultValues(
  application: Application | null | undefined,
  dealLabel: string,
  funding: LetterFundingSources = {},
  senderName = ""
): Record<string, string> {
  const client = application?.client;
  const owner = typeof client === "object" ? client?.owner : undefined;
  const business = typeof client === "object" ? client?.business : undefined;
  const merchantName = [owner?.firstName, owner?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const dealReference =
    dealLabel ||
    (application?.applicationId != null
      ? String(application.applicationId)
      : "");
  // Letters show "Account Ending in <last 4>", so prefer the merchant's real
  // bank account number and only fall back to the deal reference when missing.
  const merchantAccountRef =
    mergeFieldStr(funding.merchantAccountNumber) || dealReference;
  const email = resolveMerchantEmail(application, merchantAccountRef);
  const loan = resolveFundedAmount(application, funding);
  const collectionPayback = Number(application?.collectionPaybackAmount);
  const collectionRepaid = Number(application?.collectionSumOfRepaid);
  const totalRepay =
    Number.isFinite(collectionPayback) && collectionPayback > 0
      ? collectionPayback
      : Math.round(loan * 1.42);
  const paid =
    Number.isFinite(collectionRepaid) && collectionRepaid >= 0
      ? collectionRepaid
      : Math.round(loan * 0.071);
  const balanceDue = Number(application?.collectionBalanceDue);
  const payoff =
    Number.isFinite(balanceDue) && balanceDue >= 0
      ? balanceDue
      : Math.max(0, totalRepay - paid);
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const d = new Date();
  const letterDate = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  const agreementDate =
    formatUsShortDate(application?.createdAt) || letterDate;
  const legalEntityName = (business?.name ?? merchantName).trim();
  const mailingAddress = business?.address ?? owner?.address;
  const recipientAddress1 = mailingAddress?.address1?.trim() ?? "";
  const recipientAddress2 = formatAddressLine2(mailingAddress);
  const salutationName =
    owner?.firstName?.trim() ||
    merchantName.split(/\s+/).filter(Boolean)[0] ||
    merchantName;
  const goodThroughDate = addDaysUsShortDate(7, d);

  return {
    merchant_name: merchantName,
    business_name: business?.name ?? "",
    agent_name: application?.salesRepresentative ?? "",
    advance_amount: loan ? formatCurrency(loan) : "",
    offer_amount: loan ? formatCurrency(loan) : "",
    factor_rate: "1.42",
    payback_amount: totalRepay ? formatCurrency(totalRepay) : "",
    daily_payment: totalRepay ? formatCurrency(Math.round(totalRepay / 120)) : "",
    term_months: "",
    owner_ssn_last4: "",
    deal_id: dealLabel,
    as_of_date: today,
    original_funded: loan ? formatCurrency(loan) : "",
    total_repayment: totalRepay ? formatCurrency(totalRepay) : "",
    total_paid: paid ? formatCurrency(paid) : "",
    payoff_balance: payoff ? formatCurrency(payoff) : "",
    funded_date: today,
    missed_date: today,
    remaining_balance: payoff ? formatCurrency(payoff) : "",
    payoff_amount: payoff ? formatCurrency(payoff) : "",
    payoff_date: today,
    default_date: today,
    outstanding_balance: payoff ? formatCurrency(payoff) : "",
    __recipient_email: email,
    customer_id: dealLabel,
    beneficiary_name: DEFAULT_PAYOFF_WIRE_DETAILS.beneficiary_name,
    bank_name: DEFAULT_PAYOFF_WIRE_DETAILS.bank_name,
    bank_address_line1: DEFAULT_PAYOFF_WIRE_DETAILS.bank_address_line1,
    bank_city_state_zip: DEFAULT_PAYOFF_WIRE_DETAILS.bank_city_state_zip,
    routing_number: DEFAULT_PAYOFF_WIRE_DETAILS.routing_number,
    wire_account_number: DEFAULT_PAYOFF_WIRE_DETAILS.account_number,
    client_name: merchantName,
    letter_date: letterDate,
    merchant_legal_name: legalEntityName,
    agreement_date: agreementDate,
    zero_balance_statement: "$0.00 (zero dollars)",
    recipient_name: legalEntityName || merchantName,
    recipient_address_line1: recipientAddress1,
    recipient_address_line2: recipientAddress2,
    account_number: merchantAccountRef,
    salutation_name: salutationName,
    good_through_date: goodThroughDate,
    payment_company_name: DEFAULT_PAYOFF_WIRE_DETAILS.bank_name,
    payment_address_line1: DEFAULT_PAYOFF_WIRE_DETAILS.bank_address_line1,
    payment_address_line2: DEFAULT_PAYOFF_WIRE_DETAILS.bank_city_state_zip,
    payment_routing_number: DEFAULT_PAYOFF_WIRE_DETAILS.routing_number,
    payment_account_number: DEFAULT_PAYOFF_WIRE_DETAILS.account_number,
    sender_name: senderName,
    account_status: "Zero Balance",
  };
}

export default function Letters() {
  const dispatch = useDispatch<AppDispatch>();
  const { paymentDealId, letterGeneratorDealId } = useParams<{
    paymentDealId?: string;
    letterGeneratorDealId?: string;
  }>();
  const routeSegment = paymentDealId ?? letterGeneratorDealId;
  const routeDealLabel = useMemo(
    () => decodeDealLabel(routeSegment),
    [routeSegment]
  );
  const application = useSelector(
    (s: RootState) => s.applicationDetail.data
  ) as Application | null | undefined;
  const loginUser = useSelector((s: RootState) => s.login.data?.user);
  const senderDisplayName = useMemo(
    () =>
      [loginUser?.firstName, loginUser?.lastName].filter(Boolean).join(" ").trim(),
    [loginUser?.firstName, loginUser?.lastName]
  );
  const offerDecisionRaw = useSelector(
    (s: RootState) => s.offerDecision.data
  ) as Record<string, unknown> | null | undefined;
  const termsOffersRaw = useSelector(
    (s: RootState) => s.termsOffers.data
  ) as TermsOffer[];
  const bankDetailsRaw = useSelector(
    (s: RootState) => s.bankDetails.data
  ) as BankDetail[];
  const applicationUuid = application?._id ?? "";

  const fundingSources = useMemo((): LetterFundingSources => {
    const offerDecision = offerDecisionBelongsToApplication(
      offerDecisionRaw,
      applicationUuid
    )
      ? offerDecisionRaw
      : null;
    const termsOffers = termsOffersRaw.filter((row) =>
      termsOfferBelongsToApplication(row, applicationUuid)
    );
    const merchantAccountNumber = resolveMerchantAccountNumber(
      bankDetailsRaw,
      applicationUuid
    );
    return { offerDecision, termsOffers, merchantAccountNumber };
  }, [offerDecisionRaw, termsOffersRaw, bankDetailsRaw, applicationUuid]);

  useEffect(() => {
    if (!applicationUuid) {
      dispatch(clearBankDetails());
      return;
    }
    void dispatch(getOfferDecisionByApplication(applicationUuid));
    void dispatch(getTermsOffers({ application: applicationUuid, limit: 5 }));
    void dispatch(getBankDetails({ application: applicationUuid }));
  }, [dispatch, applicationUuid]);

  const dealLabel = useMemo(
    () =>
      application?.applicationId != null
        ? String(application.applicationId)
        : routeDealLabel,
    [application?.applicationId, routeDealLabel]
  );

  const defaults = useMemo(
    () =>
      buildDefaultValues(
        application,
        dealLabel,
        fundingSources,
        senderDisplayName
      ),
    [application, dealLabel, fundingSources, senderDisplayName]
  );

  const merchantEmailDefault = useMemo(
    () =>
      coalesceRecipientEmail(
        "",
        defaults.__recipient_email ?? "",
        fundingSources.merchantAccountNumber ?? ""
      ),
    [defaults.__recipient_email, fundingSources.merchantAccountNumber]
  );

  const [templates, setTemplates] = useState<ApiTemplateItem[]>(() =>
    mergeBuiltinFeTemplates(readPaymentTemplatesCache() ?? [])
  );

  useEffect(() => {
    let mounted = true;
    const loadTemplates = async () => {
      try {
        const apiTemplates = await getPaymentTemplates(undefined, {
          force: true,
        });
        if (!mounted) return;
        setTemplates(mergeBuiltinFeTemplates(apiTemplates));
      } catch {
        // Keep session cache if the request fails
      }
    };
    void loadTemplates();
    return () => {
      mounted = false;
    };
  }, []);

  const templateSource = templates;

  const categories = useMemo(
    () =>
      Array.from(
        new Set(templateSource.map((t) => t.category))
      ) as TemplateCategory[],
    [templateSource]
  );

  const [templateType, setTemplateType] = useState<TemplateCategory>("letter");
  const [templateId, setTemplateId] = useState<string>("");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [recipientEmail, setRecipientEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [isSending, setIsSending] = useState(false);

  const templatesForType = useMemo(
    () => templateSource.filter((t) => t.category === templateType),
    [templateSource, templateType]
  );

  const selectedTemplate = useMemo(
    () => templateSource.find((t) => t.id === templateId) ?? null,
    [templateSource, templateId]
  );

  useEffect(() => {
    const list = templateSource.filter((t) => t.category === templateType);
    const nextId =
      list.find((t) => t.id === templateId)?.id ?? list[0]?.id ?? "";
    if (nextId !== templateId) setTemplateId(nextId);
  }, [templateSource, templateType, templateId]);

  const activeTemplateIdRef = useRef("");

  // Reset merge fields only when the user picks a different template.
  useEffect(() => {
    const templateId = selectedTemplate?.id ?? "";
    if (!selectedTemplate) {
      activeTemplateIdRef.current = "";
      setFieldValues({});
      setSubject("");
      setRecipientEmail("");
      return;
    }
    if (activeTemplateIdRef.current === templateId) return;
    activeTemplateIdRef.current = templateId;

    const keys = templateMergeKeys(selectedTemplate);
    const next: Record<string, string> = {};
    for (const k of keys) {
      next[k] = defaults[k] ?? "";
    }
    setFieldValues(next);
    setRecipientEmail(
      coalesceRecipientEmail(
        "",
        merchantEmailDefault,
        fundingSources.merchantAccountNumber ?? ""
      )
    );
    if (selectedTemplate.category === "email") {
      setSubject(`${selectedTemplate.name} - ${defaults.business_name || dealLabel}`);
    } else if (selectedTemplate.category === "letter") {
      setSubject(
        isPayoffOrZeroBalanceLetter(selectedTemplate.name)
          ? buildLetterEmailSubject(selectedTemplate.name, { ...defaults, ...next })
          : `RE: ${selectedTemplate.name} - Deal ID: ${dealLabel}`
      );
    } else {
      setSubject(`${selectedTemplate.name} - ${dealLabel}`);
    }
  }, [selectedTemplate, defaults, dealLabel, merchantEmailDefault, fundingSources.merchantAccountNumber]);

  // When async application data arrives, fill empty fields without overwriting edits.
  useEffect(() => {
    if (!selectedTemplate) return;
    const keys = templateMergeKeys(selectedTemplate);
    setFieldValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const k of keys) {
        const defaultVal = mergeFieldStr(defaults[k]);
        if (!mergeFieldStr(prev[k]) && defaultVal) {
          next[k] = defaultVal;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [selectedTemplate, defaults]);

  // Merchant email is separate from letter merge fields — only accept real emails.
  useEffect(() => {
    if (!selectedTemplate) return;
    setRecipientEmail((prev) =>
      coalesceRecipientEmail(
        prev,
        merchantEmailDefault,
        fundingSources.merchantAccountNumber ?? ""
      )
    );
  }, [
    selectedTemplate?.id,
    merchantEmailDefault,
    fundingSources.merchantAccountNumber,
  ]);

  const placeholderKeys = useMemo(
    () =>
      selectedTemplate
        ? templateMergeKeys(selectedTemplate)
        : [],
    [selectedTemplate]
  );

  const mergedBody = useMemo(() => {
    if (!selectedTemplate) return "";
    if (isBuiltinFeTemplate(selectedTemplate.id)) {
      return renderBuiltinReactTemplateHtml(selectedTemplate.id, fieldValues);
    }
    const escapeVals = templateBodyIsHtml(selectedTemplate.body);
    return mergeTemplate(
      selectedTemplate.body,
      fieldValues,
      escapeVals,
      placeholderKeys
    );
  }, [selectedTemplate, fieldValues, placeholderKeys]);

  const previewHtml = useDebouncedValue(mergedBody, 300);

  const previewIsHtml = Boolean(
    selectedTemplate &&
      (isBuiltinFeTemplate(selectedTemplate.id) ||
        templateBodyIsHtml(selectedTemplate.body))
  );

  const previewUsesFullDocument = Boolean(
    selectedTemplate && isBuiltinFeTemplate(selectedTemplate.id)
  );

  const autofillFromDefaults = () => {
    if (!selectedTemplate) return;
    const keys = templateMergeKeys(selectedTemplate);
    const next: Record<string, string> = {};
    for (const key of keys) {
      next[key] = defaults[key] ?? "";
    }
    setFieldValues(next);
    setRecipientEmail(
      coalesceRecipientEmail(
        "",
        merchantEmailDefault,
        fundingSources.merchantAccountNumber ?? ""
      )
    );
  };

  const clearAllInputs = () => {
    setFieldValues((prev) => {
      const next: Record<string, string> = {};
      for (const key of Object.keys(prev)) next[key] = "";
      return next;
    });
    setRecipientEmail("");
    setSubject("");
  };

  const sendLetter = async () => {
    if (!selectedTemplate) {
      toast.error("Choose a template first.");
      return;
    }
    const unresolved = placeholderKeys.filter(
      (k) => !mergeFieldStr(fieldValues[k])
    );
    if (unresolved.length) {
      toast.error(
        `Fill all fields: ${unresolved
          .map((k) => mergeFieldLabelForTemplate(k, selectedTemplate))
          .join(", ")}`
      );
      return;
    }
    if (!recipientEmail.trim()) {
      toast.error("Add the merchant email address.");
      return;
    }
    if (
      (selectedTemplate.category === "email" ||
        selectedTemplate.category === "letter") &&
      !subject.trim()
    ) {
      toast.error("Add a subject line.");
      return;
    }

    setIsSending(true);
    try {
      const recipient = recipientEmail.trim();
      const resolvedSubject =
        subject.trim() ||
        (selectedTemplate.category === "letter" &&
        isPayoffOrZeroBalanceLetter(selectedTemplate.name)
          ? buildLetterEmailSubject(selectedTemplate.name, {
              ...defaults,
              ...fieldValues,
            })
          : `${selectedTemplate.name} - Deal #${dealLabel}`);

      const outboundBody = isBuiltinFeTemplate(selectedTemplate.id)
        ? renderBuiltinReactTemplateHtml(selectedTemplate.id, fieldValues)
        : mergedBody;

      const sendResult = await dispatch(
        sendPaymentMail({
          to: recipient,
          subject: resolvedSubject,
          body: outboundBody,
          applicationId: application?._id ?? null,
          dealKey: dealLabel,
          templateName: selectedTemplate.name,
          category: selectedTemplate.category,
          attachLetterPdf:
            selectedTemplate.category === "letter" ||
            selectedTemplate.category === "email",
          letterPdfFilename:
            selectedTemplate.category === "letter" ||
            selectedTemplate.category === "email"
              ? `${selectedTemplate.name}.pdf`
              : undefined,
        })
      ).unwrap();

      toast.success(
        `Email sent to ${recipient} (${selectedTemplate.name})`
      );

      const paymentMailLog = sendResult?.data?.paymentMailLog;
      if (paymentMailLog) {
        savePaymentMailLogEntry(paymentMailLog);
      }
    } catch (error: any) {
      const message =
        typeof error === "string"
          ? error
          : error?.message || "Failed to send email";
      toast.error(message);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] p-3">
      <div className="mb-5 rounded-xl border border-border/70 bg-card/95 px-5 py-4 dark:border-white/10 dark:bg-white/[0.03]">
        <div>
          {/* <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--brand)]/20 bg-[var(--brand)]/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--brand)]">
            <Mail className="size-3.5" />
            Correspondence
          </div> */}
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Merchant Communications
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create and send letters or emails for deal
            <span className="ml-1 font-semibold text-foreground">#{dealLabel}</span>
            . Outbound email uses SendGrid from Katan Capital LLC(not your connected Gmail account).
          </p>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(680px,55%)]">
        <div className="min-w-0">
          <Card className="overflow-hidden border-border/70 bg-card shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
            <CardHeader className="border-b border-border/60 bg-muted/30 py-4 dark:border-white/10 dark:bg-white/[0.03]">
              <CardTitle className="text-md flex items-center gap-2 font-medium text-foreground">
                <span className="flex size-8 items-center justify-center rounded-lg bg-[var(--brand)]/12">
                  <FileText className="size-4 text-[var(--brand)]" />
                </span>
                Template Configuration
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-7 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Communication Type</Label>
                  <Select
                    value={templateType}
                    onValueChange={(value: string) => setTemplateType(value as TemplateCategory)}
                  >
                    <SelectTrigger className="w-full border-border bg-background dark:border-white/10 dark:bg-white/[0.04]">
                      <SelectValue placeholder="Select type..." />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>{TEMPLATE_CATEGORY_LABELS[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-foreground">Template</Label>
                  <Select
                    value={templateId}
                    onValueChange={setTemplateId}
                    disabled={!templatesForType.length}
                  >
                    <SelectTrigger className="w-full border-border bg-background dark:border-white/10 dark:bg-white/[0.04]">
                      <SelectValue placeholder="Select template..." />
                    </SelectTrigger>
                    <SelectContent>
                      {templatesForType.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Mail className="size-4" /> Delivery Details
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="text-sm text-foreground/90">Merchant Email</Label>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="email@example.com"
                      value={recipientEmail}
                      onChange={(e) => setRecipientEmail(e.target.value)}
                      className="border-border bg-background dark:border-white/10 dark:bg-white/[0.04]"
                    />
                  </div>
                  {(selectedTemplate?.category === "email" || selectedTemplate?.category === "letter") && (
                    <div className="space-y-2">
                      <Label className="text-sm text-foreground/90">Subject Line</Label>
                      <Input
                        placeholder="Enter subject..."
                        value={subject}
                        onChange={(e) => setSubject(e.target.value)}
                        className="border-border bg-background dark:border-white/10 dark:bg-white/[0.04]"
                      />
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {selectedTemplate && placeholderKeys.length > 0 && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">
                      Data Personalization
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {placeholderKeys.length} fields
                    </div>
                  </div>
                  <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 dark:border-white/10 dark:bg-white/[0.02] sm:grid-cols-2 lg:grid-cols-3">
                    {placeholderKeys.map((key) => (
                      <div key={key} className="space-y-1.5">
                        <Label className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {mergeFieldLabelForTemplate(key, selectedTemplate)}
                        </Label>
                        <Input
                          value={fieldValues[key] || ""}
                          onChange={(e) => setFieldValues((p) => ({ ...p, [key]: e.target.value }))}
                          className="h-9 border-border bg-background text-sm dark:border-white/10 dark:bg-white/[0.04]"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
            <CardFooter className="flex flex-wrap justify-end gap-2 border-t border-border/60 bg-muted/25 px-5 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <Button
                type="button"
                variant="outline"
                onClick={autofillFromDefaults}
                disabled={!selectedTemplate}
                className="cursor-pointer border-border dark:border-white/10"
              >
                <RotateCcw className="mr-2 size-4" />
                Autofill Defaults
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={clearAllInputs}
                disabled={!selectedTemplate}
                className="cursor-pointer border-border dark:border-white/10"
              >
                Clear
              </Button>
            </CardFooter>
          </Card>
        </div>

        <div className="min-w-0 w-full lg:sticky lg:top-6 lg:self-start">
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-xl border border-border/70 bg-card/95 px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
              <div className="flex items-center gap-3">
                <span className="hidden h-8 w-1 rounded-full bg-[var(--brand)] sm:block" aria-hidden />
                <Mail className="size-5" />
                <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Live Preview
                </h3>
              </div>
              {isSending && (
                <span className="rounded-full bg-blue-50 px-3 py-1 text-[10px] font-medium text-[var(--brand)] animate-pulse">
                  Processing...
                </span>
              )}
            </div>

              <CardContent className="flex-1 overflow-hidden p-0">
                {selectedTemplate ? (
                  <div className="m-4 min-h-[460px] rounded-xl border border-border/70 bg-card p-6 text-foreground dark:border-white/10 dark:bg-white/[0.03] sm:m-5 sm:p-3">
                    <div className="mb-5 space-y-2 rounded-lg border border-border/60 bg-muted/25 p-4 dark:border-white/10 dark:bg-white/[0.03]">
                      <p className="text-[13px] text-muted-foreground">
                        Template:{" "}
                        <span className="font-medium text-foreground">
                          {selectedTemplate.name}
                        </span>
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        Type:{" "}
                        <span className="font-medium capitalize text-foreground">
                          {selectedTemplate.category}
                        </span>
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        To:{" "}
                        <span className="break-all font-medium text-foreground">
                          {recipientEmail || "(Empty)"}
                        </span>
                      </p>
                      <p className="text-[13px] text-muted-foreground">
                        Subject:{" "}
                        <span className="break-words font-medium text-foreground">
                          {subject || "(No Subject)"}
                        </span>
                      </p>
                    </div>
                    <div
                      className={cn(
                        "rounded-md border border-slate-200 bg-white",
                        previewUsesFullDocument
                          ? "overflow-hidden"
                          : "max-h-[min(54vh,480px)] overflow-y-auto p-3 pr-1 text-[13px] text-slate-900",
                        !previewUsesFullDocument &&
                          previewIsHtml &&
                          "font-sans leading-normal [&_table]:w-full [&_td]:align-top",
                        !previewUsesFullDocument &&
                          !previewIsHtml &&
                          "whitespace-pre-wrap font-serif leading-7"
                      )}
                    >
                      {previewUsesFullDocument ? (
                        <LetterHtmlPreviewFrame
                          html={previewHtml}
                          title="Letter preview"
                          className="block h-[min(54vh,480px)] bg-[#f3f4f6]"
                        />
                      ) : previewIsHtml ? (
                        <div
                          className="email-html-preview"
                          dangerouslySetInnerHTML={{ __html: previewHtml }}
                        />
                      ) : (
                        previewHtml
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full min-h-[420px] flex-col items-center justify-center space-y-3 p-12 text-center">
                    <div className="flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-muted/30 dark:border-white/10 dark:bg-white/[0.03]">
                      <FileText className="size-7 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Select a template to preview and send
                    </p>
                  </div>
                )}
              </CardContent>

              <CardFooter className="border-t border-border/60 bg-muted/25 p-4 dark:border-white/10 dark:bg-white/[0.03] sm:p-5">
                <Button
                  onClick={() => void sendLetter()}
                  disabled={!selectedTemplate || isSending}
                  className="w-full bg-[var(--brand)] py-5 text-base font-semibold text-white cursor-pointer hover:bg-[#1e547a]"
                >
                  {isSending ? (
                    "Sending..."
                  ) : (
                    <>
                      <Send className="mr-2 size-4" />
                      Send Communication
                    </>
                  )}
                </Button>
              </CardFooter>
         
          </div>
        </div>
      </div>
    </div>
  );
}
