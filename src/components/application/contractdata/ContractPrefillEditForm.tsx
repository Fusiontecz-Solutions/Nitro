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
    Plus,
    Receipt,
    ScrollText,
    Trash2,
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
    formatNetToMerchantPrefillValue,
    getContractPrefillEditDefaultsFromApplication,
    normalizeContractPrefillOverrides,
    omitLiveOfferMoneyPrefillKeys,
    stripStaleOfferOverridesFromPersisted,
    coercePaymentFrequencyLabel,
    mergeNonemptyPrefillPartial,
    resolveContractBusinessLegalNameForPrefill,
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
import { resolveOwnerRowsForContractPrefill } from "./contractOwnerPrefillRows";
import {
    DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY,
    DOCUMENT_TEMPLATE_ENVELOPE_BY_MAPPING_ID_KEY,
    DOCUMENT_SEND_HISTORY_KEY,
    applyOnlineBankingFromTabsToMainPrefill,
    applySharedDbaToMappingBlob,
    getDocumentTemplatePrefillFieldRowsForEditor,
    hasStateDisclosurePrefillFieldMap,
    omitMappingBlobIds,
    withoutExhibitCCopyDbas,
    resolveSharedDbaValue,
    LINKED_DOCUSIGN_ADDENDUM_SECTION_ID,
    LINKED_DOCUSIGN_DISCLOSURE_SECTION_ID,
    stripDocumentTemplateBlobFromPrefillOverrides,
    LINKED_DOC_MANUAL_FIELD_IDS_KEY,
    parseLinkedDocManualFieldIds,
} from "./documentTemplateMappingPrefill";
import { useDispatch } from "react-redux";
import type { AppDispatch } from "@/redux/store";
import { getByApplicationIdContract, updateContract } from "@/redux/actions/contractActions";
import { getApplicationById } from "@/redux/actions/applicationActions";
import { invalidateApplicationDetailCache } from "@/lib/applicationDetailCache";
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
import { DISCLOSURE_WIRE_FEE_USD, resolveIncludeWireFee } from "./platformDocumentConfig";
import { isSignNowContractUiEnabled } from "./contractTemplatePreview";
import { isSignNowDisclosureLayoutKey } from "./signnowAddendumTemplates";
import {
    createEmptyExhibitCEntity,
    EXHIBIT_C_ENTITIES_PREFILL_KEY,
    EXHIBIT_C_ENTITY_FIELD_DEFS,
    EXHIBIT_C_ENTITY_MAX,
    exhibitCEntitiesFromPrefill,
    exhibitCEntityFromTabValues,
    exhibitCEntityNavTitle,
    exhibitCEntitySectionId,
    exhibitCEntityToTabValues,
    padExhibitCEntitiesToCount,
    parseExhibitCEntitySectionIndex,
    serializeExhibitCEntities,
    withoutDealLegalNameEcho,
    type ExhibitCEntityPrefill,
} from "./exhibitCEntityPrefill";
import { FlexAddendumInstallmentGrid } from "./FlexAddendumInstallmentGrid";
import { splitFlexInstallmentRows } from "./flexAddendumInstallmentRows";
import { isMultiInstanceAddendumRef } from "./multiInstanceAddendum";
import { formatUSPhoneNumber } from "@/utils/formatPhoneNumber";
import { formatSSN, getSSNDigits } from "@/utils/formatSSN";

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
type ContractPrefillFormFieldKey = Exclude<
    keyof BuildContractPrefillFieldsArgs,
    LegacySnakeCasePrefillKey | "exhibitCEntities"
>;

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
    owner2PrintTitle: "Title",
    owner2Email: "Email",
    owner2Phone: "Phone",
    owner2Address: "Address",
    clientEmail2: "Email",
    clientPhone2: "Phone",
    guarantor2Phone: "Phone",
    guarantor2Address: "Address",
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
    achAuthorizationReferenceName3: "Contact name",
    achAuthorizationReferenceNumber3: "Business phone",
    achAuthorizationReferenceRelationship3: "Company name",
    achAuthorizationReferenceName4: "Contact name",
    achAuthorizationReferenceNumber4: "Business phone",
    achAuthorizationReferenceRelationship4: "Company name",
    landlordCompany: "Company name",
    landlordContact: "Contact name",
    landlordPhone: "Business number",
    emergencyName: "Name",
    emergencyRelationship: "Relationship",
    emergencyPhone: "Phone number",
    emergencyEmail: "Email",
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
        description: "Owner 1 and Owner 2 each have the same name, ID, contact, and address fields.",
        Icon: Users,
        groups: [
            {
                heading: "Owner 1",
                keys: [
                    "owner1GuarantorName",
                    "guarantyOwner1Ss",
                    "guarantyOwner1DriverLicense",
                    "guarantorPhone",
                    "guarantorEmail",
                    "securityBusinessAddress",
                    "securityBusinessAddressCity",
                    "securityBusinessAddressState",
                    "securityBusinessAddressZip",
                ],
            },
            {
                heading: "Owner 2",
                keys: [
                    "owner2GuarantorName",
                    "guarantyGuarantor2Ss",
                    "guarantyGuarantor2DriverLicense",
                    "guarantor2Phone",
                    "owner2Email",
                    "guarantor2Address",
                    "owner2PrintTitle",
                ],
            },
            { heading: "Exhibit A", keys: ["exhibitAValue1"] },
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
        description: "Bank portal login, personal and business references, landlord, and emergency contacts.",
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
                heading: "Personal reference 1",
                keys: [
                    "achAuthorizationReferenceName1",
                    "achAuthorizationReferenceNumber1",
                    "achAuthorizationReferenceRelationship1",
                ],
            },
            {
                heading: "Personal reference 2",
                keys: [
                    "achAuthorizationReferenceName2",
                    "achAuthorizationReferenceNumber2",
                    "achAuthorizationReferenceRelationship2",
                ],
            },
            {
                heading: "Business reference 1",
                keys: [
                    "achAuthorizationReferenceRelationship3",
                    "achAuthorizationReferenceName3",
                    "achAuthorizationReferenceNumber3",
                ],
            },
            {
                heading: "Business reference 2",
                keys: [
                    "achAuthorizationReferenceRelationship4",
                    "achAuthorizationReferenceName4",
                    "achAuthorizationReferenceNumber4",
                ],
            },
            {
                heading: "Landlord contact",
                keys: ["landlordCompany", "landlordContact", "landlordPhone"],
            },
            {
                heading: "Emergency contact",
                keys: [
                    "emergencyName",
                    "emergencyRelationship",
                    "emergencyPhone",
                    "emergencyEmail",
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
        // ACH account holder is intentionally separate — different void-check entities live on Exhibit C.
        keys: ["legalName", "authorizationClientName"],
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
        id: "clientEmail",
        label: "Client / guarantor email",
        keys: ["clientEmail", "guarantorEmail"],
    },
    {
        id: "businessPhone",
        label: "Business / guarantor phone",
        keys: [
            "clientPhone",
            "guarantorPhone",
            "authorizedBusinessPhone",
            "achAuthorizationAccountHolderPhone",
        ],
    },
    {
        id: "street",
        label: "Business street",
        // The ACH account holder address is deliberately NOT here: it is Owner 1's
        // home address, a separate CRM entry. Mirroring the business street onto it
        // is what made the Monthly Fee / Exhibit C addendums print the same street on
        // the business line and the account-holder line, then compose that street
        // with Owner 1's city/state/zip.
        keys: ["businessAddress"],
    },
    {
        id: "owner1Street",
        label: "Owner 1 / account holder street",
        keys: [
            "businessAddressContract",
            "guarantorAddress",
            "achAuthorizationAccountHolderAddress",
        ],
    },
    {
        id: "owner1City",
        label: "Owner 1 / account holder city",
        keys: [
            "businessAddressContractCity",
            "guarantorAddressCity",
            "achAuthorizationAccountHolderCity",
        ],
    },
    {
        id: "owner1State",
        label: "Owner 1 / account holder state",
        keys: [
            "businessAddressContractState",
            "guarantorAddressState",
            "achAuthorizationAccountHolderState",
        ],
    },
    {
        id: "owner1Zip",
        label: "Owner 1 / account holder ZIP",
        keys: [
            "businessAddressContractZip",
            "guarantorAddressZip",
            "achAuthorizationAccountHolderZip",
        ],
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
        keys: ["guarantyOwner1Ss", "guarantyGuarantor1Ss", "guarantySs"],
    },
    {
        id: "driverLicense",
        label: "Driver license",
        keys: ["guarantyOwner1DriverLicense", "guarantyGuarantor1DriverLicense"],
    },
    {
        id: "owner2Ssn",
        label: "Owner 2 SSN",
        keys: ["guarantyGuarantor2Ss", "guarantyOwner2Ss"],
    },
    {
        id: "owner2DriverLicense",
        label: "Owner 2 driver license",
        keys: ["guarantyGuarantor2DriverLicense", "guarantyOwner2DriverLicense"],
    },
    {
        id: "owner2Phone",
        label: "Owner 2 phone",
        keys: ["guarantor2Phone", "owner2Phone", "clientPhone2"],
    },
    {
        id: "owner2Email",
        label: "Owner 2 email",
        keys: ["owner2Email", "clientEmail2"],
    },
    {
        id: "owner2Address",
        label: "Owner 2 address",
        keys: ["guarantor2Address", "owner2Address"],
    },
    {
        id: "date",
        label: "Date",
        keys: ["agreementDate"],
    },
];

