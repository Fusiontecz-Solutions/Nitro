import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
    Building2,
    Calculator,
    ChevronRight,
    CopyCheck,
    DollarSign,
    FilePenLine,
    FileText,
    Globe,
    Landmark,
    LayoutList,
    Receipt,
    ScrollText,
    Users,
    Wallet,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    applyAuthorizationBusinessNamePrefillFields,
    applyLiveBankDetailsToPrefillMerge,
    applyLiveOfferSyncToPrefillPartial,
    applyOwnerRowsToPrefillMerge,
    applySeparatedAddressPrefillFields,
    contractPrefillToContractColumnUpdate,
    finalCalculationPrefillSyncKey,
    finalizeContractPrefillMoneyFields,
    getContractPrefillEditDefaultsFromApplication,
    normalizeContractPrefillOverrides,
    omitLiveOfferMoneyPrefillKeys,
    stripStaleOfferOverridesFromPersisted,
    coercePaymentFrequencyLabel,
    mergeNonemptyPrefillPartial,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
} from "./Contract";
import {
    clearParty2PrefillPartial,
    GUARANTOR1_PREFILL_FORM_KEYS,
    GUARANTOR2_PREFILL_FORM_KEYS,
    OWNER2_PREFILL_FORM_KEYS,
    resolveActiveGuarantorCount,
    resolveActiveOwnerCount,
    resolveOwnerRowFullName,
    resolveSecondOwnerSignerName,
    syncOwner2NameToPrefillPartial,
} from "./contractPartyCounts";
import {
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY,
    DOCUMENT_SEND_HISTORY_KEY,
    getDocumentTemplatePrefillFieldRowsForEditor,
    hasStateDisclosurePrefillFieldMap,
    LINKED_DOCUSIGN_ADDENDUM_SECTION_ID,
    LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID,
    stripDocumentTemplateBlobFromPrefillOverrides,
} from "./documentTemplateMappingPrefill";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import { toast } from "react-toastify";
import { cn } from "@/lib/utils";
import { syncContractPrefillToSourceRecords } from "./contractPrefillSourceSync";
import { MANUAL_NET_TO_MERCHANT_KEY } from "../contractRecipientFundsSync";
import { SpaCalculationModal } from "./SpaCalculationModal";
import { persistCalculatedPurchasePercent } from "./spaPrefillSync";
import {
    buildDocuSignRolesFromEditorRows,
    CONTRACT_SIGNER_OVERRIDES_KEY,
    parseContractSignerOverridesFromPrefill,
    type ContractSignerOverrideRow,
} from "./templateRecipients";
import { isSignNowContractUiEnabled } from "./contractTemplatePreview";
import { isSignNowDisclosureLayoutKey } from "./signnowAddendumTemplates";

type LegacySnakeCasePrefillKey =
    | "ach_authorization_bank_portal_website"
    | "ach_authorization_username"
    | "ach_authorization_password"
    | "ach_authorization_security_question1"
    | "ach_authorization_security_answer1"
    | "ach_authorization_security_question2"
    | "ach_authorization_security_answer2"
    | "ach_authorization_security_question3"
    | "ach_authorization_security_answer3"
    | "ach_authorization_other_infomation";
type ContractPrefillFormFieldKey = Exclude<keyof BuildContractPrefillFieldsArgs, LegacySnakeCasePrefillKey>;

/** Field labels aligned with Deal Review + Offer decision (section title provides context). */
const FIELD_LABELS = {
    customerName: "Customer / primary name",
    entityType: "Type of entity",
    legalName: "Legal name",
    doingBusinessAs: "DBA",
    businessAddress: "Street",
    federalTaxIdEin: "EIN",
    agreementDate: "Agreement date",
    state: "State of incorporation",
    businessAddressCity: "City",
    businessAddressState: "State",
    businessAddressZip: "Business ZIP",
    businessAddressContract: "Street",
    businessAddressContractCity: "City",
    businessAddressContractState: "State",
    businessAddressContractZip: "Contract ZIP",
    guarantorAddress: "Street",
    guarantorAddressCity: "City",
    guarantorAddressState: "State",
    guarantorAddressZip: "Guarantor ZIP",
    clientEmail: "Email",
    guarantorEmail: "Email",
    guarantorPhone: "Phone",
    clientPhone: "Phone",
    purchasePrice: "Payback amount",
    purchaseAmount: "Offer amount",
    purchasePercent: "Specific Percentage",
    remittance: "Total remit (payment amount)",
    refinanceAmount: "REFI Amount",
    frequency: "Frequency",
    achProgramFee: "ACH Program Fee",
    includeWireFee: "Include $25 wire fee",
    netToMerchant: "Recipient funds",
    clientName: "Name",
    ownerPrintTitle: "Print title",
    guarantorPrintTitle: "Print title",
    owner1GuarantorName: "Name",
    owner2GuarantorName: "Name",
    merchant2Name: "Name",
    appendixMerchant2Name: "Name",
    businessName2: "Name",
    securityBusinessName: "Business name",
    securityTaxEin: "Tax ID / EIN",
    securityDoingBusinessAs: "DBA",
    securityBusinessAddress: "Street",
    securityBusinessAddressCity: "City",
    securityBusinessAddressState: "State",
    securityBusinessAddressZip: "Security ZIP",
    securityGuarantor: "Guarantor",
    guarantyClientName: "Name",
    guarantySs: "SSN",
    guarantySsDriverLicense: "Driver license",
    guarantyOwner1Name: "Name",
    guarantyOwner1Ss: "SSN",
    guarantyOwner1DriverLicense: "Driver license",
    guarantyOwner2Name: "Name",
    guarantyOwner2DriverLicense: "Driver license",
    guarantyOwner2Ss: "SSN",
    guarantyGuarantor1Name: "Name",
    guarantyGuarantor1Ss: "SSN",
    guarantyGuarantor1DriverLicense: "Driver license",
    guarantyGuarantor2Name: "Name",
    guarantyGuarantor2Ss: "SSN",
    guarantyGuarantor2DriverLicense: "Driver license",
    appendixUnderwritingFees: "Underwriting fees (% or $; sent as $ on contract)",
    appendixClientName: "Client name",
    authorizationApplication: "Merchant name",
    authorizationClientBankName: "Bank name",
    authorizationClientBankRouting: "Routing number",
    authorizationClientBankAccount: "Account number",
    authorizationClientName: "Signer name",
    authorizationClientSignerName: "Business name (signer line)",
    authorizationClientNamePrint: "Printed client name",
    authorizationClientTaxId: "Tax ID / EIN",
    authorizationClientDate: "Date",
    authorizedBusinessPhone: "Business phone",
    achAuthorizationAccountHolderName: "Name",
    achAuthorizationAccountHolderDba: "DBA",
    achAuthorizationAccountHolderPhone: "Phone",
    achAuthorizationAccountHolderAddress: "Street",
    achAuthorizationAccountHolderCity: "City",
    achAuthorizationAccountHolderState: "State",
    achAuthorizationAccountHolderZip: "ZIP",
    achAuthorizationAccountHolderBankName: "Bank name",
    achAuthorizationAccountHolderBankBranchCity: "Branch city",
    achAuthorizationAccountHolderBankState: "Bank state",
    achAuthorizationAccountHolderBankZip: "Bank ZIP",
    achAuthorizationAccountHolderBankRoutingNumber: "Routing number",
    achAuthorizationAccountHolderBankAccountNumber: "Account number",
    achAuthorizationAccountHolderBankTransactionFee: "Transaction fee",
    achAuthorizationAccountHolderBankNumberOfTransactions: "NO. of transaction",
    achAuthorizationAccountHolderDate: "Date",
    achAuthorizationConcentAccountHolderName: "Client name (ACH consent)",
    achAuthorizationConcentAccountHolderName2: "Client name (ACH consent page 2)",
    achAuthorizationConcentAccountHolderDate: "Date",
    achAuthorizationBankPortalWebsite: "Bank portal URL",
    achAuthorizationUsername: "Username",
    achAuthorizationPassword: "Password",
    achAuthorizationSecurityQuestion1: "Security question 1",
    achAuthorizationSecurityAnswer1: "Security answer 1",
    achAuthorizationSecurityQuestion2: "Security question 2",
    achAuthorizationSecurityAnswer2: "Security answer 2",
    achAuthorizationSecurityQuestion3: "Security question 3",
    achAuthorizationSecurityAnswer3: "Security answer 3",
    achAuthorizationOtherInfomation: "Other information",
    achAuthorizationReferenceName1: "Name",
    achAuthorizationReferenceNumber1: "Phone",
    achAuthorizationReferenceRelationship1: "Relationship",
    achAuthorizationReferenceName2: "Name",
    achAuthorizationReferenceNumber2: "Phone",
    achAuthorizationReferenceRelationship2: "Relationship",
    achAuthorizationReferenceName3: "Name",
    achAuthorizationReferenceNumber3: "Phone",
    achAuthorizationReferenceRelationship3: "Relationship",
    addendumDated: "Date",
    addendumDatedPrincipalOwner: "Owner",
    addendumDatedPrincipalBusiness: "Business",
    addendumDatedBusinessLocation: "Business location",
    addendumDatedPrincipalState: "State",
    addendumDatedPrincipalOwnerAmount: "Offer amount",
    addendumDatedPrincipalOwnerAmount2: "Payback amount",
    addendumDatedPrincipalOwner1Name: "Name",
    addendumDatedPrincipalOwner1Date: "Date",
    addendumDatedPrincipalOwner2Name: "Name",
    addendumDatedPrincipalOwner2Date: "Date",
    exhibitOwnerName: "Exhibit owner",
    exhibitAValue1: "Exhibit A company 1",
    exhibitAValue2: "Exhibit A company 2",
    exhibitAValue3: "Exhibit A company 3",
    exhibitAValue4: "Exhibit A company 4",
    exhibitAValue5: "Exhibit A company 5",
    exhibitAValue6: "Exhibit A company 6",
    exhibitAValue7: "Exhibit A company 7",
    exhibitAValue8: "Exhibit A company 8",
    exhibitAValue9: "Exhibit A company 9",
    exhibitAValue10: "Exhibit A company 10",
} as const satisfies Record<ContractPrefillFormFieldKey, string>;

/** Matches Create Client / application business entity options. */
const ENTITY_TYPE_OPTIONS = [
    { value: "LLC", label: "LLC" },
    { value: "Corporation", label: "Corporation" },
    { value: "Partnership", label: "Partnership" },
    { value: "Sole Proprietorship", label: "Sole Proprietorship" },
    { value: "S-Corp", label: "S-Corp" },
    { value: "C-Corp", label: "C-Corp" },
    { value: "Non-Profit", label: "Non-Profit" },
    { value: "Other", label: "Other" },
] as const;

const PAYMENT_FREQUENCY_OPTIONS = [
    { value: "Daily", label: "Daily" },
    { value: "Weekly", label: "Weekly" },
    { value: "Bi-Weekly", label: "Bi-Weekly" },
    { value: "Monthly", label: "Monthly" },
] as const;

type ContractPrefillSectionGroup = {
    /** Sub-heading inside the section (e.g. Client, Guarantor). */
    heading?: string;
    keys: ContractPrefillFormFieldKey[];
};

type ContractPrefillSection = {
    id: string;
    title: string;
    description: string;
    Icon: LucideIcon;
    groups: ContractPrefillSectionGroup[];
};

function contractPrefillSectionKeys(section: ContractPrefillSection): ContractPrefillFormFieldKey[] {
    return section.groups.flatMap((g) => g.keys);
}

/**
 * Nitro Advance 2026 contract layout only (`contract.layout.json` data labels).
 * Omits legacy addendum fields that are not on the Nitro Advance PDF.
 * `refinanceAmount` is included for recipient-funds math even when not a DocuSign placement.
 */
