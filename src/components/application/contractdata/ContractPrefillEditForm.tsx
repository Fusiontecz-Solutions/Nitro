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
    applyAuthorizationBusinessNamePrefillFields,
    applyLiveBankDetailsToPrefillMerge,
    applyLiveOfferSyncToPrefillPartial,
    applyOwnerRowsToPrefillMerge,
    finalizeContractPrefillMoneyFields,
    getContractPrefillEditDefaultsFromApplication,
    normalizeContractPrefillOverrides,
    stripStaleOfferOverridesFromPersisted,
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
    LINKED_DOCUSIGN_ADDENDUM_SECTION_ID,
    stripDocumentTemplateBlobFromPrefillOverrides,
} from "./documentTemplateMappingPrefill";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import { toast } from "react-toastify";
import { cn } from "@/lib/utils";
import { syncContractPrefillToSourceRecords } from "./contractPrefillSourceSync";
import { SpaCalculationModal } from "./SpaCalculationModal";
import { persistCalculatedPurchasePercent } from "./spaPrefillSync";
import {
    buildDocuSignRolesFromEditorRows,
    CONTRACT_SIGNER_OVERRIDES_KEY,
    parseContractSignerOverridesFromPrefill,
    type ContractSignerOverrideRow,
} from "./templateRecipients";

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
    purchasePercent: "Specific Percentage",
    remittance: "Total remit (payment amount)",
    frequency: "Frequency",
    netToMerchant: "Net to merchant",
    clientName: "Name",
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
    authorizationApplication: "Merchant name",
    authorizationClientBankName: "Bank name",
    authorizationClientBankRouting: "Routing number",
    authorizationClientBankAccount: "Account number",
    authorizationClientName: "Signer name",
    authorizationClientNamePrint: "Printed name",
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
    achAuthorizationConcentAccountHolderName: "Name",
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

/**
 * Document-aligned sections for the Woodmere RPA stack (RPA → Security → Guaranty → Appendix → ACH → Addendum).
 * Order follows the contract PDF flow so users can verify fields section by section.
 */
