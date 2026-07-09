import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
    Building2,
    ChevronRight,
    CopyCheck,
    DollarSign,
    FilePenLine,
    FileText,
    Globe,
    Landmark,
    Layers,
    LayoutList,
    Loader2,
    Mail,
    MapPin,
    Phone,
    Receipt,
    ScrollText,
    Shield,
    Users,
    Wallet,
    Calculator,
} from "lucide-react";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
    applyCanonicalBankFieldsToPrefill,
    applyLiveBankDetailsToPrefillMerge,
    applyLiveOfferSyncToPrefillPartial,
    applyOwnerRowsToPrefillMerge,
    contractPrefillToContractColumnUpdate,
    deriveOfferFeesDollarsForNetToMerchant,
    finalizeContractPrefillMoneyFields,
    formatOfferDecisionFeesDollarsForPrefill,
    getContractPrefillEditDefaultsFromApplication,
    stripStaleOfferOverridesFromPersisted,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
} from "./Contract";
import {
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    getDocumentTemplatePrefillFieldRowsForEditor,
    hasAddendumPrefillFieldMap,
    hasStateDisclosurePrefillFieldMap,
    normalizeAddendumSavedFieldValuesForPersistence,
    stripDocumentTemplateBlobFromPrefillOverrides,
} from "./documentTemplateMappingPrefill";
import { DOCUSIGN_ADDENDUM_LAYOUT_KEYS } from "./docusignAddendumTemplates";
import type { TemplateMappingPrefillEditRow } from "./TemplateMappingPrefillEditDialog";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import { toast } from "react-toastify";
import { SpaCalculationModal } from "./SpaCalculationModal";
import { persistCalculatedPurchasePercent } from "./spaPrefillSync";
import { cn, parseNumberUS } from "@/lib/utils";
import {
    GUARANTOR2_PREFILL_FORM_KEYS,
    OWNER2_PREFILL_FORM_KEYS,
    resolveActiveOwnerCount,
    resolveOwnerRowFullName,
    resolveSecondOwnerSignerName,
} from "./contractPartyCounts";
import {
    buildDocuSignRolesFromEditorRows,
    mergeContractPrefillWithSignerOverrides,
    resolveContractSignerOverrideRows,
    resolveDocuSignSignerRole,
    type ContractSignerOverrideRow,
} from "./templateRecipients";
import { getPlatformSignerRoleRows } from "./platformDocumentConfig";
import { syncContractPrefillToSourceRecords } from "./contractPrefillSourceSync";
import { resolveOwnerRowsForContractPrefill } from "./contractSignerOwnersSync";
import {
    CONTRACT_PREFILL_UPDATED_EVENT,
    contractPrefillUpdateMatchesApplication,
    emitContractPrefillUpdated,
} from "@/lib/contractPrefillSync";
import {
    MANUAL_NET_TO_MERCHANT_KEY,
    readNetToMerchantPrefillFromContract,
    syncApplicationNoteRecipientFundsFromNetToMerchant,
} from "../contractRecipientFundsSync";

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
    /** Kept for form state typing; not shown in sections — entity type is set on the template. */
    entityType: "Entity type",
    legalName: "Legal name",
    doingBusinessAs: "DBA",
    businessAddress: "Street",
    federalTaxIdEin: "EIN",
    agreementDate: "Agreement date",
    state: "State of incorporation",
    businessAddressCity: "City",
    businessAddressState: "State",
    businessAddressZip: "ZIP",
    businessAddressContract: "Street",
    businessAddressContractCity: "City",
    businessAddressContractState: "State",
    businessAddressContractZip: "ZIP",
    guarantorAddress: "Street",
    guarantorAddressCity: "City",
    guarantorAddressState: "State",
    guarantorAddressZip: "ZIP",
    clientEmail: "Email",
    guarantorEmail: "Email",
    guarantorPhone: "Phone",
    clientPhone: "Phone",
    purchasePrice: "Payback amount",
    purchaseAmount: "Offer amount",
    purchasePercent: "Specified percentage",
    remittance: "Daily payment",
    frequency: "Frequency",
    netToMerchant: "Net to merchant",
    clientName: "Client name (signatures & addenda)",
    owner1GuarantorName: "Owner 1 / Merchant #1 name",
    merchant2Name: "Name",
    owner2GuarantorName: "Name",
    securityBusinessName: "Business name",
    securityTaxEin: "Tax ID / EIN",
    securityDoingBusinessAs: "DBA",
    securityBusinessAddress: "Street",
    securityBusinessAddressCity: "City",
    securityBusinessAddressState: "State",
    securityBusinessAddressZip: "ZIP",
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
    authorizationApplication: "Client name",
    authorizationClientBankName: "Bank name",
    authorizationClientBankRouting: "Routing number",
    authorizationClientBankAccount: "Account number",
    authorizationClientName: "Signer name",
    authorizationClientNamePrint: "Printed name",
    authorizationClientTaxId: "Tax ID / EIN",
    authorizationClientDate: "Date",
    authorizedBusinessPhone: "Business phone",
    achAuthorizationAccountHolderName: "Owner name",
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
    achAuthorizationAccountHolderBankTransactionFee: "Transaction fee (estimated payment)",
    achAuthorizationAccountHolderBankNumberOfTransactions: "NO. of transaction",
    achAuthorizationAccountHolderDate: "Date",
    achAuthorizationConcentAccountHolderName: "Owner name",
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

/** Client 1 → Owner 1 → Guarantor 1, then Client 2 → Owner 2 → Guarantor 2 (per linked owner). */
function buildGuarantyPartyGroups(ownerCount: number): ContractPrefillSectionGroup[] {
    const groups: ContractPrefillSectionGroup[] = [];
    if (ownerCount >= 1) {
        groups.push({
            heading: "Client 1",
            keys: ["guarantyClientName", "guarantySs", "guarantySsDriverLicense"],
        });
        groups.push({
            heading: "Owner 1",
            keys: ["guarantyOwner1Name", "guarantyOwner1Ss", "guarantyOwner1DriverLicense"],
        });
        groups.push({
            heading: "Guarantor 1",
            keys: [
                "guarantyGuarantor1Name",
                "guarantyGuarantor1Ss",
                "guarantyGuarantor1DriverLicense",
            ],
        });
    }
    if (ownerCount >= 2) {
        groups.push({
            heading: "Client 2",
            keys: ["merchant2Name", "guarantyOwner2Ss", "guarantyOwner2DriverLicense"],
        });
        groups.push({
            heading: "Owner 2",
            keys: ["guarantyOwner2Name", "guarantyOwner2Ss", "guarantyOwner2DriverLicense"],
        });
        groups.push({
            heading: "Guarantor 2",
            keys: [
                "guarantyGuarantor2Name",
                "guarantyGuarantor2Ss",
                "guarantyGuarantor2DriverLicense",
            ],
        });
    }
    return groups;
}

/**
 * Document-aligned sections for the Katan RPA stack (RPA → Security → Guaranty → Appendix → ACH → Addendum).
 * Order follows the contract PDF flow so users can verify fields section by section.
 */