const CONTRACT_PREFILL_SECTIONS: ContractPrefillSection[] = [
    {
        id: "merchant",
        title: "Merchant & agreement",
        description: "Page 1 — agreement date, legal name, entity, DBA, merchant name and phone.",
        Icon: FileText,
        groups: [
            {
                keys: [
                    "agreementDate",
                    "legalName",
                    "entityType",
                    "doingBusinessAs",
                    "federalTaxIdEin",
                    "clientName",
                    "clientPhone",
                    "clientEmail",
                ],
            },
        ],
    },
    {
        id: "addresses",
        title: "Addresses",
        description: "Business, contract/mailing, and guarantor address lines on the Nitro Advance MCA.",
        Icon: Building2,
        groups: [
            {
                heading: "Business",
                keys: [
                    "businessAddress",
                    "businessAddressCity",
                    "businessAddressState",
                    "businessAddressZip",
                ],
            },
            {
                heading: "Contract / mailing",
                keys: [
                    "businessAddressContract",
                    "businessAddressContractCity",
                    "businessAddressContractState",
                    "businessAddressContractZip",
                ],
            },
            {
                heading: "Guarantor",
                keys: [
                    "guarantorAddress",
                    "guarantorAddressCity",
                    "guarantorAddressState",
                    "guarantorAddressZip",
                    "guarantorEmail",
                    "guarantorPhone",
                ],
            },
        ],
    },
    {
        id: "financial",
        title: "Offer & payback",
        description:
            "Purchase price, offer amount, percentage, remittance, REFI (for recipient funds), frequency, and net to merchant.",
        Icon: DollarSign,
        groups: [
            {
                keys: [
                    "purchasePrice",
                    "purchaseAmount",
                    "purchasePercent",
                    "remittance",
                    "refinanceAmount",
                    "frequency",
                    "includeWireFee",
                    "netToMerchant",
                    "achProgramFee",
                    "appendixUnderwritingFees",
                ],
            },
        ],
    },
    {
        id: "owners",
        title: "Owners & guarantors",
        description: "Owner names, Exhibit A company line, and guaranty SSN / driver license fields.",
        Icon: Users,
        groups: [
            { heading: "Owners", keys: ["owner1GuarantorName", "owner2GuarantorName", "exhibitAValue1"] },
            {
                heading: "Owner 1 ID",
                keys: ["guarantyOwner1Ss", "guarantyOwner1DriverLicense"],
            },
            {
                heading: "Guarantor 2",
                keys: [
                    "guarantyGuarantor2Name",
                    "guarantyGuarantor2Ss",
                    "guarantyGuarantor2DriverLicense",
                ],
            },
            {
                heading: "Security address",
                keys: [
                    "securityBusinessAddress",
                    "securityBusinessAddressCity",
                    "securityBusinessAddressState",
                    "securityBusinessAddressZip",
                ],
            },
        ],
    },
    {
        id: "ach_deposit",
        title: "ACH / bank (funding)",
        description: "Bank details and signer on the ACH debit / funding pages.",
        Icon: Landmark,
        groups: [
            {
                keys: [
                    "authorizationClientBankName",
                    "authorizationClientBankRouting",
                    "authorizationClientBankAccount",
                    "authorizationClientTaxId",
                    "authorizationClientName",
                    "authorizedBusinessPhone",
                ],
            },
        ],
    },
    {
        id: "ach_account_bank",
        title: "ACH — Account holder & bank",
        description: "Account holder block and bank branch / routing on the ACH form.",
        Icon: Wallet,
        groups: [
            {
                heading: "Account holder",
                keys: [
                    "achAuthorizationAccountHolderName",
                    "achAuthorizationAccountHolderDba",
                    "achAuthorizationAccountHolderPhone",
                    "achAuthorizationAccountHolderAddress",
                    "achAuthorizationAccountHolderCity",
                    "achAuthorizationAccountHolderState",
                    "achAuthorizationAccountHolderZip",
                ],
            },
            {
                heading: "Consent",
                keys: ["achAuthorizationConcentAccountHolderName"],
            },
        ],
    },
    {
        id: "ach_portal_refs",
        title: "ACH — Portal & references",
        description: "Bank portal login, security questions, notes, and emergency contacts.",
        Icon: Globe,
        groups: [
            {
                heading: "Online banking",
                keys: [
                    "achAuthorizationBankPortalWebsite",
                    "achAuthorizationUsername",
                    "achAuthorizationPassword",
                    "achAuthorizationSecurityQuestion1",
                    "achAuthorizationSecurityQuestion2",
                    "achAuthorizationOtherInfomation",
                ],
            },
            {
                heading: "Reference 1",
                keys: [
                    "achAuthorizationReferenceName1",
                    "achAuthorizationReferenceNumber1",
                    "achAuthorizationReferenceRelationship1",
                ],
            },
        ],
    },
];

type PrefillSyncGroup = {
    id: string;
    label: string;
    keys: ContractPrefillFormFieldKey[];
};

/** Shared logical values repeated across contract sections — synced via “Sync to all”. */
const PREFILL_SYNC_GROUPS: PrefillSyncGroup[] = [
    {
        id: "ein",
        label: "EIN / Tax ID",
        keys: ["federalTaxIdEin", "securityTaxEin", "authorizationClientTaxId"],
    },
    {
        id: "dba",
        label: "DBA",
        keys: ["doingBusinessAs", "achAuthorizationAccountHolderDba"],
    },
    {
        id: "routing",
        label: "Routing number",
        keys: ["authorizationClientBankRouting", "achAuthorizationAccountHolderBankRoutingNumber"],
    },
    {
        id: "account",
        label: "Account number",
        keys: ["authorizationClientBankAccount", "achAuthorizationAccountHolderBankAccountNumber"],
    },
    {
        id: "bankName",
        label: "Bank name",
        keys: ["authorizationClientBankName", "achAuthorizationAccountHolderBankName"],
    },
    {
        id: "businessName",
        label: "Business / legal name",
        keys: ["legalName", "achAuthorizationAccountHolderName", "authorizationClientName"],
    },
    {
        id: "clientName",
        label: "Client / primary name",
        keys: [
            "clientName",
            "achAuthorizationConcentAccountHolderName",
            "owner1GuarantorName",
            "guarantyGuarantor1Name",
        ],
    },
    {
        id: "businessPhone",
        label: "Business phone",
        keys: ["clientPhone", "authorizedBusinessPhone", "achAuthorizationAccountHolderPhone"],
    },
    {
        id: "street",
        label: "Business street",
        keys: ["businessAddress", "achAuthorizationAccountHolderAddress"],
    },
    {
        id: "offerAmount",
        label: "Offer amount",
        keys: ["purchaseAmount"],
    },
    {
        id: "paybackAmount",
        label: "Payback amount",
        keys: ["purchasePrice"],
    },
    {
        id: "paymentAmount",
        label: "Payment / transaction fee",
        keys: ["remittance", "achAuthorizationAccountHolderBankTransactionFee"],
    },
    {
        id: "owner1Name",
        label: "Owner 1 name",
        keys: ["owner1GuarantorName", "guarantyGuarantor1Name", "clientName"],
    },
    {
        id: "owner2Name",
        label: "Owner 2 name",
        keys: ["owner2GuarantorName", "guarantyGuarantor2Name"],
    },
    {
        id: "ssn",
        label: "SSN",
        keys: ["guarantyOwner1Ss", "guarantyGuarantor1Ss"],
    },
    {
        id: "driverLicense",
        label: "Driver license",
        keys: ["guarantyOwner1DriverLicense", "guarantyGuarantor1DriverLicense"],
    },
    {
        id: "owner2Ssn",
        label: "Owner 2 / Guarantor 2 SSN",
        keys: ["guarantyGuarantor2Ss"],
    },
    {
        id: "owner2DriverLicense",
        label: "Owner 2 / Guarantor 2 driver license",
        keys: ["guarantyGuarantor2DriverLicense"],
    },
    {
        id: "date",
        label: "Date",
        keys: ["agreementDate"],
    },
];

/** Shared logical values — mirrored on every keystroke (Katan-style sync across sections). */
const PREFILL_REALTIME_MIRROR_BY_KEY = (() => {
    const map = new Map<ContractPrefillFormFieldKey, ContractPrefillFormFieldKey[]>();
    for (const group of PREFILL_SYNC_GROUPS) {
        for (const key of group.keys) {
            map.set(key, group.keys);
        }
    }
    return map;
})();

const ADDENDUM_VERIFY_SKIP_ID_RE =
    /bank_name|bank_account|bank_routing|routing_number|account_number|authorization_client_bank|agreement_date|client_legal_name|^client_name|ach_account_holder_|federal_tax|doing_business|guaranty_ss|ein|_dba/i;

function collectMappingBlobValues(
    blob: Record<string, Record<string, string>> | null | undefined,
): Record<string, string> {
    const out: Record<string, string> = {};
    if (!blob) return out;
    for (const row of Object.values(blob)) {
        if (!row || typeof row !== "object") continue;
        for (const [key, raw] of Object.entries(row)) {
            const value = String(raw ?? "").trim();
            if (value && !out[key]) out[key] = value;
        }
    }
    return out;
}

function firstBlobValueMatching(
    values: Record<string, string>,
    patterns: RegExp[],
): string {
    for (const [id, value] of Object.entries(values)) {
        if (!value) continue;
        if (patterns.some((pattern) => pattern.test(id))) return value;
    }
    return "";
}

function overlayAddendumBlobOntoMainPrefill(
    merged: Record<string, unknown>,
    blob: Record<string, Record<string, string>> | null | undefined,
): void {
    const fromAddendum = collectMappingBlobValues(blob);
    const pick = (...ids: string[]) => {
        for (const id of ids) {
            const value = String(fromAddendum[id] ?? "").trim();
            if (value) return value;
        }
        return "";
    };
    const fill = (key: string, ...ids: string[]) => {
        if (String(merged[key] ?? "").trim()) return;
        const value = pick(...ids);
        if (value) merged[key] = value;
    };
    fill(
        "doingBusinessAs",
        "ach_account_holder_dba_p1",
        "doing_business_as_p1",
        "doing_business_as",
        "merchant_dba",
        "dba",
    );
    if (!String(merged.doingBusinessAs ?? "").trim()) {
        const dba = firstBlobValueMatching(fromAddendum, [/dba/i, /doing_business/i]);
        if (dba) merged.doingBusinessAs = dba;
    }
    fill(
        "federalTaxIdEin",
        "addendum_ein_1_p1",
        "federal_tax_id_EIN",
        "federal_tax_id_ein",
        "security_tax_ein",
        "ein",
        "tax_id",
    );
    if (!String(merged.federalTaxIdEin ?? "").trim()) {
        const ein = firstBlobValueMatching(fromAddendum, [/ein/i, /tax_id/i, /federal_tax/i]);
        if (ein) merged.federalTaxIdEin = ein;
    }
    fill("legalName", "client_legal_name_p1", "client_legal_name");
    fill("guarantyOwner1Ss", "guaranty_ss_p1", "guaranty_ss", "owner1_ssn", "owner_1_ssn");
    fill(
        "authorizationClientBankName",
        "ach_bank_name_p1",
        "ach_authorization_account_holder_bank_name",
    );
    fill(
        "authorizationClientBankRouting",
        "ach_bank_routing_p1",
        "ach_authorization_account_holder_bank_routing_number",
    );
    fill(
        "authorizationClientBankAccount",
        "ach_bank_account_p1",
        "ach_authorization_account_holder_bank_account_number",
    );
}

function copySharedPrefillAliases(
    values: Record<string, string>,
): Record<string, string> {
    const next = { ...values };
    const fill = (target: string, source: string) => {
        if (String(next[target] ?? "").trim()) return;
        const value = String(next[source] ?? "").trim();
        if (value) next[target] = value;
    };
    fill("guarantyGuarantor1Name", "owner1GuarantorName");
    fill("guarantyGuarantor1Ss", "guarantyOwner1Ss");
    fill("guarantyGuarantor1DriverLicense", "guarantyOwner1DriverLicense");
    fill("securityTaxEin", "federalTaxIdEin");
    fill("achAuthorizationAccountHolderDba", "doingBusinessAs");
    fill("doingBusinessAs", "achAuthorizationAccountHolderDba");
    fill("federalTaxIdEin", "securityTaxEin");
    fill("achAuthorizationAccountHolderBankName", "authorizationClientBankName");
    fill("achAuthorizationAccountHolderBankRoutingNumber", "authorizationClientBankRouting");
    fill("achAuthorizationAccountHolderBankAccountNumber", "authorizationClientBankAccount");
    fill("authorizationClientBankName", "achAuthorizationAccountHolderBankName");
    fill("authorizationClientBankRouting", "achAuthorizationAccountHolderBankRoutingNumber");
    fill("authorizationClientBankAccount", "achAuthorizationAccountHolderBankAccountNumber");
    const frequency = coercePaymentFrequencyLabel(next.frequency);
    if (frequency) next.frequency = frequency;
    return next;
}

function pickPreservedContractPrefillMeta(
    resolvedContract: Record<string, unknown> | null | undefined,
    liveSignerRows: ContractSignerOverrideRow[] | null | undefined,
): Record<string, unknown> {
    const preserved: Record<string, unknown> = {};
    const raw = resolvedContract?.contractPrefillOverrides;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        const o = raw as Record<string, unknown>;
        for (const key of [
            CONTRACT_SIGNER_OVERRIDES_KEY,
            DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY,
            DOCUMENT_SEND_HISTORY_KEY,
            // Keep voided/sent/signed/completed rows in Contracts Generated after resend.
            "contractSendHistory",
            "mainContractSendPackage",
            "achAuthorizationDocuSign",
            "achSendHistory",
            "standalonePackageDocuSign",
            "standalonePackageSendHistory",
            "lastAchSentFunder",
        ] as const) {
            if (o[key] !== undefined) preserved[key] = o[key];
        }
    }
    if (liveSignerRows?.length) {
        preserved[CONTRACT_SIGNER_OVERRIDES_KEY] = liveSignerRows;
    } else if (!preserved[CONTRACT_SIGNER_OVERRIDES_KEY]) {
        const parsed = parseContractSignerOverridesFromPrefill(raw);
        if (parsed?.length) preserved[CONTRACT_SIGNER_OVERRIDES_KEY] = parsed;
    }
    return preserved;
}