/** Main-form fields that reappear on the selected addendum (Exhibit C / ACH Weekly). */
const MAIN_TO_LINKED_DOC_FIELD_MATCHERS: Array<{
    mainKey: ContractPrefillFormFieldKey;
    match: (id: string) => boolean;
    combineWith?: ContractPrefillFormFieldKey;
    alsoKeys?: ContractPrefillFormFieldKey[];
}> = [
    {
        mainKey: "achAuthorizationBankPortalWebsite",
        match: (id) => /bank_portal|bankportal|portal_website|portal_url/i.test(id),
    },
    {
        mainKey: "achAuthorizationUsername",
        match: (id) => /(?:^|_)(?:ach_)?username(?:_|$)/i.test(id) || /^bankUsername$/i.test(id),
    },
    {
        mainKey: "achAuthorizationPassword",
        match: (id) => /(?:^|_)(?:ach_)?password(?:_|$)/i.test(id) || /^bankPassword$/i.test(id),
    },
    {
        mainKey: "achAuthorizationSecurityQuestion1",
        match: (id) => /security_q(?:uestion)?_?1|securityQa1/i.test(id),
        combineWith: "achAuthorizationSecurityAnswer1",
    },
    {
        mainKey: "achAuthorizationSecurityQuestion2",
        match: (id) => /security_q(?:uestion)?_?2|securityQa2/i.test(id),
        combineWith: "achAuthorizationSecurityAnswer2",
    },
    {
        mainKey: "doingBusinessAs",
        match: (id) => /(?:^|_)dba(?:_|$)|doing_business|account_holder_dba|holder_dba|merchant_dba/i.test(id),
        alsoKeys: ["achAuthorizationAccountHolderDba", "securityDoingBusinessAs"],
    },
    {
        mainKey: "clientEmail",
        match: (id) => /(?:client_email|billing_email|merchant_contact_email)/i.test(id),
    },
    {
        mainKey: "clientPhone",
        match: (id) => /(?:client_phone|billing_phone|merchant_contact_phone)/i.test(id),
    },
];

function linkedDocValueFromMain(
    matcher: (typeof MAIN_TO_LINKED_DOC_FIELD_MATCHERS)[number],
    main: Record<string, string>,
    typed?: { key: ContractPrefillFormFieldKey; value: string },
): string {
    const read = (key: ContractPrefillFormFieldKey) =>
        typed?.key === key ? typed.value : String(main[key] ?? "");
    const primary =
        read(matcher.mainKey).trim() ||
        (matcher.alsoKeys ?? []).map(read).map((v) => v.trim()).find(Boolean) ||
        "";
    if (!matcher.combineWith) return primary;
    const secondary = read(matcher.combineWith).trim();
    if (primary && secondary) return `${primary} / ${secondary}`;
    return primary || secondary;
}

function overlayLinkedDocFieldsFromMain(
    linked: Record<string, string>,
    main: Record<string, string>,
    options?: {
        emptyOnly?: boolean;
        typed?: { key: ContractPrefillFormFieldKey; value: string };
        knownIds?: string[];
        /** Hand-typed tab fields: never overwritten from the main form. */
        skipIds?: ReadonlySet<string>;
    },
): Record<string, string> {
    const next = { ...linked };
    for (const id of options?.knownIds ?? []) {
        if (!(id in next)) next[id] = "";
    }
    const emptyOnly = options?.emptyOnly === true;
    const ids = Object.keys(next);
    if (ids.length === 0) return next;
    for (const matcher of MAIN_TO_LINKED_DOC_FIELD_MATCHERS) {
        if (
            options?.typed &&
            matcher.mainKey !== options.typed.key &&
            matcher.combineWith !== options.typed.key &&
            !(matcher.alsoKeys ?? []).includes(options.typed.key)
        ) {
            continue;
        }
        const source = linkedDocValueFromMain(matcher, main, options?.typed);
        if (!source) continue;
        for (const id of ids) {
            if (!matcher.match(id)) continue;
            if (options?.skipIds?.has(id)) continue;
            if (emptyOnly && String(next[id] ?? "").trim()) continue;
            next[id] = source;
        }
    }
    return next;
}

function mainUpdatesFromLinkedDocField(
    linkedId: string,
    value: string,
): Partial<Record<ContractPrefillFormFieldKey, string>> {
    const updates: Partial<Record<ContractPrefillFormFieldKey, string>> = {};
    for (const matcher of MAIN_TO_LINKED_DOC_FIELD_MATCHERS) {
        if (!matcher.match(linkedId)) continue;
        updates[matcher.mainKey] = value;
        for (const also of matcher.alsoKeys ?? []) updates[also] = value;
        if (matcher.mainKey === "doingBusinessAs") {
            updates.achAuthorizationAccountHolderDba = value;
        }
        if (matcher.mainKey === "clientEmail") updates.guarantorEmail = value;
        if (matcher.mainKey === "clientPhone") {
            updates.guarantorPhone = value;
            updates.authorizedBusinessPhone = value;
            updates.achAuthorizationAccountHolderPhone = value;
        }
    }
    return updates;
}

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

// Exhibit C entities are independent of the main ACH / bank stages: nothing is
// mirrored between them in either direction.

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
    applyOnlineBankingFromTabsToMainPrefill(merged, fromAddendum);
    if (!String(merged.achAuthorizationBankPortalWebsite ?? "").trim()) {
        const portal = firstBlobValueMatching(fromAddendum, [/bank_portal|portal_website|portal_url/i]);
        if (portal) merged.achAuthorizationBankPortalWebsite = portal;
    }
    if (!String(merged.achAuthorizationUsername ?? "").trim()) {
        const username = firstBlobValueMatching(fromAddendum, [/(?:^|_)(?:ach_)?username(?:_|$)/i]);
        if (username) merged.achAuthorizationUsername = username;
    }
    if (!String(merged.achAuthorizationPassword ?? "").trim()) {
        const password = firstBlobValueMatching(fromAddendum, [/(?:^|_)(?:ach_)?password(?:_|$)/i]);
        if (password) merged.achAuthorizationPassword = password;
    }
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
    fill("guarantorEmail", "clientEmail");
    fill("clientEmail", "guarantorEmail");
    fill("guarantorPhone", "clientPhone");
    fill("authorizedBusinessPhone", "clientPhone");
    fill("achAuthorizationAccountHolderPhone", "clientPhone");
    fill("clientPhone", "guarantorPhone");
    fill("clientPhone", "authorizedBusinessPhone");
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
    normalizeSsnFormValues(rec);
    return rec;
}