const CONTRACT_PREFILL_SECTIONS: ContractPrefillSection[] = [
        {
            id: "rpa_merchant",
            title: "RPA — Merchant & agreement",
            description:
                "Agreement date, legal name, state of inc., DBA, EIN, and primary owner / client name (synced to Merchant #1 and signature lines on the PDF).",
            Icon: FileText,
            groups: [
                {
                    keys: [
                        "customerName",
                        "agreementDate",
                        "state",
                        "legalName",
                        "doingBusinessAs",
                        "federalTaxIdEin",
                    ],
                },
            ],
        },
        {
            id: "business_address",
            title: "Business address",
            description: "Street, city, state, ZIP for the merchant location on page 1.",
            Icon: Building2,
            groups: [{ keys: ["businessAddress", "businessAddressCity", "businessAddressState", "businessAddressZip"] }],
        },
        {
            id: "contact_address",
            title: "Contact / mailing address",
            description: "Contract mailing address (contact address block on the agreement).",
            Icon: Mail,
            groups: [
                {
                    keys: [
                        "businessAddressContract",
                        "businessAddressContractCity",
                        "businessAddressContractState",
                        "businessAddressContractZip",
                    ],
                },
            ],
        },
        {
            id: "guarantor_address",
            title: "Guarantor address",
            description: "Guarantor(s) street, city, state, ZIP.",
            Icon: MapPin,
            groups: [{ keys: ["guarantorAddress", "guarantorAddressCity", "guarantorAddressState", "guarantorAddressZip"] }],
        },
        {
            id: "contact",
            title: "Emails & phones",
            description: "Merchant (client) and guarantor email and phone.",
            Icon: Phone,
            groups: [
                { heading: "Client", keys: ["clientEmail", "clientPhone"] },
                { heading: "Guarantor", keys: ["guarantorEmail", "guarantorPhone"] },
            ],
        },
        {
            id: "financial",
            title: "Offer & payback",
            description:
                "Offer amount, payback amount, specified percentage (purchase percent on contract), total remit, frequency, and net to merchant (advance − fees − refinance).",
            Icon: DollarSign,
            groups: [
                {
                    keys: [
                        "purchasePrice",
                        "purchaseAmount",
                        "purchasePercent",
                        "remittance",
                        "frequency",
                        "netToMerchant",
                    ],
                },
            ],
        },
        {
            id: "owners_exhibit",
            title: "Owners & Exhibit A",
            description:
                "Owner names, Exhibit A signature party, and up to 10 Exhibit A line values (DocuSign data labels exhibit_a_value_1 … 10).",
            Icon: Users,
            groups: [
                { heading: "Owner 1", keys: ["owner1GuarantorName"] },
                { heading: "Merchant 2", keys: ["merchant2Name"] },
                { heading: "Owner 2", keys: ["owner2GuarantorName"] },
                { heading: "Exhibit A — signature", keys: ["exhibitOwnerName"] },
                {
                    heading: "Exhibit A — company names",
                    keys: [
                        "exhibitAValue1",
                        "exhibitAValue2",
                        "exhibitAValue3",
                        "exhibitAValue4",
                        "exhibitAValue5",
                        "exhibitAValue6",
                        "exhibitAValue7",
                        "exhibitAValue8",
                        "exhibitAValue9",
                        "exhibitAValue10",
                    ],
                },
            ],
        },
        {
            id: "security",
            title: "Security agreement",
            description: "Collateral schedule — business name, EIN, DBA, address, additional guarantor text.",
            Icon: Layers,
            groups: [
                {
                    keys: [
                        "securityBusinessName",
                        "securityTaxEin",
                        "securityDoingBusinessAs",
                        "securityBusinessAddress",
                        "securityBusinessAddressCity",
                        "securityBusinessAddressState",
                        "securityBusinessAddressZip",
                        "securityGuarantor",
                    ],
                },
            ],
        },
        {
            id: "guaranty",
            title: "Guaranty of performance",
            description:
                "Guaranty blocks per linked owner — each owner's name, SSN, and driver license fill Client, Owner, and Guarantor lines for that owner.",
            Icon: Shield,
            groups: buildGuarantyPartyGroups(2),
        },
        {
            id: "appendix",
            title: "Appendix A — Fees",
            description:
                "Underwriting fee for Appendix A: enter a percent (e.g. 10 or 10%) and we send the dollar amount (percent × purchase amount) to DocuSign.",
            Icon: Receipt,
            groups: [{ keys: ["appendixUnderwritingFees", "appendixClientName"] }],
        },
        {
            id: "ach_direct_deposit",
            title: "ACH credit / direct deposit authorization",
            description: "Client name on the authorization, then bank, signatory, tax ID, and date.",
            Icon: Landmark,
            groups: [
                { heading: "Client", keys: ["authorizationApplication"] },
                {
                    keys: [
                        "authorizationClientBankName",
                        "authorizationClientBankRouting",
                        "authorizationClientBankAccount",
                        "authorizationClientName",
                        "authorizationClientNamePrint",
                        "authorizationClientTaxId",
                        "authorizationClientDate",
                        "authorizedBusinessPhone",
                    ],
                },
            ],
        },
        {
            id: "ach_account_bank",
            title: "ACH — Account & bank",
            description: "Account holder, bank branch, routing, account number, NO. of transaction (term), transaction fee (estimated payment), consent signature.",
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
                        "achAuthorizationAccountHolderDate",
                    ],
                },
                {
                    heading: "Bank",
                    keys: [
                        "achAuthorizationAccountHolderBankName",
                        "achAuthorizationAccountHolderBankBranchCity",
                        "achAuthorizationAccountHolderBankState",
                        "achAuthorizationAccountHolderBankZip",
                        "achAuthorizationAccountHolderBankRoutingNumber",
                        "achAuthorizationAccountHolderBankAccountNumber",
                        "achAuthorizationAccountHolderBankNumberOfTransactions",
                        "achAuthorizationAccountHolderBankTransactionFee",
                    ],
                },
                {
                    heading: "Consent",
                    keys: [
                        "achAuthorizationConcentAccountHolderName",
                        "achAuthorizationConcentAccountHolderDate",
                    ],
                },
            ],
        },
        {
            id: "ach_portal_refs",
            title: "ACH — Portal & references",
            description:
                "Page 15 fields are completed by the merchant in DocuSign (required). CRM values here are optional notes only and are not sent on the PDF.",
            Icon: Globe,
            groups: [
                {
                    heading: "Online banking (merchant completes on page 15)",
                    keys: [
                        "achAuthorizationBankPortalWebsite",
                        "achAuthorizationUsername",
                        "achAuthorizationPassword",
                        "achAuthorizationSecurityQuestion1",
                        "achAuthorizationSecurityAnswer1",
                        "achAuthorizationSecurityQuestion2",
                        "achAuthorizationSecurityAnswer2",
                        "achAuthorizationSecurityQuestion3",
                        "achAuthorizationSecurityAnswer3",
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
                {
                    heading: "Reference 2",
                    keys: [
                        "achAuthorizationReferenceName2",
                        "achAuthorizationReferenceNumber2",
                        "achAuthorizationReferenceRelationship2",
                    ],
                },
                {
                    heading: "Reference 3",
                    keys: [
                        "achAuthorizationReferenceName3",
                        "achAuthorizationReferenceNumber3",
                        "achAuthorizationReferenceRelationship3",
                    ],
                },
            ],
        },
        {
            id: "addendum",
            title: "Addendum to merchant agreement",
            description: "Date, principal block (owner, business, state), offer / payback amounts, owner signature lines.",
            Icon: FilePenLine,
            groups: [
                {
                    keys: ["addendumDated", "addendumDatedBusinessLocation"],
                },
                {
                    heading: "Principal",
                    keys: [
                        "addendumDatedPrincipalOwner",
                        "addendumDatedPrincipalBusiness",
                        "addendumDatedPrincipalState",
                        "addendumDatedPrincipalOwnerAmount",
                        "addendumDatedPrincipalOwnerAmount2",
                    ],
                },
                {
                    heading: "Owner 1",
                    keys: ["addendumDatedPrincipalOwner1Name", "addendumDatedPrincipalOwner1Date"],
                },
                {
                    heading: "Owner 2",
                    keys: ["addendumDatedPrincipalOwner2Name", "addendumDatedPrincipalOwner2Date"],
                },
            ],
        },
    ];

/** Extra nav section in the prefill modal for the linked DocuSign addendum template (not main-contract addendum fields). */
export const LINKED_DOCUSIGN_ADDENDUM_SECTION_ID = "linked_docusign_addendum";

/** State disclosure template merged with the contract (Florida, Georgia, etc.). */
export const LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID = "linked_docusign_disclosure";

/** Editable contract signer rows when two owners / signers are active. */
export const CONTRACT_SIGNERS_PREFILL_SECTION_ID = "contract_signers";

function defaultSignerEditorRows(ownerCount: number): ContractSignerOverrideRow[] {
    if (ownerCount < 2) return [];
    return getPlatformSignerRoleRows(ownerCount).map((slot) => ({
        role: resolveDocuSignSignerRole(),
        name: String(slot.signerName || "").trim(),
        email: String(slot.signerEmail || "").trim(),
    }));
}

function mergeSignerEditorRows(
    saved: ContractSignerOverrideRow[] | null,
    ownerCount: number,
): ContractSignerOverrideRow[] {
    if (ownerCount < 2) return saved ?? [];
    const defaults = defaultSignerEditorRows(ownerCount);
    if (!saved?.length) return defaults;
    const out = [...saved];
    while (out.length < 2 && defaults[out.length]) {
        out.push(defaults[out.length]!);
    }
    return out.slice(0, 2);
}

function applySecondOwnerNameToPrefillPartial(
    partial: Partial<BuildContractPrefillFieldsArgs>,
    secondOwnerName: string,
    secondOwnerSs?: string,
    secondOwnerDriverLicense?: string,
): void {
    const name = String(secondOwnerName || "").trim();
    if (name) {
        const keys = [
            "owner2GuarantorName",
            "merchant2Name",
            "guarantyOwner2Name",
            "guarantyGuarantor2Name",
            "addendumDatedPrincipalOwner2Name",
        ] as const;
        for (const key of keys) {
            if (!String(partial[key] || "").trim()) {
                partial[key] = name;
            }
        }
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
        out[k] = "";
    }
    return out;
}

function mergeFormState(
    base: Partial<BuildContractPrefillFieldsArgs>,
): Record<keyof BuildContractPrefillFieldsArgs, string> {
    const rec = emptyValuesRecord();
    for (const k of Object.keys(FIELD_LABELS) as (keyof BuildContractPrefillFieldsArgs)[]) {
        const v = base[k];
        rec[k] = v === undefined || v === null ? "" : String(v);
    }
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
const MONEY_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "purchasePrice",
    "purchaseAmount",
    "remittance",
    "netToMerchant",
    "appendixUnderwritingFees",
    "addendumDatedPrincipalOwnerAmount",
    "addendumDatedPrincipalOwnerAmount2",
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

/**
 * Fields that hold the SAME logical value but are repeated across contract sections
 * (e.g. EIN, routing number, bank name, business address appear in RPA, Security, ACH …).
 * The "Sync to all" button on a section copies that section's value for each group into
 * every sibling field in that group. Contact / mailing, ACH account-holder, and guarantor
 * addresses are kept separate and are not included in these groups.
 */
type PrefillSyncGroup = {
    id: string;
    label: string;
    keys: ContractPrefillFormFieldKey[];
};

const PREFILL_SYNC_GROUPS: PrefillSyncGroup[] = [
    {
        id: "ein",
        label: "EIN / Tax ID",
        keys: ["federalTaxIdEin", "securityTaxEin", "authorizationClientTaxId"],
    },
    {
        id: "dba",
        label: "DBA",
        keys: ["doingBusinessAs", "securityDoingBusinessAs", "achAuthorizationAccountHolderDba"],
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
        keys: [
            "legalName",
            "securityBusinessName",
            "achAuthorizationAccountHolderName",
            "achAuthorizationConcentAccountHolderName",
            "addendumDatedPrincipalBusiness",
        ],
    },
    {
        id: "clientName",
        label: "Client / primary name",
        keys: [
            "customerName",
            "clientName",
            "appendixClientName",
            "authorizationApplication",
            "authorizationClientName",
            "authorizationClientNamePrint",
            "guarantyClientName",
            "securityGuarantor",
            "exhibitOwnerName",
            "addendumDatedPrincipalOwner",
            "addendumDatedPrincipalOwner1Name",
            "owner1GuarantorName",
            "guarantyOwner1Name",
            "guarantyGuarantor1Name",
        ],
    },
    {
        id: "clientEmail",
        label: "Client / guarantor email",
        keys: ["clientEmail", "guarantorEmail"],
    },
    {
        id: "businessPhone",
        label: "Business / guarantor phone",
        keys: [
            "clientPhone",
            "authorizedBusinessPhone",
            "achAuthorizationAccountHolderPhone",
            "guarantorPhone",
        ],
    },
    {
        id: "businessStreet",
        label: "Business street",
        keys: ["businessAddress", "securityBusinessAddress", "addendumDatedBusinessLocation"],
    },
    {
        id: "businessCity",
        label: "Business city",
        keys: ["businessAddressCity", "securityBusinessAddressCity"],
    },
    {
        id: "addressState",
        label: "Business state",
        keys: [
            "businessAddressState",
            "securityBusinessAddressState",
            "addendumDatedPrincipalState",
        ],
    },
    {
        id: "businessZip",
        label: "Business ZIP",
        keys: ["businessAddressZip", "securityBusinessAddressZip"],
    },
    {
        id: "bankBranchCity",
        label: "Bank branch city",
        keys: ["achAuthorizationAccountHolderBankBranchCity"],
    },
    {
        id: "bankBranchState",
        label: "Bank state",
        keys: ["achAuthorizationAccountHolderBankState"],
    },
    {
        id: "bankBranchZip",
        label: "Bank ZIP",
        keys: ["achAuthorizationAccountHolderBankZip"],
    },
    {
        id: "offerAmount",
        label: "Offer amount",
        keys: ["purchaseAmount", "addendumDatedPrincipalOwnerAmount"],
    },
    {
        id: "paybackAmount",
        label: "Payback amount",
        keys: ["purchasePrice", "addendumDatedPrincipalOwnerAmount2"],
    },
    {
        id: "owner2Name",
        label: "Owner 2 name",
        keys: [
            "owner2GuarantorName",
            "merchant2Name",
            "guarantyOwner2Name",
            "guarantyGuarantor2Name",
            "addendumDatedPrincipalOwner2Name",
        ],
    },
    {
        id: "ssn",
        label: "SSN",
        keys: ["guarantySs", "guarantyOwner1Ss", "guarantyGuarantor1Ss"],
    },
    {
        id: "driverLicense",
        label: "Driver license",
        keys: [
            "guarantySsDriverLicense",
            "guarantyOwner1DriverLicense",
            "guarantyGuarantor1DriverLicense",
        ],
    },
    {
        id: "owner2Ssn",
        label: "Owner 2 SSN",
        keys: ["guarantyOwner2Ss", "guarantyGuarantor2Ss"],
    },
    {
        id: "owner2DriverLicense",
        label: "Owner 2 driver license",
        keys: ["guarantyOwner2DriverLicense", "guarantyGuarantor2DriverLicense"],
    },
    {
        id: "date",
        label: "Date",
        keys: [
            "agreementDate",
            "authorizationClientDate",
            "achAuthorizationAccountHolderDate",
            "achAuthorizationConcentAccountHolderDate",
            "addendumDated",
            "addendumDatedPrincipalOwner1Date",
            "addendumDatedPrincipalOwner2Date",
        ],
    },
];

/** Owner-party groups mirrored on every keystroke (Client ↔ Owner ↔ Guarantor per index). */
const OWNER_PARTY_REALTIME_MIRROR_GROUP_IDS = new Set([
    "owner2Name",
    "clientName",
    "ssn",
    "driverLicense",
    "owner2Ssn",
    "owner2DriverLicense",
]);

const PREFILL_REALTIME_MIRROR_BY_KEY = (() => {
    const map = new Map<ContractPrefillFormFieldKey, ContractPrefillFormFieldKey[]>();
    for (const group of PREFILL_SYNC_GROUPS) {
        if (!OWNER_PARTY_REALTIME_MIRROR_GROUP_IDS.has(group.id)) continue;
        for (const key of group.keys) {
            map.set(key, group.keys);
        }
    }
    return map;
})();

/** Prefer a filled field on the active stage; otherwise reuse any filled sibling in the group. */
function resolvePrefillSyncSourceKey(
    group: PrefillSyncGroup,
    keysInSection: Set<string>,
    values: Record<keyof BuildContractPrefillFieldsArgs, string>,
): ContractPrefillFormFieldKey | undefined {
    const isFilled = (k: ContractPrefillFormFieldKey) => String(values[k] ?? "").trim() !== "";
    const inSection = group.keys.find((k) => keysInSection.has(k) && isFilled(k));
    if (inSection) return inSection;
    return group.keys.find((k) => isFilled(k));
}

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

    for (const key of EMAIL_KEYS) {
        const msg = validateEmail(trimField(values, key));
        if (msg) err[key] = msg;
    }
    for (const key of PHONE_KEYS) {
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

    const purchasePctRaw = trimField(values, "purchasePercent");
    if (!purchasePctRaw) {
        err.purchasePercent = "Specified percentage is required.";
    } else {
        const purchasePct = validatePercent(purchasePctRaw);
        if (purchasePct) err.purchasePercent = purchasePct;
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
    return null;
}

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
    /** Called after a successful save or clear so the parent can refresh Deal Review / BoldSign merge state. */
    onPersistedPrefillChange?: (next: Partial<BuildContractPrefillFieldsArgs> | null) => void;
    /** Application UUID — used to reload the contract row after save so `contractPrefillOverrides` matches the DB. */
    applicationUuid?: string | null;
    contractRecords?: ContractPrefillContractRecords;
    /** Shown in agreement date field when empty (e.g. today). */
    agreementDatePlaceholder?: string;
    /** Loaded offer decision — used to auto-calculate net to merchant when not overridden. */
    offerDecision?: Record<string, unknown> | null;
    readOnly?: boolean;
    /** Merged into `contractPrefillOverrides` on save; preserved when clearing main prefill (document template field map). */
    additionalContractPrefillJson?: Record<string, unknown> | null;
    /** When false, parent is still loading `contractPrefillOverrides` — form waits before hydrating. */
    prefillOverridesReady?: boolean;
    /** Full saved JSON (includes template mapping blob); use to sync parent contract row. */
    onPersistedPrefillFullChange?: (full: Record<string, unknown> | null) => void;
    /** Linked addendum mapping row from Info — enables a final modal tab for template-specific DocuSign fields. */
    linkedAddendumMapping?: TemplateMappingPrefillEditRow | null;
    /** Linked state disclosure mapping row — enables disclosure prefill fields for the selected state. */
    linkedDisclosureMapping?: TemplateMappingPrefillEditRow | null;
    /** Contract / Info panel state when the disclosure template row has no `state` column. */
    contractDisclosureState?: string | null;
    /** Offer payment frequency (daily / weekly) for disclosure field resolution. */
    contractDisclosureFrequency?: string | null;
    resolvedContract?: Record<string, unknown> | null;
    /** Live CRM signer rows from Summary (may be unsaved); used for owner-2 field visibility and hydration. */
    contractSignerOverrides?: ContractSignerOverrideRow[] | null;
    /** Called after offer/client/application rows are synced from saved prefill. */
    onSourceRecordsSynced?: () => void;
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
    onPersistedPrefillChange,
    applicationUuid = null,
    contractRecords,
    agreementDatePlaceholder = "",
    offerDecision = null,
    readOnly = false,
    additionalContractPrefillJson = null,
    prefillOverridesReady = true,
    onPersistedPrefillFullChange,
    linkedAddendumMapping = null,
    linkedDisclosureMapping = null,
    contractDisclosureState = null,
    contractDisclosureFrequency = null,
    resolvedContract = null,
    contractSignerOverrides = null,
    onSourceRecordsSynced,
}: ContractPrefillEditFormProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [values, setValues] = useState<Record<keyof BuildContractPrefillFieldsArgs, string>>(emptyValuesRecord);
    const [addendumFieldValues, setAddendumFieldValues] = useState<Record<string, string>>({});
    const [disclosureFieldValues, setDisclosureFieldValues] = useState<Record<string, string>>({});
    const [signerEditorRows, setSignerEditorRows] = useState<ContractSignerOverrideRow[]>([]);
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const [activeSectionId, setActiveSectionId] = useState(CONTRACT_PREFILL_SECTIONS[0]?.id ?? "rpa_merchant");
    const purchasePercentTouchedRef = useRef(false);
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
        if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
            return raw as Record<string, Record<string, string>>;
        }
        return {};
    }, [additionalContractPrefillJson]);

    const mainPrefillOverridesForAddendum = useMemo(() => {
        if (persistedPrefillOverrides === undefined) return undefined;
        return (
            stripDocumentTemplateBlobFromPrefillOverrides(persistedPrefillOverrides) ??
            ({} as Partial<BuildContractPrefillFieldsArgs>)
        );
    }, [persistedPrefillOverrides]);

    const linkedAddendumTemplateGuid = linkedAddendumMapping
        ? String(
              linkedAddendumMapping.template?.templateId ?? linkedAddendumMapping.templateId ?? "",
          ).trim()
        : "";
    const linkedAddendumTemplateName =
        linkedAddendumMapping?.template?.name?.trim() ||
        linkedAddendumMapping?.template?.templateId ||
        linkedAddendumTemplateGuid ||
        "Addendum";
    const linkedAddendumHasFieldMap = Boolean(
        linkedAddendumMapping &&
            (String(linkedAddendumMapping.documentType || "").toLowerCase() === "ach" ||
                hasAddendumPrefillFieldMap(
                    linkedAddendumTemplateGuid,
                    linkedAddendumTemplateName,
                    linkedAddendumMapping.template?.layoutKey ?? null,
                )),
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
            hasStateDisclosurePrefillFieldMap(
                linkedDisclosureTemplateName,
                linkedDisclosureMapping.template?.state ?? null,
                linkedDisclosureMapping.template?.frequency ?? null,
                contractDisclosureState,
                contractDisclosureFrequency,
            ),
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
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            offerDecision: offerDecision ?? null,
            agreementDate: agreementDateForDefaults,
            mainPrefillOverrides: mainPrefillOverridesForAddendum,
            savedOverridesForMapping: saved,
            bankDetail: contractRecords?.bankDetail ?? null,
        });
    }, [
        linkedDisclosureMapping,
        linkedDisclosureHasFieldMap,
        documentTemplatePrefillByMappingId,
        contractDisclosureState,
        contractDisclosureFrequency,
        resolvedContract,
        applicationData,
        offerDecision,
        agreementDateForDefaults,
        mainPrefillOverridesForAddendum,
        contractRecords?.bankDetail,
    ]);

    const addendumEditorRows = useMemo(() => {
        if (!linkedAddendumMapping?.id || !linkedAddendumHasFieldMap) return [];
        const saved = documentTemplatePrefillByMappingId[linkedAddendumMapping.id] ?? {};
        const isAchMapping =
            String(linkedAddendumMapping.documentType || "").toLowerCase() === "ach";
        return getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: isAchMapping
                ? linkedAddendumTemplateGuid ||
                  DOCUSIGN_ADDENDUM_LAYOUT_KEYS.ACH_AUTHORIZATION
                : linkedAddendumTemplateGuid || null,
            templateLayoutKey: linkedAddendumMapping.template?.layoutKey ?? null,
            templateName: linkedAddendumMapping.template?.name ?? null,
            templateState: linkedAddendumMapping.template?.state ?? null,
            templateFrequency: linkedAddendumMapping.template?.frequency ?? null,
            documentType: isAchMapping ? "ach" : "addendum",
            prefillDocumentKind: isAchMapping ? "ach_form" : "addendum",
            contract: resolvedContract,
            application: applicationData as Record<string, unknown> | null,
            agreementDate: agreementDateForDefaults,
            mainPrefillOverrides: mainPrefillOverridesForAddendum,
            savedOverridesForMapping: saved,
            bankDetail: contractRecords?.bankDetail ?? null,
        });
    }, [
        linkedAddendumMapping,
        linkedAddendumHasFieldMap,
        linkedAddendumTemplateGuid,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        applicationData,
        agreementDateForDefaults,
        mainPrefillOverridesForAddendum,
        contractRecords?.bankDetail,
    ]);

    const resolvedSignerRows = useMemo(
        () =>
            resolveContractSignerOverrideRows({
                explicit: contractSignerOverrides,
                contractPrefillOverrides: resolvedContract?.contractPrefillOverrides,
                additionalPrefillJson: additionalContractPrefillJson,
            }),
        [
            contractSignerOverrides,
            resolvedContract?.contractPrefillOverrides,
            additionalContractPrefillJson,
        ],
    );

    const contractSignerRolesForCounts = useMemo(
        () =>
            (resolvedSignerRows ?? []).map((row) => ({
                signerRole: row.role,
                signerEmail: row.email,
                signerName: row.name,
            })),
        [resolvedSignerRows],
    );

    const resolvedOwnerRows = useMemo(
        () => resolveOwnerRowsForContractPrefill(applicationData, contractRecords?.owners ?? null),
        [applicationData, contractRecords?.owners],
    );

    const activeOwnerCount = useMemo(
        () =>
            Math.min(
                2,
                Math.max(
                    resolvedOwnerRows.length,
                    resolveActiveOwnerCount({
                        owners: resolvedOwnerRows.length
                            ? resolvedOwnerRows
                            : (contractRecords?.owners ?? null),
                        guarantors: contractRecords?.guarantors ?? null,
                        signerRoles: contractSignerRolesForCounts,
                    }),
                ),
            ),
        [
            resolvedOwnerRows,
            contractRecords?.owners,
            contractRecords?.guarantors,
            contractSignerRolesForCounts,
        ],
    );
    const owner2KeySet = useMemo(() => new Set<string>(OWNER2_PREFILL_FORM_KEYS), []);
    const guarantor2KeySet = useMemo(() => new Set<string>(GUARANTOR2_PREFILL_FORM_KEYS), []);
    const showSecondPartyFields = activeOwnerCount >= 2;

    const prefillSections = useMemo((): ContractPrefillSection[] => {
        const filterGroupKeys = (keys: ContractPrefillFormFieldKey[]) =>
            keys.filter((key) => {
                if (!showSecondPartyFields && owner2KeySet.has(key)) return false;
                if (!showSecondPartyFields && guarantor2KeySet.has(key)) return false;
                return true;
            });

        const sections = CONTRACT_PREFILL_SECTIONS.map((section) => {
            if (section.id === "guaranty") {
                return {
                    ...section,
                    groups: buildGuarantyPartyGroups(activeOwnerCount)
                        .map((group) => ({
                            ...group,
                            keys: filterGroupKeys(group.keys),
                        }))
                        .filter((group) => group.keys.length > 0),
                };
            }
            return {
                ...section,
                groups: section.groups
                    .map((group) => ({
                        ...group,
                        keys: filterGroupKeys(group.keys),
                    }))
                    .filter((group) => group.keys.length > 0),
            };
        }).filter((section) => section.groups.length > 0);

        if (activeOwnerCount >= 2) {
            sections.splice(
                sections.findIndex((s) => s.id === "owners_exhibit") + 1,
                0,
                {
                    id: CONTRACT_SIGNERS_PREFILL_SECTION_ID,
                    title: "Contract signers",
                    description:
                        "Name and email for each signer on the envelope. Owner 2 / secondary signer details also flow into owner-2 prefill fields below.",
                    Icon: Users,
                    groups: [],
                },
            );
        }

        if (linkedAddendumMapping) {
            sections.push({
                id: LINKED_DOCUSIGN_ADDENDUM_SECTION_ID,
                title: `Selected addendum — ${linkedAddendumTemplateName}`,
                description: linkedAddendumHasFieldMap
                    ? "DocuSign field values for the addendum template linked on Info Required (Flex, balance transfer, ACH authorization, etc.)."
                    : "This addendum template is not registered for field editing yet.",
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
            sections.push({
                id: LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID,
                title: `State disclosure — ${stateLabel}${freqLabel}`,
                description: linkedDisclosureHasFieldMap
                    ? `Commercial financing disclosure fields for ${stateLabel}. Values are computed from the deal and can be overridden before send.`
                    : "This state disclosure template is not registered for field editing yet.",
                Icon: Receipt,
                groups: [],
            });
        }
        return sections;
    }, [
        linkedAddendumMapping,
        linkedAddendumTemplateName,
        linkedAddendumHasFieldMap,
        linkedDisclosureMapping,
        linkedDisclosureState,
        linkedDisclosureFrequency,
        linkedDisclosureHasFieldMap,
        showSecondPartyFields,
        owner2KeySet,
        guarantor2KeySet,
        activeOwnerCount,
    ]);

    const seededAddendumMappingIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (!open || !linkedAddendumMapping?.id) {
            seededAddendumMappingIdRef.current = null;
            return;
        }
        if (addendumEditorRows.length === 0) return;
        if (seededAddendumMappingIdRef.current === linkedAddendumMapping.id) return;
        seededAddendumMappingIdRef.current = linkedAddendumMapping.id;
        setAddendumFieldValues(Object.fromEntries(addendumEditorRows.map((r) => [r.id, r.value ?? ""])));
    }, [open, linkedAddendumMapping?.id, addendumEditorRows]);

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
        setDisclosureFieldValues(
            Object.fromEntries(disclosureEditorRows.map((r) => [r.id, r.value ?? ""])),
        );
    }, [open, linkedDisclosureMapping?.id, disclosureSeedKey, disclosureEditorRows]);

    const seededSignerEditorRef = useRef(false);
    useEffect(() => {
        if (!open) {
            seededSignerEditorRef.current = false;
            return;
        }
        if (seededSignerEditorRef.current) return;
        seededSignerEditorRef.current = true;
        setSignerEditorRows(mergeSignerEditorRows(resolvedSignerRows, activeOwnerCount));
    }, [open, resolvedSignerRows, activeOwnerCount]);

    const resetFromSources = useCallback(() => {
        const defaults = getContractPrefillEditDefaultsFromApplication(applicationData, {
            agreementDate: agreementDateForDefaults,
            contractRecords,
            offerDecision,
        });
        const persistedRaw =
            persistedPrefillOverrides === undefined
                ? ({} as Partial<BuildContractPrefillFieldsArgs>)
                : (stripDocumentTemplateBlobFromPrefillOverrides(persistedPrefillOverrides) ??
                    ({} as Partial<BuildContractPrefillFieldsArgs>));
        const persistedClean = { ...(persistedRaw as Record<string, unknown>) };
        delete persistedClean._manualPurchasePercent;
        const persisted = stripStaleOfferOverridesFromPersisted(
            persistedClean as Partial<BuildContractPrefillFieldsArgs>,
            offerDecision,
            applicationData,
        );
        const mergedBase = { ...defaults, ...persisted };
        let merged = applyLiveBankDetailsToPrefillMerge(
            defaults,
            finalizeContractPrefillMoneyFields(mergedBase, {
                application: applicationData as Record<string, unknown> | undefined,
                contract: contractRecords?.contract ?? null,
                offerDecision: offerDecision ?? null,
                prefill: mergedBase,
            }),
        );
        merged = applyLiveOfferSyncToPrefillPartial(merged, applicationData, offerDecision);
        const ownerCount = Math.min(
            2,
            Math.max(
                resolvedOwnerRows.length,
                resolveActiveOwnerCount({
                    owners: resolvedOwnerRows.length
                        ? resolvedOwnerRows
                        : (contractRecords?.owners ?? null),
                    guarantors: contractRecords?.guarantors ?? null,
                    signerRoles: contractSignerRolesForCounts,
                }),
            ),
        );
        applyOwnerRowsToPrefillMerge(merged, resolvedOwnerRows);
        if (ownerCount >= 2) {
            const signerRoles = buildDocuSignRolesFromEditorRows(
                mergeSignerEditorRows(resolvedSignerRows, ownerCount),
            );
            const secondRow = resolvedOwnerRows[1];
            const secondOwnerName =
                resolveOwnerRowFullName(secondRow) ||
                resolveSecondOwnerSignerName(
                    signerRoles,
                    ownerCount,
                    resolvedOwnerRows,
                );
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
        setValues(mergeFormState(merged));
        setSignerEditorRows(mergeSignerEditorRows(resolvedSignerRows, ownerCount));
        setFieldErrors({});
    }, [
        applicationData,
        contractRecords,
        agreementDateForDefaults,
        persistedPrefillOverrides,
        offerDecision,
        contractSignerRolesForCounts,
        resolvedSignerRows,
        resolvedOwnerRows,
    ]);

    /** Stable ref so `resetFromSources` stays current without widening effect deps below. */
    const resetFromSourcesRef = useRef(resetFromSources);
    resetFromSourcesRef.current = resetFromSources;

    /**
     * Hydrate when the dialog opens (or when overrides finish loading after open).
     * Do not re-hydrate on later `persistedPrefillOverrides` churn while the user is typing.
     */
    const wasOpenRef = useRef(false);
    const hydratePersistAfterLoadRef = useRef(false);
    const skipNextOfferSyncRef = useRef(false);
    const offerSyncAppliedKeyRef = useRef<string | null>(null);
    const formReady = prefillOverridesReady && persistedPrefillOverrides !== undefined;

    useEffect(() => {
        if (!open) {
            wasOpenRef.current = false;
            hydratePersistAfterLoadRef.current = false;
            return;
        }
        const justOpened = !wasOpenRef.current;
        wasOpenRef.current = true;

        if (!formReady) {
            if (justOpened) {
                hydratePersistAfterLoadRef.current = true;
            }
            return;
        }

        if (justOpened || hydratePersistAfterLoadRef.current) {
            hydratePersistAfterLoadRef.current = false;
            skipNextOfferSyncRef.current = true;
            resetFromSourcesRef.current();
        }
        // Intentionally omit `persistedPrefillOverrides` — re-hydrating on parent updates resets in-progress edits.
    }, [open, formReady]);

    /** Contract tab saved Recipient Funds → refresh Net to merchant while this dialog is open. */
    useEffect(() => {
        if (!open) return;
        const appKey = String(applicationUuid ?? "").trim();
        if (!appKey) return;
        const onExternalPrefillUpdate = (event: Event) => {
            const detail = (
                event as CustomEvent<{ applicationUuid?: string; contract?: unknown }>
            ).detail;
            if (!contractPrefillUpdateMatchesApplication(detail?.applicationUuid, appKey)) {
                return;
            }
            const netToMerchant = readNetToMerchantPrefillFromContract(detail?.contract);
            if (!netToMerchant) return;
            const netDollars = parseNumberUS(netToMerchant);
            const derivedFees =
                Number.isFinite(netDollars) && netDollars >= 0
                    ? deriveOfferFeesDollarsForNetToMerchant(
                          {
                              application: applicationData as Record<string, unknown> | undefined,
                              contract: contractRecords?.contract ?? null,
                              offerDecision: offerDecision ?? null,
                              prefill: { netToMerchant },
                          },
                          netDollars,
                      )
                    : undefined;
            setValues((prev) => ({
                ...prev,
                netToMerchant,
                ...(derivedFees !== undefined
                    ? {
                          appendixUnderwritingFees:
                              formatOfferDecisionFeesDollarsForPrefill(derivedFees),
                      }
                    : {}),
            }));
        };
        window.addEventListener(CONTRACT_PREFILL_UPDATED_EVENT, onExternalPrefillUpdate);
        return () => {
            window.removeEventListener(CONTRACT_PREFILL_UPDATED_EVENT, onExternalPrefillUpdate);
        };
    }, [open, applicationUuid, applicationData, contractRecords?.contract, offerDecision]);

    useEffect(() => {
        if (!open) {
            offerSyncAppliedKeyRef.current = null;
            skipNextOfferSyncRef.current = false;
        }
    }, [open]);

    const offerDecisionSyncKey = useMemo(() => {
        const root =
            offerDecision && typeof offerDecision === "object"
                ? offerDecision
                : (() => {
                      // Fall back to the offer carried on the freshly loaded application so the
                      // re-sync still fires when the dedicated OfferDecision fetch is null/stale.
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
        if (!root || typeof root !== "object") return "";
        const inner =
            root.offer != null &&
            typeof root.offer === "object" &&
            !Array.isArray(root.offer)
                ? (root.offer as Record<string, unknown>)
                : root;
        return [
            inner.offer,
            inner.approvedAmount,
            inner.totalRemit,
            inner.fees,
            inner.repayPerPeriod,
            inner.paymentAmount,
            inner.dailyPayment,
            inner.frequency,
            inner.numberOfPayments,
            inner.paymentsTerms,
            inner.term,
            inner.termLength,
        ]
            .map((v) => String(v ?? ""))
            .join("|");
    }, [offerDecision, applicationData]);

    /** When the live offer arrives or changes after open, refresh offer-derived fields without wiping other edits. */
    useEffect(() => {
        if (!open || !formReady || !offerDecisionSyncKey) return;
        if (skipNextOfferSyncRef.current) {
            skipNextOfferSyncRef.current = false;
            offerSyncAppliedKeyRef.current = offerDecisionSyncKey;
            return;
        }
        if (offerSyncAppliedKeyRef.current === offerDecisionSyncKey) return;
        offerSyncAppliedKeyRef.current = offerDecisionSyncKey;
        setValues((prev) =>
            mergeFormState(
                applyLiveOfferSyncToPrefillPartial(
                    prev as Partial<BuildContractPrefillFieldsArgs>,
                    applicationData,
                    offerDecision,
                ),
            ),
        );
    }, [open, formReady, offerDecisionSyncKey, applicationData, offerDecision]);

    useEffect(() => {
        if (!open) {
            setFieldErrors({});
            setSaveError(null);
        }
    }, [open]);

    useEffect(() => {
        if (open && CONTRACT_PREFILL_SECTIONS[0]?.id) {
            setActiveSectionId(CONTRACT_PREFILL_SECTIONS[0].id);
        }
    }, [open]);

    const activeSection = prefillSections.find((s) => s.id === activeSectionId) ?? prefillSections[0];
    const activeIdx = prefillSections.findIndex((s) => s.id === activeSection.id);
    const nextSection =
        activeIdx >= 0 && activeIdx < prefillSections.length - 1 ? prefillSections[activeIdx + 1] : null;
    const isLinkedAddendumSection = activeSectionId === LINKED_DOCUSIGN_ADDENDUM_SECTION_ID;
    const isLinkedDisclosureSection = activeSectionId === LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID;
    const isContractSignersSection = activeSectionId === CONTRACT_SIGNERS_PREFILL_SECTION_ID;

    /** Shared-value groups (EIN, routing, address, …) that have a field on the current stage. */
    const activeSectionSyncGroups = useMemo(() => {
        if (
            !activeSection ||
            isContractSignersSection ||
            isLinkedAddendumSection ||
            isLinkedDisclosureSection
        ) {
            return [] as PrefillSyncGroup[];
        }
        const keysInSection = new Set<string>(activeSection.groups.flatMap((g) => g.keys));
        return PREFILL_SYNC_GROUPS.filter((group) => group.keys.some((k) => keysInSection.has(k)));
    }, [activeSection, isContractSignersSection, isLinkedAddendumSection, isLinkedDisclosureSection]);

    const handleSave = async () => {
        setSaveError(null);
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
            const firstSection = firstSectionIdWithFieldErrors(validation);
            if (firstSection) setActiveSectionId(firstSection);
            const count = Object.keys(validation).length;
            const msg =
                count === 1
                    ? "Fix the highlighted field, then save again."
                    : `Fix ${count} highlighted fields, then save again.`;
            setSaveError(msg);
            toast.error(msg);
            return;
        }
        setFieldErrors({});
        setSaving(true);
        try {
            const rawPayload = toPayload(values);
            const payload = applyCanonicalBankFieldsToPrefill(
                finalizeContractPrefillMoneyFields(rawPayload, {
                    application: applicationData as Record<string, unknown> | undefined,
                    contract: contractRecords?.contract ?? null,
                    offerDecision: offerDecision ?? null,
                    prefill: rawPayload,
                }),
            );
            const netDollars = parseNumberUS(String(payload.netToMerchant ?? "").trim());
            if (Number.isFinite(netDollars) && netDollars >= 0) {
                const derivedFees = deriveOfferFeesDollarsForNetToMerchant(
                    {
                        application: applicationData as Record<string, unknown> | undefined,
                        contract: contractRecords?.contract ?? null,
                        offerDecision: offerDecision ?? null,
                        prefill: payload,
                    },
                    netDollars,
                );
                if (derivedFees !== undefined) {
                    payload.appendixUnderwritingFees =
                        formatOfferDecisionFeesDollarsForPrefill(derivedFees);
                }
            }
            const extras =
                additionalContractPrefillJson && typeof additionalContractPrefillJson === "object"
                    ? { ...additionalContractPrefillJson }
                    : ({} as Record<string, unknown>);
            const shouldPersistTemplateBlob =
                (linkedAddendumMapping?.id &&
                    linkedAddendumHasFieldMap &&
                    addendumEditorRows.length > 0) ||
                (linkedDisclosureMapping?.id &&
                    linkedDisclosureHasFieldMap &&
                    disclosureEditorRows.length > 0);
            if (shouldPersistTemplateBlob) {
                const priorBlob =
                    extras[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] != null &&
                    typeof extras[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] === "object" &&
                    !Array.isArray(extras[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY])
                        ? {
                              ...(extras[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] as Record<
                                  string,
                                  Record<string, string>
                              >),
                          }
                        : { ...documentTemplatePrefillByMappingId };
                if (
                    linkedAddendumMapping?.id &&
                    linkedAddendumHasFieldMap &&
                    addendumEditorRows.length > 0
                ) {
                    priorBlob[linkedAddendumMapping.id] =
                        normalizeAddendumSavedFieldValuesForPersistence(
                            {
                                templateId:
                                    linkedAddendumMapping.template?.templateId ??
                                    linkedAddendumMapping.templateId ??
                                    null,
                                templateName: linkedAddendumMapping.template?.name ?? null,
                                templateLayoutKey: linkedAddendumMapping.template?.layoutKey ?? null,
                            },
                            { ...addendumFieldValues },
                        );
                }
                if (
                    linkedDisclosureMapping?.id &&
                    linkedDisclosureHasFieldMap &&
                    disclosureEditorRows.length > 0
                ) {
                    priorBlob[linkedDisclosureMapping.id] = { ...disclosureFieldValues };
                }
                extras[DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY] = priorBlob;
            }
            let contractPrefillOverrides: Record<string, unknown> = {
                ...(payload as Record<string, unknown>),
                ...extras,
            };
            if (purchasePercentTouchedRef.current) {
                contractPrefillOverrides._manualPurchasePercent = true;
            } else {
                delete contractPrefillOverrides._manualPurchasePercent;
            }
            const netToMerchantRaw = String(
                (payload as { netToMerchant?: unknown }).netToMerchant ?? "",
            ).trim();
            if (netToMerchantRaw) {
                contractPrefillOverrides[MANUAL_NET_TO_MERCHANT_KEY] = true;
            } else {
                delete contractPrefillOverrides[MANUAL_NET_TO_MERCHANT_KEY];
            }
            const signerRowsToPersist = signerEditorRows
                .map((row) => ({
                    role: resolveDocuSignSignerRole(row.role),
                    name: String(row.name || "").trim(),
                    email: String(row.email || "").trim(),
                }))
                .filter((row) => row.email);
            if (signerRowsToPersist.length) {
                contractPrefillOverrides = mergeContractPrefillWithSignerOverrides(
                    contractPrefillOverrides,
                    signerRowsToPersist,
                );
            } else if (resolvedSignerRows?.length) {
                contractPrefillOverrides = mergeContractPrefillWithSignerOverrides(
                    contractPrefillOverrides,
                    resolvedSignerRows,
                );
            }
            const columnSync = contractPrefillToContractColumnUpdate(payload);
            const updateRes = await dispatch(
                updateContract({
                    id: cid,
                    data: {
                        contractPrefillOverrides,
                        ...columnSync,
                    },
                }),
            ).unwrap();
            const updatedContract = (updateRes as { data?: unknown })?.data ?? updateRes;
            const fromUpdate = (updatedContract as { contractPrefillOverrides?: unknown } | null)
                ?.contractPrefillOverrides;
            const fullSaved =
                fromUpdate != null && typeof fromUpdate === "object" && !Array.isArray(fromUpdate)
                    ? (fromUpdate as Record<string, unknown>)
                    : contractPrefillOverrides;
            const mainSaved =
                stripDocumentTemplateBlobFromPrefillOverrides(fullSaved) ??
                (payload as Partial<BuildContractPrefillFieldsArgs>);
            onPersistedPrefillChange?.(mainSaved);
            onPersistedPrefillFullChange?.(fullSaved);
            setValues(mergeFormState(mainSaved));
            try {
                await syncContractPrefillToSourceRecords({
                    dispatch,
                    applicationData,
                    applicationUuid,
                    prefill: payload,
                    offerDecision,
                    contractGuarantors: contractRecords?.guarantors ?? null,
                    bankDetail: contractRecords?.bankDetail ?? null,
                    contract:
                        (updatedContract as Record<string, unknown> | null) ??
                        contractRecords?.contract ??
                        null,
                });
                onSourceRecordsSynced?.();
            } catch (syncErr) {
                console.error(syncErr);
                const syncMsg =
                    syncErr instanceof Error
                        ? syncErr.message
                        : "Contract saved, but application or offer sync failed.";
                toast.warn(syncMsg);
            }
            const appKey = String(applicationUuid ?? "").trim();
            if (appKey) {
                try {
                    await dispatch(getByApplicationIdContract(appKey)).unwrap();
                } catch {
                    /* parent already has saved snapshot from update response */
                }
                const netToMerchantSaved = String(
                    (mainSaved as { netToMerchant?: unknown } | null)?.netToMerchant ?? "",
                ).trim();
                if (netToMerchantSaved) {
                    try {
                        const appNote = String(
                            (applicationData as { note?: unknown } | null)?.note ?? "",
                        );
                        await syncApplicationNoteRecipientFundsFromNetToMerchant(
                            dispatch,
                            appKey,
                            appNote,
                            netToMerchantSaved,
                        );
                    } catch (noteSyncErr) {
                        console.error(noteSyncErr);
                    }
                }
                emitContractPrefillUpdated(appKey, updatedContract);
            }
            setSaveError(null);
            toast.success("Contract prefill, offer, application, and bank details saved.");
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
                    const full =
                        (contract as { contractPrefillOverrides?: unknown } | null)
                            ?.contractPrefillOverrides ?? null;
                    const fullObj =
                        full != null && typeof full === "object" && !Array.isArray(full)
                            ? (full as Record<string, unknown>)
                            : null;
                    onPersistedPrefillChange?.(stripDocumentTemplateBlobFromPrefillOverrides(fullObj));
                    onPersistedPrefillFullChange?.(fullObj);
                    emitContractPrefillUpdated(appKey, contract);
                } catch {
                    onPersistedPrefillChange?.(null);
                    onPersistedPrefillFullChange?.(preserveDoc ?? null);
                }
            } else {
                onPersistedPrefillChange?.(null);
                onPersistedPrefillFullChange?.(preserveDoc ?? null);
            }
            resetFromSources();
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
                        onPersistedPrefillFullChange?.(result.fullSaved);
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
        ],
    );

    /**
     * Push shared values (EIN, routing, address, names, …) across every contract stage.
     * Uses the current stage when filled; otherwise reuses the best value found anywhere on the form.
     */
    const handleSyncSectionToAll = () => {
        if (readOnly || !activeSection) return;
        const keysInSection = new Set<string>(activeSection.groups.flatMap((g) => g.keys));
        const isHiddenTarget = (k: keyof BuildContractPrefillFieldsArgs) =>
            !showSecondPartyFields && (owner2KeySet.has(k) || guarantor2KeySet.has(k));
        const updates: Partial<Record<keyof BuildContractPrefillFieldsArgs, string>> = {};
        const syncedLabels: string[] = [];
        const groupsWithSource: string[] = [];
        for (const group of PREFILL_SYNC_GROUPS) {
            const sourceKey = resolvePrefillSyncSourceKey(group, keysInSection, values);
            if (!sourceKey) continue;
            groupsWithSource.push(group.label);
            const value = String(values[sourceKey] ?? "");
            let changed = false;
            for (const k of group.keys) {
                if (isHiddenTarget(k)) continue;
                if (String(values[k] ?? "") !== value) {
                    updates[k] = value;
                    changed = true;
                }
            }
            if (changed) syncedLabels.push(group.label);
        }
        if (!syncedLabels.length) {
            if (!groupsWithSource.length) {
                toast.info("Fill at least one shared field (name, address, EIN, bank, …), then sync.");
            } else {
                toast.info("Shared fields are already synced across all stages.");
            }
            return;
        }
        const normalizedUpdates = applyCanonicalBankFieldsToPrefill(
            updates as Partial<BuildContractPrefillFieldsArgs>,
        ) as Partial<Record<keyof BuildContractPrefillFieldsArgs, string>>;
        setValues((prev) => ({ ...prev, ...normalizedUpdates }));
        setFieldErrors((prev) => {
            const next = { ...prev };
            for (const k of Object.keys(normalizedUpdates) as (keyof BuildContractPrefillFieldsArgs)[]) {
                delete next[k];
            }
            return next;
        });
        setSaveError(null);
        toast.success(`Synced ${syncedLabels.join(", ")} to every stage.`);
    };

    return (
        <>
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent
                className="flex max-h-[92vh] w-[min(100vw-2rem,960px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[960px]"
                onOpenAutoFocus={(e: any) => e.preventDefault()}
            >
                <DialogHeader className="shrink-0 border-b border-[#276D9C]/15 bg-gradient-to-r from-[#276D9C]/10 via-white to-slate-50 px-6 py-4 dark:from-[#276D9C]/20 dark:via-slate-950 dark:to-slate-900">
                    <div className="flex items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#276D9C] text-white shadow-md shadow-[#276D9C]/25">
                            <ScrollText className="h-5 w-5" aria-hidden />
                        </div>
                        <div className="min-w-0 space-y-1">
                            <DialogTitle className="text-left text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                                Verify contract prefill (DocuSign)
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
                        {saveError}
                    </div>
                ) : null}

                {!formReady ? (
                    <div className="flex min-h-[min(52vh,420px)] flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-sm text-muted-foreground">
                        <Loader2 className="h-8 w-8 animate-spin text-[#276D9C]" aria-hidden />
                        <span>Loading saved prefill overrides…</span>
                    </div>
                ) : (
                <>
                {/* Mobile: section picker */}
                <div className="border-b border-slate-200 px-4 py-3 md:hidden dark:border-slate-700">
                    <Label className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-400">
                        Section
                    </Label>
                    <Select value={activeSectionId} onValueChange={setActiveSectionId}>
                        <SelectTrigger className="h-10 w-full border-[#276D9C]/25 bg-white dark:border-slate-600 dark:bg-slate-950">
                            <SelectValue placeholder="Choose section" />
                        </SelectTrigger>
                        <SelectContent position="popper" className="z-[10200] max-h-[min(70vh,420px)]">
                            {prefillSections.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                    {s.title}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex min-h-0 min-h-[min(52vh,420px)] flex-1 flex-col md:flex-row">
                    {/* Desktop: section rail */}
                    <nav
                        className="hidden max-h-[min(58vh,520px)] w-[220px] shrink-0 flex-col gap-0.5 overflow-y-auto border-b border-slate-200 p-3 md:flex md:border-b-0 md:border-r dark:border-slate-700"
                        aria-label="Contract sections"
                    >
                        <p className="mb-2 flex items-center gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-wide text-[#276D9C] dark:text-[#5a9fd4]">
                            <LayoutList className="h-3 w-3" aria-hidden />
                            Outline
                        </p>
                        {prefillSections.map((s) => {
                            const isActive = s.id === activeSectionId;
                            return (
                                <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => setActiveSectionId(s.id)}
                                    className={cn(
                                        "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors",
                                        isActive
                                            ? "bg-[#276D9C]/12 font-medium text-[#276D9C] ring-1 ring-[#276D9C]/25 dark:bg-[#276D9C]/20 dark:text-[#7eb8e8]"
                                            : "text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800",
                                    )}
                                >
                                    <s.Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                                    <span className="leading-snug">{s.title}</span>
                                </button>
                            );
                        })}
                    </nav>

                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 md:px-6">
                        {activeSection ? (
                            <div className="space-y-4">
                                <div className="rounded-xl border border-[#276D9C]/12 bg-slate-50/80 px-4 py-3 dark:border-slate-600 dark:bg-slate-900/50">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex min-w-0 items-start gap-3">
                                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#276D9C]/12 text-[#276D9C]">
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
                                                title={`Copy shared fields (${activeSectionSyncGroups
                                                    .map((g) => g.label)
                                                    .join(", ")}) across every contract section`}
                                                className="h-8 shrink-0 gap-1.5 border-[#276D9C]/30 text-[#276D9C] hover:bg-[#276D9C]/10"
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
                                            . Sync copies matching values across every section (uses data already on the form).
                                        </p>
                                    ) : null}
                                </div>
                                {isContractSignersSection ? (
                                    <div className="space-y-4">
                                        {signerEditorRows.map((row, index) => (
                                            <div
                                                key={`signer-${index}`}
                                                className="space-y-3 rounded-lg border border-slate-200/90 bg-white p-4 dark:border-slate-600 dark:bg-slate-950/40"
                                            >
                                                <h5 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                    {index === 0 ? "Primary signer" : "Secondary signer (Owner 2)"}
                                                </h5>
                                                <div className="grid gap-3 sm:grid-cols-2">
                                                    <div className="space-y-1.5">
                                                        <Label
                                                            htmlFor={`prefill-signer-role-${index}`}
                                                            className="text-xs font-medium"
                                                        >
                                                            Role
                                                        </Label>
                                                        <Input
                                                            id={`prefill-signer-role-${index}`}
                                                            value={resolveDocuSignSignerRole()}
                                                            readOnly
                                                            disabled
                                                            className="h-9 text-sm bg-slate-50"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5">
                                                        <Label
                                                            htmlFor={`prefill-signer-email-${index}`}
                                                            className="text-xs font-medium"
                                                        >
                                                            Email
                                                        </Label>
                                                        <Input
                                                            id={`prefill-signer-email-${index}`}
                                                            type="email"
                                                            value={row.email}
                                                            onChange={(e) =>
                                                                setSignerEditorRows((prev) =>
                                                                    prev.map((r, i) =>
                                                                        i === index
                                                                            ? { ...r, email: e.target.value }
                                                                            : r,
                                                                    ),
                                                                )
                                                            }
                                                            disabled={readOnly}
                                                            className="h-9 text-sm"
                                                        />
                                                    </div>
                                                    <div className="space-y-1.5 sm:col-span-2">
                                                        <Label
                                                            htmlFor={`prefill-signer-name-${index}`}
                                                            className="text-xs font-medium"
                                                        >
                                                            Name
                                                        </Label>
                                                        <Input
                                                            id={`prefill-signer-name-${index}`}
                                                            value={row.name}
                                                            onChange={(e) => {
                                                                const name = e.target.value;
                                                                setSignerEditorRows((prev) =>
                                                                    prev.map((r, i) =>
                                                                        i === index ? { ...r, name } : r,
                                                                    ),
                                                                );
                                                                if (index === 1 && name.trim()) {
                                                                    setValues((prev) => {
                                                                        const next = { ...prev };
                                                                        applySecondOwnerNameToPrefillPartial(
                                                                            next,
                                                                            name,
                                                                        );
                                                                        return next;
                                                                    });
                                                                }
                                                            }}
                                                            disabled={readOnly}
                                                            className="h-9 text-sm"
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                ) : isLinkedAddendumSection ? (
                                    <div className="space-y-4">
                                        {!linkedAddendumHasFieldMap ? (
                                            <p className="text-muted-foreground text-sm">
                                                No registered field map for this addendum. Link Flex, balance
                                                transfer, or ACH authorization templates on Info Required.
                                            </p>
                                        ) : addendumEditorRows.length === 0 ? (
                                            <p className="text-muted-foreground text-sm">Loading field definitions…</p>
                                        ) : (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                {addendumEditorRows.map((r) => (
                                                    <div key={r.id} className="space-y-1.5">
                                                        <Label
                                                            htmlFor={`addendum-prefill-${r.id}`}
                                                            className="text-xs font-medium"
                                                        >
                                                            {r.label}
                                                        </Label>
                                                        <Input
                                                            id={`addendum-prefill-${r.id}`}
                                                            value={addendumFieldValues[r.id] ?? ""}
                                                            onChange={(e) =>
                                                                setAddendumFieldValues((prev) => ({
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
                                            className={cn(group.heading && groupIdx > 0 && "mt-1 border-t border-slate-200/90 pt-4 dark:border-slate-600")}
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
                                                        <Label htmlFor={`prefill-${key}`} className="text-xs font-medium">
                                                            {FIELD_LABELS[key as keyof typeof FIELD_LABELS]}
                                                        </Label>
                                                        {key === "purchasePercent" ? (
                                                            <>
                                                                <div className="flex flex-wrap gap-2">
                                                                    <Input
                                                                        id={`prefill-${key}`}
                                                                        type="text"
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
                                                                            className="h-9 shrink-0 gap-1.5 border-[#276D9C]/30 text-[#276D9C] hover:bg-[#276D9C]/10"
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
                                                                    SPA = (total monthly payments ÷ average credits
                                                                    of last 3 months) × 100. Calculate saves the
                                                                    result; you can still edit the field manually
                                                                    afterward.
                                                                </p>
                                                            </>
                                                        ) : (
                                                            <Input
                                                                id={`prefill-${key}`}
                                                                type={isPasswordPrefillKey(key) ? "password" : "text"}
                                                                autoComplete={
                                                                    isPasswordPrefillKey(key) ? "new-password" : undefined
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
                                            className="gap-1 border-[#276D9C]/30 text-[#276D9C] hover:bg-[#276D9C]/10"
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
                </>
                )}
                <DialogFooter className="shrink-0 flex-col gap-2 border-t px-6 py-4 sm:flex-row sm:justify-between">
                    <div className="flex flex-wrap gap-2">
                        {!readOnly && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => resetFromSources()}
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
                                className="bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer"
                                type="button"
                                onClick={() => void handleSave()}
                                disabled={saving || !formReady || parsePositiveContractId(contractId) == null}
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
