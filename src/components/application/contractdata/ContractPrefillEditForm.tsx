import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
    Building2,
    ChevronRight,
    DollarSign,
    FilePenLine,
    FileText,
    Globe,
    Landmark,
    Layers,
    LayoutList,
    Mail,
    MapPin,
    Phone,
    Receipt,
    ScrollText,
    Shield,
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
    getContractPrefillEditDefaultsFromApplication,
    normalizeContractPrefillOverrides,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
} from "./Contract";
import { DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY } from "./documentTemplateMappingPrefill";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import { toast } from "react-toastify";
import { cn } from "@/lib/utils";

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

const FIELD_LABELS = {
    customerName: "Customer / primary name",
    /** Kept for form state typing; not shown in sections — entity type is set on the template. */
    entityType: "Entity type",
    legalName: "Legal name",
    doingBusinessAs: "Doing business as (DBA)",
    businessAddress: "Business street address",
    federalTaxIdEin: "Federal tax ID (EIN)",
    agreementDate: "Agreement date",
    state: "State of incorporation",
    businessAddressCity: "Business city",
    businessAddressState: "Business state",
    businessAddressZip: "Business ZIP",
    businessAddressContract: "Contract mailing address",
    businessAddressContractCity: "Contract address city",
    businessAddressContractState: "Contract address state",
    businessAddressContractZip: "Contract address ZIP",
    guarantorAddress: "Guarantor street address",
    guarantorAddressCity: "Guarantor city",
    guarantorAddressState: "Guarantor state",
    guarantorAddressZip: "Guarantor ZIP",
    clientEmail: "Client email",
    guarantorEmail: "Guarantor email",
    guarantorPhone: "Guarantor phone",
    clientPhone: "Client phone",
    purchasePrice: "Purchase price",
    purchaseAmount: "Purchase amount",
    purchasePercent: "Purchase percent",
    remittance: "Remittance",
    clientName: "Client name",
    owner1GuarantorName: "Owner 1 / guarantor name",
    owner2GuarantorName: "Owner 2 / guarantor name",
    securityBusinessName: "Security — business name",
    securityTaxEin: "Security — tax EIN",
    securityDoingBusinessAs: "Security — DBA",
    securityBusinessAddress: "Security — business address",
    securityBusinessAddressCity: "Security — city",
    securityBusinessAddressState: "Security — state",
    securityBusinessAddressZip: "Security — ZIP",
    securityGuarantor: "Security — guarantor",
    guarantyClientName: "Guaranty — client name",
    guarantySs: "Guaranty — SSN",
    guarantySsDriverLicense: "Guaranty — SSN / driver license",
    guarantyOwner1Name: "Guaranty — owner 1 name",
    guarantyOwner1Ss: "Guaranty — owner 1 SSN",
    guarantyOwner1DriverLicense: "Guaranty — owner 1 driver license",
    guarantyOwner2Name: "Guaranty — owner 2 name",
    guarantyOwner2DriverLicense: "Guaranty — owner 2 driver license",
    guarantyOwner2Ss: "Guaranty — owner 2 SSN",
    guarantyGuarantor1Name: "Guaranty — guarantor 1 name",
    guarantyGuarantor1Ss: "Guaranty — guarantor 1 SSN",
    guarantyGuarantor1DriverLicense: "Guaranty — guarantor 1 driver license",
    guarantyGuarantor2Name: "Guaranty — guarantor 2 name",
    guarantyGuarantor2Ss: "Guaranty — guarantor 2 SSN",
    guarantyGuarantor2DriverLicense: "Guaranty — guarantor 2 driver license",
    appendixUnderwritingFees: "Appendix — underwriting fees",
    appendixClientName: "Appendix — client name",
    authorizationApplication: "Authorization — application",
    authorizationClientBankName: "Authorization — bank name",
    authorizationClientBankRouting: "Authorization — routing number",
    authorizationClientBankAccount: "Authorization — account number",
    authorizationClientName: "Authorization — client name",
    authorizationClientNamePrint: "Authorization — printed name",
    authorizationClientTaxId: "Authorization — tax ID",
    authorizationClientDate: "Authorization — date",
    authorizedBusinessPhone: "Authorized business phone",
    achAuthorizationAccountHolderName: "ACH — account holder name",
    achAuthorizationAccountHolderDba: "ACH — DBA",
    achAuthorizationAccountHolderPhone: "ACH — phone",
    achAuthorizationAccountHolderAddress: "ACH — address",
    achAuthorizationAccountHolderCity: "ACH — city",
    achAuthorizationAccountHolderState: "ACH — state",
    achAuthorizationAccountHolderZip: "ACH — ZIP",
    achAuthorizationAccountHolderBankName: "ACH — bank name",
    achAuthorizationAccountHolderBankBranchCity: "ACH — bank branch city",
    achAuthorizationAccountHolderBankState: "ACH — bank state",
    achAuthorizationAccountHolderBankZip: "ACH — bank ZIP",
    achAuthorizationAccountHolderBankRoutingNumber: "ACH — routing number",
    achAuthorizationAccountHolderBankAccountNumber: "ACH — account number",
    achAuthorizationAccountHolderBankTransactionFee: "ACH — transaction fee",
    achAuthorizationAccountHolderDate: "ACH — date",
    achAuthorizationConcentAccountHolderName: "ACH Concent — account holder name",
    achAuthorizationConcentAccountHolderDate: "ACH Concent — date",
    achAuthorizationBankPortalWebsite: "ACH — bank portal website",
    achAuthorizationUsername: "ACH — username",
    achAuthorizationPassword: "ACH — password",
    achAuthorizationSecurityQuestion1: "ACH — security question 1",
    achAuthorizationSecurityAnswer1: "ACH — security answer 1",
    achAuthorizationSecurityQuestion2: "ACH — security question 2",
    achAuthorizationSecurityAnswer2: "ACH — security answer 2",
    achAuthorizationSecurityQuestion3: "ACH — security question 3",
    achAuthorizationSecurityAnswer3: "ACH — security answer 3",
    achAuthorizationOtherInfomation: "ACH — other information",
    achAuthorizationReferenceName1: "ACH — reference name 1",
    achAuthorizationReferenceNumber1: "ACH — reference number 1",
    achAuthorizationReferenceRelationship1: "ACH — reference relationship 1",
    achAuthorizationReferenceName2: "ACH — reference name 2",
    achAuthorizationReferenceNumber2: "ACH — reference number 2",
    achAuthorizationReferenceRelationship2: "ACH — reference relationship 2",
    achAuthorizationReferenceName3: "ACH — reference name 3",
    achAuthorizationReferenceNumber3: "ACH — reference number 3",
    achAuthorizationReferenceRelationship3: "ACH — reference relationship 3",
    addendumDated: "Addendum — dated",
    addendumDatedPrincipalOwner: "Addendum — principal owner",
    addendumDatedPrincipalBusiness: "Addendum — principal business",
    addendumDatedBusinessLocation: "Addendum — business location",
    addendumDatedPrincipalState: "Addendum — principal state",
    addendumDatedPrincipalOwnerAmount: "Addendum — principal amount",
    addendumDatedPrincipalOwnerAmount2: "Addendum — principal amount 2",
    addendumDatedPrincipalOwner1Name: "Addendum — owner 1 name",
    addendumDatedPrincipalOwner1Date: "Addendum — owner 1 date",
    addendumDatedPrincipalOwner2Name: "Addendum — owner 2 name",
    addendumDatedPrincipalOwner2Date: "Addendum — owner 2 date",
    exhibitOwnerName: "Exhibit — owner name",
} as const satisfies Record<ContractPrefillFormFieldKey, string>;