/**
 * SSNs arrive from OCR / saved overrides with stray digits, spaces or no dashes, so a value
 * that reads as nine digits on screen ("888-27-6882" rendered from a longer raw string) could
 * still fail validation. Every SSN key is stored canonically as XXX-XX-XXXX here, and hidden
 * mirror keys (never rendered in a section) are back-filled from their visible partner so they
 * cannot raise an error the user has no field to fix.
 */
function normalizeSsnFormValues(rec: Record<keyof BuildContractPrefillFieldsArgs, string>): void {
    for (const key of ALL_SSN_FORM_KEYS) {
        const current = String(rec[key] ?? "").trim();
        rec[key] = current ? formatSSN(current) : "";
    }
    for (const group of SSN_MIRROR_GROUPS) {
        const source = group.find((key) => getSSNDigits(rec[key]).length === 9);
        if (!source) continue;
        for (const key of group) {
            if (getSSNDigits(rec[key]).length !== 9) rec[key] = rec[source];
        }
    }
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

const EMAIL_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "clientEmail",
    "guarantorEmail",
    "owner2Email",
    "clientEmail2",
];
const PHONE_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "clientPhone",
    "guarantorPhone",
    "authorizedBusinessPhone",
    "achAuthorizationAccountHolderPhone",
    "owner2Phone",
    "guarantor2Phone",
    "clientPhone2",
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
/** Keys an outline section actually renders as an editable input. */
const RENDERED_PREFILL_FIELD_KEYS = new Set<string>(
    CONTRACT_PREFILL_SECTIONS.flatMap((section) => contractPrefillSectionKeys(section) as string[]),
);
const SSN_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "guarantySs",
    "guarantyOwner1Ss",
    "guarantyOwner2Ss",
    "guarantyGuarantor1Ss",
    "guarantyGuarantor2Ss",
];
/** Every SSN-bearing form key, including the ones no section renders. */
const ALL_SSN_FORM_KEYS = SSN_KEYS;
/** SSN keys that hold the same person's number and must stay identical. */
const SSN_MIRROR_GROUPS: (keyof BuildContractPrefillFieldsArgs)[][] = [
    ["guarantyOwner1Ss", "guarantyGuarantor1Ss", "guarantySs"],
    ["guarantyGuarantor2Ss", "guarantyOwner2Ss"],
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
 * Fields the application / CRM owns. When the live application value differs from what was
 * saved earlier (merchant changed their email, phone, address, DBA…), the saved override is a
 * stale snapshot, so it is dropped and the live value wins. Bank, portal, reference and
 * disclosure fields are not listed here — those are typed by hand and must survive a reload.
 */
const LIVE_APPLICATION_OWNED_PREFILL_KEYS: (keyof BuildContractPrefillFieldsArgs)[] = [
    "customerName",
    "clientName",
    "legalName",
    "doingBusinessAs",
    "entityType",
    "federalTaxIdEin",
    "securityTaxEin",
    "authorizationClientTaxId",
    "clientEmail",
    "guarantorEmail",
    "owner2Email",
    "clientEmail2",
    "clientPhone",
    "guarantorPhone",
    "authorizedBusinessPhone",
    "achAuthorizationAccountHolderPhone",
    "owner2Phone",
    "guarantor2Phone",
    "clientPhone2",
    "owner1GuarantorName",
    "guarantyGuarantor1Name",
    "guarantyOwner1Name",
    "owner2GuarantorName",
    "guarantyGuarantor2Name",
    "guarantyOwner2Name",
    "achAuthorizationConcentAccountHolderName",
    "achAuthorizationAccountHolderName",
    "achAuthorizationAccountHolderDba",
    "businessAddress",
    "businessAddressCity",
    "businessAddressState",
    "businessAddressZip",
    "businessAddressContract",
    "businessAddressContractCity",
    "businessAddressContractState",
    "businessAddressContractZip",
    "guarantorAddress",
    "guarantorAddressCity",
    "guarantorAddressState",
    "guarantorAddressZip",
    "achAuthorizationAccountHolderAddress",
    "achAuthorizationAccountHolderCity",
    "achAuthorizationAccountHolderState",
    "achAuthorizationAccountHolderZip",
    "state",
];

const EMAIL_PREFILL_KEY_SET = new Set<string>([
    "clientEmail",
    "guarantorEmail",
    "owner2Email",
    "clientEmail2",
]);
const PHONE_PREFILL_KEY_SET = new Set<string>([
    "clientPhone",
    "guarantorPhone",
    "authorizedBusinessPhone",
    "achAuthorizationAccountHolderPhone",
    "owner2Phone",
    "guarantor2Phone",
    "clientPhone2",
]);

/** Normalized compare so formatting alone (case, dashes, spacing) never looks like a change. */
function prefillValuesMatch(key: string, a: string, b: string): boolean {
    const left = String(a ?? "").trim();
    const right = String(b ?? "").trim();
    if (EMAIL_PREFILL_KEY_SET.has(key)) return left.toLowerCase() === right.toLowerCase();
    if (PHONE_PREFILL_KEY_SET.has(key)) {
        return left.replace(/\D/g, "") === right.replace(/\D/g, "");
    }
    return left.replace(/\s+/g, " ").toLowerCase() === right.replace(/\s+/g, " ").toLowerCase();
}

/**
 * Drop saved overrides for application-owned fields whose live value has since changed, so the
 * editor shows current contact / business details instead of the snapshot saved on an earlier open.
 */
function stripStaleApplicationOverrides(
    persisted: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
    liveDefaults: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
): Partial<BuildContractPrefillFieldsArgs> {
    const out = { ...(persisted ?? {}) } as Record<string, unknown>;
    for (const key of LIVE_APPLICATION_OWNED_PREFILL_KEYS) {
        const live = String((liveDefaults as Record<string, unknown> | null)?.[key] ?? "").trim();
        const saved = String(out[key] ?? "").trim();
        if (!live || !saved) continue;
        if (!prefillValuesMatch(key, live, saved)) delete out[key];
    }
    return out as Partial<BuildContractPrefillFieldsArgs>;
}

/** Scalar application fields the prefill defaults are built from. */
const APPLICATION_PREFILL_FINGERPRINT_KEYS = new Set([
    "updatedAt",
    "businessName",
    "legalName",
    "businessLegalName",
    "dba",
    "doingBusinessAs",
    "ein",
    "federalTaxId",
    "federalTaxIdEin",
    "entityType",
    "businessType",
    "email",
    "businessEmail",
    "phone",
    "businessPhone",
    "mobileNumber",
    "address",
    "businessAddress",
    "city",
    "state",
    "zip",
    "zipCode",
    "firstName",
    "lastName",
    "ownerFirstName",
    "ownerLastName",
    "ownerEmail",
    "ownerPhone",
    "ownerAddress",
    "ownershipPercentage",
    "title",
    "ssn",
    "ssnNumber",
    "driverLicense",
    "driverLicenseNumber",
]);

/** Objects worth descending into when fingerprinting the application. */
const APPLICATION_PREFILL_CONTAINER_KEYS = new Set([
    "client",
    "owner",
    "owners",
    "clientOwners",
    "applicationOwners",
    "guarantor",
    "guarantors",
    "business",
    "businessDetails",
    "basicDetails",
    "contactDetails",
]);

/**
 * Content fingerprint of the application fields the prefill form reads.
 *
 * Without this, the hydration key only watched the contract records, so editing a business
 * owner's name, email, phone or address on the application left the open prefill form (and
 * the values it later saves onto the contract) showing the snapshot from when it first
 * hydrated. Stringifying the whole application is not an option — it carries bank statement
 * and document arrays — so only the fields that feed prefill defaults are hashed.
 */
function applicationPrefillFingerprint(application: unknown): string {
    const parts: string[] = [];
    const seen = new Set<unknown>();
    const walk = (node: unknown, depth: number, path: string) => {
        if (!node || typeof node !== "object" || depth > 4 || seen.has(node)) return;
        seen.add(node);
        if (Array.isArray(node)) {
            node.slice(0, 6).forEach((row, i) => walk(row, depth + 1, `${path}[${i}]`));
            return;
        }
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
            if (value === null || typeof value !== "object") {
                if (APPLICATION_PREFILL_FINGERPRINT_KEYS.has(key)) {
                    parts.push(`${path}.${key}=${String(value ?? "")}`);
                }
                continue;
            }
            if (APPLICATION_PREFILL_CONTAINER_KEYS.has(key)) walk(value, depth + 1, `${path}.${key}`);
        }
    };
    walk(application, 0, "app");
    return parts.sort().join("|");
}