function applySecondOwnerNameToPrefillPartial(
    partial: Partial<BuildContractPrefillFieldsArgs>,
    secondOwnerName: string,
    secondOwnerSs?: string,
    secondOwnerDriverLicense?: string,
): void {
    const name = String(secondOwnerName || "").trim();
    if (name) {
        syncOwner2NameToPrefillPartial(partial as Record<string, unknown>, name);
    }
    const ssn = String(secondOwnerSs || "").trim();
    if (ssn) {
        for (const key of ["guarantyOwner2Ss", "guarantyGuarantor2Ss"] as const) {
            if (!String(partial[key] || "").trim()) partial[key] = ssn;
        }
    }
    const dl = String(secondOwnerDriverLicense || "").trim();
    if (dl) {
        for (const key of ["guarantyOwner2DriverLicense", "guarantyGuarantor2DriverLicense"] as const) {
            if (!String(partial[key] || "").trim()) partial[key] = dl;
        }
    }
}

function emptyValuesRecord(): Record<keyof BuildContractPrefillFieldsArgs, string> {
    const out = {} as Record<keyof BuildContractPrefillFieldsArgs, string>;
    for (const k of Object.keys(FIELD_LABELS) as (keyof BuildContractPrefillFieldsArgs)[]) {
        out[k] = k === "includeWireFee" ? "true" : "";
    }
    return out;
}

function mergeFormState(
    base: Partial<BuildContractPrefillFieldsArgs>,
): Record<keyof BuildContractPrefillFieldsArgs, string> {
    const rec = emptyValuesRecord();
    for (const k of Object.keys(FIELD_LABELS) as (keyof BuildContractPrefillFieldsArgs)[]) {
        const v = base[k];
        rec[k] = v === undefined || v === null ? rec[k] : String(v);
    }
    if (!String(rec.includeWireFee ?? "").trim()) rec.includeWireFee = "true";
    const frequency = coercePaymentFrequencyLabel(rec.frequency);
    if (frequency) rec.frequency = frequency;
    return rec;
}

function toPayload(values: Record<keyof BuildContractPrefillFieldsArgs, string>): Partial<BuildContractPrefillFieldsArgs> {
    const out: Partial<BuildContractPrefillFieldsArgs> = {};
    for (const k of Object.keys(FIELD_LABELS) as (keyof BuildContractPrefillFieldsArgs)[]) {
        (out as Record<string, string>)[k] = values[k] ?? "";
    }
    return out;
}

/** `Number(null)` is `0` in JS — never treat that as a valid contract id. */
function parsePositiveContractId(id: number | string | null | undefined): number | null {
    if (id === null || id === undefined) return null;
    const n = typeof id === "number" ? id : Number(String(id).trim());
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
    return n;
}

type FieldErrors = Partial<Record<keyof BuildContractPrefillFieldsArgs, string>>;

const EMAIL_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = ["clientEmail", "guarantorEmail"];
const PHONE_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "clientPhone",
    "guarantorPhone",
    "authorizedBusinessPhone",
    "achAuthorizationAccountHolderPhone",
];
const EIN_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "federalTaxIdEin",
    "securityTaxEin",
    "authorizationClientTaxId",
];
const ROUTING_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "authorizationClientBankRouting",
    "achAuthorizationAccountHolderBankRoutingNumber",
];
const ZIP_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "businessAddressZip",
    "businessAddressContractZip",
    "guarantorAddressZip",
    "securityBusinessAddressZip",
    "achAuthorizationAccountHolderZip",
    "achAuthorizationAccountHolderBankZip",
];
const DATE_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "agreementDate",
    "authorizationClientDate",
    "achAuthorizationAccountHolderDate",
    "achAuthorizationConcentAccountHolderDate",
    "addendumDatedPrincipalOwner1Date",
    "addendumDatedPrincipalOwner2Date",
];
/** Shown empty until the user saves a value in contract prefill overrides. */
const REQUIRED_PREFILL_FIELD_KEYS = new Set<keyof BuildContractPrefillFieldsArgs>([
    "legalName",
    "purchasePercent",
    "remittance",
]);

const MONEY_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "purchasePrice",
    "purchaseAmount",
    "remittance",
    "refinanceAmount",
    "netToMerchant",
    "appendixUnderwritingFees",
    "addendumDatedPrincipalOwnerAmount",
    "addendumDatedPrincipalOwnerAmount2",
    "achAuthorizationAccountHolderBankNumberOfTransactions",
    "achAuthorizationAccountHolderBankTransactionFee",
];
const SSN_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "guarantySs",
    "guarantyOwner1Ss",
    "guarantyOwner2Ss",
    "guarantyGuarantor1Ss",
    "guarantyGuarantor2Ss",
];
/** When exactly two characters, treat as US state abbreviation. */
const US_STATE_ABBR_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "businessAddressState",
    "businessAddressContractState",
    "guarantorAddressState",
    "securityBusinessAddressState",
    "achAuthorizationAccountHolderState",
    "achAuthorizationAccountHolderBankState",
];

function trimField(values: Record<keyof BuildContractPrefillFieldsArgs, string>, key: keyof BuildContractPrefillFieldsArgs) {
    return String(values[key] ?? "").trim();
}

function validateEmail(value: string): string | null {
    if (!value) return null;
    const simple = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return simple.test(value) ? null : "Enter a valid email address.";
}

function validatePhone(value: string): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    return digits.length >= 10 ? null : "Enter a phone number with at least 10 digits.";
}

function validateEin(value: string): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    return digits.length === 9 ? null : "EIN / tax ID must be 9 digits (optional XX-XXXXXXX format).";
}

function validateRouting(value: string): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    return digits.length === 9 ? null : "Routing number must be exactly 9 digits.";
}

function validateUsZip(value: string): string | null {
    if (!value) return null;
    return /^\d{5}(-\d{4})?$/.test(value) ? null : "Use 12345 or 12345-6789 for ZIP.";
}

function validateDate(value: string): string | null {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? "Enter a valid date." : null;
}

function validateMoney(value: string): string | null {
    if (!value) return null;
    const cleaned = String(value).replace(/[^0-9.-]/g, "");
    if (cleaned === "" || cleaned === "-" || cleaned === ".") return "Enter a valid number.";
    const n = Number(cleaned);
    return Number.isFinite(n) ? null : "Enter a valid number.";
}

function validatePercent(value: string): string | null {
    if (!value) return null;
    const n = Number(String(value).replace(/%/g, "").trim());
    if (!Number.isFinite(n)) return "Enter a valid percent.";
    if (n < 0 || n > 100) return "Percent must be between 0 and 100.";
    return null;
}

function validateSsnDigits(value: string): string | null {
    if (!value) return null;
    const digits = value.replace(/\D/g, "");
    return digits.length === 9 ? null : "SSN must be 9 digits (dashes optional).";
}

function validateTwoLetterState(value: string): string | null {
    if (value.length !== 2) return null;
    return /^[A-Za-z]{2}$/.test(value) ? null : "Use a two-letter state code (e.g. CA).";
}