/**
 * Document-aligned sections for the Barclays RPA stack (RPA → Security → Guaranty → Appendix → ACH → Addendum).
 * Order follows the contract PDF flow so users can verify fields section by section.
 */
const CONTRACT_PREFILL_SECTIONS: {
    id: string;
    title: string;
    description: string;
    Icon: LucideIcon;
    keys: (keyof BuildContractPrefillFieldsArgs)[];
}[] = [
        {
            id: "rpa_merchant",
            title: "RPA — Merchant & agreement",
            description: "Agreement date, legal name, state of inc., DBA, EIN, client / merchant name.",
            Icon: FileText,
            keys: ["customerName", "agreementDate", "state", "legalName", "doingBusinessAs", "federalTaxIdEin", "clientName"],
        },
        {
            id: "business_address",
            title: "Business address",
            description: "Street, city, state, ZIP for the merchant location on page 1.",
            Icon: Building2,
            keys: ["businessAddress", "businessAddressCity", "businessAddressState", "businessAddressZip"],
        },
        {
            id: "contact_address",
            title: "Contact / mailing address",
            description: "Contract mailing address (contact address block on the agreement).",
            Icon: Mail,
            keys: [
                "businessAddressContract",
                "businessAddressContractCity",
                "businessAddressContractState",
                "businessAddressContractZip",
            ],
        },
        {
            id: "guarantor_address",
            title: "Guarantor address",
            description: "Guarantor(s) street, city, state, ZIP.",
            Icon: MapPin,
            keys: ["guarantorAddress", "guarantorAddressCity", "guarantorAddressState", "guarantorAddressZip"],
        },
        {
            id: "contact",
            title: "Emails & phones",
            description: "Merchant and guarantor email and phone.",
            Icon: Phone,
            keys: ["clientEmail", "clientPhone", "guarantorEmail", "guarantorPhone"],
        },
        {
            id: "financial",
            title: "Purchase & remittance",
            description: "Purchase price, purchased amount, percent, remittance (financial terms box).",
            Icon: DollarSign,
            keys: ["purchasePrice", "purchaseAmount", "purchasePercent", "remittance"],
        },
        {
            id: "owners_exhibit",
            title: "Owners & Exhibit A",
            description: "Owner / merchant print lines and Exhibit A signature party.",
            Icon: Users,
            keys: ["owner1GuarantorName", "owner2GuarantorName", "exhibitOwnerName"],
        },
        {
            id: "security",
            title: "Security agreement",
            description: "Collateral schedule — business name, EIN, DBA, address, additional guarantor text.",
            Icon: Layers,
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
        {
            id: "guaranty",
            title: "Guaranty of performance",
            description: "Guaranty blocks — client, owners, guarantors; SSN and driver license lines.",
            Icon: Shield,
            keys: [
                "guarantyClientName",
                "guarantySs",
                "guarantySsDriverLicense",
                "guarantyOwner1Name",
                "guarantyOwner1Ss",
                "guarantyOwner1DriverLicense",
                "guarantyOwner2Name",
                "guarantyOwner2DriverLicense",
                "guarantyOwner2Ss",
                "guarantyGuarantor1Name",
                "guarantyGuarantor1Ss",
                "guarantyGuarantor1DriverLicense",
                "guarantyGuarantor2Name",
                "guarantyGuarantor2Ss",
                "guarantyGuarantor2DriverLicense",
            ],
        },
        {
            id: "appendix",
            title: "Appendix A — Fees",
            description: "Underwriting fee amount and appendix acknowledgement name.",
            Icon: Receipt,
            keys: ["appendixUnderwritingFees", "appendixClientName"],
        },
        {
            id: "ach_direct_deposit",
            title: "ACH credit / direct deposit authorization",
            description: "Authorization agreement — bank name, routing, account, merchant signatory, tax ID, date.",
            Icon: Landmark,
            keys: [
                "authorizationApplication",
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
        {
            id: "ach_account_bank",
            title: "ACH — Account & bank",
            description: "Account holder, bank branch, routing, account number, transaction fee, dates.",
            Icon: Wallet,
            keys: [
                "achAuthorizationAccountHolderName",
                "achAuthorizationAccountHolderDba",
                "achAuthorizationAccountHolderPhone",
                "achAuthorizationAccountHolderAddress",
                "achAuthorizationAccountHolderCity",
                "achAuthorizationAccountHolderState",
                "achAuthorizationAccountHolderZip",
                "achAuthorizationAccountHolderBankName",
                "achAuthorizationAccountHolderBankBranchCity",
                "achAuthorizationAccountHolderBankState",
                "achAuthorizationAccountHolderBankZip",
                "achAuthorizationAccountHolderBankRoutingNumber",
                "achAuthorizationAccountHolderBankAccountNumber",
                "achAuthorizationAccountHolderBankTransactionFee",
                "achAuthorizationAccountHolderDate",
                "achAuthorizationConcentAccountHolderName",
                "achAuthorizationConcentAccountHolderDate",
            ],
        },
        {
            id: "ach_portal_refs",
            title: "ACH — Portal & references",
            description: "Bank portal credentials, security Q&A, other notes, and three references.",
            Icon: Globe,
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
                "achAuthorizationReferenceName1",
                "achAuthorizationReferenceNumber1",
                "achAuthorizationReferenceRelationship1",
                "achAuthorizationReferenceName2",
                "achAuthorizationReferenceNumber2",
                "achAuthorizationReferenceRelationship2",
                "achAuthorizationReferenceName3",
                "achAuthorizationReferenceNumber3",
                "achAuthorizationReferenceRelationship3",
            ],
        },
        {
            id: "addendum",
            title: "Addendum to merchant agreement",
            description: "Principal owner, business, amounts, owner signature lines.",
            Icon: FilePenLine,
            keys: [
                "addendumDated",
                "addendumDatedPrincipalOwner",
                "addendumDatedPrincipalBusiness",
                "addendumDatedBusinessLocation",
                "addendumDatedPrincipalState",
                "addendumDatedPrincipalOwnerAmount",
                "addendumDatedPrincipalOwnerAmount2",
                "addendumDatedPrincipalOwner1Name",
                "addendumDatedPrincipalOwner1Date",
                "addendumDatedPrincipalOwner2Name",
                "addendumDatedPrincipalOwner2Date",
            ],
        },
    ];

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

    const purchasePct = validatePercent(trimField(values, "purchasePercent"));
    if (purchasePct) err.purchasePercent = purchasePct;

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
    readOnly?: boolean;
    /** Merged into `contractPrefillOverrides` on save; preserved when clearing main prefill (document template field map). */
    additionalContractPrefillJson?: Record<string, unknown> | null;
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
    readOnly = false,
    additionalContractPrefillJson = null,
}: ContractPrefillEditFormProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [values, setValues] = useState<Record<keyof BuildContractPrefillFieldsArgs, string>>(emptyValuesRecord);
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [activeSectionId, setActiveSectionId] = useState(CONTRACT_PREFILL_SECTIONS[0]?.id ?? "rpa_merchant");

    const agreementDateForDefaults = agreementDatePlaceholder || "";

    const resetFromSources = useCallback(() => {
        const defaults = getContractPrefillEditDefaultsFromApplication(applicationData, {
            agreementDate: agreementDateForDefaults,
            contractRecords,
        });
        const persisted =
            persistedPrefillOverrides === undefined
                ? ({} as Partial<BuildContractPrefillFieldsArgs>)
                : (normalizeContractPrefillOverrides(persistedPrefillOverrides) ??
                    ({} as Partial<BuildContractPrefillFieldsArgs>));
        setValues(mergeFormState({ ...defaults, ...persisted }));
        setFieldErrors({});
    }, [applicationData, contractRecords, agreementDateForDefaults, persistedPrefillOverrides]);

    /** Stable ref so `resetFromSources` stays current without widening effect deps below. */
    const resetFromSourcesRef = useRef(resetFromSources);
    resetFromSourcesRef.current = resetFromSources;

    /**
     * Parents may pass `persistedPrefillOverrides=undefined` until the contract JSON is loaded. When we opened in
     * that state, merge overrides once after load; ignore later `persisted`/Redux churn so edits aren't wiped mid-type.
     */
    const hydratePersistAfterLoadRef = useRef(false);

    useEffect(() => {
        if (!open) {
            hydratePersistAfterLoadRef.current = false;
            return;
        }
        hydratePersistAfterLoadRef.current = persistedPrefillOverrides === undefined;
        resetFromSourcesRef.current();
    }, [open]);

    useEffect(() => {
        if (
            !open ||
            persistedPrefillOverrides === undefined ||
            !hydratePersistAfterLoadRef.current
        ) {
            return;
        }
        hydratePersistAfterLoadRef.current = false;
        resetFromSourcesRef.current();
    }, [open, persistedPrefillOverrides]);

    useEffect(() => {
        if (!open) setFieldErrors({});
    }, [open]);

    useEffect(() => {
        if (open && CONTRACT_PREFILL_SECTIONS[0]?.id) {
            setActiveSectionId(CONTRACT_PREFILL_SECTIONS[0].id);
        }
    }, [open]);

    const activeSection = CONTRACT_PREFILL_SECTIONS.find((s) => s.id === activeSectionId) ?? CONTRACT_PREFILL_SECTIONS[0];
    const activeIdx = CONTRACT_PREFILL_SECTIONS.findIndex((s) => s.id === activeSection.id);
    const nextSection = activeIdx >= 0 && activeIdx < CONTRACT_PREFILL_SECTIONS.length - 1
        ? CONTRACT_PREFILL_SECTIONS[activeIdx + 1]
        : null;

    const handleSave = async () => {
        const cid = parsePositiveContractId(contractId);
        if (cid == null) {
            toast.error("Cannot save: open or create a contract for this application first.");
            return;
        }
        const validation = validatePrefillValues(values);
        if (Object.keys(validation).length > 0) {
            setFieldErrors(validation);
            toast.error("Fix the highlighted fields, then save again.");
            return;
        }
        setFieldErrors({});
        setSaving(true);
        try {
            const payload = toPayload(values);
            const extras =
                additionalContractPrefillJson && typeof additionalContractPrefillJson === "object"
                    ? additionalContractPrefillJson
                    : {};
            const contractPrefillOverrides = {
                ...(payload as Record<string, unknown>),
                ...extras,
            };
            await dispatch(
                updateContract({
                    id: cid,
                    data: { contractPrefillOverrides },
                }),
            ).unwrap();
            const appKey = String(applicationUuid ?? "").trim();
            if (appKey) {
                try {
                    const res = await dispatch(getByApplicationIdContract(appKey)).unwrap();
                    const contract = (res as { data?: unknown })?.data ?? res;
                    const fromDb = normalizeContractPrefillOverrides(
                        (contract as { contractPrefillOverrides?: unknown })?.contractPrefillOverrides,
                    );
                    onPersistedPrefillChange?.(fromDb ?? (payload as Partial<BuildContractPrefillFieldsArgs>));
                } catch {
                    onPersistedPrefillChange?.(payload as Partial<BuildContractPrefillFieldsArgs>);
                }
            } else {
                onPersistedPrefillChange?.(payload as Partial<BuildContractPrefillFieldsArgs>);
            }
            toast.success("Contract prefill fields saved.");
            onOpenChange(false);
        } catch (e) {
            console.error(e);
            toast.error("Failed to save contract prefill fields.");
        } finally {
            setSaving(false);
        }
    };

    const handleClearOverrides = async () => {
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
                    onPersistedPrefillChange?.(
                        normalizeContractPrefillOverrides(
                            (contract as { contractPrefillOverrides?: unknown })?.contractPrefillOverrides,
                        ) ?? null,
                    );
                } catch {
                    onPersistedPrefillChange?.(null);
                }
            } else {
                onPersistedPrefillChange?.(null);
            }
            resetFromSources();
            toast.success("Saved overrides cleared; BoldSign will use application data again.");
        } catch (e) {
            console.error(e);
            toast.error("Failed to clear overrides.");
        } finally {
            setSaving(false);
        }
    };

    const setField = (key: keyof BuildContractPrefillFieldsArgs, v: string) => {
        setValues((prev) => ({ ...prev, [key]: v }));
        setFieldErrors((prev) => {
            if (!prev[key]) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
        });
    };

    return (
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
                                Verify contract prefill (BoldSign)
                            </DialogTitle>
                            <p className="text-muted-foreground text-sm font-normal leading-snug">
                                Walk through each agreement section and confirm values match the deal. Saved overrides
                                merge into BoldSign when you open or send the contract.
                            </p>
                        </div>
                    </div>
                </DialogHeader>

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
                            {CONTRACT_PREFILL_SECTIONS.map((s) => (
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
                        {CONTRACT_PREFILL_SECTIONS.map((s) => {
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
                                    <div className="flex items-start gap-3">
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
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    {activeSection.keys.map((key) => (
                                        <div key={key} className="space-y-1.5">
                                            <Label htmlFor={`prefill-${key}`} className="text-xs font-medium">
                                                {FIELD_LABELS[key as keyof typeof FIELD_LABELS]}
                                            </Label>
                                            <Input
                                                id={`prefill-${key}`}
                                                type={isPasswordPrefillKey(key) ? "password" : "text"}
                                                autoComplete={isPasswordPrefillKey(key) ? "new-password" : undefined}
                                                value={values[key] ?? ""}
                                                onChange={(e) => setField(key, e.target.value)}
                                                disabled={readOnly}
                                                aria-invalid={Boolean(fieldErrors[key])}
                                                className={cn(
                                                    "h-9 text-sm",
                                                    fieldErrors[key] && "border-destructive focus-visible:ring-destructive",
                                                )}
                                                placeholder={
                                                    key === "agreementDate" ? agreementDatePlaceholder : undefined
                                                }
                                            />
                                            {fieldErrors[key] ? (
                                                <p className="text-destructive text-xs" role="alert">
                                                    {fieldErrors[key]}
                                                </p>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
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
                                disabled={saving || parsePositiveContractId(contractId) == null}
                            >
                                {saving ? "Saving…" : "Save"}
                            </Button>
                        )}
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