function trimField(values: Record<keyof BuildContractPrefillFieldsArgs, string>, key: keyof BuildContractPrefillFieldsArgs) {
    return String(values[key] ?? "").trim();
}

function validateEmail(value: string): string | null {
    if (!value) return null;
    const simple = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return simple.test(value) ? null : "Enter a valid email address.";
}

/** Prefill keys holding a phone number, formatted for display as XXX-XXX-XXXX. */
function isPhonePrefillKey(key: string): boolean {
    return /phone|mobile|fax/i.test(key);
}

/** Prefill keys holding an SSN, formatted for display as XXX-XX-XXXX. */
function isSsnPrefillKey(key: string): boolean {
    return /ssn/i.test(key) || /Ss$/.test(key) || /socialSecurity/i.test(key);
}

/** Canonical dashed display for phone / SSN prefill values; other keys pass through. */
function formatPrefillDisplayValue(key: string, value: string): string {
    if (!value) return value;
    if (isPhonePrefillKey(key)) return formatUSPhoneNumber(value);
    if (isSsnPrefillKey(key)) return formatSSN(value);
    return value;
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
        // Hidden mirror keys are back-filled from their visible partner; flagging them would
        // point the user at a section that renders no SSN field at all.
        if (!RENDERED_PREFILL_FIELD_KEYS.has(key)) continue;
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
    /** All linked addendum mappings (Exhibit C may appear more than once). */
    linkedAddendumMappings?: LinkedAddendumMappingRef[] | null;
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
    linkedAddendumMappings = null,
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
    const valuesRef = useRef(values);
    valuesRef.current = values;
    const [addendumFieldValues, setAddendumFieldValues] = useState<Record<string, string>>({});
    /**
     * Addendum tab fields typed by hand in this session. Saved onto the tab as
     * `_manualFieldIds`, so a typed amount (the PayOff Addendum's "Net Amount to
     * Merchant") reopens — and reaches SignNow — as typed instead of re-derived.
     */
    const addendumManualIdsRef = useRef<Set<string>>(new Set());
    /** "Reload from application" drops the saved hand-typed marks until the next save. */
    const [ignoreSavedAddendumManualIds, setIgnoreSavedAddendumManualIds] = useState(false);
    const pendingAddendumReloadRef = useRef(false);
    const [disclosureFieldValues, setDisclosureFieldValues] = useState<Record<string, string>>({});
    const [saving, setSaving] = useState(false);
    const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
    const [saveError, setSaveError] = useState<string | null>(null);
    const [saveErrorSections, setSaveErrorSections] = useState<PrefillErrorSectionHint[]>([]);
    const [activeSectionId, setActiveSectionId] = useState(CONTRACT_PREFILL_SECTIONS[0]?.id ?? "merchant");
    const purchasePercentTouchedRef = useRef(false);
    /** Fields the user edited in this session — kept when live sources re-hydrate the form. */
    const dirtyFieldKeysRef = useRef(new Set<keyof BuildContractPrefillFieldsArgs>());
    /** Edit order per field — "Sync to all" copies from the most recently edited copy. */
    const fieldEditedAtRef = useRef(new Map<keyof BuildContractPrefillFieldsArgs, number>());
    const fieldEditSeqRef = useRef(0);
    const pendingFocusFieldKeyRef = useRef<keyof BuildContractPrefillFieldsArgs | null>(null);
    const [spaModalOpen, setSpaModalOpen] = useState(false);
    const [savingSpaCalculation, setSavingSpaCalculation] = useState(false);
    const [exhibitCEntities, setExhibitCEntities] = useState<ExhibitCEntityPrefill[]>([]);

    const agreementDateForDefaults = agreementDatePlaceholder || "";

    useEffect(() => {
        if (!open) {
            purchasePercentTouchedRef.current = false;
        }
    }, [open]);

    /**
     * Application detail is served from a 5-minute IndexedDB cache, and owner / client edits
     * made elsewhere do not invalidate it. Opening this form therefore has to force a fresh
     * read, or the prefill (and the values it saves onto the contract) keeps showing the
     * business owner details as they were when the cache entry was written.
     */
    const refreshedApplicationKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!open) {
            refreshedApplicationKeyRef.current = null;
            return;
        }
        const app = applicationData as
            | { _id?: string; id?: string; applicationId?: number }
            | null;
        const uuid = String(applicationUuid || app?._id || app?.id || "").trim();
        if (!uuid || refreshedApplicationKeyRef.current === uuid) return;
        refreshedApplicationKeyRef.current = uuid;
        invalidateApplicationDetailCache(uuid);
        if (app?.applicationId != null) {
            invalidateApplicationDetailCache(String(app.applicationId));
        }
        void dispatch(getApplicationById(uuid));
    }, [open, applicationUuid, applicationData, dispatch]);

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

    const exhibitCLinkedMappings = useMemo(() => {
        const rows =
            Array.isArray(linkedAddendumMappings) && linkedAddendumMappings.length
                ? linkedAddendumMappings
                : linkedAddendumMapping
                  ? [linkedAddendumMapping]
                  : [];
        return rows.filter((row) =>
            isMultiInstanceAddendumRef(
                row?.template?.layoutKey || row?.template?.templateId || row?.templateId || "",
                row?.template?.name,
            ),
        );
    }, [linkedAddendumMappings, linkedAddendumMapping]);

    /**
     * The "Selected addendum" stage for an Exhibit C is that Exhibit C itself — an
     * independent record. Main ACH / bank values never flow into it, and its edits
     * never flow back.
     */
    const linkedAddendumIsExhibitC = Boolean(
        linkedAddendumMapping &&
            isMultiInstanceAddendumRef(
                linkedAddendumMapping.template?.layoutKey ||
                    linkedAddendumMapping.template?.templateId ||
                    linkedAddendumMapping.templateId ||
                    "",
                linkedAddendumMapping.template?.name,
            ),
    );
    const linkedAddendumIsExhibitCRef = useRef(linkedAddendumIsExhibitC);
    linkedAddendumIsExhibitCRef.current = linkedAddendumIsExhibitC;
    const linkedAddendumMainSource = useCallback(
        <T extends Record<string, string>>(main: T): T | Record<string, string> =>
            linkedAddendumIsExhibitCRef.current ? {} : main,
        [],
    );

    const exhibitCLinkedMappingIdsKey = exhibitCLinkedMappings
        .map((row) => String(row?.id ?? ""))
        .join("|");
    // A string, so a re-render that hands over an equal contract does not re-seed.
    const exhibitCDealLegalName = resolveContractBusinessLegalNameForPrefill(
        (resolvedContract ?? contractRecords?.contract ?? {}) as Record<string, unknown>,
        applicationData,
    );

    useEffect(() => {
        if (!open || !prefillOverridesReady) return;
        const fromPersisted = exhibitCEntitiesFromPrefill(
            (strippedMainPrefillOverrides ??
                persistedPrefillOverrides ??
                additionalContractPrefillJson ??
                {}) as Record<string, unknown>,
        );
        const fromAdditional = exhibitCEntitiesFromPrefill(
            (additionalContractPrefillJson ?? {}) as Record<string, unknown>,
        );
        const base = fromPersisted.length > 0 ? fromPersisted : fromAdditional;
        // One entity slot per Exhibit C document mapping so extras persist like other addenda.
        const padded = padExhibitCEntitiesToCount(
            base,
            Math.max(base.length, exhibitCLinkedMappings.length),
        );
        /**
         * Backfill each slot from its copy's own saved tab. Save writes every entity
         * field back onto that tab — empty strings included — so a slot the
         * `exhibitCEntities` key did not carry (a copy edited from its pencil dialog,
         * a key an older save dropped) used to erase the copy's values on the next
         * Info Required save. Same precedence as the backend's `resolveExhibitCEntities`.
         */
        // An older build seeded Exhibit C with the deal's legal name and saved it;
        // every Exhibit C is its own entity, so that echo starts blank.
        const dealLegalName = exhibitCDealLegalName;
        const filled = padded.map((entity, index) => {
            const mappingId = String(exhibitCLinkedMappings[index]?.id ?? "").trim();
            const tabs = mappingId ? documentTemplatePrefillByMappingId[mappingId] : undefined;
            if (!tabs) return withoutDealLegalNameEcho(entity, dealLegalName);
            const fromTabs = exhibitCEntityFromTabValues(tabs, entity);
            const merged: Record<string, unknown> = { ...entity };
            for (const [key, value] of Object.entries(fromTabs)) {
                if (!String(merged[key] ?? "").trim() && String(value ?? "").trim()) {
                    merged[key] = value;
                }
            }
            return withoutDealLegalNameEcho(
                createEmptyExhibitCEntity(merged as Partial<ExhibitCEntityPrefill>),
                dealLegalName,
            );
        });
        setExhibitCEntities(filled);
    }, [
        open,
        prefillOverridesReady,
        strippedMainPrefillOverrides,
        persistedPrefillOverrides,
        additionalContractPrefillJson,
        // Ids, not the array: a re-render that hands over an equal list must not
        // re-seed the entities over unsaved edits.
        exhibitCLinkedMappingIdsKey,
        documentTemplatePrefillByMappingId,
        exhibitCDealLegalName,
    ]);

    useEffect(() => {
        if (!open) return;
        addendumManualIdsRef.current = new Set();
        pendingAddendumReloadRef.current = false;
        setIgnoreSavedAddendumManualIds(false);
    }, [open]);

    const addendumEditorRows = useMemo(() => {
        if (!linkedAddendumMapping?.id) return [];
        const savedRaw = documentTemplatePrefillByMappingId[linkedAddendumMapping.id] ?? {};
        const saved = ignoreSavedAddendumManualIds
            ? Object.fromEntries(
                  Object.entries(savedRaw).filter(([k]) => k !== LINKED_DOC_MANUAL_FIELD_IDS_KEY),
              )
            : savedRaw;
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
            siblingPrefillByMappingId: omitMappingBlobIds(
                documentTemplatePrefillByMappingId,
                exhibitCLinkedMappings.map((m) => String(m?.id ?? "")),
            ),
            savedOverridesForMapping: saved,
            bankDetail: contractRecords?.bankDetail ?? null,
        });
    }, [
        linkedAddendumMapping,
        exhibitCLinkedMappings,
        documentTemplatePrefillByMappingId,
        resolvedContract,
        contractRecords?.contract,
        contractRecords?.bankDetail,
        applicationData,
        agreementDateForDefaults,
        strippedMainPrefillOverrides,
        ignoreSavedAddendumManualIds,
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

    const resolvedOwnerRows = useMemo(
        () =>
            resolveOwnerRowsForContractPrefill(
                applicationData,
                Array.isArray(contractRecords?.owners)
                    ? (contractRecords.owners as Record<string, unknown>[])
                    : [],
            ),
        [applicationData, contractRecords?.owners],
    );
    const activeOwnerCount = useMemo(
        () =>
            resolveActiveOwnerCount({
                owners: resolvedOwnerRows,
                signerRoles: contractSignerRolesForCounts,
            }),
        [resolvedOwnerRows, contractSignerRolesForCounts],
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
        for (let i = 0; i < exhibitCEntities.length; i++) {
            const entity = exhibitCEntities[i];
            base.push({
                id: exhibitCEntitySectionId(i),
                title: exhibitCEntityNavTitle(entity, i),
                description:
                    "Independent Exhibit C — starts blank and is never linked to the ACH / bank stages.",
                Icon: FileText,
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
        exhibitCEntities,
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
        let persistedForMerge = forceLiveOfferMoney
            ? omitLiveOfferMoneyPrefillKeys(persistedRaw)
            : persistedRaw;
        /** Live application contact / business details always beat an older saved snapshot. */
        persistedForMerge = stripStaleApplicationOverrides(persistedForMerge, defaults);
        const defaultsForMerge = forceLiveOfferMoney
            ? omitLiveOfferMoneyPrefillKeys(defaults)
            : defaults;
        /** Reload also drops stale merchant legal-name overrides (void-check OCR snapshots). */
        if (forceLiveOfferMoney) {
            const dropLegal = { ...persistedForMerge } as Record<string, unknown>;
            delete dropLegal.legalName;
            delete dropLegal.securityBusinessName;
            delete dropLegal.authorizationApplication;
            delete dropLegal.authorizationClientName;
            delete dropLegal.authorizationClientSignerName;
            persistedForMerge = dropLegal as Partial<BuildContractPrefillFieldsArgs>;
        }
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
        /**
         * An unchecked "$25 wire fee" that has not been saved yet still has to drive the
         * recomputed money here. Without it the overlay resolves the preference from the
         * persisted snapshot ("on"), re-adds $25 to recipient funds, and the box appears
         * to do nothing until a save + reload round trip.
         */
        const liveIncludeWireFee =
            !forceLiveOfferMoney && dirtyFieldKeysRef.current.has("includeWireFee")
                ? String(valuesRef.current.includeWireFee ?? "").trim()
                : String((merged as Record<string, unknown>).includeWireFee ?? "").trim();
        if (liveIncludeWireFee) {
            (merged as Record<string, unknown>).includeWireFee = liveIncludeWireFee;
        }
        merged = applyLiveOfferSyncToPrefillPartial(merged, applicationData, offerDecision, {
            forceLiveOfferMoney: forceLiveOfferMoney || undefined,
            contract: contractRecords?.contract ?? null,
            includeWireFee: liveIncludeWireFee || undefined,
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
        // Every Exhibit C (first included) is its own entity — never seeds the application.
        overlayAddendumBlobOntoMainPrefill(
            merged as Record<string, unknown>,
            omitMappingBlobIds(
                documentTemplatePrefillByMappingId,
                exhibitCLinkedMappings.map((m) => String(m?.id ?? "")),
            ),
        );
        // An earlier save may have stored an Exhibit C DBA as the deal's. Drop it
        // by value — an Exhibit C copy's DBA is never the deal's.
        merged = withoutExhibitCCopyDbas(
            merged,
            exhibitCEntitiesFromPrefill(
                (strippedMainPrefillOverrides ?? persistedPrefillOverrides ?? {}) as Record<
                    string,
                    unknown
                >,
            ),
            [merged.legalName],
        );
        /** Re-assert live deal business name after addendum overlay (never keep OCR legal name). */
        merged = applyAuthorizationBusinessNamePrefillFields(merged, applicationData);
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
        const nextValues = mergeFormState({ ...merged, ...aliased });
        setValues(nextValues);
        setFieldErrors({});
        if (forceLiveOfferMoney) {
            toast.success("Reloaded legal name, offer & deal terms from the application.");
        }
        return nextValues;
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
        exhibitCLinkedMappings,
    ]);

    const resetAddendumFromSources = useCallback(
        (mainValues?: Record<string, string>) => {
            const fromRows = Object.fromEntries(addendumEditorRows.map((r) => [r.id, r.value ?? ""]));
            setAddendumFieldValues(
                overlayLinkedDocFieldsFromMain(fromRows, linkedAddendumMainSource(mainValues ?? valuesRef.current), {
                    emptyOnly: true,
                    knownIds: addendumEditorRows.map((r) => String(r.id)),
                }),
            );
        },
        [addendumEditorRows, linkedAddendumMainSource],
    );

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

    // "Reload from application": re-seed the addendum once its rows no longer
    // carry the saved hand-typed marks.
    useEffect(() => {
        if (!pendingAddendumReloadRef.current || !ignoreSavedAddendumManualIds) return;
        pendingAddendumReloadRef.current = false;
        resetAddendumFromSources();
    }, [ignoreSavedAddendumManualIds, resetAddendumFromSources]);

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

    const hydratedSourceKeyRef = useRef<string | null>(null);
    const prevActiveOwnerCountRef = useRef(activeOwnerCount);
    const prevOfferDecisionSyncKeyRef = useRef("");
    const formReady = prefillOverridesReady && persistedPrefillOverrides !== undefined;

    /**
     * Content fingerprint of every source the form hydrates from. Parent panels load the
     * contract, bank details, owners and offer asynchronously, so hydrating only once on
     * open left the form showing the first (often empty/stale) snapshot. Re-hydrating on
     * this key pulls the live values whenever the data actually changes, while identical
     * re-renders are no-ops.
     */
    const prefillSourceKey = useMemo(() => {
        try {
            return JSON.stringify([
                applicationPrefillFingerprint(applicationData),
                strippedMainPrefillOverrides ?? null,
                contractRecords?.contract ?? null,
                contractRecords?.bankDetail ?? null,
                contractRecords?.owners ?? null,
                contractRecords?.guarantors ?? null,
                contractRecords?.ach ?? null,
                offerDecisionSyncKey,
                agreementDateForDefaults,
                documentTemplatePrefillByMappingId,
            ]);
        } catch {
            return String(Date.now());
        }
    }, [
        applicationData,
        strippedMainPrefillOverrides,
        contractRecords?.contract,
        contractRecords?.bankDetail,
        contractRecords?.owners,
        contractRecords?.guarantors,
        contractRecords?.ach,
        offerDecisionSyncKey,
        agreementDateForDefaults,
        documentTemplatePrefillByMappingId,
    ]);

    useEffect(() => {
        if (!open) {
            hydratedSourceKeyRef.current = null;
            dirtyFieldKeysRef.current = new Set();
            fieldEditedAtRef.current = new Map();
            prevActiveOwnerCountRef.current = activeOwnerCount;
            return;
        }
        if (!formReady) return;
        if (hydratedSourceKeyRef.current === prefillSourceKey) return;
        const firstHydration = hydratedSourceKeyRef.current === null;
        hydratedSourceKeyRef.current = prefillSourceKey;
        const preserved = firstHydration
            ? null
            : // Keep what the user typed; everything else follows the live sources.
              Object.fromEntries(
                  [...dirtyFieldKeysRef.current].map((key) => [key, valuesRef.current[key] ?? ""]),
              );
        const fresh = resetFromSourcesRef.current();
        const nextMain =
            preserved && Object.keys(preserved).length > 0
                ? { ...fresh, ...(preserved as Partial<typeof fresh>) }
                : fresh;
        if (nextMain !== fresh) setValues(nextMain);
        resetAddendumFromSourcesRef.current(nextMain);
        resetDisclosureFromSourcesRef.current();
        prevActiveOwnerCountRef.current = activeOwnerCount;
    }, [open, formReady, activeOwnerCount, prefillSourceKey]);

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
    const activeExhibitCEntityIndex = parseExhibitCEntitySectionIndex(activeSectionId);
    const isExhibitCEntitySection = activeExhibitCEntityIndex != null;
    const activeExhibitCEntity =
        activeExhibitCEntityIndex != null ? exhibitCEntities[activeExhibitCEntityIndex] ?? null : null;

    const handleAddExhibitCEntity = useCallback(() => {
        setExhibitCEntities((prev) => {
            if (prev.length >= EXHIBIT_C_ENTITY_MAX) return prev;
            const next = [...prev, createEmptyExhibitCEntity()];
            setActiveSectionId(exhibitCEntitySectionId(next.length - 1));
            return next;
        });
    }, []);

    const handleRemoveExhibitCEntity = useCallback((index: number) => {
        setExhibitCEntities((prev) => {
            if (index < 0 || index >= prev.length) return prev;
            const next = prev.filter((_, i) => i !== index);
            setActiveSectionId((current) => {
                const currentIdx = parseExhibitCEntitySectionIndex(current);
                if (currentIdx == null) return current;
                if (next.length === 0) return "ach_account_bank";
                if (currentIdx >= next.length) return exhibitCEntitySectionId(next.length - 1);
                if (currentIdx > index) return exhibitCEntitySectionId(currentIdx - 1);
                return exhibitCEntitySectionId(currentIdx);
            });
            return next;
        });
    }, []);

    const setExhibitCEntityField = useCallback(
        (index: number, key: keyof Omit<ExhibitCEntityPrefill, "id">, value: string) => {
            setExhibitCEntities((prev) =>
                prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
            );
            // Every slot, the first included, is its own Exhibit C: never written to ACH.
            setSaveError(null);
        },
        [],
    );

    useEffect(() => {
        if (!open || !isLinkedAddendumSection || addendumEditorRows.length === 0) return;
        setAddendumFieldValues((prev) =>
            overlayLinkedDocFieldsFromMain(prev, linkedAddendumMainSource(valuesRef.current), {
                emptyOnly: true,
                knownIds: addendumEditorRows.map((r) => String(r.id)),
            }),
        );
        // Intentionally only when entering the addendum stage.
        // eslint-disable-next-line react-hooks/exhaustive-deps -- live typing already mirrors via setField
    }, [open, isLinkedAddendumSection]);

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
        if (
            !activeSection ||
            isLinkedAddendumSection ||
            isLinkedDisclosureSection ||
            isExhibitCEntitySection
        ) {
            return [] as PrefillSyncGroup[];
        }
        const keysInSection = new Set<string>(activeSection.groups.flatMap((g) => g.keys));
        return PREFILL_SYNC_GROUPS.filter((group) => group.keys.some((k) => keysInSection.has(k)));
    }, [activeSection, isLinkedAddendumSection, isLinkedDisclosureSection, isExhibitCEntitySection]);


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
        /**
         * Source of truth for a shared value, in order: the field the user edited most
         * recently, then a filled field on this stage, then any filled field in the group.
         * The last two fallbacks are what make the button work for a value the user changed
         * on an earlier stage — previously only fields on the current stage could be a
         * source, so the edit never reached the other copies.
         */
        const resolveSyncSourceKey = (group: PrefillSyncGroup) => {
            let recentKey: keyof BuildContractPrefillFieldsArgs | null = null;
            let recentAt = -1;
            for (const k of group.keys) {
                if (!String(values[k] ?? "").trim()) continue;
                const editedAt = fieldEditedAtRef.current.get(k) ?? -1;
                if (editedAt > recentAt) {
                    recentAt = editedAt;
                    recentKey = k;
                }
            }
            if (recentKey && recentAt >= 0) return recentKey;
            return (
                group.keys.find((k) => keysInSection.has(k) && String(values[k] ?? "").trim()) ??
                group.keys.find((k) => String(values[k] ?? "").trim()) ??
                null
            );
        };
        // Every shared value is levelled, not just the ones visible on this stage.
        for (const group of PREFILL_SYNC_GROUPS) {
            const sourceKey = resolveSyncSourceKey(group);
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
            toast.info("Fill a shared field first, then sync.");
            return;
        }
        if (!syncedLabels.length) {
            toast.info("Shared fields already match on every stage.");
            return;
        }
        const nextMain = { ...values, ...updates };
        for (const k of Object.keys(updates) as (keyof BuildContractPrefillFieldsArgs)[]) {
            dirtyFieldKeysRef.current.add(k);
        }
        setValues(nextMain);
        setAddendumFieldValues((linked) =>
            overlayLinkedDocFieldsFromMain(linked, linkedAddendumMainSource(nextMain), {
                knownIds: addendumEditorRows.map((r) => String(r.id)),
            }),
        );
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

    /**
     * Save-time "Sync to all" for what was edited in this session: a shared value
     * (bank, EIN, DBA, phone, Owner 1 address, …) changed on one stage reaches every
     * other copy that was not itself edited. Without it, editing the funding bank
     * left the ACH account-holder copy on its old number, and that is the copy the
     * account-holder page prints. Copies edited separately keep their own values.
     */
    const levelEditedSharedValues = (
        current: Record<keyof BuildContractPrefillFieldsArgs, string>,
    ): Record<keyof BuildContractPrefillFieldsArgs, string> => {
        const next = { ...current };
        const edited = fieldEditedAtRef.current;
        for (const group of PREFILL_SYNC_GROUPS) {
            let sourceKey: keyof BuildContractPrefillFieldsArgs | null = null;
            let sourceAt = -1;
            for (const k of group.keys) {
                const at = edited.get(k);
                if (at == null || at <= sourceAt) continue;
                sourceAt = at;
                sourceKey = k;
            }
            if (!sourceKey) continue;
            const value = String(current[sourceKey] ?? "").trim();
            if (!value) continue;
            for (const k of group.keys) {
                if (edited.has(k)) continue;
                if ((activeOwnerCount < 2 && owner2KeySet.has(k)) ||
                    (activeGuarantorCount < 2 && guarantor2KeySet.has(k))) {
                    continue;
                }
                next[k] = value;
            }
        }
        return next;
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
            const leveled = levelEditedSharedValues(values);
            // An Exhibit C (2)/(3)/… DBA is another business's: it must never be
            // saved as the deal's own DBA (column + overrides) — see
            // `withoutExhibitCCopyDbas`.
            const aliased = withoutExhibitCCopyDbas(
                copySharedPrefillAliases({ ...leveled }),
                exhibitCEntities,
                [values.legalName],
            ) as Record<keyof BuildContractPrefillFieldsArgs, string>;
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
                const manualIds = new Set<string>([
                    ...(ignoreSavedAddendumManualIds
                        ? []
                        : parseLinkedDocManualFieldIds(existingBlob[linkedAddendumMapping.id])),
                    ...addendumManualIdsRef.current,
                ]);
                // Fields the tab only copied from the main form follow the main form's
                // current value, so a bank / name / DBA edited on any stage reaches this
                // addendum too. Only what was typed on the tab itself keeps its value.
                const addendumValues = overlayLinkedDocFieldsFromMain(
                    { ...addendumFieldValues },
                    linkedAddendumMainSource(aliased),
                    {
                        knownIds: addendumEditorRows.map((r) => String(r.id)),
                        skipIds: manualIds,
                    },
                );
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
                const keptManualIds = [...manualIds].filter((id) =>
                    String(addendumValues[id] ?? "").trim(),
                );
                delete addendumValues[LINKED_DOC_MANUAL_FIELD_IDS_KEY];
                if (keptManualIds.length) {
                    addendumValues[LINKED_DOC_MANUAL_FIELD_IDS_KEY] = keptManualIds.join(",");
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
            // Persist each Exhibit C entity onto its matching addendum mapping row in DB
            // (documentTemplatePrefillByMappingId), same pattern as other addendums.
            // Every Exhibit C tab is shielded from the shared DBA below — also a copy
            // with no entity slot yet, which otherwise took the deal's DBA.
            const exhibitMappingIds = new Set<string>(
                exhibitCLinkedMappings.map((m) => String(m?.id ?? "")).filter(Boolean),
            );
            for (let i = 0; i < exhibitCEntities.length; i++) {
                const mapping = exhibitCLinkedMappings[i];
                if (!mapping?.id) continue;
                const entityTabs = exhibitCEntityToTabValues(exhibitCEntities[i]);
                nextBlob[mapping.id] = {
                    ...(nextBlob[mapping.id] ?? {}),
                    ...entityTabs,
                };
            }
            // Every Exhibit C carries its own entity's DBA — never the application's.
            const sharedDba = resolveSharedDbaValue({
                mainPrefill: aliased,
                contract: resolvedContract,
                exhibitCEntities,
                mappingBlobs: omitMappingBlobIds(
                    nextBlob,
                    exhibitCLinkedMappings.map((m) => String(m?.id ?? "")),
                ),
            });
            if (sharedDba) {
                const withDba = applySharedDbaToMappingBlob(nextBlob, sharedDba);
                // Do not push shared DBA onto isolated Exhibit C copies.
                for (const [mappingId, row] of Object.entries(withDba)) {
                    if (exhibitMappingIds.has(mappingId)) {
                        // Every Exhibit C keeps its entity-written values.
                        continue;
                    }
                    nextBlob[mappingId] = row;
                }
            }
            const contractPrefillOverrides: Record<string, unknown> = {
                ...pickPreservedContractPrefillMeta(
                    resolvedContract,
                    liveContractSignerOverrides,
                ),
                ...(payload as Record<string, unknown>),
                ...(sharedDba
                    ? {
                          doingBusinessAs: sharedDba,
                          achAuthorizationAccountHolderDba: sharedDba,
                      }
                    : {}),
                [DOCUMENT_TEMPLATE_PREFILL_BY_MAPPING_ID_KEY]: nextBlob,
            };
            const exhibitCSerialized = serializeExhibitCEntities(exhibitCEntities);
            if (exhibitCSerialized) {
                contractPrefillOverrides[EXHIBIT_C_ENTITIES_PREFILL_KEY] = exhibitCSerialized;
            } else {
                delete contractPrefillOverrides[EXHIBIT_C_ENTITIES_PREFILL_KEY];
            }
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
            dirtyFieldKeysRef.current = new Set();
            fieldEditedAtRef.current = new Map();
            hydratedSourceKeyRef.current = null;
            resetFromSources();
            resetAddendumFromSources();
            resetDisclosureFromSources();
            setExhibitCEntities([]);
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
            dirtyFieldKeysRef.current.add("purchasePercent");
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
        (key: keyof BuildContractPrefillFieldsArgs, vRaw: string) => {
            let v = vRaw;
            if (key === "purchasePercent") {
                purchasePercentTouchedRef.current = true;
            }
            if (isSsnPrefillKey(key)) v = formatSSN(v);
            dirtyFieldKeysRef.current.add(key);
            fieldEditSeqRef.current += 1;
            fieldEditedAtRef.current.set(key, fieldEditSeqRef.current);
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
            if (key === "includeWireFee") {
                /**
                 * Recipient funds = advance − fees − $25 wire − refinance. The field is a
                 * plain text input, so toggling the checkbox must shift it here or the old
                 * (fee-included) amount is saved and the contract keeps the $25.
                 */
                const turningOn = resolveIncludeWireFee(v);
                const current = Number(
                    String(valuesRef.current.netToMerchant ?? "").replace(/[$,\s]/g, ""),
                );
                if (Number.isFinite(current) && String(valuesRef.current.netToMerchant ?? "").trim()) {
                    const delta = turningOn
                        ? -DISCLOSURE_WIRE_FEE_USD
                        : DISCLOSURE_WIRE_FEE_USD;
                    updates.netToMerchant = formatNetToMerchantPrefillValue(
                        Math.max(0, Math.round((current + delta) * 100) / 100),
                    );
                }
            }
            // Every key this edit writes (mirrors, and the wire-fee-adjusted recipient funds)
            // must count as user-edited, or the next re-hydration recomputes it from the
            // saved sources and silently puts the $25 back into Recipient funds.
            for (const touched of Object.keys(updates) as (keyof BuildContractPrefillFieldsArgs)[]) {
                dirtyFieldKeysRef.current.add(touched);
            }
            const nextMain = { ...valuesRef.current, ...updates };
            setValues(nextMain);
            setAddendumFieldValues((linked) => {
                const next = overlayLinkedDocFieldsFromMain(linked, linkedAddendumMainSource(nextMain), {
                    typed: { key: key as ContractPrefillFormFieldKey, value: v },
                    knownIds: addendumEditorRows.map((r) => String(r.id)),
                });
                // A value typed on the main form and mirrored onto the addendum is
                // just as hand-entered there.
                for (const [id, val] of Object.entries(next)) {
                    if (val !== linked[id]) addendumManualIdsRef.current.add(id);
                }
                return next;
            });
            setSaveError(null);
            setFieldErrors((prev) => {
                if (!prev[key] && !mirrorKeys?.some((k) => prev[k])) return prev;
                const next = { ...prev };
                delete next[key];
                for (const mirrorKey of mirrorKeys ?? []) {
                    delete next[mirrorKey];
                }
                return next;
            });
        },
        [
            showSecondPartyFields,
            owner2KeySet,
            guarantor2KeySet,
            addendumEditorRows,
            linkedAddendumMainSource,
        ],
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
                                    (() => {
                                        const handleAddendumFieldChange = (
                                            rowId: string,
                                            nextValue: string,
                                        ) => {
                                            addendumManualIdsRef.current.add(rowId);
                                            setAddendumFieldValues((prev) => ({
                                                ...prev,
                                                [rowId]: nextValue,
                                            }));
                                            // Exhibit C is its own record: its fields never write the ACH stages.
                                            if (linkedAddendumIsExhibitCRef.current) return;
                                            const mainUpdates = mainUpdatesFromLinkedDocField(rowId, nextValue);
                                            if (Object.keys(mainUpdates).length === 0) return;
                                            setValues((prev) => {
                                                const next = { ...prev, ...mainUpdates };
                                                for (const [k, val] of Object.entries(mainUpdates)) {
                                                    const mirrors = PREFILL_REALTIME_MIRROR_BY_KEY.get(
                                                        k as ContractPrefillFormFieldKey,
                                                    );
                                                    if (!mirrors) continue;
                                                    for (const mk of mirrors) {
                                                        next[mk] = val;
                                                    }
                                                }
                                                return next;
                                            });
                                        };
                                        if (visibleAddendumEditorRows.length === 0) {
                                            return (
                                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                                    Merchant, EIN, DBA, and bank fields for this addendum are
                                                    filled from the sections above. Edit them there instead of
                                                    re-entering them here.
                                                </p>
                                            );
                                        }
                                        const { installmentRows, otherRows } =
                                            splitFlexInstallmentRows(visibleAddendumEditorRows);
                                        return (
                                            <div className="space-y-5">
                                                {installmentRows.length > 0 ? (
                                                    <FlexAddendumInstallmentGrid
                                                        rows={installmentRows}
                                                        values={addendumFieldValues}
                                                        idPrefix="addendum-prefill-"
                                                        onChange={handleAddendumFieldChange}
                                                        disabled={readOnly}
                                                        inputClassName="h-9 text-sm"
                                                    />
                                                ) : null}
                                                {otherRows.length > 0 ? (
                                                    <div className="grid gap-4 sm:grid-cols-2">
                                                        {otherRows.map((row) => (
                                                            <div key={row.id} className="space-y-1.5">
                                                                <Label
                                                                    htmlFor={`addendum-prefill-${row.id}`}
                                                                    className="text-xs font-medium"
                                                                >
                                                                    {row.label}
                                                                </Label>
                                                                <Input
                                                                    id={`addendum-prefill-${row.id}`}
                                                                    value={addendumFieldValues[row.id] ?? ""}
                                                                    onChange={(e) =>
                                                                        handleAddendumFieldChange(
                                                                            String(row.id),
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                    disabled={readOnly}
                                                                    className="h-9 text-sm"
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </div>
                                        );
                                    })()
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
                                ) : isExhibitCEntitySection &&
                                  activeExhibitCEntity &&
                                  activeExhibitCEntityIndex != null ? (
                                    <div className="space-y-5">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                                Keep the merchant legal name on Merchant &amp; agreement. Use this
                                                Exhibit C entity for a different void-check / bank account holder.
                                            </p>
                                            {!readOnly ? (
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    className="h-8 text-destructive hover:text-destructive"
                                                    onClick={() =>
                                                        handleRemoveExhibitCEntity(activeExhibitCEntityIndex)
                                                    }
                                                >
                                                    <Trash2 className="mr-1 h-3.5 w-3.5" aria-hidden />
                                                    Remove entity
                                                </Button>
                                            ) : null}
                                        </div>
                                        {(["Account", "Bank", "Online banking"] as const).map((groupName) => {
                                            const fields = EXHIBIT_C_ENTITY_FIELD_DEFS.filter(
                                                (f) => f.group === groupName,
                                            );
                                            if (!fields.length) return null;
                                            return (
                                                <div key={groupName} className="space-y-3">
                                                    <h5 className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                                        {groupName}
                                                    </h5>
                                                    <div className="grid gap-4 sm:grid-cols-2">
                                                        {fields.map((field) => (
                                                            <div key={field.key} className="space-y-1.5">
                                                                <Label
                                                                    htmlFor={`exhibit-c-${activeExhibitCEntityIndex}-${field.key}`}
                                                                    className="text-xs font-medium"
                                                                >
                                                                    {field.label}
                                                                </Label>
                                                                <Input
                                                                    id={`exhibit-c-${activeExhibitCEntityIndex}-${field.key}`}
                                                                    value={
                                                                        activeExhibitCEntity[field.key] ?? ""
                                                                    }
                                                                    onChange={(e) =>
                                                                        setExhibitCEntityField(
                                                                            activeExhibitCEntityIndex,
                                                                            field.key,
                                                                            e.target.value,
                                                                        )
                                                                    }
                                                                    disabled={readOnly}
                                                                    className="h-9 text-sm"
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
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
                                                                        onCheckedChange={(checked: boolean | "indeterminate") =>
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
                                                                    value={formatPrefillDisplayValue(key, values[key] ?? "")}
                                                                    onChange={(e) =>
                                                                        setField(
                                                                            key,
                                                                            formatPrefillDisplayValue(key, e.target.value),
                                                                        )
                                                                    }
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
                                onClick={() => {
                                    dirtyFieldKeysRef.current = new Set();
                                    fieldEditedAtRef.current = new Map();
                                    resetFromSources({ forceLiveOfferMoney: true });
                                    // Hand-typed addendum amounts go back to the live values too.
                                    addendumManualIdsRef.current = new Set();
                                    if (ignoreSavedAddendumManualIds) {
                                        resetAddendumFromSourcesRef.current();
                                    } else {
                                        pendingAddendumReloadRef.current = true;
                                        setIgnoreSavedAddendumManualIds(true);
                                    }
                                }}
                                disabled={saving}
                            >
                                Reload from application
                            </Button>
                        )}
                        {!readOnly && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="gap-1.5 border-[var(--brand)]/30 text-[var(--brand)] hover:bg-[var(--brand)]/10"
                                onClick={handleAddExhibitCEntity}
                                disabled={saving || exhibitCEntities.length >= EXHIBIT_C_ENTITY_MAX}
                                title={
                                    exhibitCEntities.length >= EXHIBIT_C_ENTITY_MAX
                                        ? `Maximum ${EXHIBIT_C_ENTITY_MAX} Exhibit C entities`
                                        : "Add another Exhibit C entity"
                                }
                            >
                                <Plus className="h-3.5 w-3.5" aria-hidden />
                                Add Exhibit C entity
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