const CONTRACT_PREFILL_SECTIONS: ContractPrefillSection[] = [
        {
            id: "rpa_merchant",
            title: "RPA — Merchant & agreement",
            description: "Agreement date, legal name, state of inc., DBA, EIN, client / merchant name, and client phone (page 1).",
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
                        "clientName",
                        "clientPhone",
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
                { heading: "Client", keys: ["clientEmail"] },
                { heading: "Guarantor", keys: ["guarantorEmail", "guarantorPhone"] },
            ],
        },
        {
            id: "financial",
            title: "Offer & payback",
            description:
                "Offer amount, payback amount, specific percentage, payment amount per period (total remit), frequency, and net to merchant (advance − fees − refinance).",
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
            description: "Guaranty blocks — client, owners, guarantors; SSN and driver license lines.",
            Icon: Shield,
            groups: [
                {
                    heading: "Client",
                    keys: ["guarantyClientName", "guarantySs", "guarantySsDriverLicense"],
                },
                {
                    heading: "Owner 1",
                    keys: ["guarantyOwner1Name", "guarantyOwner1Ss", "guarantyOwner1DriverLicense"],
                },
                {
                    heading: "Owner 2",
                    keys: ["guarantyOwner2Name", "guarantyOwner2Ss", "guarantyOwner2DriverLicense"],
                },
                {
                    heading: "Guarantor 1",
                    keys: ["guarantyGuarantor1Name", "guarantyGuarantor1Ss", "guarantyGuarantor1DriverLicense"],
                },
                {
                    heading: "Guarantor 2",
                    keys: ["guarantyGuarantor2Name", "guarantyGuarantor2Ss", "guarantyGuarantor2DriverLicense"],
                },
            ],
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
            description: "Merchant name on the authorization, then bank, signatory, tax ID, and date.",
            Icon: Landmark,
            groups: [
                { heading: "Merchant", keys: ["authorizationApplication"] },
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
            description: "Account holder, bank branch, routing, account number, NO. of transaction (term), transaction fee, consent signature.",
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
            description: "Bank portal credentials, security Q&A, other notes, and three references.",
            Icon: Globe,
            groups: [
                {
                    heading: "Online banking",
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
            "owner1GuarantorName",
            "guarantyOwner1Name",
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
        label: "Street",
        keys: [
            "businessAddress",
            "businessAddressContract",
            "securityBusinessAddress",
            "achAuthorizationAccountHolderAddress",
        ],
    },
    {
        id: "city",
        label: "City",
        keys: [
            "businessAddressCity",
            "businessAddressContractCity",
            "securityBusinessAddressCity",
            "achAuthorizationAccountHolderCity",
        ],
    },
    {
        id: "addressState",
        label: "State",
        keys: [
            "businessAddressState",
            "businessAddressContractState",
            "securityBusinessAddressState",
            "achAuthorizationAccountHolderState",
        ],
    },
    {
        id: "zip",
        label: "ZIP",
        keys: [
            "businessAddressZip",
            "businessAddressContractZip",
            "securityBusinessAddressZip",
            "achAuthorizationAccountHolderZip",
        ],
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
        id: "paymentAmount",
        label: "Payment / transaction fee",
        keys: ["remittance", "achAuthorizationAccountHolderBankTransactionFee"],
    },
    {
        id: "owner1Name",
        label: "Owner 1 name",
        keys: [
            "owner1GuarantorName",
            "guarantyClientName",
            "guarantyOwner1Name",
            "guarantyGuarantor1Name",
            "addendumDatedPrincipalOwner1Name",
            "customerName",
            "clientName",
        ],
    },
    {
        id: "owner2Name",
        label: "Owner 2 name",
        keys: [
            "owner2GuarantorName",
            "merchant2Name",
            "guarantyOwner2Name",
            "guarantyGuarantor2Name",
            "appendixMerchant2Name",
            "addendumDatedPrincipalOwner2Name",
            "businessName2",
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
/** Shown empty until the user saves a value in contract prefill overrides. */
const REQUIRED_PREFILL_FIELD_KEYS = new Set<keyof BuildContractPrefillFieldsArgs>([
    "customerName",
    "clientPhone",
    "purchasePercent",
    "remittance",
]);

const MONEY_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "purchasePrice",
    "purchaseAmount",
    "remittance",
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
    if (!clientPhoneVal) {
        err.clientPhone = "Client phone is required.";
    } else {
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
    return null;
}

export type LinkedAddendumMappingRef = {
    id: string;
    templateId?: string;
    template?: {
        templateId?: string;
        name?: string | null;
        layoutKey?: string | null;
        state?: string | null;
        frequency?: string | null;
    } | null;
};

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
    /** Shown in agreement date field when empty (e.g. today). */
    agreementDatePlaceholder?: string;
    /** Loaded offer decision — used to auto-calculate net to merchant when not overridden. */
    offerDecision?: Record<string, unknown> | null;
    readOnly?: boolean;
    /** Merged into `contractPrefillOverrides` on save; preserved when clearing main prefill (document template field map). */
    additionalContractPrefillJson?: Record<string, unknown> | null;
    /** Live Contract Signers from the PDF modal (unsaved rows still count for owner-2 prefill sections). */
    liveContractSignerOverrides?: ContractSignerOverrideRow[] | null;
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
    agreementDatePlaceholder = "",
    offerDecision = null,
    readOnly = false,
    additionalContractPrefillJson = null,
    liveContractSignerOverrides = null,
}: ContractPrefillEditFormProps) {
    const dispatch = useDispatch<AppDispatch>();
    const [values, setValues] = useState<Record<keyof BuildContractPrefillFieldsArgs, string>>(emptyValuesRecord);
    const [addendumFieldValues, setAddendumFieldValues] = useState<Record<string, string>>({});
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
        return stripStaleOfferOverridesFromPersisted(main, offerDecision, applicationData);
    }, [persistedPrefillOverrides, offerDecision, applicationData]);

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
            contract: resolvedContract ?? contractRecords?.contract ?? null,
            application: applicationData as Record<string, unknown> | null,
            agreementDate: agreementDateForDefaults,
            mainPrefillOverrides: strippedMainPrefillOverrides ?? undefined,
            savedOverridesForMapping: saved,
        });
    }, [
        linkedAddendumMapping,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        contractRecords?.contract,
        applicationData,
        agreementDateForDefaults,
        strippedMainPrefillOverrides,
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
        return base;
    }, [
        linkedAddendumMapping,
        addendumEditorRows.length,
        linkedAddendumSectionTitle,
        activeOwnerCount,
        activeGuarantorCount,
        owner2KeySet,
        guarantor2KeySet,
        guarantor1KeySet,
    ]);

    const resetFromSources = useCallback(() => {
        const defaults = getContractPrefillEditDefaultsFromApplication(applicationData, {
            agreementDate: agreementDateForDefaults,
            contractRecords,
            offerDecision,
        });
        const persistedRaw =
            strippedMainPrefillOverrides === undefined
                ? ({} as Partial<BuildContractPrefillFieldsArgs>)
                : (strippedMainPrefillOverrides ?? ({} as Partial<BuildContractPrefillFieldsArgs>));
        const mergedBase = applyLiveBankDetailsToPrefillMerge(defaults, { ...defaults, ...persistedRaw });
        let merged = applyAuthorizationBusinessNamePrefillFields(
            finalizeContractPrefillMoneyFields(mergedBase, {
                application: applicationData as Record<string, unknown> | undefined,
                contract: contractRecords?.contract ?? null,
                offerDecision: offerDecision ?? null,
                prefill: mergedBase,
            }),
            applicationData,
        );
        merged = applyLiveOfferSyncToPrefillPartial(merged, applicationData, offerDecision);

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
                resolveOwnerRowFullName(secondRow) ||
                resolveSecondOwnerSignerName(signerRoles, ownerCount, resolvedOwnerRows);
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
        setValues(mergeFormState(merged));
        setFieldErrors({});
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
    ]);

    const resetAddendumFromSources = useCallback(() => {
        setAddendumFieldValues(Object.fromEntries(addendumEditorRows.map((r) => [r.id, r.value ?? ""])));
    }, [addendumEditorRows]);

    /** Stable ref so `resetFromSources` stays current without widening effect deps below. */
    const resetFromSourcesRef = useRef(resetFromSources);
    resetFromSourcesRef.current = resetFromSources;
    const resetAddendumFromSourcesRef = useRef(resetAddendumFromSources);
    resetAddendumFromSourcesRef.current = resetAddendumFromSources;

    const openedHydratedRef = useRef(false);
    const prevActiveOwnerCountRef = useRef(activeOwnerCount);
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
        prevActiveOwnerCountRef.current = activeOwnerCount;
        // Intentionally omit persistedPrefillOverrides — re-hydrating on parent updates resets in-progress edits.
    }, [open, formReady, activeOwnerCount]);

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
                resolveOwnerRowFullName(secondRow) ||
                resolveSecondOwnerSignerName(signerRoles, activeOwnerCount, resolvedOwnerRows);
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
        }
    }, [open]);

    useEffect(() => {
        if (open && navSections[0]?.id) {
            setActiveSectionId(navSections[0].id);
        }
    }, [open, navSections]);

    const activeSection = navSections.find((s) => s.id === activeSectionId) ?? navSections[0];
    const activeIdx = navSections.findIndex((s) => s.id === activeSection?.id);
    const nextSection =
        activeIdx >= 0 && activeIdx < navSections.length - 1 ? navSections[activeIdx + 1] : null;
    const isLinkedAddendumSection = activeSectionId === LINKED_DOCUSIGN_ADDENDUM_SECTION_ID;

    const activeSectionSyncGroups = useMemo(() => {
        if (!activeSection || isLinkedAddendumSection) {
            return [] as PrefillSyncGroup[];
        }
        const keysInSection = new Set<string>(activeSection.groups.flatMap((g) => g.keys));
        return PREFILL_SYNC_GROUPS.filter((group) => group.keys.some((k) => keysInSection.has(k)));
    }, [activeSection, isLinkedAddendumSection]);

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
            inner.numberOfPayments,
            inner.paymentFrequency,
            inner.monthlyPayment,
            inner.dailyPayment,
        ]
            .map((v) => String(v ?? ""))
            .join("|");
    }, [offerDecision, applicationData]);

    useEffect(() => {
        if (!open || !offerDecisionSyncKey) return;
        setValues((prev) =>
            mergeFormState(
                applyLiveOfferSyncToPrefillPartial(prev, applicationData, offerDecision),
            ),
        );
    }, [open, offerDecisionSyncKey, applicationData, offerDecision]);

    const handleSyncSectionToAll = () => {
        if (readOnly || !activeSection) return;
        const keysInSection = new Set<string>(activeSection.groups.flatMap((g) => g.keys));
        const isHiddenTarget = (k: keyof BuildContractPrefillFieldsArgs) =>
            (activeOwnerCount < 2 && owner2KeySet.has(k)) ||
            (activeGuarantorCount < 2 && guarantor2KeySet.has(k));
        const updates: Partial<Record<keyof BuildContractPrefillFieldsArgs, string>> = {};
        const syncedLabels: string[] = [];
        for (const group of PREFILL_SYNC_GROUPS) {
            const sourceKey = group.keys.find(
                (k) => keysInSection.has(k) && String(values[k] ?? "").trim() !== "",
            );
            if (!sourceKey) continue;
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
            toast.info("Fill a shared field on this stage first, then sync.");
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
            const payload = finalizeContractPrefillMoneyFields(rawPayload, {
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
                nextBlob[linkedAddendumMapping.id] = { ...addendumFieldValues };
            }
            const contractPrefillOverrides = {
                ...pickPreservedContractPrefillMeta(
                    resolvedContract,
                    liveContractSignerOverrides,
                ),
                ...(payload as Record<string, unknown>),
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: nextBlob,
            };
            const updateRes = await dispatch(
                updateContract({
                    id: cid,
                    data: { contractPrefillOverrides },
                }),
            ).unwrap();
            const appKey = String(applicationUuid ?? "").trim();
            let rawOverrides: unknown =
                (updateRes as { data?: { contractPrefillOverrides?: unknown } })?.data
                    ?.contractPrefillOverrides ??
                (updateRes as { contractPrefillOverrides?: unknown })?.contractPrefillOverrides;
            if (appKey) {
                try {
                    const res = await dispatch(getByApplicationIdContract(appKey)).unwrap();
                    const contract = (res as { data?: unknown })?.data ?? res;
                    rawOverrides = (contract as { contractPrefillOverrides?: unknown })?.contractPrefillOverrides;
                } catch {
                    /* use update response */
                }
            }
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
            toast.success("Contract prefill, offer, application, and bank details saved.");
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
                            {navSections.map((s) => (
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
                        {navSections.map((s) => {
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
                                                title={`Copy this stage's shared fields (${activeSectionSyncGroups
                                                    .map((g) => g.label)
                                                    .join(", ")}) to every other stage`}
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
                                            . Fill them once here, then click “Sync to all”.
                                        </p>
                                    ) : null}
                                </div>
                                {isLinkedAddendumSection ? (
                                    <div className="grid gap-4 sm:grid-cols-2">
                                        {addendumEditorRows.map((row) => (
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
                                        ))}
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
                                                                        SPA = (total of repayments ÷ average credits
                                                                        of last 3 months) × 100. Uses scrubbing
                                                                        REPAYMENT column (ACH), not monthly pmts.
                                                                    </p>
                                                                </>
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