function validatePrefillValues(values: Record<keyof BuildContractPrefillFieldsArgs, string>): FieldErrors {
    const err: FieldErrors = {};

    if (!trimField(values, "customerName")) {
        err.customerName = "Customer / primary name is required.";
    }

    const clientPhoneVal = trimField(values, "clientPhone");
    if (clientPhoneVal) {
        const clientPhoneMsg = validatePhone(clientPhoneVal);
        if (clientPhoneMsg) err.clientPhone = clientPhoneMsg;
    }

    for (const key of EMAIL_KEYS) {
        const msg = validateEmail(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of PHONE_KEYS) {
        if (key === "clientPhone") continue;
        const msg = validatePhone(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of EIN_KEYS) {
        const msg = validateEin(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of ROUTING_KEYS) {
        const msg = validateRouting(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of ZIP_KEYS) {
        const msg = validateUsZip(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of DATE_KEYS) {
        const msg = validateDate(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of MONEY_KEYS) {
        const msg = validateMoney(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of SSN_KEYS) {
        const msg = validateSsnDigits(trimField(values, key));
        if (msg) err[key] = msg;
    }

    const purchasePctVal = trimField(values, "purchasePercent");
    if (!purchasePctVal) {
        err.purchasePercent = "Specific Percentage is required.";
    } else {
        const purchasePct = validatePercent(purchasePctVal);
        if (purchasePct) err.purchasePercent = purchasePct;
    }

    const remitVal = trimField(values, "remittance");
    if (!remitVal) {
        err.remittance = "Total remit is required.";
    } else {
        const remitMsg = validateMoney(remitVal);
        if (remitMsg) err.remittance = remitMsg;
    }

    const stateInc = trimField(values, "state");
    if (stateInc.length === 2) {
        const m = validateTwoLetterState(stateInc);
        if (m) err.state = m;
    }

    for (const key of US_STATE_ABBR_KEYS) {
        const v = trimField(values, key);
        const m = validateTwoLetterState(v);
        if (m) err[key] = m;
    }

    return err;
}

function messageFromSaveError(error: unknown, fallback: string): string {
    if (typeof error === "string" && error.trim()) return error.trim();
    if (error && typeof error === "object") {
        const o = error as Record<string, unknown>;
        if (typeof o.message === "string" && o.message.trim()) return o.message.trim();
        if (typeof o.payload === "string" && o.payload.trim()) return o.payload.trim();
        const nested = o.response as { data?: { message?: unknown } } | undefined;
        if (nested?.data && typeof nested.data.message === "string" && nested.data.message.trim()) {
            return nested.data.message.trim();
        }
    }
    return fallback;
}

function firstSectionIdWithFieldErrors(errors: FieldErrors): string | null {
    for (const section of CONTRACT_PREFILL_SECTIONS) {
        if (contractPrefillSectionKeys(section).some((key) => Boolean(errors[key]))) return section.id;
    }
    for (const key of Object.keys(errors) as (keyof BuildContractPrefillFieldsArgs)[]) {
        if (!errors[key]) continue;
        const fallback = FIELD_ERROR_SECTION_FALLBACK[key];
        if (fallback) return fallback;
    }
    return null;
}

type PrefillErrorSectionHint = {
    id: string;
    title: string;
    fieldKeys: (keyof BuildContractPrefillFieldsArgs)[];
};

/**
 * Validated keys that may not appear in CONTRACT_PREFILL_SECTIONS yet still need a real
 * outline target (never invent an "Other fields" stage).
 */
const FIELD_ERROR_SECTION_FALLBACK: Partial<Record<keyof BuildContractPrefillFieldsArgs, string>> = {
    customerName: "merchant",
    federalTaxIdEin: "merchant",
    state: "merchant",
    authorizationClientTaxId: "ach_deposit",
    authorizationClientDate: "ach_deposit",
    businessAddressCity: "addresses",
    businessAddressState: "addresses",
    businessAddressZip: "addresses",
    businessAddressContractCity: "addresses",
    businessAddressContractState: "addresses",
    businessAddressContractZip: "addresses",
    guarantorAddressCity: "addresses",
    guarantorAddressState: "addresses",
    guarantorAddressZip: "addresses",
    securityBusinessAddress: "owners",
    securityBusinessAddressCity: "owners",
    securityBusinessAddressState: "owners",
    securityBusinessAddressZip: "owners",
    achAuthorizationAccountHolderDate: "ach_account_bank",
    achAuthorizationConcentAccountHolderDate: "ach_account_bank",
};

/** Group validation errors by outline section so the user knows where to go. */
function collectPrefillErrorSections(errors: FieldErrors): PrefillErrorSectionHint[] {
    const bySectionId = new Map<string, PrefillErrorSectionHint>();

    const addToSection = (sectionId: string, fieldKey: keyof BuildContractPrefillFieldsArgs) => {
        const section =
            CONTRACT_PREFILL_SECTIONS.find((s) => s.id === sectionId) ?? CONTRACT_PREFILL_SECTIONS[0];
        if (!section) return;
        const existing = bySectionId.get(section.id);
        if (existing) {
            if (!existing.fieldKeys.includes(fieldKey)) existing.fieldKeys.push(fieldKey);
            return;
        }
        bySectionId.set(section.id, {
            id: section.id,
            title: section.title,
            fieldKeys: [fieldKey],
        });
    };

    const claimed = new Set<string>();
    for (const section of CONTRACT_PREFILL_SECTIONS) {
        for (const key of contractPrefillSectionKeys(section)) {
            if (!errors[key]) continue;
            claimed.add(key);
            addToSection(section.id, key);
        }
    }

    for (const key of Object.keys(errors) as (keyof BuildContractPrefillFieldsArgs)[]) {
        if (!errors[key] || claimed.has(key)) continue;
        addToSection(FIELD_ERROR_SECTION_FALLBACK[key] ?? "merchant", key);
    }

    // Preserve outline order.
    const ordered: PrefillErrorSectionHint[] = [];
    for (const section of CONTRACT_PREFILL_SECTIONS) {
        const hint = bySectionId.get(section.id);
        if (hint) ordered.push(hint);
    }
    return ordered;
}

function fieldLabelForPrefillKey(key: keyof BuildContractPrefillFieldsArgs): string {
    return FIELD_LABELS[key as keyof typeof FIELD_LABELS] ?? String(key);
}

function firstErroredFieldKey(
    errors: FieldErrors,
    sectionId?: string | null,
): keyof BuildContractPrefillFieldsArgs | null {
    if (sectionId) {
        const section = CONTRACT_PREFILL_SECTIONS.find((s) => s.id === sectionId);
        if (section) {
            const inSection = contractPrefillSectionKeys(section).find((key) => Boolean(errors[key]));
            if (inSection) return inSection;
        }
    }
    for (const section of CONTRACT_PREFILL_SECTIONS) {
        const key = contractPrefillSectionKeys(section).find((k) => Boolean(errors[k]));
        if (key) return key;
    }
    const any = (Object.keys(errors) as (keyof BuildContractPrefillFieldsArgs)[]).find((k) =>
        Boolean(errors[k]),
    );
    return any ?? null;
}

function buildPrefillValidationErrorMessage(
    errors: FieldErrors,
    sections: PrefillErrorSectionHint[],
): string {
    const count = Object.keys(errors).length;
    const fieldWord = count === 1 ? "field" : "fields";
    if (sections.length === 0) {
        return count === 1
            ? "Fix the highlighted field, then save again."
            : `Fix ${count} highlighted ${fieldWord}, then save again.`;
    }
    if (sections.length === 1) {
        const section = sections[0]!;
        const labels = section.fieldKeys.map(fieldLabelForPrefillKey);
        const shown = labels.slice(0, 4);
        const labelPart =
            shown.join(", ") + (labels.length > shown.length ? `, +${labels.length - shown.length} more` : "");
        return `Fix ${count} highlighted ${fieldWord} in “${section.title}” (${labelPart}).`;
    }
    const sectionList = sections
        .map((s) => `“${s.title}” (${s.fieldKeys.length})`)
        .join(", ");
    return `Fix ${count} highlighted ${fieldWord} in: ${sectionList}. Use the outline (or buttons below) to jump to each section.`;
}

export type LinkedAddendumMappingRef = {
    id: string;
    templateId?: string;
    documentType?: string | null;
    template?: {
        templateId?: string;
        name?: string | null;
        layoutKey?: string | null;
        state?: string | null;
        frequency?: string | null;
    } | null;
};

/** Same shape as linked addendum — reused for state disclosure mappings. */
export type LinkedDisclosureMappingRef = LinkedAddendumMappingRef;

export type ContractPrefillEditFormProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    applicationData: unknown;
    /** Numeric contract id (CRM `Contract.id`); required to save prefill overrides on the contract. */
    contractId: number | string | null;
    /**
     * Overrides from `Contract.contractPrefillOverrides` once the parent has loaded the contract.
     * Omit or leave `undefined` until loaded so the form can merge application defaults + legacy note only in the parent.
     */
    persistedPrefillOverrides?: Partial<BuildContractPrefillFieldsArgs> | null;
    /** Parent has finished loading contract prefill from the API. */
    prefillOverridesReady?: boolean;
    /** Called after a successful save or clear so the parent can refresh Deal Review / BoldSign merge state. */
    onPersistedPrefillChange?: (next: Partial<BuildContractPrefillFieldsArgs> | null) => void;
    /** Full save payload: main overrides (no mapping blob) + per-mapping addendum field map. */
    onPersistedPrefillFullChange?: (
        main: Partial<BuildContractPrefillFieldsArgs> | null,
        documentTemplatePrefillByMappingId: Record<string, Record<string, string>>,
    ) => void;
    /** Parent syncs saved values to an open DocuSign draft envelope (contract PDF modal). */
    onAfterPrefillSaved?: () => void;
    /** Application UUID — used to reload the contract row after save so `contractPrefillOverrides` matches the DB. */
    applicationUuid?: string | null;
    contractRecords?: ContractPrefillContractRecords;
    resolvedContract?: Record<string, unknown> | null;
    linkedAddendumMapping?: LinkedAddendumMappingRef | null;
    /** Linked state disclosure mapping — shows disclosure data labels (same catalog as Katan). */
    linkedDisclosureMapping?: LinkedDisclosureMappingRef | null;
    /** Contract / Info panel state when the disclosure template row has no `state` column. */
    contractDisclosureState?: string | null;
    /** Offer payment frequency (daily / weekly) for disclosure field resolution. */
    contractDisclosureFrequency?: string | null;
    /** Shown in agreement date field when empty (e.g. today). */
    agreementDatePlaceholder?: string;
    /** Loaded offer decision — used to auto-calculate net to merchant when not overridden. */
    offerDecision?: Record<string, unknown> | null;
    readOnly?: boolean;
    /** Merged into `contractPrefillOverrides` on save; preserved when clearing main prefill (document template field map). */
    additionalContractPrefillJson?: Record<string, unknown> | null;
    /** Live Contract Signers from the PDF modal (unsaved rows still count for owner-2 prefill sections). */
    liveContractSignerOverrides?: ContractSignerOverrideRow[] | null;
    /** Bank-analysis rows for disclosure monthly income / lookback months. */
    bankAnalyses?: unknown;
};

function isPasswordPrefillKey(key: keyof BuildContractPrefillFieldsArgs): boolean {
    return key === "achAuthorizationPassword";
}

export function ContractPrefillEditForm({
    open,
    onOpenChange,
    applicationData,
    contractId,
    persistedPrefillOverrides,
    prefillOverridesReady = true,
    onPersistedPrefillChange,
    onPersistedPrefillFullChange,
    onAfterPrefillSaved,
    applicationUuid = null,
    contractRecords,
    resolvedContract = null,
    linkedAddendumMapping = null,
    linkedDisclosureMapping = null,
    contractDisclosureState = null,
    contractDisclosureFrequency = null,
    agreementDatePlaceholder = "",
    offerDecision = null,
    readOnly = false,
    additionalContractPrefillJson = null,
    liveContractSignerOverrides = null,
    bankAnalyses = null,
}: ContractPrefillEditFormProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [values, setValues] = useState<Record<keyof BuildContractPrefillFieldsArgs, string>>(emptyValuesRecord);
    const [addendumFieldValues, setAddendumFieldValues] = useState<Record<string, string>>({});
    const [disclosureFieldValues, setDisclosureFieldValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveErrorSections, setSaveErrorSections] = useState<PrefillErrorSectionHint[]>([]);
    const [activeSectionId, setActiveSectionId] = useState(CONTRACT_PREFILL_SECTIONS[0]?.id ?? "merchant");
    const purchasePercentTouchedRef = useRef(false);
    const pendingFocusFieldKeyRef = useRef<keyof BuildContractPrefillFieldsArgs | null>(null);
    const [spaModalOpen, setSpaModalOpen] = useState(false);
    const [savingSpaCalculation, setSavingSpaCalculation] = useState(false);

    const agreementDateForDefaults = agreementDatePlaceholder || "";

    useEffect(() => {
        if (!open) {
            purchasePercentTouchedRef.current = false;
        }
    }, [open]);

    const documentTemplatePrefillByMappingId = useMemo(() => {
        const raw = additionalContractPrefillJson?.[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
        return raw as Record<string, Record<string, string>>;
    }, [additionalContractPrefillJson]);

    const strippedMainPrefillOverrides = useMemo(() => {
        const main = stripDocumentTemplateBlobFromPrefillOverrides(
            persistedPrefillOverrides === undefined
                ? undefined
                : (normalizeContractPrefillOverrides(persistedPrefillOverrides) ?? null),
        );
        if (main === undefined) return undefined;
        return stripStaleOfferOverridesFromPersisted(
            main,
            offerDecision,
            applicationData,
            contractRecords?.contract ?? null,
        );
    }, [persistedPrefillOverrides, offerDecision, applicationData, contractRecords?.contract]);

    const addendumEditorRows = useMemo(() => {
        if (!linkedAddendumMapping?.id) return [];
        const saved = documentTemplatePrefillByMappingId[linkedAddendumMapping.id] ?? {};
        return getDocumentTemplatePrefillFieldRowsForEditor({
            templateId:
                linkedAddendumMapping.template?.templateId ??
                linkedAddendumMapping.templateId ??
                null,
            templateName: linkedAddendumMapping.template?.name ?? null,
            templateLayoutKey: linkedAddendumMapping.template?.layoutKey ?? null,
            templateState: linkedAddendumMapping.template?.state ?? null,
            templateFrequency: linkedAddendumMapping.template?.frequency ?? null,
            documentType: linkedAddendumMapping.documentType ?? "addendum",
            contract: resolvedContract ?? contractRecords?.contract ?? null,
            application: applicationData as Record<string, unknown> | null,
            agreementDate: agreementDateForDefaults,
            mainPrefillOverrides: strippedMainPrefillOverrides ?? undefined,
            savedOverridesForMapping: saved,
            bankDetail: contractRecords?.bankDetail ?? null,
        });
    }, [
        linkedAddendumMapping,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        contractRecords?.contract,
        contractRecords?.bankDetail,
        applicationData,
        agreementDateForDefaults,
        strippedMainPrefillOverrides,
    ]);

    const visibleAddendumEditorRows = useMemo(
        () => addendumEditorRows.filter((row) => !ADDENDUM_VERIFY_SKIP_ID_RE.test(String(row.id))),
        [addendumEditorRows],
    );

    const linkedDisclosureTemplateName =
        linkedDisclosureMapping?.template?.name?.trim() ||
        linkedDisclosureMapping?.template?.templateId ||
        linkedDisclosureMapping?.templateId ||
        "State disclosure";
    const linkedDisclosureState =
        String(
            linkedDisclosureMapping?.template?.state ?? contractDisclosureState ?? "",
        ).trim() || null;
    const linkedDisclosureFrequency =
        String(
            linkedDisclosureMapping?.template?.frequency ?? contractDisclosureFrequency ?? "",
        ).trim() || null;
    const linkedDisclosureHasFieldMap = Boolean(
        linkedDisclosureMapping &&
            (isSignNowContractUiEnabled() ||
                isSignNowDisclosureLayoutKey(
                    linkedDisclosureMapping.template?.layoutKey ??
                        linkedDisclosureMapping.template?.templateId ??
                        linkedDisclosureMapping.templateId ??
                        "",
                ) ||
                hasStateDisclosurePrefillFieldMap(
                    linkedDisclosureTemplateName,
                    linkedDisclosureMapping.template?.state ?? null,
                    linkedDisclosureMapping.template?.frequency ?? null,
                    contractDisclosureState,
                    contractDisclosureFrequency,
                    linkedDisclosureMapping.template?.layoutKey ??
                        linkedDisclosureMapping.template?.templateId ??
                        linkedDisclosureMapping.templateId ??
                        null,
                )),
    );

    const disclosureEditorRows = useMemo(() => {
        if (!linkedDisclosureMapping?.id || !linkedDisclosureHasFieldMap) return [];
        const saved = documentTemplatePrefillByMappingId[linkedDisclosureMapping.id] ?? {};
        return getDocumentTemplatePrefillFieldRowsForEditor({
            templateId:
                linkedDisclosureMapping.template?.templateId ??
                linkedDisclosureMapping.templateId ??
                null,
            templateLayoutKey: linkedDisclosureMapping.template?.layoutKey ?? null,
            templateName: linkedDisclosureMapping.template?.name ?? null,
            templateState: linkedDisclosureMapping.template?.state ?? null,
            templateFrequency: linkedDisclosureMapping.template?.frequency ?? null,
            fallbackState: contractDisclosureState,
            fallbackFrequency: contractDisclosureFrequency,
            documentType: "disclosure",
            contract: resolvedContract ?? contractRecords?.contract ?? null,
            application: applicationData as Record<string, unknown> | null,
            agreementDate: agreementDateForDefaults,
            mainPrefillOverrides: strippedMainPrefillOverrides ?? undefined,
            savedOverridesForMapping: saved,
            bankDetail: contractRecords?.bankDetail ?? null,
            bankAnalyses,
        });
    }, [
        linkedDisclosureMapping,
        linkedDisclosureHasFieldMap,
        documentTemplatePrefillByMappingId,
        contractDisclosureState,
        contractDisclosureFrequency,
        resolvedContract,
        contractRecords?.contract,
        contractRecords?.bankDetail,
        applicationData,
        agreementDateForDefaults,
        strippedMainPrefillOverrides,
        bankAnalyses,
    ]);

    const linkedAddendumSectionTitle = useMemo(() => {
        const name =
            linkedAddendumMapping?.template?.name?.trim() ||
            linkedAddendumMapping?.template?.templateId ||
            linkedAddendumMapping?.templateId ||
            "Addendum";
        return `Selected addendum — ${name}`;
    }, [linkedAddendumMapping]);

    const contractSignerRolesForCounts = useMemo(() => {
        if (liveContractSignerOverrides?.length) {
            return liveContractSignerOverrides.map((row) => ({
                signerRole: row.role,
                signerEmail: row.email,
                signerName: row.name,
            }));
        }
        const raw =
            resolvedContract?.contractPrefillOverrides ??
            additionalContractPrefillJson ??
            null;
        const rows = parseContractSignerOverridesFromPrefill(raw);
        return (rows ?? []).map((row) => ({
            signerRole: row.role,
            signerEmail: row.email,
            signerName: row.name,
        }));
    }, [
        resolvedContract?.contractPrefillOverrides,
        additionalContractPrefillJson,
        liveContractSignerOverrides,
    ]);

    const activeOwnerCount = useMemo(
        () =>
            resolveActiveOwnerCount({
                owners: contractRecords?.owners ?? null,
                signerRoles: contractSignerRolesForCounts,
            }),
        [contractRecords?.owners, contractSignerRolesForCounts],
    );
    const resolvedOwnerRows = useMemo(
        () =>
            Array.isArray(contractRecords?.owners)
                ? (contractRecords.owners as Record<string, unknown>[])
                : [],
        [contractRecords?.owners],
    );
    const showSecondPartyFields = activeOwnerCount >= 2;
    const activeGuarantorCount = useMemo(
        () =>
            resolveActiveGuarantorCount({
                guarantors: contractRecords?.guarantors ?? null,
                signerRoles: contractSignerRolesForCounts,
            }),
        [contractRecords?.guarantors, contractSignerRolesForCounts],
    );

    const owner2KeySet = useMemo(() => new Set<string>(OWNER2_PREFILL_FORM_KEYS), []);
    const guarantor2KeySet = useMemo(() => new Set<string>(GUARANTOR2_PREFILL_FORM_KEYS), []);
    const guarantor1KeySet = useMemo(() => new Set<string>(GUARANTOR1_PREFILL_FORM_KEYS), []);

    const navSections = useMemo(() => {
        const filterGroupKeys = (keys: ContractPrefillFormFieldKey[]) =>
            keys.filter((key) => {
                if (activeOwnerCount < 2 && owner2KeySet.has(key)) return false;
                if (activeOwnerCount < 2 && guarantor2KeySet.has(key)) return false;
                return true;
            });

        const base = CONTRACT_PREFILL_SECTIONS.map((section) => ({
            ...section,
            groups: section.groups
                .map((group) => ({
                    ...group,
                    keys: filterGroupKeys(group.keys),
                }))
                .filter((group) => group.keys.length > 0),
        })).filter((section) => section.groups.length > 0);

        if (linkedAddendumMapping && addendumEditorRows.length > 0) {
            base.push({
                id: LINKED_DOCUSIGN_ADDENDUM_SECTION_ID,
                title: linkedAddendumSectionTitle,
                description: "DocuSign addendum template fields merged when you send the contract.",
                Icon: FilePenLine,
                groups: [],
            });
        }
        if (linkedDisclosureMapping) {
            const stateLabel = linkedDisclosureState
                ? linkedDisclosureState.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
                : "selected state";
            const freqLabel = linkedDisclosureFrequency
                ? ` (${linkedDisclosureFrequency})`
                : "";
            base.push({
                id: LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID,
                title: `State disclosure — ${stateLabel}${freqLabel}`,
                description: linkedDisclosureHasFieldMap
                    ? `Commercial financing disclosure fields for ${stateLabel}. Values are computed from the deal and can be overridden before send.`
                    : "This state disclosure template is not registered for field editing yet.",
                Icon: Receipt,
                groups: [],
            });
        }
        return base;
    }, [
        linkedAddendumMapping,
        addendumEditorRows.length,
        linkedAddendumSectionTitle,
        linkedDisclosureMapping,
        linkedDisclosureState,
        linkedDisclosureFrequency,
        linkedDisclosureHasFieldMap,
        activeOwnerCount,
        activeGuarantorCount,
        owner2KeySet,
        guarantor2KeySet,
        guarantor1KeySet,
    ]);

    const resetFromSources = useCallback((options?: { forceLiveOfferMoney?: boolean }) => {
        const forceLiveOfferMoney = options?.forceLiveOfferMoney === true;
        const defaults = getContractPrefillEditDefaultsFromApplication(applicationData, {
            agreementDate: agreementDateForDefaults,
            contractRecords,
            offerDecision,
        });
        const persistedRaw =
            strippedMainPrefillOverrides === undefined
                ? ({} as Partial<BuildContractPrefillFieldsArgs>)
                : (strippedMainPrefillOverrides ?? ({} as Partial<BuildContractPrefillFieldsArgs>));
        /** Reload must not keep stale saved offer/payback/remit over the live OfferDecision. */
        const persistedForMerge = forceLiveOfferMoney
            ? omitLiveOfferMoneyPrefillKeys(persistedRaw)
            : persistedRaw;
        const defaultsForMerge = forceLiveOfferMoney
            ? omitLiveOfferMoneyPrefillKeys(defaults)
            : defaults;
        const mergedBase = applyLiveBankDetailsToPrefillMerge(
            defaultsForMerge,
            mergeNonemptyPrefillPartial(
                defaultsForMerge as Record<string, unknown>,
                persistedForMerge as Record<string, unknown>,
            ) as Partial<BuildContractPrefillFieldsArgs>,
        );
        let merged = applyAuthorizationBusinessNamePrefillFields(
            finalizeContractPrefillMoneyFields(mergedBase, {
                application: applicationData as Record<string, unknown> | undefined,
                contract: contractRecords?.contract ?? null,
                offerDecision: offerDecision ?? null,
                prefill: mergedBase,
            }),
            applicationData,
        );
        merged = applyLiveOfferSyncToPrefillPartial(merged, applicationData, offerDecision, {
            forceLiveOfferMoney: forceLiveOfferMoney || undefined,
            contract: contractRecords?.contract ?? null,
        });

        const ownerCount = Math.min(
            2,
            Math.max(resolvedOwnerRows.length, activeOwnerCount),
        );
        applyOwnerRowsToPrefillMerge(merged, resolvedOwnerRows);
        if (ownerCount >= 2) {
            const signerRoles = buildDocuSignRolesFromEditorRows(
                liveContractSignerOverrides?.length
                    ? liveContractSignerOverrides
                    : (parseContractSignerOverridesFromPrefill(
                          strippedMainPrefillOverrides ?? persistedPrefillOverrides,
                      ) ?? []),
            );
            const secondRow = resolvedOwnerRows[1];
            const secondOwnerName =
                resolveSecondOwnerSignerName(signerRoles, ownerCount, resolvedOwnerRows) ||
                resolveOwnerRowFullName(secondRow);
            const secondOwnerSs = String(secondRow?.ssnNumber ?? secondRow?.ssn ?? "").trim();
            const secondOwnerDriverLicense = String(
                secondRow?.driverLicenseNumber ?? secondRow?.driverLicense ?? "",
            ).trim();
            applySecondOwnerNameToPrefillPartial(
                merged,
                secondOwnerName,
                secondOwnerSs,
                secondOwnerDriverLicense,
            );
        }

        clearParty2PrefillPartial(merged as Record<string, unknown>, ownerCount);
        /** Undo stale overrides that mirrored business address onto contact / owner tabs. */
        merged = applySeparatedAddressPrefillFields(merged, applicationData);
        overlayAddendumBlobOntoMainPrefill(
            merged as Record<string, unknown>,
            documentTemplatePrefillByMappingId,
        );
        if (!String(merged.guarantyOwner1Ss ?? "").trim()) {
            const fromApp = String(
                getContractPrefillEditDefaultsFromApplication(applicationData, {
                    agreementDate: agreementDateForDefaults,
                    contractRecords,
                    offerDecision,
                }).guarantyOwner1Ss ?? "",
            ).trim();
            if (fromApp) {
                merged.guarantyOwner1Ss = fromApp;
                if (!String(merged.guarantySs ?? "").trim()) merged.guarantySs = fromApp;
                if (!String(merged.guarantyGuarantor1Ss ?? "").trim()) {
                    merged.guarantyGuarantor1Ss = fromApp;
                }
            }
        }
        const aliased = copySharedPrefillAliases(
            Object.fromEntries(
                Object.entries(merged as Record<string, unknown>).map(([key, value]) => [
                    key,
                    value === true ? "true" : value === false ? "false" : String(value ?? ""),
                ]),
            ),
        );
        setValues(mergeFormState({ ...merged, ...aliased }));
        setFieldErrors({});
        if (forceLiveOfferMoney) {
            toast.success("Reloaded offer & deal terms from the application.");
        }
    }, [
        applicationData,
        contractRecords,
        agreementDateForDefaults,
        strippedMainPrefillOverrides,
        persistedPrefillOverrides,
        offerDecision,
        activeOwnerCount,
        resolvedOwnerRows,
        liveContractSignerOverrides,
        documentTemplatePrefillByMappingId,
    ]);

    const resetAddendumFromSources = useCallback(() => {
        setAddendumFieldValues(Object.fromEntries(addendumEditorRows.map((r) => [r.id, r.value ?? ""])));
    }, [addendumEditorRows]);

    const resetDisclosureFromSources = useCallback(() => {
        setDisclosureFieldValues(
            Object.fromEntries(disclosureEditorRows.map((r) => [r.id, r.value ?? ""])),
        );
    }, [disclosureEditorRows]);

    /** Stable ref so `resetFromSources` stays current without widening effect deps below. */
    const resetFromSourcesRef = useRef(resetFromSources);
    resetFromSourcesRef.current = resetFromSources;
    const resetAddendumFromSourcesRef = useRef(resetAddendumFromSources);
    resetAddendumFromSourcesRef.current = resetAddendumFromSources;
    const resetDisclosureFromSourcesRef = useRef(resetDisclosureFromSources);
    resetDisclosureFromSourcesRef.current = resetDisclosureFromSources;

    const openedHydratedRef = useRef(false);
    const prevActiveOwnerCountRef = useRef(activeOwnerCount);
    const prevOfferDecisionSyncKeyRef = useRef("");
    const formReady = prefillOverridesReady && persistedPrefillOverrides !== undefined;

    useEffect(() => {
        if (!open) {
            openedHydratedRef.current = false;
            prevActiveOwnerCountRef.current = activeOwnerCount;
            return;
        }
        if (!formReady) return;
        if (openedHydratedRef.current) return;
        openedHydratedRef.current = true;
        resetFromSourcesRef.current();
        resetAddendumFromSourcesRef.current();
        resetDisclosureFromSourcesRef.current();
        prevActiveOwnerCountRef.current = activeOwnerCount;
        // Intentionally omit persistedPrefillOverrides — re-hydrating on parent updates resets in-progress edits.
    }, [open, formReady, activeOwnerCount]);

    const seededDisclosureMappingIdRef = useRef<string | null>(null);
    const disclosureSavedFingerprint = JSON.stringify(
        documentTemplatePrefillByMappingId[linkedDisclosureMapping?.id ?? ""] ?? {},
    );
    const disclosureSeedKey = `${linkedDisclosureMapping?.id ?? ""}:${linkedDisclosureState ?? ""}:${linkedDisclosureFrequency ?? ""}:${disclosureSavedFingerprint}`;
    useEffect(() => {
        if (!open || !linkedDisclosureMapping?.id) {
            seededDisclosureMappingIdRef.current = null;
            return;
        }
        if (disclosureEditorRows.length === 0) return;
        if (seededDisclosureMappingIdRef.current === disclosureSeedKey) return;
        seededDisclosureMappingIdRef.current = disclosureSeedKey;
        resetDisclosureFromSourcesRef.current();
    }, [open, linkedDisclosureMapping?.id, disclosureSeedKey, disclosureEditorRows]);

    /** When owner 2 is added while the form is open, merge party-2 fields without wiping other edits. */
    useEffect(() => {
        if (!open || !formReady) return;
        const prev = prevActiveOwnerCountRef.current;
        prevActiveOwnerCountRef.current = activeOwnerCount;
        if (prev >= 2 || activeOwnerCount < 2) return;

        setValues((prevValues) => {
            const merged = { ...prevValues } as Partial<BuildContractPrefillFieldsArgs>;
            applyOwnerRowsToPrefillMerge(merged, resolvedOwnerRows);
            const signerRoles = buildDocuSignRolesFromEditorRows(
                liveContractSignerOverrides?.length
                    ? liveContractSignerOverrides
                    : (parseContractSignerOverridesFromPrefill(
                          strippedMainPrefillOverrides ?? persistedPrefillOverrides,
                      ) ?? []),
            );
            const secondRow = resolvedOwnerRows[1];
            const secondOwnerName =
                resolveSecondOwnerSignerName(signerRoles, activeOwnerCount, resolvedOwnerRows) ||
                resolveOwnerRowFullName(secondRow);
            applySecondOwnerNameToPrefillPartial(
                merged,
                secondOwnerName,
                String(secondRow?.ssnNumber ?? secondRow?.ssn ?? "").trim(),
                String(secondRow?.driverLicenseNumber ?? secondRow?.driverLicense ?? "").trim(),
            );
            return mergeFormState(merged);
        });
    }, [
        open,
        formReady,
        activeOwnerCount,
        resolvedOwnerRows,
        liveContractSignerOverrides,
        strippedMainPrefillOverrides,
        persistedPrefillOverrides,
    ]);

    useEffect(() => {
        if (!open) {
            setFieldErrors({});
            setSaveError(null);
            setSaveErrorSections([]);
            pendingFocusFieldKeyRef.current = null;
        }
    }, [open]);

    const prevOpenRef = useRef(false);
    useEffect(() => {
        const justOpened = open && !prevOpenRef.current;
        prevOpenRef.current = open;
        if (!open || !navSections[0]?.id) return;
        // Only jump to the first stage when the dialog opens — not whenever navSections
        // re-memoizes (that was yanking users back from Offer & payback to RPA).
        if (justOpened) {
            setActiveSectionId(navSections[0].id);
            return;
        }
        setActiveSectionId((current) =>
            navSections.some((s) => s.id === current) ? current : navSections[0]!.id,
        );
    }, [open, navSections]);

    const activeSection = navSections.find((s) => s.id === activeSectionId) ?? navSections[0];
    const activeIdx = navSections.findIndex((s) => s.id === activeSection?.id);
    const nextSection =
        activeIdx >= 0 && activeIdx < navSections.length - 1 ? navSections[activeIdx + 1] : null;
    const isLinkedAddendumSection = activeSectionId === LINKED_DOCUSIGN_ADDENDUM_SECTION_ID;
    const isLinkedDisclosureSection = activeSectionId === LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID;

    /** After validation jumps sections, scroll/focus the first highlighted input. */
    useEffect(() => {
        const key = pendingFocusFieldKeyRef.current;
        if (!key || !open) return;
        const timer = window.setTimeout(() => {
            if (pendingFocusFieldKeyRef.current !== key) return;
            const el = document.getElementById(`prefill-${key}`);
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
                if (typeof (el as HTMLElement).focus === "function") {
                    (el as HTMLElement).focus({ preventScroll: true });
                }
            }
            pendingFocusFieldKeyRef.current = null;
        }, 60);
        return () => window.clearTimeout(timer);
    }, [activeSectionId, fieldErrors, open]);

    const jumpToPrefillErrorSection = useCallback(
        (sectionId: string) => {
            pendingFocusFieldKeyRef.current = firstErroredFieldKey(fieldErrors, sectionId);
            setActiveSectionId(sectionId);
        },
        [fieldErrors],
    );

    const sectionErrorCounts = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const section of navSections) {
            if (!section.groups.length) continue;
            const n = contractPrefillSectionKeys(section).filter((key) => Boolean(fieldErrors[key])).length;
            if (n > 0) counts[section.id] = n;
        }
        return counts;
    }, [navSections, fieldErrors]);

    const activeSectionSyncGroups = useMemo(() => {
        if (!activeSection || isLinkedAddendumSection || isLinkedDisclosureSection) {
            return [] as PrefillSyncGroup[];
        }
        const keysInSection = new Set<string>(activeSection.groups.flatMap((g) => g.keys));
        return PREFILL_SYNC_GROUPS.filter((group) => group.keys.some((k) => keysInSection.has(k)));
    }, [activeSection, isLinkedAddendumSection, isLinkedDisclosureSection]);

    const offerDecisionSyncKey = useMemo(() => {
        const root =
            offerDecision && typeof offerDecision === "object"
                ? offerDecision
                : (() => {
                      const app = applicationData as Record<string, unknown> | null;
                      const embedded =
                          (app?.offerDecision as Record<string, unknown> | undefined) ??
                          (app?.OfferDecision as Record<string, unknown> | undefined) ??
                          null;
                      if (embedded && typeof embedded === "object" && !Array.isArray(embedded)) {
                          return embedded;
                      }
                      const termsRaw = app?.termsOffers;
                      if (Array.isArray(termsRaw) && termsRaw[0] && typeof termsRaw[0] === "object") {
                          return termsRaw[0] as Record<string, unknown>;
                      }
                      if (termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)) {
                          return termsRaw as Record<string, unknown>;
                      }
                      return null;
                  })();
        const offerKey = (() => {
            if (!root || typeof root !== "object") return "";
            const inner =
                root.offer != null && typeof root.offer === "object" && !Array.isArray(root.offer)
                    ? (root.offer as Record<string, unknown>)
                    : root;
            return [
                inner.offer,
                inner.approvedAmount,
                inner.totalRemit,
                inner.fees,
                inner.rate,
                inner.term,
                inner.termLength,
                inner.numberOfPayments,
                inner.paymentsTerms,
                inner.frequency,
                inner.paymentFrequency,
                inner.monthlyPayment,
                inner.dailyPayment,
                inner.repayPerPeriod,
                inner.paymentAmount,
                inner.ourRemit,
                inner.refinanceAmount,
                inner.updatedAt,
            ]
                .map((v) => String(v ?? ""))
                .join("|");
        })();
        const finalCalcKey = finalCalculationPrefillSyncKey(applicationData);
        return [offerKey, finalCalcKey].filter(Boolean).join("||");
    }, [offerDecision, applicationData]);

    useEffect(() => {
        if (!open) {
            prevOfferDecisionSyncKeyRef.current = "";
            return;
        }
        if (!offerDecisionSyncKey) return;
        const prevKey = prevOfferDecisionSyncKeyRef.current;
        prevOfferDecisionSyncKeyRef.current = offerDecisionSyncKey;
        // Initial open is handled by resetFromSources / stripStale; only push when offer changes.
        if (!prevKey || prevKey === offerDecisionSyncKey) return;
        setValues((prev) =>
            mergeFormState(
                applyLiveOfferSyncToPrefillPartial(prev, applicationData, offerDecision, {
                    forceLiveOfferMoney: true,
                    contract: contractRecords?.contract ?? null,
                }),
            ),
        );
    }, [open, offerDecisionSyncKey, applicationData, offerDecision, contractRecords?.contract]);

    const handleSyncSectionToAll = () => {
        if (readOnly || !activeSection) return;
        const keysInSection = new Set<string>(activeSection.groups.flatMap((g) => g.keys));
        const isHiddenTarget = (k: keyof BuildContractPrefillFieldsArgs) =>
            (activeOwnerCount < 2 && owner2KeySet.has(k)) ||
            (activeGuarantorCount < 2 && guarantor2KeySet.has(k));
        const updates: Partial<Record<keyof BuildContractPrefillFieldsArgs, string>> = {};
        const syncedLabels: string[] = [];
        let foundFilledSharedField = false;
        // Prefer groups that appear on this stage so we always copy from the visible fields.
        const groupsToSync =
            activeSectionSyncGroups.length > 0 ? activeSectionSyncGroups : PREFILL_SYNC_GROUPS;
        for (const group of groupsToSync) {
            const sourceKey = group.keys.find(
                (k) => keysInSection.has(k) && String(values[k] ?? "").trim() !== "",
            );
            if (!sourceKey) continue;
            foundFilledSharedField = true;
            const value = String(values[sourceKey] ?? "").trim();
            let changed = false;
            for (const k of group.keys) {
                if (isHiddenTarget(k)) continue;
                if (String(values[k] ?? "").trim() !== value) {
                    updates[k] = value;
                    changed = true;
                }
            }
            if (changed) syncedLabels.push(group.label);
        }
        if (!foundFilledSharedField) {
            toast.info("Fill a shared field on this stage first, then sync.");
            return;
        }
        if (!syncedLabels.length) {
            toast.info("Shared fields on this stage already match every other stage.");
            return;
        }
        setValues((prev) => ({ ...prev, ...updates }));
        setFieldErrors((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(updates) as (keyof BuildContractPrefillFieldsArgs)[]) {
                delete next[k];
            }
            return next;
        });
        setSaveError(null);
        toast.success(`Synced ${syncedLabels.join(", ")} to every stage.`);
    };

    const handleSave = async () => {
        setSaveError(null);
        setSaveErrorSections([]);
        const cid = parsePositiveContractId(contractId);
        if (cid == null) {
            const msg = "Cannot save: open or create a contract for this application first.";
            setSaveError(msg);
            toast.error(msg);
            return;
        }
        const validation = validatePrefillValues(values);
        if (Object.keys(validation).length > 0) {
            setFieldErrors(validation);
            const errorSections = collectPrefillErrorSections(validation);
            const firstSection = firstSectionIdWithFieldErrors(validation) ?? errorSections[0]?.id ?? null;
            if (firstSection) setActiveSectionId(firstSection);
            pendingFocusFieldKeyRef.current = firstErroredFieldKey(validation, firstSection);
            const msg = buildPrefillValidationErrorMessage(validation, errorSections);
            setSaveErrorSections(errorSections);
            setSaveError(msg);
            toast.error(msg);
            return;
        }
        setFieldErrors({});
        setSaveErrorSections([]);
        setSaving(true);
        try {
            const aliased = copySharedPrefillAliases({ ...values }) as Record<
                keyof BuildContractPrefillFieldsArgs,
                string
            >;
            const rawPayload = toPayload(aliased);
            const separated = applySeparatedAddressPrefillFields(rawPayload, applicationData);
            const payload = finalizeContractPrefillMoneyFields(separated, {
                application: applicationData as Record<string, unknown> | undefined,
                contract: contractRecords?.contract ?? null,
                offerDecision: offerDecision ?? null,
                prefill: rawPayload,
            });
            const existingBlob =
                documentTemplatePrefillByMappingId && typeof documentTemplatePrefillByMappingId === "object"
                    ? { ...documentTemplatePrefillByMappingId }
                    : {};
            const nextBlob = { ...existingBlob };
            if (linkedAddendumMapping?.id && addendumEditorRows.length > 0) {
                const addendumValues = { ...addendumFieldValues };
                const remainingBalance =
                    String(
                        addendumValues.purchase_price ??
                            addendumValues.balance_transfer_purchase_price ??
                            "",
                    ).trim();
                if (remainingBalance) {
                    addendumValues.purchase_price = remainingBalance;
                    addendumValues.balance_transfer_purchase_price = remainingBalance;
                }
                nextBlob[linkedAddendumMapping.id] = addendumValues;
            }
            if (
                linkedDisclosureMapping?.id &&
                linkedDisclosureHasFieldMap &&
                disclosureEditorRows.length > 0
            ) {
                nextBlob[linkedDisclosureMapping.id] = { ...disclosureFieldValues };
            }
            const contractPrefillOverrides: Record<string, unknown> = {
                ...pickPreservedContractPrefillMeta(
                    resolvedContract,
                    liveContractSignerOverrides,
                ),
                ...(payload as Record<string, unknown>),
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: nextBlob,
            };
            const netToMerchantRaw = String(
                (payload as { netToMerchant?: unknown }).netToMerchant ?? "",
            ).trim();
            if (netToMerchantRaw) {
                contractPrefillOverrides[MANUAL_NET_TO_MERCHANT_KEY] = true;
            } else {
                delete contractPrefillOverrides[MANUAL_NET_TO_MERCHANT_KEY];
            }
            const columnSync = contractPrefillToContractColumnUpdate(payload);
            const approvedAmount = (() => {
                const n = Number(String(payload.purchaseAmount ?? "").replace(/[$,\s]/g, ""));
                return Number.isFinite(n) && n > 0 ? n : undefined;
            })();
            const totalAmount = (() => {
                const n = Number(String(payload.purchasePrice ?? "").replace(/[$,\s]/g, ""));
                return Number.isFinite(n) && n > 0 ? n : undefined;
            })();
            const updateRes = await dispatch(
                updateContract({
                    id: cid,
                    data: {
                        contractPrefillOverrides,
                        ...columnSync,
                        ...(approvedAmount != null ? { approvedAmount } : {}),
                        ...(totalAmount != null ? { totalAmount } : {}),
                    },
                }),
            ).unwrap();
            const rawOverrides: unknown =
                (updateRes as { data?: { contractPrefillOverrides?: unknown } })?.data
                    ?.contractPrefillOverrides ??
                (updateRes as { contractPrefillOverrides?: unknown })?.contractPrefillOverrides ??
                contractPrefillOverrides;
            const parsedBlob = (() => {
                if (rawOverrides == null || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) {
                    return nextBlob;
                }
                const inner = (rawOverrides as Record<string, unknown>)[
                    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY
                ];
                if (inner == null || typeof inner !== "object" || Array.isArray(inner)) return nextBlob;
                const out: Record<string, Record<string, string>> = {};
                for (const [mappingId, row] of Object.entries(inner)) {
                    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
                    out[mappingId] = Object.fromEntries(
                        Object.entries(row as Record<string, unknown>).map(([k, v]) => [k, String(v ?? "")]),
                    );
                }
                return out;
            })();
            const fromDb = stripDocumentTemplateBlobFromPrefillOverrides(
                normalizeContractPrefillOverrides(rawOverrides) ??
                    (payload as Partial<BuildContractPrefillFieldsArgs>),
            );
            onPersistedPrefillChange?.(fromDb ?? (payload as Partial<BuildContractPrefillFieldsArgs>));
            onPersistedPrefillFullChange?.(
                fromDb ?? (payload as Partial<BuildContractPrefillFieldsArgs>),
                parsedBlob,
            );
            try {
                await syncContractPrefillToSourceRecords({
                    dispatch,
                    applicationData,
                    applicationUuid,
                    prefill: payload,
                    offerDecision,
                    contractGuarantors: contractRecords?.guarantors ?? null,
                    contractOwners: contractRecords?.owners ?? null,
                    contractAch: (contractRecords?.ach as Record<string, unknown> | null) ?? null,
                    bankDetail: contractRecords?.bankDetail ?? null,
                });
            } catch (syncErr) {
                console.error(syncErr);
                const syncMsg =
                    syncErr instanceof Error
                        ? syncErr.message
                        : "Contract saved, but application or offer sync failed.";
                toast.warn(syncMsg);
            }
            setSaveError(null);
            toast.success("Prefill saved.");
            queueMicrotask(() => {
                onAfterPrefillSaved?.();
            });
            onOpenChange(false);
        } catch (e) {
            console.error(e);
            const msg = messageFromSaveError(e, "Failed to save contract prefill fields.");
            setSaveError(msg);
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleClearOverrides = async () => {
        setSaveError(null);
        const cid = parsePositiveContractId(contractId);
        if (cid == null || readOnly) return;
        setSaving(true);
        try {
            const preserveDoc =
                additionalContractPrefillJson &&
                    typeof additionalContractPrefillJson === "object" &&
                    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY in additionalContractPrefillJson
                    ? {
                        [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]:
                            additionalContractPrefillJson[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY],
                    }
                    : null;
            await dispatch(
                updateContract({
                    id: cid,
                    data: { contractPrefillOverrides: preserveDoc ?? null },
                }),
            ).unwrap();
            const appKey = String(applicationUuid ?? "").trim();
            if (appKey) {
                try {
                    const res = await dispatch(getByApplicationIdContract(appKey)).unwrap();
                    const contract = (res as { data?: unknown })?.data ?? res;
                    const raw = (contract as { contractPrefillOverrides?: unknown })?.contractPrefillOverrides;
                    const main = stripDocumentTemplateBlobFromPrefillOverrides(
                        normalizeContractPrefillOverrides(raw) ?? null,
                    );
                    const blob = (() => {
                        if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return {};
                        const inner = (raw as Record<string, unknown>)[
                            DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY
                        ];
                        if (inner == null || typeof inner !== "object" || Array.isArray(inner)) return {};
                        const out: Record<string, Record<string, string>> = {};
                        for (const [mappingId, row] of Object.entries(inner)) {
                            if (!row || typeof row !== "object" || Array.isArray(row)) continue;
                            out[mappingId] = Object.fromEntries(
                                Object.entries(row as Record<string, unknown>).map(([k, v]) => [
                                    k,
                                    String(v ?? ""),
                                ]),
                            );
                        }
                        return out;
                    })();
                    onPersistedPrefillChange?.(main);
                    onPersistedPrefillFullChange?.(main, blob);
                } catch {
                    onPersistedPrefillChange?.(null);
                    onPersistedPrefillFullChange?.(null, preserveDoc ? (preserveDoc[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] as Record<string, Record<string, string>>) ?? {} : {});
                }
            } else {
                onPersistedPrefillChange?.(null);
                onPersistedPrefillFullChange?.(
                    null,
                    preserveDoc
                        ? ((preserveDoc[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] as Record<
                              string,
                              Record<string, string>
                          >) ?? {})
                        : {},
                );
            }
            resetFromSources();
            resetAddendumFromSources();
            resetDisclosureFromSources();
            setSaveError(null);
            toast.success("Saved overrides cleared; DocuSign will use application data again.");
        } catch (e) {
            console.error(e);
            const msg = messageFromSaveError(e, "Failed to clear overrides.");
            setSaveError(msg);
            toast.error(msg);
        } finally {
            setSaving(false);
        }
    };

    const handleApplyCalculatedSpa = useCallback(
        async (spa: string) => {
            purchasePercentTouchedRef.current = false;
            setValues((prev) => ({ ...prev, purchasePercent: spa }));
            setSaveError(null);
            setFieldErrors((prev) => {
                if (!prev.purchasePercent) return prev;
                const next = { ...prev };
                delete next.purchasePercent;
                return next;
            });

            setSavingSpaCalculation(true);
            try {
                const result = await persistCalculatedPurchasePercent({
                    dispatch,
                    contractId,
                    spa,
                    persistedPrefillOverrides,
                    additionalContractPrefillJson,
                });
                if (result.saved && result.mainSaved) {
                    onPersistedPrefillChange?.(result.mainSaved);
                    if (result.fullSaved) {
                        const parsedBlob = (() => {
                            const inner = result.fullSaved?.[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY];
                            if (inner == null || typeof inner !== "object" || Array.isArray(inner)) {
                                return documentTemplatePrefillByMappingId;
                            }
                            const out: Record<string, Record<string, string>> = {};
                            for (const [mappingId, row] of Object.entries(inner)) {
                                if (!row || typeof row !== "object" || Array.isArray(row)) continue;
                                out[mappingId] = Object.fromEntries(
                                    Object.entries(row as Record<string, unknown>).map(([k, v]) => [
                                        k,
                                        String(v ?? ""),
                                    ]),
                                );
                            }
                            return out;
                        })();
                        onPersistedPrefillFullChange?.(result.mainSaved, parsedBlob);
                    }
                    toast.success(`Specified percentage calculated and saved: ${spa}%`);
                } else {
                    toast.success(
                        `Specified percentage calculated: ${spa}%. Open a contract record to save it permanently.`,
                    );
                }
                setSpaModalOpen(false);
            } finally {
                setSavingSpaCalculation(false);
            }
        },
        [
            contractId,
            persistedPrefillOverrides,
            additionalContractPrefillJson,
            dispatch,
            onPersistedPrefillChange,
            onPersistedPrefillFullChange,
            documentTemplatePrefillByMappingId,
        ],
    );

    const setField = useCallback(
        (key: keyof BuildContractPrefillFieldsArgs, v: string) => {
            if (key === "purchasePercent") {
                purchasePercentTouchedRef.current = true;
            }
            setValues((prev) => {
                const updates: Partial<Record<keyof BuildContractPrefillFieldsArgs, string>> = {
                    [key]: v,
                };
                const mirrorKeys = PREFILL_REALTIME_MIRROR_BY_KEY.get(key as ContractPrefillFormFieldKey);
                if (mirrorKeys) {
                    for (const mirrorKey of mirrorKeys) {
                        if (mirrorKey === key) continue;
                        if (
                            !showSecondPartyFields &&
                            (owner2KeySet.has(mirrorKey) || guarantor2KeySet.has(mirrorKey))
                        ) {
                            continue;
                        }
                        updates[mirrorKey] = v;
                    }
                }
                return { ...prev, ...updates };
            });
            setSaveError(null);
            setFieldErrors((prev) => {
                const mirrorKeys = PREFILL_REALTIME_MIRROR_BY_KEY.get(key as ContractPrefillFormFieldKey);
                if (!prev[key] && !mirrorKeys?.some((k) => prev[k])) return prev;
                const next = { ...prev };
                delete next[key];
                for (const mirrorKey of mirrorKeys ?? []) {
                    delete next[mirrorKey];
                }
                return next;
            });
        },
        [showSecondPartyFields, owner2KeySet, guarantor2KeySet],
    );

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[92vh] w-[min(100vw-2rem,960px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]"
                onOpenAutoFocus={(e: any) => e.preventDefault()}
            >
                <DialogHeader className="shrink-0 border-b border-[var(--brand)]/15 bg-gradient-to-r from-[var(--brand)]/10 via-white to-slate-50 px-6 py-4 dark:from-[var(--brand)]/20 dark:via-slate-950 dark:to-slate-900">
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[image:var(--brand-gradient)] text-white shadow-md shadow-[var(--brand)]/25">
                            <ScrollText className="h-5 w-5" aria-hidden />
                        </div>
                        <div className="min-w-0 space-y-1">
                            <DialogTitle className="text-left text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                                Verify contract prefill (Signnow)
                            </DialogTitle>
                            <p className="text-muted-foreground text-sm font-normal leading-snug">
                                Walk through each agreement section and confirm values match the deal. Saved overrides
                                merge into DocuSign when you open or send the contract.
                            </p>
                        </div>
                    </div>
                </DialogHeader>

                {saveError ? (
                    <div
                        className="mx-6 mt-3 shrink-0 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                        role="alert"
                    >
                        <p>{saveError}</p>
                        {saveErrorSections.length > 0 ? (
                            <div className="mt-2.5 flex flex-wrap gap-2">
                                {saveErrorSections.map((section) => (
                                    <button
                                        key={section.id}
                                        type="button"
                                        onClick={() => jumpToPrefillErrorSection(section.id)}
                                        className="inline-flex items-center gap-1.5 rounded-md border border-destructive/35 bg-white/80 px-2.5 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 dark:bg-slate-950/60"
                                    >
                                        Go to {section.title}
                                        <span className="rounded-full bg-destructive/15 px-1.5 py-0.5 text-[10px] tabular-nums">
                                            {section.fieldKeys.length}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : null}

                {/* Mobile: section picker */}
                <div className="border-b border-slate-200 px-4 py-3 md:hidden dark:border-slate-700">
                    <Label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Section
                    </Label>
                    <Select value={activeSectionId} onValueChange={setActiveSectionId}>
                        <SelectTrigger className="h-10 w-full border-[var(--brand)]/25 bg-white dark:border-slate-600 dark:bg-slate-950">
                            <SelectValue placeholder="Choose section" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="z-[10200] max-h-[min(70vh,420px)]">
                            {navSections.map((s) => {
                                const errCount = sectionErrorCounts[s.id] ?? 0;
                                return (
                                    <SelectItem key={s.id} value={s.id}>
                                        {errCount > 0 ? `${s.title} (${errCount} to fix)` : s.title}
                                    </SelectItem>
                                );
                            })}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex min-h-0 min-h-[min(52vh,420px)] flex-1 flex-col md:flex-row">
                    {/* Desktop: section rail */}
                    <nav
                        className="hidden max-h-[min(58vh,520px)] w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-slate-200 p-3 md:flex md:border-b-0 md:border-r dark:border-slate-700"
                        aria-label="Contract sections"
                    >
                        <p className="mb-2 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand)] dark:text-[var(--brand-accent)]">
                            <LayoutList className="h-3 w-3" aria-hidden />
                            Outline
                        </p>
                        {navSections.map((s) => {
                            const isActive = s.id === activeSectionId;
                            const errCount = sectionErrorCounts[s.id] ?? 0;
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => {
                                        if (errCount > 0) {
                                            jumpToPrefillErrorSection(s.id);
                                        } else {
                                            setActiveSectionId(s.id);
                                        }
                                    }}
                                    className={cn(
                                        "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                                        isActive
                                            ? "bg-[var(--brand)]/12 font-medium text-[var(--brand)] ring-1 ring-[var(--brand)]/25 dark:bg-[var(--brand)]/20 dark:text-[#7eb8e8]"
                                            : errCount > 0
                                              ? "text-destructive hover:bg-destructive/10 dark:hover:bg-destructive/15"
                                              : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
                                    )}
                                >
                                    <s.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                                    <span className="min-w-0 flex-1 leading-snug">{s.title}</span>
                                    {errCount > 0 ? (
                                        <span
                                            className="mt-0.5 shrink-0 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white"
                                            aria-label={`${errCount} fields to fix`}
                                        >
                                            {errCount}
                                        </span>
                                    ) : null}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
                        {activeSection ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-[var(--brand)]/12 bg-slate-50/80 px-4 py-3 dark:border-slate-600 dark:bg-slate-900/50">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]">
                                                <activeSection.Icon className="h-4 w-4" aria-hidden />
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                                                    {activeSection.title}
                                                </h4>
                                                <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                                                    {activeSection.description}
                                                </p>
                                            </div>
                                        </div>
                                        {!readOnly && activeSectionSyncGroups.length > 0 ? (
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleSyncSectionToAll}
                                                disabled={saving}
                                                title={`Copy this stage's shared fields (${activeSectionSyncGroups
                                                    .map((g) => g.label)
                                                    .join(", ")}) to every other stage`}
                                                className="h-8 shrink-0 gap-1.5 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                            >
                                                <CopyCheck className="h-3.5 w-3.5" aria-hidden />
                                                Sync to all
                                            </Button>
                                        ) : null}
                                    </div>
                                    {!readOnly && activeSectionSyncGroups.length > 0 ? (
                                        <p className="mt-2 pl-12 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                                            Shared with other stages:{" "}
                                            <span className="font-medium text-slate-600 dark:text-slate-300">
                                                {activeSectionSyncGroups.map((g) => g.label).join(", ")}
                                            </span>
                                            . Fill them once here, then click “Sync to all”.
                                        </p>
                                    ) : null}
                                </div>
                                {isLinkedAddendumSection ? (
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        {visibleAddendumEditorRows.length === 0 ? (
                                            <p className="text-sm text-slate-600 dark:text-slate-400">
                                                Merchant, EIN, DBA, and bank fields for this addendum are
                                                filled from the sections above. Edit them there instead of
                                                re-entering them here.
                                            </p>
                                        ) : (
                                        visibleAddendumEditorRows.map((row) => (
                                            <div key={row.id} className="space-y-1.5">
                                                <Label htmlFor={`addendum-prefill-${row.id}`} className="text-xs font-medium">
                                                    {row.label}
                                                </Label>
                                                <Input
                                                    id={`addendum-prefill-${row.id}`}
                                                    value={addendumFieldValues[row.id] ?? ""}
                                                    onChange={(e) =>
                                                        setAddendumFieldValues((prev) => ({
                                                            ...prev,
                                                            [row.id]: e.target.value,
                                                        }))
                                                    }
                                                    disabled={readOnly}
                                                    className="h-9 text-sm"
                                                />
                                            </div>
                                        ))
                                        )}
                                    </div>
                                ) : isLinkedDisclosureSection ? (
                                    <div className="space-y-4">
                                        {!linkedDisclosureHasFieldMap ? (
                                            <p className="text-muted-foreground text-sm">
                                                No registered field map for this state disclosure. Link a
                                                disclosure template for the selected state on Info Required.
                                            </p>
                                        ) : disclosureEditorRows.length === 0 ? (
                                            <p className="text-muted-foreground text-sm">
                                                Loading disclosure field definitions…
                                            </p>
                                        ) : (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                {disclosureEditorRows.map((r) => (
                                                    <div key={r.id} className="space-y-1.5">
                                                        <Label
                                                            htmlFor={`disclosure-prefill-${r.id}`}
                                                            className="text-xs font-medium"
                                                        >
                                                            {r.label}
                                                        </Label>
                                                        <Input
                                                            id={`disclosure-prefill-${r.id}`}
                                                            value={disclosureFieldValues[r.id] ?? ""}
                                                            onChange={(e) =>
                                                                setDisclosureFieldValues((prev) => ({
                                                                    ...prev,
                                                                    [r.id]: e.target.value,
                                                                }))
                                                            }
                                                            disabled={readOnly}
                                                            className="h-9 text-sm"
                                                        />
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="space-y-5">
                                        {activeSection.groups.map((group, groupIdx) => (
                                            <div
                                                key={group.heading ?? `group-${groupIdx}`}
                                                className={cn(
                                                    group.heading &&
                                                        groupIdx > 0 &&
                                                        "mt-1 border-t border-slate-200/90 pt-4 dark:border-slate-600",
                                                )}
                                            >
                                                {group.heading ? (
                                                    <h5 className="mb-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                        {group.heading}
                                                    </h5>
                                                ) : null}
                                                <div className="grid gap-4 sm:grid-cols-2">
                                                    {group.keys.map((key) => (
                                                        <div
                                                            key={key}
                                                            className={cn(
                                                                "space-y-1.5",
                                                                key === "purchasePercent" && "sm:col-span-2",
                                                            )}
                                                        >
                                                            <Label
                                                                htmlFor={`prefill-${key}`}
                                                                className="text-xs font-medium"
                                                            >
                                                                {FIELD_LABELS[key as keyof typeof FIELD_LABELS]}
                                                                {REQUIRED_PREFILL_FIELD_KEYS.has(key) ? (
                                                                    <span className="text-destructive"> *</span>
                                                                ) : null}
                                                            </Label>
                                                            {key === "purchasePercent" ? (
                                                                <>
                                                                    <div className="flex flex-wrap gap-2">
                                                                        <Input
                                                                            id={`prefill-${key}`}
                                                                            type="text"
                                                                            required={REQUIRED_PREFILL_FIELD_KEYS.has(key)}
                                                                            value={values[key] ?? ""}
                                                                            onChange={(e) =>
                                                                                setField(key, e.target.value)
                                                                            }
                                                                            disabled={readOnly}
                                                                            aria-invalid={Boolean(fieldErrors[key])}
                                                                            className={cn(
                                                                                "h-9 min-w-[8rem] flex-1 text-sm",
                                                                                fieldErrors[key] &&
                                                                                    "border-destructive focus-visible:ring-destructive",
                                                                            )}
                                                                            placeholder="e.g. 25.00"
                                                                        />
                                                                        {!readOnly ? (
                                                                            <Button
                                                                                type="button"
                                                                                variant="outline"
                                                                                size="sm"
                                                                                className="h-9 shrink-0 gap-1.5 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                                                                onClick={() => setSpaModalOpen(true)}
                                                                            >
                                                                                <Calculator
                                                                                    className="h-3.5 w-3.5"
                                                                                    aria-hidden
                                                                                />
                                                                                Calculate
                                                                            </Button>
                                                                        ) : null}
                                                                    </div>
                                                                    <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                                                                        SPA = (total of repayments ÷ average credits
                                                                        of last 3 months) × 100. Uses scrubbing
                                                                        REPAYMENT column (ACH), not monthly pmts.
                                                                    </p>
                                                                </>
                                                            ) : key === "includeWireFee" ? (
                                                                <div className="flex items-center gap-2 pt-1">
                                                                    <Checkbox
                                                                        id={`prefill-${key}`}
                                                                        checked={
                                                                            values[key] !== "false" &&
                                                                            values[key] !== "0"
                                                                        }
                                                                        onCheckedChange={(checked) =>
                                                                            setField(
                                                                                key,
                                                                                checked === true
                                                                                    ? "true"
                                                                                    : "false",
                                                                            )
                                                                        }
                                                                        disabled={readOnly}
                                                                    />
                                                                    <span className="text-xs text-slate-500 dark:text-slate-400">
                                                                        Usually added to contracts. Uncheck to omit
                                                                        the $25 wire fee from total fees and net
                                                                        amount.
                                                                    </span>
                                                                </div>
                                                            ) : key === "entityType" ? (
                                                                <Select
                                                                    value={values[key] ?? ""}
                                                                    onValueChange={(v: string) => setField(key, v)}
                                                                    disabled={readOnly}
                                                                >
                                                                    <SelectTrigger
                                                                        id={`prefill-${key}`}
                                                                        className={cn(
                                                                            "h-9 text-sm",
                                                                            fieldErrors[key] &&
                                                                                "border-destructive focus-visible:ring-destructive",
                                                                        )}
                                                                        aria-invalid={Boolean(fieldErrors[key])}
                                                                    >
                                                                        <SelectValue placeholder="Select type of entity" />
                                                                    </SelectTrigger>
                                                                    <SelectContent
                                                                        position="popper"
                                                                        className="z-[10200]"
                                                                    >
                                                                        {ENTITY_TYPE_OPTIONS.map((opt) => (
                                                                            <SelectItem
                                                                                key={opt.value}
                                                                                value={opt.value}
                                                                            >
                                                                                {opt.label}
                                                                            </SelectItem>
                                                                        ))}
                                                                        {values[key] &&
                                                                        !ENTITY_TYPE_OPTIONS.some(
                                                                            (o) => o.value === values[key],
                                                                        ) ? (
                                                                            <SelectItem value={values[key]!}>
                                                                                {values[key]}
                                                                            </SelectItem>
                                                                        ) : null}
                                                                    </SelectContent>
                                                                </Select>
                                                            ) : key === "frequency" ? (
                                                                <Select
                                                                    value={
                                                                        coercePaymentFrequencyLabel(
                                                                            values[key],
                                                                        ) ||
                                                                        values[key] ||
                                                                        ""
                                                                    }
                                                                    onValueChange={(v: string) =>
                                                                        setField(key, v)
                                                                    }
                                                                    disabled={readOnly}
                                                                >
                                                                    <SelectTrigger
                                                                        id={`prefill-${key}`}
                                                                        className={cn(
                                                                            "h-9 text-sm",
                                                                            fieldErrors[key] &&
                                                                                "border-destructive focus-visible:ring-destructive",
                                                                        )}
                                                                        aria-invalid={Boolean(
                                                                            fieldErrors[key],
                                                                        )}
                                                                    >
                                                                        <SelectValue placeholder="Select frequency" />
                                                                    </SelectTrigger>
                                                                    <SelectContent
                                                                        position="popper"
                                                                        className="z-[10200]"
                                                                    >
                                                                        {PAYMENT_FREQUENCY_OPTIONS.map(
                                                                            (opt) => (
                                                                                <SelectItem
                                                                                    key={opt.value}
                                                                                    value={opt.value}
                                                                                >
                                                                                    {opt.label}
                                                                                </SelectItem>
                                                                            ),
                                                                        )}
                                                                        {values[key] &&
                                                                        !PAYMENT_FREQUENCY_OPTIONS.some(
                                                                            (o) =>
                                                                                o.value ===
                                                                                coercePaymentFrequencyLabel(
                                                                                    values[key],
                                                                                ),
                                                                        ) &&
                                                                        coercePaymentFrequencyLabel(
                                                                            values[key],
                                                                        ) ? (
                                                                            <SelectItem
                                                                                value={coercePaymentFrequencyLabel(
                                                                                    values[key],
                                                                                )}
                                                                            >
                                                                                {coercePaymentFrequencyLabel(
                                                                                    values[key],
                                                                                )}
                                                                            </SelectItem>
                                                                        ) : null}
                                                                    </SelectContent>
                                                                </Select>
                                                            ) : (
                                                                <Input
                                                                    id={`prefill-${key}`}
                                                                    type={isPasswordPrefillKey(key) ? "password" : "text"}
                                                                    required={REQUIRED_PREFILL_FIELD_KEYS.has(key)}
                                                                    autoComplete={
                                                                        isPasswordPrefillKey(key)
                                                                            ? "new-password"
                                                                            : undefined
                                                                    }
                                                                    value={values[key] ?? ""}
                                                                    onChange={(e) => setField(key, e.target.value)}
                                                                    disabled={readOnly}
                                                                    aria-invalid={Boolean(fieldErrors[key])}
                                                                    className={cn(
                                                                        "h-9 text-sm",
                                                                        fieldErrors[key] &&
                                                                            "border-destructive focus-visible:ring-destructive",
                                                                    )}
                                                                    placeholder={
                                                                        key === "agreementDate"
                                                                            ? agreementDatePlaceholder
                                                                            : undefined
                                                                    }
                                                                />
                                                            )}
                                                            {fieldErrors[key] ? (
                                                                <p className="text-destructive text-xs" role="alert">
                                                                    {fieldErrors[key]}
                                                                </p>
                                                            ) : null}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {nextSection ? (
                                    <div className="flex justify-end pt-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="gap-1 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                            onClick={() => setActiveSectionId(nextSection.id)}
                                        >
                                            Next: {nextSection.title}
                                            <ChevronRight className="h-4 w-4" aria-hidden />
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                </div>
                <DialogFooter className="shrink-0 flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                        {!readOnly && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => resetFromSources({ forceLiveOfferMoney: true })}
                                disabled={saving}
                            >
                                Reload from application
                            </Button>
                        )}
                        {!readOnly && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground"
                                onClick={() => void handleClearOverrides()}
                                disabled={saving || parsePositiveContractId(contractId) == null}
                            >
                                Clear saved overrides
                            </Button>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                            Cancel
                        </Button>
                        {!readOnly && (
                            <Button
                                className="bg-[image:var(--brand-gradient)] text-white hover:opacity-90 cursor-pointer"
                                type="button"
                                onClick={() => void handleSave()}
                                disabled={saving || parsePositiveContractId(contractId) == null}
                            >
                                {saving ? "Saving…" : "Save"}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
        <SpaCalculationModal
            open={spaModalOpen}
            onOpenChange={setSpaModalOpen}
            applicationUuid={applicationUuid}
            offerDecision={offerDecision}
            saving={savingSpaCalculation}
            onApply={handleApplyCalculatedSpa}
        />
        </>
    );
}
