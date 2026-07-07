import { resolveOfferDecisionFeesRaw, resolveOfferFeeAmountForDeal } from "@/lib/offerDecisionFees";
import {
    parseTerm,
    resolveOfferFactorRate,
    resolveOfferPayback,
} from "@/lib/offerRepaymentCalculations";
import {
    applyAllianceBridgeContractPrefillToFields,
    shouldApplyAllianceBridgeContractPrefill,
} from "./allianceContractPrefill";
import { resolveOwnerRowsForContractPrefill } from "./contractSignerOwnersSync";
import {
    clearParty2PrefillPartial,
    isDistinctPartyRow,
    resolveActiveOwnerCount,
} from "./contractPartyCounts";

export interface ContractPrefillField {
    id: string;
    label: string;
    value: string;
}

export interface BuildContractPrefillFieldsArgs {
    customerName: string;
    entityType?: string;
    legalName?: string;
    doingBusinessAs?: string;
    businessAddress?: string;
    federalTaxIdEin?: string;
    agreementDate?: string;
    state?: string;
    businessAddressCity?: string;
    businessAddressState?: string;
    businessAddressZip?: string;
    businessAddressContract?: string;
    businessAddressContractCity?: string;
    businessAddressContractState?: string;
    businessAddressContractZip?: string;
    guarantorAddress?: string;
    guarantorAddressCity?: string;
    guarantorAddressState?: string;
    guarantorAddressZip?: string;
    clientEmail?: string;
    guarantorEmail?: string;
    guarantorPhone?: string;
    clientPhone?: string;
    purchasePrice?: string;
    purchaseAmount?: string;
    purchasePercent?: string;
    remittance?: string;
    /** Payment frequency (e.g. Daily, Weekly). DocuSign data label: `frequency`; BoldSign may use `paymentTerms`. */
    frequency?: string;
    /** Net cash to merchant (advance − fees − refinance). DocuSign data label: `net_to_merchant`. */
    netToMerchant?: string;

    clientName?: string;
    owner1GuarantorName?: string;
    /** PDF page 2 “Merchant 2” line — DocuSign tab `owner2_guarantor_name` (no separate merchant2_name tab). */
    merchant2Name?: string;
    owner2GuarantorName?: string;
    securityBusinessName?: string;
    securityTaxEin?: string;
    securityDoingBusinessAs?: string;
    securityBusinessAddress?: string;
    securityBusinessAddressCity?: string;
    securityBusinessAddressState?: string;
    securityBusinessAddressZip?: string;
    securityGuarantor?: string;
    guarantyClientName?: string;
    guarantySs?: string;
    guarantySsDriverLicense?: string;
    guarantyOwner1Name?: string;
    guarantyOwner1Ss?: string;
    guarantyOwner1DriverLicense?: string;
    guarantyOwner2Name?: string;
    guarantyOwner2DriverLicense?: string;
    guarantyOwner2Ss?: string;
    guarantyGuarantor1Name?: string;
    guarantyGuarantor1Ss?: string;
    guarantyGuarantor1DriverLicense?: string;
    guarantyGuarantor2Name?: string;
    guarantyGuarantor2Ss?: string;
    guarantyGuarantor2DriverLicense?: string;
    appendixUnderwritingFees?: string;
    appendixClientName?: string;
    authorizationApplication?: string;
    authorizationClientBankName?: string;
    authorizationClientBankRouting?: string;
    authorizationClientBankAccount?: string;
    authorizationClientName?: string;
    authorizationClientNamePrint?: string;
    authorizationClientTaxId?: string;
    authorizationClientDate?: string;
    authorizedBusinessPhone?: string;
    achAuthorizationAccountHolderName?: string;
    achAuthorizationAccountHolderDba?: string;
    achAuthorizationAccountHolderPhone?: string;
    achAuthorizationAccountHolderAddress?: string;
    achAuthorizationAccountHolderCity?: string;
    achAuthorizationAccountHolderState?: string;
    achAuthorizationAccountHolderZip?: string;
    achAuthorizationAccountHolderBankName?: string;
    achAuthorizationAccountHolderBankBranchCity?: string;
    achAuthorizationAccountHolderBankState?: string;
    achAuthorizationAccountHolderBankZip?: string;
    achAuthorizationAccountHolderBankRoutingNumber?: string;
    achAuthorizationAccountHolderBankAccountNumber?: string;
    achAuthorizationAccountHolderBankTransactionFee?: string;
    /** Term of offer — number of payments shown on ACH form. */
    achAuthorizationAccountHolderBankNumberOfTransactions?: string;
    achAuthorizationAccountHolderDate?: string;

    /**
     * Some templates use a "concent" (sic) variation of the ACH authorization fields.
     * These are separate from `achAuthorizationAccountHolderName/Date` but map to their own BoldSign ids.
     */
    achAuthorizationConcentAccountHolderName?: string;
    achAuthorizationConcentAccountHolderDate?: string;

    achAuthorizationBankPortalWebsite?: string;
    achAuthorizationUsername?: string;
    achAuthorizationPassword?: string;
    achAuthorizationSecurityQuestion1?: string;
    achAuthorizationSecurityQuestion2?: string;
    achAuthorizationSecurityQuestion3?: string;
    achAuthorizationSecurityAnswer1?: string;
    achAuthorizationSecurityAnswer2?: string;
    achAuthorizationSecurityAnswer3?: string;
    achAuthorizationOtherInfomation?: string;
    // Optional snake_case aliases for external payload compatibility.
    ach_authorization_bank_portal_website?: string;
    ach_authorization_username?: string;
    ach_authorization_password?: string;
    ach_authorization_security_question1?: string;
    ach_authorization_security_answer1?: string;
    ach_authorization_security_question2?: string;
    ach_authorization_security_answer2?: string;
    ach_authorization_security_question3?: string;
    ach_authorization_security_answer3?: string;
    ach_authorization_other_infomation?: string;
    achAuthorizationReferenceName1?: string;
    achAuthorizationReferenceNumber1?: string;
    achAuthorizationReferenceRelationship1?: string;
    achAuthorizationReferenceName2?: string;
    achAuthorizationReferenceNumber2?: string;
    achAuthorizationReferenceRelationship2?: string;
    achAuthorizationReferenceName3?: string;
    achAuthorizationReferenceNumber3?: string;
    achAuthorizationReferenceRelationship3?: string;
    addendumDated?: string;
    addendumDatedPrincipalOwner?: string;
    addendumDatedPrincipalBusiness?: string;
    addendumDatedBusinessLocation?: string;
    addendumDatedPrincipalState?: string;
    addendumDatedPrincipalOwnerAmount?: string;
    addendumDatedPrincipalOwnerAmount2?: string;
    addendumDatedPrincipalOwner1Name?: string;
    addendumDatedPrincipalOwner1Date?: string;
    addendumDatedPrincipalOwner2Name?: string;
    addendumDatedPrincipalOwner2Date?: string;
    exhibitOwnerName?: string;
    /** Exhibit A line items (DocuSign data labels `exhibit_a_value_1` … `exhibit_a_value_10`). */
    exhibitAValue1?: string;
    exhibitAValue2?: string;
    exhibitAValue3?: string;
    exhibitAValue4?: string;
    exhibitAValue5?: string;
    exhibitAValue6?: string;
    exhibitAValue7?: string;
    exhibitAValue8?: string;
    exhibitAValue9?: string;
    exhibitAValue10?: string;
}

export const EXHIBIT_A_VALUE_COUNT = 10;

export type ExhibitAValueFieldKey = `exhibitAValue${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10}`;

export const EXHIBIT_A_VALUE_FIELD_KEYS: readonly ExhibitAValueFieldKey[] = Array.from(
    { length: EXHIBIT_A_VALUE_COUNT },
    (_, i) => `exhibitAValue${i + 1}` as ExhibitAValueFieldKey,
);

const FIELD_IDS = {
    agreementDate: ["agreement_date"],
    legalName: ["client_legal_name"],
    stateOfInc: ["state_of_inc"],
    doingBusinessAs: ["doing_business_as"],
    federalTaxIdEin: ["federal_tax_id_EIN"],
    entityType: ["entity_type", "typeOfEntity1"],
    businessAddress: ["business_address"],
    businessAddressCity: ["business_address_city"],
    businessAddressState: ["business_address_state"],
    businessAddressZip: ["business_address_zip"],
    businessAddressContract: ["business_address_contract"],
    businessAddressContractCity: ["business_address_contract_city"],
    businessAddressContractState: ["business_address_contract_state"],
    businessAddressContractZip: ["business_address_contract_zip"],
    guarantorAddress: ["guarantor_address"],
    guarantorAddressCity: ["guarantor_address_city"],
    guarantorAddressState: ["guarantor_address_state"],
    guarantorAddressZip: ["guarantor_address_zip"],
    clientEmail: ["client_email"],
    guarantorEmail: ["guarantor_email"],
    guarantorPhone: ["guarantor_phone"],
    clientPhone: ["client_phone"],
    purchasePrice: ["purchase_price"],
    purchaseAmount: ["purchase_amount"],
    purchasePercent: ["purchase_percent", "specified_percentage", "purchased_percent"],
    remittance: ["remittance"],
    frequency: ["frequency", "paymentTerms"],
    /** DocuSign: `net_to_merchant`; BoldSign template tabs often use `NetFundProvided`. */
    netToMerchant: ["net_to_merchant", "NetFundProvided"],

    clientName: ["client_name"],
    owner1GuarantorName: ["owner1_guarantor_name"],
    merchant2Name: ["merchant2_name", "owner2_guarantor_name"],
    owner2GuarantorName: ["owner2_guarantor_name", "merchant2_name"],
    securityBusinessName: ["security_business_name"],
    securityTaxEin: ["security_tax_ein"],
    securityDoingBusinessAs: ["security_doing_business_as"],
    securityBusinessAddress: ["security_business_address"],
    securityBusinessAddressCity: ["security_business_address_city"],
    securityBusinessAddressState: ["security_business_address_state"],
    securityBusinessAddressZip: ["security_business_address_zip"],
    securityGuarantor: ["security_guarantor"],

    guarantyClientName: ["guaranty_client_name"],
    guarantySs: ["guaranty_ss"],
    guarantySsDriverLicense: ["guaranty_ss_driver_license"],
    guarantyOwner1Name: ["guaranty_owner1_name"],
    guarantyOwner1Ss: ["guaranty_owner1_ss"],
    guarantyOwner1DriverLicense: ["guaranty_owner1_driver_license"],
    guarantyOwner2Name: ["guaranty_owner2_name"],
    guarantyOwner2DriverLicense: ["guaranty_owner2_driver_license"],
    guarantyOwner2Ss: ["guaranty_owner2_ss"],
    guarantyGuarantor1Name: ["guaranty_guarantor1_name"],
    guarantyGuarantor1Ss: ["guaranty_guarantor1_ss"],
    guarantyGuarantor1DriverLicense: ["guaranty_guarantor1_driver_license"],
    guarantyGuarantor2Name: ["guaranty_guarantor2_name"],
    guarantyGuarantor2Ss: ["guaranty_guarantor2_ss"],
    guarantyGuarantor2DriverLicense: ["guaranty_guarantor2_driver_license"],

    appendixUnderwritingFees: [
        "appendix_underwriting_fees",
        "underwriter_fee",
        "underwriterfee",
        "underwriter_fees",
    ],
    appendixClientName: ["appendix_client_name"],
    authorizationApplication: ["authorization_application"],
    authorizationClientBankName: ["authorization_client_bank_name"],
    authorizationClientBankRouting: ["authorization_client_bank_routing"],
    authorizationClientBankAccount: ["authorization_client_bank_account"],
    authorizationClientName: ["authorization_client_name"],
    authorizationClientNamePrint: ["authorization_client_name_print"],
    authorizationClientTaxId: ["authorization_client_tax_id"],
    authorizationClientDate: ["authorization_client_date"],
    authorizedBusinessPhone: ["authorized_business_phone"],
    achAuthorizationAccountHolderName: ["ach_authorization_account_holder_name"],
    achAuthorizationAccountHolderDba: ["ach_authorization_account_holder_dba"],
    achAuthorizationAccountHolderPhone: ["ach_authorization_account_holder_phone"],
    achAuthorizationAccountHolderAddress: ["ach_authorization_account_holder_address"],
    achAuthorizationAccountHolderCity: ["ach_authorization_account_holder_city"],
    achAuthorizationAccountHolderState: ["ach_authorization_account_holder_state"],
    achAuthorizationAccountHolderZip: ["ach_authorization_account_holder_zip"],
    achAuthorizationAccountHolderBankName: ["ach_authorization_account_holder_bank_name"],
    achAuthorizationAccountHolderBankBranchCity: ["ach_authorization_account_holder_bank_branch_city"],
    achAuthorizationAccountHolderBankState: ["ach_authorization_account_holder_bank_state"],
    achAuthorizationAccountHolderBankZip: ["ach_authorization_account_holder_bank_zip"],
    achAuthorizationAccountHolderBankRoutingNumber: ["ach_authorization_account_holder_bank_routing_number"],
    achAuthorizationAccountHolderBankAccountNumber: ["ach_authorization_account_holder_bank_account_number"],
    achAuthorizationAccountHolderBankTransactionFee: ["ach_authorization_account_holder_bank_transaction_fee"],
    achAuthorizationAccountHolderBankNumberOfTransactions: [
        "ach_authorization_account_holder_bank_number_of_transactions",
    ],
    achAuthorizationAccountHolderDate: ["ach_authorization_account_holder_date"],

    achAuthorizationConcentAccountHolderName: ["ach_authorization_concent_account_holder_name"],
    achAuthorizationConcentAccountHolderDate: ["ach_authorization_concent_account_holder_date"],

    achAuthorizationBankPortalWebsite: ["ach_authorization_bank_portal_website"],
    achAuthorizationUsername: ["ach_authorization_username"],
    achAuthorizationPassword: ["ach_authorization_password"],
    achAuthorizationSecurityQuestion1: ["ach_authorization_security_question1"],
    achAuthorizationSecurityQuestion2: ["ach_authorization_security_question2"],
    achAuthorizationSecurityQuestion3: ["ach_authorization_security_question3"],
    achAuthorizationSecurityAnswer1: ["ach_authorization_security_answer1"],
    achAuthorizationSecurityAnswer2: ["ach_authorization_security_answer2"],
    achAuthorizationSecurityAnswer3: ["ach_authorization_security_answer3"],
    achAuthorizationOtherInfomation: ["ach_authorization_other_infomation"],

    achAuthorizationReferenceName1: ["ach_authorization_reference_name1"],
    achAuthorizationReferenceNumber1: ["ach_authorization_reference_number_1"],
    achAuthorizationReferenceRelationship1: ["ach_authorization_reference_relationship1"],
    achAuthorizationReferenceName2: ["ach_authorization_reference_name2"],
    achAuthorizationReferenceNumber2: ["ach_authorization_reference_number2"],
    achAuthorizationReferenceRelationship2: ["ach_authorization_reference_relationship2"],
    achAuthorizationReferenceName3: ["ach_authorization_reference_name3"],
    achAuthorizationReferenceNumber3: ["ach_authorization_reference_number3"],
    achAuthorizationReferenceRelationship3: ["ach_authorization_reference_relationship3"],
    addendumDated: ["addendum_dated"],
    addendumDatedPrincipalOwner: ["addendum_dated_principal_owner"],
    addendumDatedPrincipalBusiness: ["addendum_dated_principal_business"],
    addendumDatedBusinessLocation: ["addendum_dated_business_location"],
    addendumDatedPrincipalState: ["addendum_dated_principal_state"],
    addendumDatedPrincipalOwnerAmount: ["addendum_dated_principal_owner_amount"],
    addendumDatedPrincipalOwnerAmount2: ["addendum_dated_principal_owner_amount2"],
    addendumDatedPrincipalOwner1Name: ["addendum_dated_principal_owner1_name"],
    addendumDatedPrincipalOwner1Date: ["addendum_dated_principal_owner1_date"],
    addendumDatedPrincipalOwner2Name: ["addendum_dated_principal_owner2_name"],
    addendumDatedPrincipalOwner2Date: ["addendum_dated_principal_owner2_date"],
    exhibitOwnerName: ["exhibit_owner_name"],
    exhibitAValue1: ["exhibit_a_value_1"],
    exhibitAValue2: ["exhibit_a_value_2"],
    exhibitAValue3: ["exhibit_a_value_3"],
    exhibitAValue4: ["exhibit_a_value_4"],
    exhibitAValue5: ["exhibit_a_value_5"],
    exhibitAValue6: ["exhibit_a_value_6"],
    exhibitAValue7: ["exhibit_a_value_7"],
    exhibitAValue8: ["exhibit_a_value_8"],
    exhibitAValue9: ["exhibit_a_value_9"],
    exhibitAValue10: ["exhibit_a_value_10"],
} as const;

function formatUsDateString(value: string): string {
    const t = String(value || "").trim();
    if (!t) return "";
    if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(t)) return t;
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) {
        const y = t.slice(0, 4);
        const m = t.slice(5, 7);
        const d = t.slice(8, 10);
        return `${m}/${d}/${y}`;
    }
    const parsed = new Date(t);
    if (Number.isNaN(parsed.getTime())) return t;
    return new Intl.DateTimeFormat("en-US", {
        month: "2-digit",
        day: "2-digit",
        year: "numeric",
        timeZone: "UTC",
    }).format(parsed);
}

function formatUsNumberString(value: string): string {
    const n = coerceToFiniteNumber(value);
    if (n === undefined) return value;
    const truncated = Math.trunc(n * 100) / 100;
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(truncated);
}

function normalizePrefillValueForUsFormat(id: string, value: string): string {
    const k = String(id || "").trim().toLowerCase();
    if (!k) return value;

    if (
        k.includes("date") ||
        /^epo_received_date_\d+$/.test(k)
    ) {
        return formatUsDateString(value);
    }

    if (
        k.includes("amount") ||
        k.includes("price") ||
        k.includes("fees") ||
        k.includes("netfund") ||
        k.includes("net_fund") ||
        k.includes("transaction_fee") ||
        /^epo_amount_received_\d+$/.test(k) ||
        k === "purchase_percent"
    ) {
        return formatUsNumberString(value);
    }

    return value;
}

const mapIds = (ids: readonly string[], label: string, value: string): ContractPrefillField[] => {
    const trimmed = String(value || "").trim();
    if (!trimmed) return [];
    return ids.map((id) => ({
        id,
        label,
        value: normalizePrefillValueForUsFormat(id, trimmed),
    }));
};

/** BoldSign dropdowns require exact option text; CRM stores short codes (e.g. LLC). */
function normalizeEntityTypeKey(raw: string): string {
    return raw
        .trim()
        .toLowerCase()
        .replace(/\./g, "")
        .replace(/-/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeEntityTypeForBoldSignDropdown(raw: string): string {
    const trimmed = String(raw ?? "").trim();
    if (!trimmed) return "";

    const key = normalizeEntityTypeKey(trimmed);
    const byKey: Record<string, string> = {
        llc: "Limited_Liability_Company",
        "limited liability company": "Limited_Liability_Company",
        corporation: "Corporation",
        partnership: "Partnership",
        "sole proprietorship": "Sole Proprietorship",
        "s corp": "S Corporation",
        scorp: "S Corporation",
        scorporation: "S Corporation",
        "s corporation": "S Corporation",
        "c corp": "C Corporation",
        ccorp: "C Corporation",
        ccorporation: "C Corporation",
        "c corporation": "C Corporation",
        "non profit": "Non-Profit",
        nonprofit: "Non-Profit",
        other: "Other",
    };
    if (byKey[key]) return byKey[key];

    for (const canonical of new Set(Object.values(byKey))) {
        if (normalizeEntityTypeKey(canonical) === key) return canonical;
    }

    return trimmed;
}

export const buildContractPrefillFields = ({
    customerName,
    entityType = "",
    legalName = customerName,
    doingBusinessAs = "",
    businessAddress = "",
    federalTaxIdEin = "",
    agreementDate = "",
    state = "",
    businessAddressCity = "",
    businessAddressState = "",
    businessAddressZip = "",
    businessAddressContract = "",
    businessAddressContractCity = "",
    businessAddressContractState = "",
    businessAddressContractZip = "",
    guarantorAddress = "",
    guarantorAddressCity = "",
    guarantorAddressState = "",
    guarantorAddressZip = "",
    clientEmail = "",
    guarantorEmail = "",
    guarantorPhone = "",
    clientPhone = "",
    purchasePrice = "",
    purchaseAmount = "",
    purchasePercent = "",
    remittance = "",
    frequency = "",
    netToMerchant = "",

    clientName = "",
    owner1GuarantorName = "",
    merchant2Name = "",
    owner2GuarantorName = "",
    securityBusinessName = "",
    securityTaxEin = "",
    securityDoingBusinessAs = "",
    securityBusinessAddress = "",
    securityBusinessAddressCity = "",
    securityBusinessAddressState = "",
    securityBusinessAddressZip = "",
    securityGuarantor = "",
    guarantyClientName = "",
    guarantySs = "",
    guarantySsDriverLicense = "",
    guarantyOwner1Name = "",
    guarantyOwner1Ss = "",
    guarantyOwner1DriverLicense = "",
    guarantyOwner2Name = "",
    guarantyOwner2DriverLicense = "",
    guarantyOwner2Ss = "",
    guarantyGuarantor1Name = "",
    guarantyGuarantor1Ss = "",
    guarantyGuarantor1DriverLicense = "",
    guarantyGuarantor2Name = "",
    guarantyGuarantor2Ss = "",
    guarantyGuarantor2DriverLicense = "",
    appendixUnderwritingFees = "",
    appendixClientName = "",
    authorizationApplication = "",
    authorizationClientBankName = "",
    authorizationClientBankRouting = "",
    authorizationClientBankAccount = "",
    authorizationClientName = "",
    authorizationClientNamePrint = "",
    authorizationClientTaxId = "",
    authorizationClientDate = "",
    authorizedBusinessPhone = "",
    achAuthorizationAccountHolderName = "",
    achAuthorizationAccountHolderDba = "",
    achAuthorizationAccountHolderPhone = "",
    achAuthorizationAccountHolderAddress = "",
    achAuthorizationAccountHolderCity = "",
    achAuthorizationAccountHolderState = "",
    achAuthorizationAccountHolderZip = "",
    achAuthorizationAccountHolderBankName = "",
    achAuthorizationAccountHolderBankBranchCity = "",
    achAuthorizationAccountHolderBankState = "",
    achAuthorizationAccountHolderBankZip = "",
    achAuthorizationAccountHolderBankRoutingNumber = "",
    achAuthorizationAccountHolderBankAccountNumber = "",
    achAuthorizationAccountHolderBankTransactionFee = "",
    achAuthorizationAccountHolderBankNumberOfTransactions = "",
    achAuthorizationAccountHolderDate = "",

    achAuthorizationConcentAccountHolderName = "",
    achAuthorizationConcentAccountHolderDate = "",
    achAuthorizationBankPortalWebsite = "",
    achAuthorizationUsername = "",
    achAuthorizationPassword = "",
    achAuthorizationSecurityQuestion1 = "",
    achAuthorizationSecurityQuestion2 = "",
    achAuthorizationSecurityQuestion3 = "",
    achAuthorizationSecurityAnswer1 = "",
    achAuthorizationSecurityAnswer2 = "",
    achAuthorizationSecurityAnswer3 = "",
    achAuthorizationOtherInfomation = "",
    ach_authorization_bank_portal_website = "",
    ach_authorization_username = "",
    ach_authorization_password = "",
    ach_authorization_security_question1 = "",
    ach_authorization_security_answer1 = "",
    ach_authorization_security_question2 = "",
    ach_authorization_security_answer2 = "",
    ach_authorization_security_question3 = "",
    ach_authorization_security_answer3 = "",
    ach_authorization_other_infomation = "",
    achAuthorizationReferenceName1 = "",
    achAuthorizationReferenceNumber1 = "",
    achAuthorizationReferenceRelationship1 = "",
    achAuthorizationReferenceName2 = "",
    achAuthorizationReferenceNumber2 = "",
    achAuthorizationReferenceRelationship2 = "",
    achAuthorizationReferenceName3 = "",
    achAuthorizationReferenceNumber3 = "",
    achAuthorizationReferenceRelationship3 = "",
    addendumDated = "",
    addendumDatedPrincipalOwner = "",
    addendumDatedPrincipalBusiness = "",
    addendumDatedBusinessLocation = "",
    addendumDatedPrincipalState = "",
    addendumDatedPrincipalOwnerAmount = "",
    addendumDatedPrincipalOwnerAmount2 = "",
    addendumDatedPrincipalOwner1Name = "",
    addendumDatedPrincipalOwner1Date = "",
    addendumDatedPrincipalOwner2Name = "",
    addendumDatedPrincipalOwner2Date = "",
    exhibitOwnerName = "",
    exhibitAValue1 = "",
    exhibitAValue2 = "",
    exhibitAValue3 = "",
    exhibitAValue4 = "",
    exhibitAValue5 = "",
    exhibitAValue6 = "",
    exhibitAValue7 = "",
    exhibitAValue8 = "",
    exhibitAValue9 = "",
    exhibitAValue10 = "",
}: BuildContractPrefillFieldsArgs): ContractPrefillField[] => {
    return [
        ...mapIds(FIELD_IDS.legalName, "Legal Name", legalName),
        ...mapIds(FIELD_IDS.stateOfInc, "State Of Incorporation", state),
        ...mapIds(FIELD_IDS.doingBusinessAs, "Doing Business As", doingBusinessAs),
        ...mapIds(FIELD_IDS.businessAddress, "Business Address", businessAddress),
        ...mapIds(FIELD_IDS.businessAddressCity, "City", businessAddressCity),
        ...mapIds(FIELD_IDS.businessAddressState, "State", businessAddressState),
        ...mapIds(FIELD_IDS.businessAddressZip, "Zip", businessAddressZip),
        ...mapIds(FIELD_IDS.businessAddressContract, "Contract Address", businessAddressContract),
        ...mapIds(FIELD_IDS.businessAddressContractCity, "Contract City", businessAddressContractCity),
        ...mapIds(FIELD_IDS.businessAddressContractState, "Contract State", businessAddressContractState),
        ...mapIds(FIELD_IDS.businessAddressContractZip, "Contract Zip", businessAddressContractZip),
        ...mapIds(FIELD_IDS.guarantorAddress, "Guarantor Address", guarantorAddress),
        ...mapIds(FIELD_IDS.guarantorAddressCity, "Guarantor City", guarantorAddressCity),
        ...mapIds(FIELD_IDS.guarantorAddressState, "Guarantor State", guarantorAddressState),
        ...mapIds(FIELD_IDS.guarantorAddressZip, "Guarantor Zip", guarantorAddressZip),
        ...mapIds(FIELD_IDS.clientEmail, "Client Email", clientEmail),
        ...mapIds(FIELD_IDS.guarantorEmail, "Guarantor Email", guarantorEmail),
        ...mapIds(FIELD_IDS.guarantorPhone, "Guarantor Phone", guarantorPhone),
        ...mapIds(FIELD_IDS.clientPhone, "Client Phone", clientPhone),
        ...mapIds(
            FIELD_IDS.entityType,
            "Entity Type",
            normalizeEntityTypeForBoldSignDropdown(entityType),
        ),
        ...mapIds(FIELD_IDS.federalTaxIdEin, "Federal Tax ID EIN", federalTaxIdEin),
        ...mapIds(FIELD_IDS.agreementDate, "Agreement Date", agreementDate),
        ...mapIds(FIELD_IDS.purchasePrice, "Purchase Price", purchasePrice),
        ...mapIds(FIELD_IDS.purchaseAmount, "Purchase Amount", purchaseAmount),
        ...mapIds(FIELD_IDS.purchasePercent, "Specified percentage", purchasePercent),
        ...mapIds(FIELD_IDS.remittance, "Remittance", remittance),
        ...mapIds(FIELD_IDS.frequency, "Frequency", frequency),
        ...mapIds(FIELD_IDS.netToMerchant, "Net to merchant", netToMerchant),
        ...mapIds(FIELD_IDS.clientName, "Client Name", clientName),
        ...mapIds(FIELD_IDS.owner1GuarantorName, "Owner1 Guarantor Name", owner1GuarantorName),
        ...mapIds(
            FIELD_IDS.merchant2Name,
            "Merchant 2 Name",
            merchant2Name || owner2GuarantorName,
        ),
        ...mapIds(FIELD_IDS.owner2GuarantorName, "Owner2 Guarantor Name", owner2GuarantorName || merchant2Name),
        ...mapIds(FIELD_IDS.securityBusinessName, "Security Business Name", securityBusinessName),
        ...mapIds(FIELD_IDS.securityTaxEin, "Security Tax EIN", securityTaxEin),
        ...mapIds(FIELD_IDS.securityDoingBusinessAs, "Security Doing Business As", securityDoingBusinessAs),
        ...mapIds(FIELD_IDS.securityBusinessAddress, "Security Business Address", securityBusinessAddress),
        ...mapIds(FIELD_IDS.securityBusinessAddressCity, "Security Business City", securityBusinessAddressCity),
        ...mapIds(FIELD_IDS.securityBusinessAddressState, "Security Business State", securityBusinessAddressState),
        ...mapIds(FIELD_IDS.securityBusinessAddressZip, "Security Business Zip", securityBusinessAddressZip),
        ...mapIds(FIELD_IDS.securityGuarantor, "Security Guarantor", securityGuarantor),
        ...mapIds(FIELD_IDS.guarantyClientName, "Guaranty Client Name", guarantyClientName),
        ...mapIds(FIELD_IDS.guarantySs, "Guaranty SS", guarantySs),
        ...mapIds(FIELD_IDS.guarantySsDriverLicense, "Guaranty SS Driver License", guarantySsDriverLicense),
        ...mapIds(FIELD_IDS.guarantyOwner1Name, "Guaranty Owner1 Name", guarantyOwner1Name),
        ...mapIds(FIELD_IDS.guarantyOwner1Ss, "Guaranty Owner1 SS", guarantyOwner1Ss),
        ...mapIds(FIELD_IDS.guarantyOwner1DriverLicense, "Guaranty Owner1 Driver License", guarantyOwner1DriverLicense),
        ...mapIds(FIELD_IDS.guarantyOwner2Name, "Guaranty Owner2 Name", guarantyOwner2Name),
        ...mapIds(FIELD_IDS.guarantyOwner2DriverLicense, "Guaranty Owner2 Driver License", guarantyOwner2DriverLicense),
        ...mapIds(FIELD_IDS.guarantyOwner2Ss, "Guaranty Owner2 SS", guarantyOwner2Ss),
        ...mapIds(FIELD_IDS.guarantyGuarantor1Name, "Guaranty Guarantor1 Name", guarantyGuarantor1Name),
        ...mapIds(FIELD_IDS.guarantyGuarantor1Ss, "Guaranty Guarantor1 SS", guarantyGuarantor1Ss),
        ...mapIds(
            FIELD_IDS.guarantyGuarantor1DriverLicense,
            "Guaranty Guarantor1 Driver License",
            guarantyGuarantor1DriverLicense,
        ),
        ...mapIds(FIELD_IDS.guarantyGuarantor2Name, "Guaranty Guarantor2 Name", guarantyGuarantor2Name),
        ...mapIds(FIELD_IDS.guarantyGuarantor2Ss, "Guaranty Guarantor2 SS", guarantyGuarantor2Ss),
        ...mapIds(
            FIELD_IDS.guarantyGuarantor2DriverLicense,
            "Guaranty Guarantor2 Driver License",
            guarantyGuarantor2DriverLicense,
        ),
        ...mapIds(FIELD_IDS.appendixUnderwritingFees, "Appendix Underwriting Fees", appendixUnderwritingFees),
        ...mapIds(FIELD_IDS.appendixClientName, "Appendix Client Name", appendixClientName),
        ...mapIds(FIELD_IDS.authorizationApplication, "Authorization Merchant Name", authorizationApplication),
        ...mapIds(FIELD_IDS.authorizationClientBankName, "Authorization Client Bank Name", authorizationClientBankName),
        ...mapIds(FIELD_IDS.authorizationClientBankRouting, "Authorization Client Bank Routing", authorizationClientBankRouting),
        ...mapIds(FIELD_IDS.authorizationClientBankAccount, "Authorization Client Bank Account", authorizationClientBankAccount),
        ...mapIds(FIELD_IDS.authorizationClientName, "Authorization Client Name", authorizationClientName),
        ...mapIds(FIELD_IDS.authorizationClientNamePrint, "Authorization Client Name Print", authorizationClientNamePrint),
        ...mapIds(FIELD_IDS.authorizationClientTaxId, "Authorization Client Tax ID", authorizationClientTaxId),
        ...mapIds(FIELD_IDS.authorizationClientDate, "Authorization Client Date", authorizationClientDate),
        ...mapIds(FIELD_IDS.authorizedBusinessPhone, "Authorized Business Phone", authorizedBusinessPhone),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderName, "ACH Account Holder Name", achAuthorizationAccountHolderName),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderDba, "ACH Account Holder DBA", achAuthorizationAccountHolderDba),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderPhone, "ACH Account Holder Phone", achAuthorizationAccountHolderPhone),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderAddress, "ACH Account Holder Address", achAuthorizationAccountHolderAddress),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderCity, "ACH Account Holder City", achAuthorizationAccountHolderCity),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderState, "ACH Account Holder State", achAuthorizationAccountHolderState),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderZip, "ACH Account Holder Zip", achAuthorizationAccountHolderZip),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderBankName, "ACH Bank Name", achAuthorizationAccountHolderBankName),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderBankBranchCity, "ACH Bank Branch City", achAuthorizationAccountHolderBankBranchCity),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderBankState, "ACH Bank State", achAuthorizationAccountHolderBankState),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderBankZip, "ACH Bank Zip", achAuthorizationAccountHolderBankZip),
        ...mapIds(
            FIELD_IDS.achAuthorizationAccountHolderBankRoutingNumber,
            "ACH Routing Number",
            achAuthorizationAccountHolderBankRoutingNumber,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationAccountHolderBankAccountNumber,
            "ACH Account Number",
            achAuthorizationAccountHolderBankAccountNumber,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationAccountHolderBankTransactionFee,
            "ACH Transaction Fee",
            achAuthorizationAccountHolderBankTransactionFee,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationAccountHolderBankNumberOfTransactions,
            "ACH NO. of transaction",
            achAuthorizationAccountHolderBankNumberOfTransactions,
        ),
        ...mapIds(FIELD_IDS.achAuthorizationAccountHolderDate, "ACH Date", achAuthorizationAccountHolderDate),
        ...mapIds(
            FIELD_IDS.achAuthorizationConcentAccountHolderName,
            "ACH Concent Account Holder Name",
            achAuthorizationConcentAccountHolderName,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationConcentAccountHolderDate,
            "ACH Concent Account Holder Date",
            achAuthorizationConcentAccountHolderDate,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationBankPortalWebsite,
            "ACH Bank Portal Website",
            achAuthorizationBankPortalWebsite || ach_authorization_bank_portal_website,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationUsername,
            "ACH Username",
            achAuthorizationUsername || ach_authorization_username,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationPassword,
            "ACH Password",
            achAuthorizationPassword || ach_authorization_password,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationSecurityQuestion1,
            "ACH Security Question 1",
            achAuthorizationSecurityQuestion1 || ach_authorization_security_question1,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationSecurityAnswer1,
            "ACH Security Answer 1",
            achAuthorizationSecurityAnswer1 || ach_authorization_security_answer1,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationSecurityQuestion2,
            "ACH Security Question 2",
            achAuthorizationSecurityQuestion2 || ach_authorization_security_question2,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationSecurityAnswer2,
            "ACH Security Answer 2",
            achAuthorizationSecurityAnswer2 || ach_authorization_security_answer2,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationSecurityQuestion3,
            "ACH Security Question 3",
            achAuthorizationSecurityQuestion3 || ach_authorization_security_question3,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationSecurityAnswer3,
            "ACH Security Answer 3",
            achAuthorizationSecurityAnswer3 || ach_authorization_security_answer3,
        ),
        ...mapIds(
            FIELD_IDS.achAuthorizationOtherInfomation,
            "ACH Other Information",
            achAuthorizationOtherInfomation || ach_authorization_other_infomation,
        ),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceName1, "ACH Reference Name 1", achAuthorizationReferenceName1),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceNumber1, "ACH Reference Number 1", achAuthorizationReferenceNumber1),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceRelationship1, "ACH Reference Relationship 1", achAuthorizationReferenceRelationship1),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceName2, "ACH Reference Name 2", achAuthorizationReferenceName2),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceNumber2, "ACH Reference Number 2", achAuthorizationReferenceNumber2),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceRelationship2, "ACH Reference Relationship 2", achAuthorizationReferenceRelationship2),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceName3, "ACH Reference Name 3", achAuthorizationReferenceName3),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceNumber3, "ACH Reference Number 3", achAuthorizationReferenceNumber3),
        ...mapIds(FIELD_IDS.achAuthorizationReferenceRelationship3, "ACH Reference Relationship 3", achAuthorizationReferenceRelationship3),
        ...mapIds(FIELD_IDS.addendumDated, "Addendum Dated", addendumDated),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalOwner, "Addendum Principal Owner", addendumDatedPrincipalOwner),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalBusiness, "Addendum Principal Business", addendumDatedPrincipalBusiness),
        ...mapIds(FIELD_IDS.addendumDatedBusinessLocation, "Addendum Business Location", addendumDatedBusinessLocation),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalState, "Addendum Principal State", addendumDatedPrincipalState),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalOwnerAmount, "Addendum Principal Owner Amount", addendumDatedPrincipalOwnerAmount),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalOwnerAmount2, "Addendum Principal Owner Amount 2", addendumDatedPrincipalOwnerAmount2),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalOwner1Name, "Addendum Principal Owner1 Name", addendumDatedPrincipalOwner1Name),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalOwner1Date, "Addendum Principal Owner1 Date", addendumDatedPrincipalOwner1Date),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalOwner2Name, "Addendum Principal Owner2 Name", addendumDatedPrincipalOwner2Name),
        ...mapIds(FIELD_IDS.addendumDatedPrincipalOwner2Date, "Addendum Principal Owner2 Date", addendumDatedPrincipalOwner2Date),
        ...mapIds(FIELD_IDS.exhibitOwnerName, "Exhibit Owner Name", exhibitOwnerName),
        ...mapIds(FIELD_IDS.exhibitAValue1, "Exhibit A company 1", exhibitAValue1),
        ...mapIds(FIELD_IDS.exhibitAValue2, "Exhibit A company 2", exhibitAValue2),
        ...mapIds(FIELD_IDS.exhibitAValue3, "Exhibit A company 3", exhibitAValue3),
        ...mapIds(FIELD_IDS.exhibitAValue4, "Exhibit A company 4", exhibitAValue4),
        ...mapIds(FIELD_IDS.exhibitAValue5, "Exhibit A company 5", exhibitAValue5),
        ...mapIds(FIELD_IDS.exhibitAValue6, "Exhibit A company 6", exhibitAValue6),
        ...mapIds(FIELD_IDS.exhibitAValue7, "Exhibit A company 7", exhibitAValue7),
        ...mapIds(FIELD_IDS.exhibitAValue8, "Exhibit A company 8", exhibitAValue8),
        ...mapIds(FIELD_IDS.exhibitAValue9, "Exhibit A company 9", exhibitAValue9),
        ...mapIds(FIELD_IDS.exhibitAValue10, "Exhibit A company 10", exhibitAValue10),
    ];
};

/** Optional rows from contract APIs (first ACH / addendum / EPO + owner & guarantor lists). */
export type ContractPrefillContractRecords = {
    contract?: Record<string, unknown> | null;
    ach?: Record<string, unknown> | null;
    addendum?: Record<string, unknown> | null;
    epo?: Record<string, unknown> | null;
    owners?: Record<string, unknown>[] | null;
    guarantors?: Record<string, unknown>[] | null;
    /** Latest application BankDetail row (plaintext from API); preferred over stale ACH/contract copies. */
    bankDetail?: Record<string, unknown> | null;
};

/** Prefill keys synced from live BankDetail — used to replace empty or stale enc:v1: overrides. */
export const LIVE_BANK_PREFILL_KEYS = [
    "authorizationClientBankName",
    "authorizationClientBankAccount",
    "authorizationClientBankRouting",
    "achAuthorizationAccountHolderBankName",
    "achAuthorizationAccountHolderBankAccountNumber",
    "achAuthorizationAccountHolderBankRoutingNumber",
] as const;

function coalescePlainBankField(...values: unknown[]): string {
    for (const value of values) {
        const s = str(value);
        if (s && !s.startsWith("enc:v1:")) return s;
    }
    return "";
}

/**
 * Resolve bank name / account / routing from Authorization or ACH prefill keys (whichever is filled).
 */
export function resolveCanonicalBankFromPrefill(
    prefill: Partial<BuildContractPrefillFieldsArgs> | Record<string, unknown>,
): { bankName: string; accountNumber: string; routingNumber: string } {
    const row = prefill as Partial<BuildContractPrefillFieldsArgs>;
    return {
        bankName: coalescePlainBankField(
            row.authorizationClientBankName,
            row.achAuthorizationAccountHolderBankName,
        ),
        accountNumber: coalescePlainBankField(
            row.authorizationClientBankAccount,
            row.achAuthorizationAccountHolderBankAccountNumber,
        ),
        routingNumber: coalescePlainBankField(
            row.authorizationClientBankRouting,
            row.achAuthorizationAccountHolderBankRoutingNumber,
        ),
    };
}

/** Mirror canonical bank values onto every Authorization + ACH prefill key before save/sync. */
export function applyCanonicalBankFieldsToPrefill(
    partial: Partial<BuildContractPrefillFieldsArgs>,
): Partial<BuildContractPrefillFieldsArgs> {
    const { bankName, accountNumber, routingNumber } = resolveCanonicalBankFromPrefill(partial);
    if (!bankName && !accountNumber && !routingNumber) return partial;

    const out = { ...partial };
    if (bankName) {
        out.authorizationClientBankName = bankName;
        out.achAuthorizationAccountHolderBankName = bankName;
    }
    if (accountNumber) {
        out.authorizationClientBankAccount = accountNumber;
        out.achAuthorizationAccountHolderBankAccountNumber = accountNumber;
    }
    if (routingNumber) {
        out.authorizationClientBankRouting = routingNumber;
        out.achAuthorizationAccountHolderBankRoutingNumber = routingNumber;
    }
    return out;
}

export function applyLiveBankDetailsToPrefillMerge<T extends Record<string, unknown>>(
    defaults: Partial<BuildContractPrefillFieldsArgs>,
    merged: T,
): T {
    const out = { ...merged };
    for (const key of LIVE_BANK_PREFILL_KEYS) {
        const fallback = str(defaults[key as keyof BuildContractPrefillFieldsArgs]);
        if (!fallback || fallback.startsWith("enc:v1:")) continue;
        const persisted = str(out[key]);
        // Only backfill from application BankDetail when override is missing or still encrypted.
        // Do not replace explicit saved/scanned plaintext (e.g. voided-check KYC extraction).
        if (!persisted || persisted.startsWith("enc:v1:")) {
            (out as Record<string, unknown>)[key] = fallback;
        }
    }
    return out;
}

function bankDetailRowToPrefillPartial(
    row: Record<string, unknown> | null | undefined,
): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    const bankName = str(row.bankName);
    const accountNumber = str(row.accountNumber);
    const routingNumber = str(row.routingNumber);
    return {
        authorizationClientBankName: bankName,
        authorizationClientBankAccount: accountNumber,
        authorizationClientBankRouting: routingNumber,
        achAuthorizationAccountHolderBankName: bankName,
        achAuthorizationAccountHolderBankAccountNumber: accountNumber,
        achAuthorizationAccountHolderBankRoutingNumber: routingNumber,
    };
}

function str(v: unknown): string {
    return String(v ?? "").trim();
}

function isZeroMoneyPrefillValue(value: unknown): boolean {
    const n = coerceToFiniteNumber(value);
    return n !== undefined && n === 0;
}

/** Apply persisted contract rows without wiping application defaults with empty strings. */
function mergeNonemptyPrefillPartial<T extends Record<string, unknown>>(
    base: Partial<T>,
    overlay: Partial<T>,
): Partial<T> {
    const out: Partial<T> = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        if (str(value)) {
            (out as Record<string, unknown>)[key] = value;
        }
    }
    return out;
}

/**
 * DocuSign page 1 expects street in `business_address` and city/state/zip in separate tabs.
 * Legacy contract rows sometimes store the full line in `businessAddress`; strip the suffix
 * when split city/state/zip columns are also present.
 */
export function streetOnlyWhenPartsSplit(args: {
    line?: unknown;
    city?: unknown;
    state?: unknown;
    zip?: unknown;
}): string {
    let line = str(args.line);
    const city = str(args.city);
    const state = str(args.state);
    const zip = str(args.zip);
    if (!line || (!city && !state && !zip)) return line;

    const suffixCandidates = [
        [city, state, zip].filter(Boolean).join(", "),
        [city, state].filter(Boolean).join(", "),
        city,
    ].filter((s) => s.length > 0);

    for (const suffix of suffixCandidates) {
        const escaped = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const withComma = new RegExp(`,\\s*${escaped}\\s*$`, "i");
        if (withComma.test(line)) {
            line = line.replace(withComma, "").trim();
            break;
        }
        const withSpace = new RegExp(`\\s+${escaped}\\s*$`, "i");
        if (withSpace.test(line) && suffix.includes(",")) {
            line = line.replace(withSpace, "").trim();
            break;
        }
    }
    return line;
}

function applySplitAddressStreetFields(
    partial: Partial<BuildContractPrefillFieldsArgs>,
): Partial<BuildContractPrefillFieldsArgs> {
    const out = { ...partial };
    if (str(out.businessAddressCity) || str(out.businessAddressState) || str(out.businessAddressZip)) {
        out.businessAddress = streetOnlyWhenPartsSplit({
            line: out.businessAddress,
            city: out.businessAddressCity,
            state: out.businessAddressState,
            zip: out.businessAddressZip,
        });
    }
    if (
        str(out.businessAddressContractCity) ||
        str(out.businessAddressContractState) ||
        str(out.businessAddressContractZip)
    ) {
        out.businessAddressContract = streetOnlyWhenPartsSplit({
            line: out.businessAddressContract,
            city: out.businessAddressContractCity,
            state: out.businessAddressContractState,
            zip: out.businessAddressContractZip,
        });
    }
    return out;
}

/**
 * Prisma decimals / floats often arrive as strings like `1400.00000000000`.
 * Normalize for US number style: truncate toward zero, format with comma separators and 2 decimals.
 */
function coerceToFiniteNumber(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "boolean") return undefined;
    if (typeof value === "bigint") return Number(value);
    if (value != null && typeof value === "object") {
        const perhaps = value as { toNumber?: unknown; valueOf?: unknown };
        if (typeof perhaps.toNumber === "function") {
            const nn = Number((perhaps as any).toNumber());
            return Number.isFinite(nn) ? nn : undefined;
        }
        const fromValueOf = typeof perhaps.valueOf === "function" ? Number((perhaps as { valueOf(): unknown }).valueOf()) : NaN;
        if (Number.isFinite(fromValueOf)) return fromValueOf;
    }
    const s =
        typeof value === "string" ? value.trim().replace(/,/g, "").replace(/^[$€£¥]\s*/, "") : String(value ?? "").trim();
    if (!s) return undefined;
    const parsed = Number(s);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function truncateDecimalPrefill(value: unknown): string {
    const n = coerceToFiniteNumber(value);
    if (n === undefined) return "";
    const truncated = Math.trunc(n * 100) / 100;
    return new Intl.NumberFormat("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(truncated);
}

/** Prefer first nonempty truncated money string from fallback chain. */
function firstTruncateDecimal(...values: unknown[]): string {
    for (const v of values) {
        const t = truncateDecimalPrefill(v);
        if (t !== "") return t;
    }
    return "";
}

/** Values from APIs are often ISO strings or `Date` objects; normalize to US date format MM/DD/YYYY. */
function prefillIsoDate(value: unknown): string {
    if (value == null) return "";
    if (typeof value === "string") {
        const t = value.trim();
        if (!t) return "";
        return formatUsDateString(t);
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? "" : formatUsDateString(value.toISOString());
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? "" : formatUsDateString(d.toISOString());
    }
    return formatUsDateString(str(value));
}

const MONEY_STRING_PREFILL_KEYS: readonly (keyof BuildContractPrefillFieldsArgs)[] = [
    "purchasePrice",
    "purchaseAmount",
    "purchasePercent",
    "netToMerchant",
    "appendixUnderwritingFees",
    "addendumDatedPrincipalOwnerAmount",
    "addendumDatedPrincipalOwnerAmount2",
];

export type NetToMerchantPrefillSources = {
    offerDecision?: Record<string, unknown> | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    /** Merged prefill / overrides — offer amount here wins over mis-set contract.purchaseAmount (payback). */
    prefill?: Partial<BuildContractPrefillFieldsArgs> | null;
};

function offerDecisionEffectiveRecordForNet(
    odRoot: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
    if (!odRoot || typeof odRoot !== "object") return null;
    const inner = odRoot.offer;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
    }
    return odRoot;
}

type OfferDecisionPrefillContext = {
    app: Record<string, unknown> | null | undefined;
    contract: Record<string, unknown> | null | undefined;
    odRoot: Record<string, unknown> | null;
    odEff: Record<string, unknown> | null;
    terms0: Record<string, unknown> | null;
};

function getOfferDecisionPrefillContext(
    sources: NetToMerchantPrefillSources,
): OfferDecisionPrefillContext {
    const app = sources.application;
    const contract = sources.contract;
    const odRoot =
        sources.offerDecision ??
        (contract?.offer as Record<string, unknown> | undefined) ??
        (app?.offerDecision as Record<string, unknown> | undefined) ??
        (app?.OfferDecision as Record<string, unknown> | undefined) ??
        null;
    const odEff = offerDecisionEffectiveRecordForNet(odRoot ?? undefined) ?? odRoot;
    const termsRaw = app?.termsOffers;
    const terms0 =
        Array.isArray(termsRaw) && termsRaw[0] && typeof termsRaw[0] === "object"
            ? (termsRaw[0] as Record<string, unknown>)
            : termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)
              ? (termsRaw as Record<string, unknown>)
              : null;
    return { app, contract, odRoot, odEff, terms0 };
}

/** Gross funded offer from OfferDecision / terms — no purchaseAmount / net fallbacks. */
function readGrossOfferAdvanceFromContext(ctx: OfferDecisionPrefillContext): number | undefined {
    const { odRoot, odEff, terms0, contract } = ctx;
    return (
        coerceToFiniteNumber(odEff?.offer) ??
        coerceToFiniteNumber(odEff?.approvedAmount) ??
        coerceToFiniteNumber(odRoot?.offer) ??
        coerceToFiniteNumber(odRoot?.approvedAmount) ??
        coerceToFiniteNumber(terms0?.approvedAmount) ??
        coerceToFiniteNumber(contract?.approvedAmount) ??
        undefined
    );
}

function readStoredNetToMerchantDollars(sources: NetToMerchantPrefillSources): number | undefined {
    const contract = sources.contract;
    return (
        coerceToFiniteNumber(sources.prefill?.netToMerchant) ??
        coerceToFiniteNumber(contract?.netToMerchant) ??
        undefined
    );
}

function valueMatchesStoredNet(n: number, sources: NetToMerchantPrefillSources): boolean {
    const net = readStoredNetToMerchantDollars(sources);
    return net !== undefined && Math.abs(n - net) < 0.01;
}

function readPaybackDollarsFromContext(ctx: OfferDecisionPrefillContext): number | undefined {
    const { odRoot, odEff, terms0, contract } = ctx;
    const advance = readGrossOfferAdvanceFromContext(ctx) ?? 0;
    const factorRate = resolveOfferFactorRateFromContext(ctx);
    const payback = resolveOfferPayback(advance, factorRate, {
        termsPaybackAmount: coerceToFiniteNumber(terms0?.paybackAmount),
        offerPaybackAmount:
            coerceToFiniteNumber(odEff?.paybackAmount) ?? coerceToFiniteNumber(odRoot?.paybackAmount),
        totalRemit:
            coerceToFiniteNumber(odEff?.totalRemit) ?? coerceToFiniteNumber(odRoot?.totalRemit),
    });
    if (payback > 0) return payback;
    const legacy =
        coerceToFiniteNumber(contract?.purchasePrice) ?? coerceToFiniteNumber(contract?.totalAmount);
    return legacy !== undefined && legacy > 0 ? legacy : undefined;
}

/** Offer Decision `fees` (dollars) for contract appendix / underwriting fee prefill. */
function resolvePlatformOfferFeesForPrefill(sources: NetToMerchantPrefillSources): string {
    const ctx = getOfferDecisionPrefillContext(sources);
    const { odRoot, odEff, terms0, app, contract } = ctx;
    const offerRecord =
        odRoot ??
        ((contract?.offer as Record<string, unknown> | undefined) ?? null);
    const feesRaw =
        resolveOfferDecisionFeesRaw(offerRecord) ??
        resolveOfferDecisionFeesRaw(odEff ? { fees: odEff.fees } : null) ??
        terms0?.fees;

    const purchase = resolveOfferAmountDollarsForUnderwritingFees({
        ...sources,
        prefill: sources.prefill,
    });

    if (purchase !== undefined && purchase > 0) {
        const feeDollars = resolveOfferFeeAmountForDeal({
            fundedAmount: purchase,
            factorRate: odEff?.rate ?? odRoot?.rate ?? terms0?.factorRate,
            feesRaw: feesRaw ?? odEff?.fees ?? odRoot?.fees,
            termsCommissionPercent: terms0?.commissionPercent,
            applicationCommissionPercentage: (app as Record<string, unknown> | undefined)
                ?.commissionPercentage,
        });
        if (feeDollars > 0) {
            return formatOfferDecisionFeesDollarsForPrefill(feeDollars);
        }
    }

    const fallbackRaw =
        feesRaw ??
        odEff?.fees ??
        odRoot?.fees ??
        (contract as Record<string, unknown> | undefined)?.appendixUnderwritingFees;
    if (fallbackRaw != null && String(fallbackRaw).trim() !== "") {
        return formatOfferDecisionFeesDollarsForPrefill(fallbackRaw);
    }
    return "";
}

function resolveOfferAdvanceDollars(
    ctx: OfferDecisionPrefillContext,
    sources?: NetToMerchantPrefillSources,
): number {
    const { contract } = ctx;
    const fromOffer = readGrossOfferAdvanceFromContext(ctx);
    if (fromOffer !== undefined && fromOffer > 0) return fromOffer;

    for (const n of [
        coerceToFiniteNumber(sources?.prefill?.purchaseAmount),
        coerceToFiniteNumber(contract?.purchaseAmount),
    ]) {
        if (n === undefined || !(n > 0)) continue;
        if (sources && valueMatchesStoredNet(n, sources)) continue;
        return n;
    }
    return 0;
}

function resolveOfferFactorRateFromContext(ctx: OfferDecisionPrefillContext): number {
    const { odRoot, odEff, terms0 } = ctx;
    return resolveOfferFactorRate({
        offerDecisionRate:
            coerceToFiniteNumber(odRoot?.rate) ?? coerceToFiniteNumber(odEff?.rate),
        offerDecisionFactorRate:
            coerceToFiniteNumber(odRoot?.factorRate) ?? coerceToFiniteNumber(odEff?.factorRate),
        termsFactorRate: coerceToFiniteNumber(terms0?.factorRate),
    });
}

/** Payback = offer amount × factor rate (not OfferDecision.totalRemit, which is leverage %). */
export function resolvePaybackAmountDollars(sources: NetToMerchantPrefillSources): number | undefined {
    const ctx = getOfferDecisionPrefillContext(sources);
    const advance = resolveOfferAdvanceDollars(ctx, sources);
    const factorRate = resolveOfferFactorRateFromContext(ctx);
    const { odRoot, odEff, terms0, contract } = ctx;

    const payback = resolveOfferPayback(advance, factorRate, {
        termsPaybackAmount: coerceToFiniteNumber(terms0?.paybackAmount),
        offerPaybackAmount:
            coerceToFiniteNumber(odEff?.paybackAmount) ?? coerceToFiniteNumber(odRoot?.paybackAmount),
        totalRemit:
            coerceToFiniteNumber(odEff?.totalRemit) ?? coerceToFiniteNumber(odRoot?.totalRemit),
    });
    if (payback > 0) return payback;

    const legacy =
        coerceToFiniteNumber(contract?.purchasePrice) ?? coerceToFiniteNumber(contract?.totalAmount);
    return legacy !== undefined && legacy > 0 ? legacy : undefined;
}

/**
 * Offer / advance amount for underwriting fee % → dollars (never payback / total remit).
 */
export function resolveOfferAmountDollarsForUnderwritingFees(
    sources: NetToMerchantPrefillSources,
): number | undefined {
    const ctx = getOfferDecisionPrefillContext(sources);
    const gross = readGrossOfferAdvanceFromContext(ctx);
    if (gross !== undefined && gross > 0) return gross;

    const payback = readPaybackDollarsFromContext(ctx);
    const contract = sources.contract;
    const prefillOverrides = normalizeContractPrefillOverrides(contract?.contractPrefillOverrides);
    const candidates = [
        coerceToFiniteNumber(sources.prefill?.purchaseAmount),
        coerceToFiniteNumber(prefillOverrides?.purchaseAmount),
        coerceToFiniteNumber(contract?.purchaseAmount),
    ];

    for (const n of candidates) {
        if (n === undefined || !(n > 0)) continue;
        if (payback !== undefined && Math.abs(n - payback) < 0.01) continue;
        if (valueMatchesStoredNet(n, sources)) continue;
        return n;
    }
    return undefined;
}

/** Purchase / advance amount used for fee % and net-to-merchant math. */
export function resolvePurchaseAmountDollars(sources: NetToMerchantPrefillSources): number | undefined {
    return resolveOfferAmountDollarsForUnderwritingFees(sources);
}

/**
 * Appendix A / offer fees: CRM often stores a percent (e.g. `10` or `10%`); DocuSign expects dollars.
 * Values over 100 without a % sign are treated as already-dollar amounts.
 */
export function resolveAppendixUnderwritingFeesDisplay(
    rawFees: unknown,
    purchaseAmount: number | undefined,
    options?: {
        /**
         * @deprecated Offer decision `fees` is stored as dollars. Prefer
         * `formatOfferDecisionFeesDollarsForPrefill` for that source.
         */
        fromOfferDecision?: boolean;
    },
): string {
    const raw = str(rawFees);
    if (!raw) return "";

    const hasPercentSign = raw.includes("%");
    const numeric = coerceToFiniteNumber(raw.replace(/%/g, ""));
    if (numeric === undefined) return raw;

    let percent: number | undefined;
    if (hasPercentSign || options?.fromOfferDecision) {
        percent = numeric;
    } else if (numeric > 0 && numeric <= 100) {
        percent = numeric;
    } else {
        return truncateDecimalPrefill(numeric);
    }

    if (purchaseAmount === undefined || !(purchaseAmount > 0)) {
        return truncateDecimalPrefill(numeric);
    }

    return truncateDecimalPrefill((purchaseAmount * percent) / 100);
}

export function resolveAppendixUnderwritingFeesDollars(
    rawFees: unknown,
    purchaseAmount: number | undefined,
): number | undefined {
    return coerceToFiniteNumber(resolveAppendixUnderwritingFeesDisplay(rawFees, purchaseAmount));
}

/** `OfferDecision.fees` is persisted as dollars (% was applied to funded amount at save). */
export function formatOfferDecisionFeesDollarsForPrefill(rawFees: unknown): string {
    const n = coerceToFiniteNumber(rawFees);
    if (n !== undefined) return truncateDecimalPrefill(n);
    const raw = str(rawFees);
    return raw ? truncateDecimalPrefill(raw) : "";
}

function applyAppendixUnderwritingFeesAmount(
    partial: Partial<BuildContractPrefillFieldsArgs>,
    sources: NetToMerchantPrefillSources,
): Partial<BuildContractPrefillFieldsArgs> {
    const out = { ...partial };
    const purchase = resolveOfferAmountDollarsForUnderwritingFees({
        ...sources,
        prefill: { ...sources.prefill, ...partial },
    });
    const platformFee = resolvePlatformOfferFeesForPrefill({
        ...sources,
        prefill: { ...sources.prefill, ...partial },
    });
    if (platformFee) {
        out.appendixUnderwritingFees = platformFee;
        return out;
    }
    const saved = str(out.appendixUnderwritingFees);
    if (saved && !isZeroMoneyPrefillValue(saved)) {
        out.appendixUnderwritingFees =
            resolveAppendixUnderwritingFeesDisplay(saved, purchase) || saved;
    }
    return out;
}

/** Apply appendix fee % → $ and related money normalization (call after merging overrides). */
export function finalizeContractPrefillMoneyFields(
    partial: Partial<BuildContractPrefillFieldsArgs>,
    sources: NetToMerchantPrefillSources,
): Partial<BuildContractPrefillFieldsArgs> {
    return applyAppendixUnderwritingFeesAmount(partial, {
        ...sources,
        prefill: { ...sources.prefill, ...partial },
    });
}

/**
 * Net to merchant = max(0, advance − fees − refinance) — same as Collections "Net funding".
 */
export function computeNetToMerchantDollars(sources: NetToMerchantPrefillSources): number | undefined {
    const ctx = getOfferDecisionPrefillContext(sources);
    let advance = readGrossOfferAdvanceFromContext(ctx);
    if (advance === undefined || !(advance > 0)) {
        const contract = sources.contract;
        for (const n of [
            coerceToFiniteNumber(sources.prefill?.purchaseAmount),
            coerceToFiniteNumber(contract?.purchaseAmount),
        ]) {
            if (n === undefined || !(n > 0)) continue;
            if (valueMatchesStoredNet(n, sources)) continue;
            advance = n;
            break;
        }
    }
    if (advance === undefined || !(advance > 0)) return undefined;

    const app = sources.application;
    const contract = sources.contract;
    const { odRoot, odEff, terms0 } = ctx;

    const appendixRaw = contract?.appendixUnderwritingFees;
    const fees =
        coerceToFiniteNumber(appendixRaw) ??
        resolveOfferFeeAmountForDeal({
            fundedAmount: advance,
            factorRate:
                odEff?.rate ??
                odRoot?.rate ??
                terms0?.factorRate,
            feesRaw: odEff?.fees ?? odRoot?.fees,
            termsCommissionPercent: terms0?.commissionPercent,
            applicationCommissionPercentage: app?.commissionPercentage,
        });
    const refinance =
        coerceToFiniteNumber(odRoot?.refinanceAmount) ??
        coerceToFiniteNumber(odRoot?.RefinanceAmount) ??
        coerceToFiniteNumber(odEff?.refinanceAmount) ??
        coerceToFiniteNumber(odEff?.RefinanceAmount) ??
        0;

    return Math.max(0, advance - fees - refinance);
}

export function formatNetToMerchantPrefillValue(amount: number | undefined): string {
    if (amount === undefined || !Number.isFinite(amount)) return "";
    return truncateDecimalPrefill(amount);
}

const PAYMENT_FREQUENCY_LABELS = new Set([
    "daily",
    "weekly",
    "monthly",
    "bi-weekly",
    "biweekly",
    "bi weekly",
]);

function isPaymentFrequencyLabel(value: string): boolean {
    return PAYMENT_FREQUENCY_LABELS.has(String(value || "").trim().toLowerCase());
}

/**
 * DocuSign `remittance` tab = per-period payment (daily payment when frequency is Daily).
 * Uses OfferDecision.repayPerPeriod, not totalRemit or frequency text.
 */
export function resolveRemittancePrefillValue(sources: NetToMerchantPrefillSources): string {
    const app = sources.application;
    const contract = sources.contract;
    const odRoot =
        sources.offerDecision ??
        (contract?.offer as Record<string, unknown> | undefined) ??
        (app?.offerDecision as Record<string, unknown> | undefined) ??
        (app?.OfferDecision as Record<string, unknown> | undefined) ??
        null;
    const odEff = offerDecisionEffectiveRecordForNet(odRoot ?? undefined) ?? odRoot;
    const termsRaw = app?.termsOffers;
    const terms0 =
        Array.isArray(termsRaw) && termsRaw[0] && typeof termsRaw[0] === "object"
            ? (termsRaw[0] as Record<string, unknown>)
            : termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)
              ? (termsRaw as Record<string, unknown>)
              : null;

    const periodic =
        coerceToFiniteNumber(odRoot?.repayPerPeriod) ??
        coerceToFiniteNumber(odEff?.repayPerPeriod) ??
        coerceToFiniteNumber(terms0?.paymentAmount) ??
        coerceToFiniteNumber(terms0?.repayPerPeriod) ??
        coerceToFiniteNumber(terms0?.dailyPayment);

    if (periodic !== undefined) {
        return truncateDecimalPrefill(periodic);
    }

    const saved = str(contract?.remittance);
    if (saved && !isPaymentFrequencyLabel(saved)) {
        const asNum = truncateDecimalPrefill(saved);
        if (asNum) return asNum;
    }

    const payback = resolvePaybackAmountDollars(sources);
    const numPayments =
        coerceToFiniteNumber(odRoot?.numberOfPayments) ??
        coerceToFiniteNumber(terms0?.numberOfPayments);
    if (payback !== undefined && numPayments !== undefined && numPayments > 0) {
        return truncateDecimalPrefill(payback / numPayments);
    }

    return saved && !isPaymentFrequencyLabel(saved) ? saved : "";
}

function paymentCountFromOfferTerm(raw: unknown): number | undefined {
    const termStr = str(raw);
    if (!termStr) return undefined;
    const parsed = parseTerm(termStr);
    if (Number.isFinite(parsed) && parsed > 0) return Math.trunc(parsed);
    const numeric = coerceToFiniteNumber(raw);
    if (numeric !== undefined && numeric > 0) return Math.trunc(numeric);
    return undefined;
}

/**
 * ACH form "NO. of transaction" = term of offer (payments count from offer / terms offer).
 */
export function resolveNumberOfPaymentsPrefillValue(sources: NetToMerchantPrefillSources): string {
    const app = sources.application;
    const contract = sources.contract;
    const contractOffer = (contract as Record<string, unknown> | null | undefined)?.offer as
        | Record<string, unknown>
        | undefined;
    const odRoot =
        sources.offerDecision ??
        contractOffer ??
        (app?.offerDecision as Record<string, unknown> | undefined) ??
        (app?.OfferDecision as Record<string, unknown> | undefined) ??
        null;
    const odEff = offerDecisionEffectiveRecordForNet(odRoot ?? undefined) ?? odRoot;
    const termsRaw = app?.termsOffers;
    const terms0 =
        Array.isArray(termsRaw) && termsRaw[0] && typeof termsRaw[0] === "object"
            ? (termsRaw[0] as Record<string, unknown>)
            : termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)
              ? (termsRaw as Record<string, unknown>)
              : null;

    const numPayments =
        coerceToFiniteNumber(odRoot?.numberOfPayments) ??
        coerceToFiniteNumber(odEff?.numberOfPayments) ??
        paymentCountFromOfferTerm(odRoot?.term) ??
        paymentCountFromOfferTerm(odEff?.term) ??
        coerceToFiniteNumber(terms0?.numberOfPayments) ??
        paymentCountFromOfferTerm(terms0?.term) ??
        coerceToFiniteNumber(terms0?.termLength) ??
        coerceToFiniteNumber((contract as Record<string, unknown> | null)?.numberOfPayments) ??
        coerceToFiniteNumber(contractOffer?.numberOfPayments) ??
        paymentCountFromOfferTerm(contractOffer?.term);

    if (numPayments !== undefined && numPayments > 0) {
        return String(Math.trunc(numPayments));
    }

    const saved = str(
        (contract as Record<string, unknown> | null | undefined)
            ?.achAuthorizationAccountHolderBankNumberOfTransactions,
    );
    if (saved) return saved;
    return "";
}

/** Human-readable payment frequency for contract / DocuSign prefill. */
export function resolveOfferFrequencyLabel(sources: NetToMerchantPrefillSources): string {
    const app = sources.application;
    const contract = sources.contract;
    const odRoot =
        sources.offerDecision ??
        (contract?.offer as Record<string, unknown> | undefined) ??
        (app?.offerDecision as Record<string, unknown> | undefined) ??
        (app?.OfferDecision as Record<string, unknown> | undefined) ??
        null;
    const odEff = offerDecisionEffectiveRecordForNet(odRoot ?? undefined) ?? odRoot;
    const termsRaw = app?.termsOffers;
    const terms0 =
        Array.isArray(termsRaw) && termsRaw[0] && typeof termsRaw[0] === "object"
            ? (termsRaw[0] as Record<string, unknown>)
            : termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)
              ? (termsRaw as Record<string, unknown>)
              : null;

    const raw =
        str(odRoot?.frequency) ||
        str(odEff?.frequency) ||
        str(terms0?.frequency) ||
        str(contract?.frequency) ||
        str(app?.frequency);
    if (!raw) return "";

    const normalized = raw.replace(/_/g, " ").trim();
    if (!normalized) return "";
    return normalized
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
}

/** Normalized disclosure template frequency key (`daily`, `weekly`, …). */
export function normalizeDisclosureTemplateFrequencyKey(frequency: string): string {
    const f = String(frequency ?? "")
        .trim()
        .toLowerCase();
    if (f.includes("biweek") || f.includes("bi_week")) return "biweekly";
    if (f.startsWith("week")) return "weekly";
    if (f.startsWith("day")) return "daily";
    if (f.startsWith("month")) return "monthly";
    return f || "daily";
}

/**
 * Resolve deal payment frequency for state disclosure template lookup.
 * Prefers live Offer Decision over stale `contract.offer` snapshots.
 */
export function resolveDealDisclosureFrequencyKey(args: {
    offerDecision?: Record<string, unknown> | null;
    contract?: Record<string, unknown> | null;
    application?: Record<string, unknown> | null;
    termsOffer?: Record<string, unknown> | null;
    /** When false, skip stale contract.offer until Offer Decision fetch completes. */
    offerDecisionLoaded?: boolean;
}): string {
    const contract = (args.contract ?? {}) as Record<string, unknown>;
    const app = (args.application ?? {}) as Record<string, unknown>;

    const liveOd =
        (args.offerDecision != null && typeof args.offerDecision === "object"
            ? args.offerDecision
            : null) ??
        (app.offerDecision != null && typeof app.offerDecision === "object"
            ? (app.offerDecision as Record<string, unknown>)
            : null) ??
        (app.OfferDecision != null && typeof app.OfferDecision === "object"
            ? (app.OfferDecision as Record<string, unknown>)
            : null);

    const termsRaw = app.termsOffers;
    const terms0 =
        args.termsOffer ??
        (Array.isArray(termsRaw) && termsRaw[0] && typeof termsRaw[0] === "object"
            ? (termsRaw[0] as Record<string, unknown>)
            : termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)
              ? (termsRaw as Record<string, unknown>)
              : null);

    const contractOffer =
        contract.offer != null &&
        typeof contract.offer === "object" &&
        !Array.isArray(contract.offer)
            ? (contract.offer as Record<string, unknown>)
            : null;

    let raw = "";
    if (liveOd) {
        raw = String(liveOd.frequency ?? "").trim();
    }
    if (!raw && terms0) {
        raw = String(terms0.frequency ?? "").trim();
    }
    if (!raw && args.offerDecisionLoaded !== false) {
        raw =
            String(contractOffer?.frequency ?? "").trim() ||
            String(contract.remittance ?? "").trim() ||
            String(contract.disclosureFrequency ?? "").trim();
    }

    if (!raw) return args.offerDecisionLoaded === false ? "" : "daily";
    return normalizeDisclosureTemplateFrequencyKey(raw);
}

function normalizeDealReviewFieldId(id: string): string {
    return String(id ?? "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
}

function stripLeadingLabelPrefixes(label: string, prefixes: string[]): string {
    let s = String(label ?? "").trim();
    let changed = true;
    while (changed) {
        changed = false;
        for (const prefix of prefixes) {
            const re = new RegExp(`^${escapeRegExpForNote(prefix)}\\s+`, "i");
            const next = s.replace(re, "").trim();
            if (next !== s) {
                s = next;
                changed = true;
            }
        }
    }
    return s;
}

function humanizeDealReviewToken(token: string): string {
    const t = String(token || "")
        .trim()
        .replace(/_/g, " ");
    if (!t) return "";
    return t
        .split(/\s+/)
        .map((w) => {
            const lower = w.toLowerCase();
            if (lower === "dba") return "DBA";
            if (lower === "ein") return "EIN";
            if (lower === "ssn") return "SSN";
            if (lower === "zip") return "ZIP";
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        })
        .join(" ");
}

/** Longest-first prefixes removed from row labels per Deal Review section. */
const DEAL_REVIEW_LABEL_PREFIXES_BY_CATEGORY: Record<string, string[]> = {
    General: ["Federal Tax ID EIN", "Federal Tax ID", "State Of Incorporation", "Doing Business As", "Agreement"],
    Parties: ["Owner2 Guarantor", "Owner1 Guarantor", "Owner 2 Guarantor", "Owner 1 Guarantor", "Client Legal", "Client"],
    "Business Address": ["Business Address"],
    "Contract Address": ["Contract Address", "Contract"],
    "Deal Terms": ["Purchase"],
    ACH: [
        "ACH Authorization Concent Account Holder",
        "ACH Concent Account Holder",
        "Concent Account Holder",
        "ACH Authorization Account Holder",
        "ACH Account Holder",
        "Account Holder",
        "ACH Authorization",
        "ACH",
    ],
    Authorization: ["Authorization Client", "Authorized Business", "Authorization", "Client"],
    Guarantor: ["Guarantor"],
    Security: ["Security"],
    Guaranty: ["Guaranty"],
    Appendix: ["Appendix"],
    Addendum: ["Principal", "Dated", "Addendum"],
};

const ACH_ACCOUNT_HOLDER_TAIL_LABELS: Record<string, string> = {
    name: "Name",
    dba: "DBA",
    phone: "Phone",
    address: "Street",
    city: "City",
    state: "State",
    zip: "ZIP",
    date: "Date",
};

const ACH_BANK_TAIL_LABELS: Record<string, string> = {
    name: "Bank name",
    branch_city: "Branch city",
    state: "Bank state",
    zip: "Bank ZIP",
    routing_number: "Routing number",
    account_number: "Account number",
    transaction_fee: "Transaction fee",
};

const AUTHORIZATION_CLIENT_TAIL_LABELS: Record<string, string> = {
    application: "Client name",
    bank_name: "Bank name",
    bank_routing: "Routing number",
    bank_account: "Account number",
    name: "Signer name",
    name_print: "Printed name",
    tax_id: "Tax ID / EIN",
    date: "Date",
};

function inferDealReviewLabelFromFieldId(id: string, category: string): string | null {
    const norm = normalizeDealReviewFieldId(id);

    if (category === "ACH" && norm.startsWith("ach_authorization_")) {
        let rest = norm.slice("ach_authorization_".length);
        if (rest.startsWith("concent_account_holder_") || rest.startsWith("consent_account_holder_")) {
            const tail = rest.replace(/^concent_account_holder_/, "").replace(/^consent_account_holder_/, "");
            if (tail === "name") return "Name";
            if (tail === "date") return "Date";
            return humanizeDealReviewToken(tail);
        }
        if (rest.startsWith("account_holder_bank_")) {
            const tail = rest.slice("account_holder_bank_".length);
            return ACH_BANK_TAIL_LABELS[tail] ?? humanizeDealReviewToken(tail);
        }
        if (rest.startsWith("account_holder_")) {
            const tail = rest.slice("account_holder_".length);
            return ACH_ACCOUNT_HOLDER_TAIL_LABELS[tail] ?? humanizeDealReviewToken(tail);
        }
        if (rest.startsWith("reference_")) {
            const tail = rest.replace(/^reference_/, "");
            return humanizeDealReviewToken(tail);
        }
        return humanizeDealReviewToken(rest);
    }

    if (category === "Authorization" && norm.startsWith("authorization_client_")) {
        const tail = norm.slice("authorization_client_".length);
        return AUTHORIZATION_CLIENT_TAIL_LABELS[tail] ?? humanizeDealReviewToken(tail);
    }
    if (category === "Authorization" && norm === "authorization_application") {
        return "Client name";
    }
    if (category === "Authorization" && norm === "authorized_business_phone") {
        return "Business phone";
    }

    if (category === "Guarantor" && norm.startsWith("guarantor_")) {
        const tail = norm.slice("guarantor_".length);
        const map: Record<string, string> = {
            address: "Street",
            address_city: "City",
            address_state: "State",
            address_zip: "ZIP",
            email: "Email",
            phone: "Phone",
        };
        return map[tail] ?? humanizeDealReviewToken(tail);
    }

    if (category === "Parties") {
        if (norm === "client_legal_name") return "Legal name";
        if (norm === "client_email") return "Email";
        if (norm === "client_phone") return "Phone";
        if (norm === "client_name") return "Name";
        if (norm === "owner1_guarantor_name") return "Owner 1 — Guarantor";
        if (norm === "merchant2_name" || norm === "owner2_guarantor_name") return "Merchant 2 — Name";
    }

    if (category === "General") {
        if (norm === "state_of_inc") return "State of incorporation";
        if (norm === "doing_business_as") return "DBA";
        if (norm === "federal_tax_id_ein") return "EIN";
        if (norm === "agreement_date") return "Agreement date";
    }

    if (category === "Business Address" || category === "Contract Address") {
        if (norm.endsWith("_city")) return "City";
        if (norm.endsWith("_state")) return "State";
        if (norm.endsWith("_zip")) return "ZIP";
        if (norm === "business_address" || norm === "business_address_contract") return "Street";
    }

    if (category === "Deal Terms") {
        if (norm === "purchase_price") return PLATFORM_LABEL.paybackAmount;
        if (norm === "purchase_amount") return PLATFORM_LABEL.offerAmount;
        if (norm === "purchase_percent") return PLATFORM_LABEL.specifiedPercentage;
        if (norm === "remittance") return PLATFORM_LABEL.remittance;
        if (norm === "frequency" || norm === "paymentterms") return PLATFORM_LABEL.frequency;
    }

    if (category === "Addendum") {
        if (norm === "addendum_dated_principal_owner_amount") return PLATFORM_LABEL.offerAmount;
        if (norm === "addendum_dated_principal_owner_amount2") return PLATFORM_LABEL.paybackAmount;
    }

    if (category === "Appendix") {
        if (norm === "appendix_client_name") return "Client name";
        if (norm === "exhibit_owner_name") return "Exhibit owner";
        const exhibitVal = norm.match(/^exhibit_a_value_(\d+)$/);
        if (exhibitVal) return `Exhibit A company ${exhibitVal[1]}`;
    }

    return null;
}

const DEAL_REVIEW_APPENDIX_FEE_IDS = new Set([
    "appendix_underwriting_fees",
    "underwriter_fee",
    "underwriterfee",
    "underwriter_fees",
]);

/** Labels deduped globally (same value shown once across sections). */
const DEAL_REVIEW_GLOBAL_DEDUPE_LABELS = new Set(["underwriting fees", "net to merchant"]);

/** Deal Review section for a prefill field id (display only; DocuSign still gets every id). */
export function categorizeDealReviewPrefillFieldId(id: string): string {
    const s = normalizeDealReviewFieldId(id);
    if (DEAL_REVIEW_APPENDIX_FEE_IDS.has(s)) return "Appendix";
    if (s === "exhibit_owner_name" || /^exhibit_a_value_\d+$/.test(s)) return "Appendix";
    if (s.startsWith("ach_")) return "ACH";
    if (s.startsWith("addendum_")) return "Addendum";
    if (s.startsWith("authorization_") || s.startsWith("authorized_")) return "Authorization";
    if (s.startsWith("appendix_")) return "Appendix";
    if (s.startsWith("security_")) return "Security";
    if (s.startsWith("guaranty_")) return "Guaranty";
    if (s.startsWith("guarantor_")) return "Guarantor";
    if (s.startsWith("business_address_contract")) return "Contract Address";
    if (s.startsWith("business_address_")) return "Business Address";
    if (s === "business_address") return "Business Address";
    if (
        s.startsWith("purchase_") ||
        s === "remittance" ||
        s === "frequency" ||
        s === "paymentterms" ||
        s === "net_to_merchant" ||
        s === "netfundprovided"
    ) {
        return "Deal Terms";
    }
    if (
        s === "agreement_date" ||
        s === "entity_type" ||
        s === "typeofentity1" ||
        s === "entitytype" ||
        s === "federal_tax_id_ein" ||
        s === "state_of_inc" ||
        s === "doing_business_as"
    ) {
        return "General";
    }
    if (s.startsWith("client_") || s.includes("owner1_guarantor") || s.includes("owner2_guarantor")) {
        return "Parties";
    }
    if (s.startsWith("epo_")) return "EPOs";
    return "Other";
}

/** Optional nested heading inside Addendum / similar sections in Deal Review. */
export function dealReviewPrefillSubsection(fieldId: string, category: string): string | null {
    const id = normalizeDealReviewFieldId(fieldId);
    if (category === "Addendum") {
        if (id.includes("principal")) return "Principal";
        if (
            id.includes("legal_name") ||
            id.includes("_dba_") ||
            id.includes("type_of_entity") ||
            id.includes("_ein_") ||
            id.includes("mailing")
        ) {
            return "Entity slots";
        }
    }
    if (category === "Guaranty") {
        if (
            id === "guaranty_client_name" ||
            id === "guaranty_ss" ||
            id === "guaranty_ss_driver_license"
        ) {
            return "Client";
        }
        if (id.includes("guarantor1") || id.includes("owner1")) return "Owner 1";
        if (id.includes("guarantor2") || id.includes("owner2")) return "Owner 2";
    }
    if (category === "ACH") {
        if (id.includes("concent") || id.includes("consent")) return "Consent";
        if (
            id.includes("account_holder_bank") ||
            id.includes("bank_routing") ||
            id.includes("bank_account") ||
            (id.includes("bank_") && !id.includes("account_holder_address"))
        ) {
            return "Bank";
        }
        if (id.includes("reference_")) return "References";
        if (
            id.includes("bank_portal") ||
            id.includes("username") ||
            id.includes("password") ||
            id.includes("security_question") ||
            id.includes("security_answer") ||
            id.includes("other_infomation")
        ) {
            return "Online banking";
        }
        if (id.includes("account_holder")) return "Account holder";
    }
    if (category === "Guarantor") {
        if (id.includes("address") || id.includes("_city") || id.includes("_state") || id.includes("_zip")) {
            return "Address";
        }
        if (id.includes("email") || id.includes("phone")) return "Contact";
    }
    if (category === "Appendix" && /^exhibit_a_value_\d+$/.test(id)) {
        return "Exhibit A companies";
    }
    return null;
}

/** Drop section title from row label when repeated (e.g. "Contract City" under "Contract Address" → "City"). */
export function formatDealReviewFieldLabel(label: string, category: string): string {
    const rowLabel = String(label || "").trim();
    const section = String(category || "").trim();
    if (!rowLabel || !section) return rowLabel || section;

    const words = section.split(/\s+/).filter(Boolean);
    for (let n = words.length; n >= 1; n--) {
        const prefix = words.slice(0, n).join(" ");
        const re = new RegExp(`^${escapeRegExpForNote(prefix)}\\s+`, "i");
        if (re.test(rowLabel)) {
            const stripped = rowLabel.replace(re, "").trim();
            if (stripped) return stripped;
        }
    }
    return rowLabel;
}

/**
 * Deal Review labels aligned with Offer Decision / contract UI
 * (see PDFViewerModal offerDecisionSummaryRows, ContractTab, ContractPrefillEditForm).
 */
const PLATFORM_LABEL = {
    offerAmount: "Offer amount",
    paybackAmount: "Payback amount",
    totalRemit: "Total remit",
    remittance: "Daily payment",
    rate: "Rate",
    specifiedPercentage: "Specified percentage",
    term: "Term",
    frequency: "Frequency",
    netToMerchant: "Net to merchant",
    underwritingFees: "Underwriting fees",
    repayPerPeriod: "Repay per period",
} as const;

/** Short display labels for Deal Review (avoids repeated "Principal", "Security", etc.). */
const DEAL_REVIEW_CANONICAL_LABEL_BY_ID: Record<string, string> = {
    addendum_dated: "Date",
    addendum_dated_principal_owner: "Owner",
    addendum_dated_principal_business: "Business",
    addendum_dated_business_location: "Business location",
    addendum_dated_principal_state: "State",
    addendum_dated_principal_owner_amount: PLATFORM_LABEL.offerAmount,
    addendum_dated_principal_owner_amount2: PLATFORM_LABEL.paybackAmount,
    addendum_dated_principal_owner1_name: "Owner 1 — Name",
    addendum_dated_principal_owner1_date: "Owner 1 — Date",
    addendum_dated_principal_owner2_name: "Owner 2 — Name",
    addendum_dated_principal_owner2_date: "Owner 2 — Date",
    addendum_legal_name_1: "Legal name (slot 1)",
    addendum_legal_name_2: "Legal name (slot 2)",
    addendum_legal_name_3: "Legal name (slot 3)",
    addendum_dba_1: "DBA (slot 1)",
    addendum_dba_2: "DBA (slot 2)",
    addendum_dba_3: "DBA (slot 3)",
    addendum_type_of_entity_1: "Entity type (slot 1)",
    addendum_type_of_entity_2: "Entity type (slot 2)",
    addendum_type_of_entity_3: "Entity type (slot 3)",
    addendum_ein_1: "EIN (slot 1)",
    addendum_ein_2: "EIN (slot 2)",
    addendum_ein_3: "EIN (slot 3)",
    addendum_mailing_address_1: "Mailing (slot 1)",
    addendum_mailing_address_2: "Mailing (slot 2)",
    addendum_mailing_address_3: "Mailing (slot 3)",
    security_business_name: "Business name",
    security_tax_ein: "Tax ID / EIN",
    security_doing_business_as: "DBA",
    security_business_address: "Street",
    security_business_address_city: "City",
    security_business_address_state: "State",
    security_business_address_zip: "ZIP",
    security_guarantor: "Guarantor",
    guaranty_client_name: "Name",
    guaranty_ss: "SSN",
    guaranty_ss_driver_license: "Driver license",
    guaranty_owner1_name: "Owner 1 — Name",
    guaranty_owner1_ss: "Owner 1 — SSN",
    guaranty_owner1_driver_license: "Owner 1 — License",
    guaranty_owner2_name: "Owner 2 — Name",
    guaranty_owner2_ss: "Owner 2 — SSN",
    guaranty_owner2_driver_license: "Owner 2 — License",
    guaranty_guarantor1_name: "Guarantor 1 — Name",
    guaranty_guarantor1_ss: "Guarantor 1 — SSN",
    guaranty_guarantor1_driver_license: "Guarantor 1 — License",
    guaranty_guarantor2_name: "Guarantor 2 — Name",
    guaranty_guarantor2_ss: "Guarantor 2 — SSN",
    guaranty_guarantor2_driver_license: "Guarantor 2 — License",
    net_to_merchant: PLATFORM_LABEL.netToMerchant,
    netfundprovided: PLATFORM_LABEL.netToMerchant,
    appendix_underwriting_fees: PLATFORM_LABEL.underwritingFees,
    underwriter_fee: PLATFORM_LABEL.underwritingFees,
    underwriterfee: PLATFORM_LABEL.underwritingFees,
    underwriter_fees: PLATFORM_LABEL.underwritingFees,
    appendix_client_name: "Client name",
    exhibit_owner_name: "Exhibit owner",
    exhibit_a_value_1: "Exhibit A company 1",
    exhibit_a_value_2: "Exhibit A company 2",
    exhibit_a_value_3: "Exhibit A company 3",
    exhibit_a_value_4: "Exhibit A company 4",
    exhibit_a_value_5: "Exhibit A company 5",
    exhibit_a_value_6: "Exhibit A company 6",
    exhibit_a_value_7: "Exhibit A company 7",
    exhibit_a_value_8: "Exhibit A company 8",
    exhibit_a_value_9: "Exhibit A company 9",
    exhibit_a_value_10: "Exhibit A company 10",
    state_of_inc: "State of incorporation",
    doing_business_as: "DBA",
    federal_tax_id_ein: "EIN",
    agreement_date: "Agreement date",
    client_legal_name: "Legal name",
    client_email: "Email",
    client_phone: "Phone",
    client_name: "Name",
    owner1_guarantor_name: "Owner 1 — Guarantor",
    merchant2_name: "Merchant 2 — Name",
    owner2_guarantor_name: "Merchant 2 — Name",
    business_address: "Street",
    business_address_city: "City",
    business_address_state: "State",
    business_address_zip: "ZIP",
    business_address_contract: "Street",
    business_address_contract_city: "City",
    business_address_contract_state: "State",
    business_address_contract_zip: "ZIP",
    purchase_price: PLATFORM_LABEL.paybackAmount,
    purchase_amount: PLATFORM_LABEL.offerAmount,
    purchase_percent: PLATFORM_LABEL.specifiedPercentage,
    remittance: PLATFORM_LABEL.remittance,
    frequency: PLATFORM_LABEL.frequency,
    paymentterms: PLATFORM_LABEL.frequency,
    authorization_application: "Client name",
    authorization_client_bank_name: "Bank name",
    authorization_client_bank_routing: "Routing number",
    authorization_client_bank_account: "Account number",
    authorization_client_name: "Business name",
    authorization_client_name_print: "Business name (print)",
    authorization_client_tax_id: "Tax ID / EIN",
    authorization_client_date: "Date",
    authorized_business_phone: "Business phone",
    ach_authorization_account_holder_name: "Name",
    ach_authorization_account_holder_dba: "DBA",
    ach_authorization_account_holder_phone: "Phone",
    ach_authorization_account_holder_address: "Street",
    ach_authorization_account_holder_city: "City",
    ach_authorization_account_holder_state: "State",
    ach_authorization_account_holder_zip: "ZIP",
    ach_authorization_account_holder_bank_name: "Bank name",
    ach_authorization_account_holder_bank_branch_city: "Branch city",
    ach_authorization_account_holder_bank_state: "Bank state",
    ach_authorization_account_holder_bank_zip: "Bank ZIP",
    ach_authorization_account_holder_bank_routing_number: "Routing number",
    ach_authorization_account_holder_bank_account_number: "Account number",
    ach_authorization_account_holder_bank_transaction_fee: "Transaction fee",
    ach_authorization_account_holder_date: "Date",
    ach_authorization_concent_account_holder_name: "Name",
    ach_authorization_concent_account_holder_date: "Date",
    guarantor_address: "Street",
    guarantor_address_city: "City",
    guarantor_address_state: "State",
    guarantor_address_zip: "ZIP",
    guarantor_email: "Email",
    guarantor_phone: "Phone",
};

function resolveDealReviewDisplayLabel(id: string, label: string, category: string): string {
    const norm = normalizeDealReviewFieldId(id);
    const canonical = DEAL_REVIEW_CANONICAL_LABEL_BY_ID[norm];
    if (canonical) return canonical;

    const inferred = inferDealReviewLabelFromFieldId(id, category);
    if (inferred) return inferred;

    const prefixes = DEAL_REVIEW_LABEL_PREFIXES_BY_CATEGORY[category] ?? [];
    let row = formatDealReviewFieldLabel(label, category);
    row = stripLeadingLabelPrefixes(row, prefixes);
    row = row.replace(/\bowner\s*(\d+)\b/gi, "Owner $1");
    row = row.replace(/\s+/g, " ").trim();
    return row || label || id;
}

/**
 * When a subsection heading is shown (e.g. "Consent"), drop the same word from the row label
 * (e.g. "Consent — Name" → "Name"). Only strips `Subsection — label` patterns, not "Bank name".
 */
export function stripDealReviewSubsectionFromLabel(
    label: string,
    subsection: string | null | undefined,
): string {
    const sub = String(subsection ?? "").trim();
    const row = String(label ?? "").trim();
    if (!sub || !row) return row;

    const escaped = escapeRegExpForNote(sub);
    const dashRe = new RegExp(`^${escaped}\\s*[—–-]\\s*`, "i");
    const dashStripped = row.replace(dashRe, "").trim();
    if (dashStripped && dashStripped !== row) {
        return dashStripped.charAt(0).toUpperCase() + dashStripped.slice(1);
    }

    const spaceRe = new RegExp(`^${escaped}\\s+`, "i");
    const spaceStripped = row.replace(spaceRe, "").trim();
    if (spaceStripped && spaceStripped !== row) {
        return spaceStripped.charAt(0).toUpperCase() + spaceStripped.slice(1);
    }

    return row;
}

function normalizeDealReviewDedupeValue(value: string): string {
    return String(value ?? "")
        .trim()
        .replace(/[$,\s]/g, "")
        .toLowerCase();
}

/**
 * Deal Review summary: hide empty values, shorten labels, one row per section+label.
 * DocuSign prefill still uses the full field list from `buildContractPrefillFieldsFromApplication`.
 */
export function prepareDealReviewPrefillDisplay(fields: ContractPrefillField[]): ContractPrefillField[] {
    const seenSection = new Set<string>();
    const seenGlobal = new Set<string>();
    /** Last row wins for labels like "Underwriting fees" (multiple DocuSign ids share one display row). */
    const globalDedupeLastBySection = new Map<string, ContractPrefillField>();
    const out: ContractPrefillField[] = [];
    for (const f of fields) {
        if (!str(f.value)) continue;
        const category = categorizeDealReviewPrefillFieldId(f.id);
        const subsection = dealReviewPrefillSubsection(f.id, category);
        let displayLabel = resolveDealReviewDisplayLabel(f.id, f.label, category);
        if (category === "Addendum" && !subsection) {
            displayLabel = stripLeadingLabelPrefixes(displayLabel, ["Addendum"]);
        }
        displayLabel = stripDealReviewSubsectionFromLabel(displayLabel, subsection);
        const labelKey = displayLabel.toLowerCase();
        const dedupeKey = `${category}|${labelKey}`;

        if (DEAL_REVIEW_GLOBAL_DEDUPE_LABELS.has(labelKey)) {
            const globalKey = `${labelKey}|${normalizeDealReviewDedupeValue(f.value)}`;
            if (seenGlobal.has(globalKey)) continue;
            seenGlobal.add(globalKey);
            globalDedupeLastBySection.set(dedupeKey, {
                id: f.id,
                label: displayLabel,
                value: f.value,
            });
            continue;
        }

        if (seenSection.has(dedupeKey)) continue;

        seenSection.add(dedupeKey);
        out.push({ id: f.id, label: displayLabel, value: f.value });
    }
    for (const [dedupeKey, field] of globalDedupeLastBySection) {
        if (seenSection.has(dedupeKey)) continue;
        seenSection.add(dedupeKey);
        out.push(field);
    }
    return out;
}

/** @deprecated Prefer `prepareDealReviewPrefillDisplay` for Deal Review UI. */
export function dedupePrefillFieldsByLabel(fields: ContractPrefillField[]): ContractPrefillField[] {
    return prepareDealReviewPrefillDisplay(fields);
}

/** When merged args still carry serialized decimals (`1400.00000000000`), coerce numeric fields to truncated two decimals. */
function coerceNumericPrefillMoneyStrings(obj: Partial<BuildContractPrefillFieldsArgs>): void {
    for (const key of MONEY_STRING_PREFILL_KEYS) {
        const raw = obj[key];
        if (raw === undefined || raw === null || raw === "") continue;
        if (coerceToFiniteNumber(raw) === undefined) continue;
        const formatted = truncateDecimalPrefill(raw);
        if (formatted !== "") (obj as Record<string, unknown>)[key] = formatted;
    }
}

function ownerFullName(first?: unknown, last?: unknown): string {
    return `${str(first)} ${str(last)}`.trim();
}

/**
 * Application detail API maps Prisma `Client` to nested `client.business` / `client.owner`.
 * Prefill must read both that shape and legacy flat fields (`businessName`, `ownerFirstName`, …).
 */
function resolveClientForPrefill(anyApp: Record<string, any> | null | undefined) {
    const c = anyApp?.client || {};
    const biz = c.business || {};
    const addr = biz.address || {};
    const own = c.owner || {};

    return {
        businessName: str(c.businessName || biz.name),
        dba: str(c.dba || biz.dba),
        businessAddress1: str(c.businessAddress1 || addr.address1),
        businessAddress2: str(c.businessAddress2 || addr.address2),
        businessCity: str(c.businessCity || addr.city || c.city),
        businessState: str(c.businessState || addr.state || c.state),
        businessZip: str(c.businessZipCode || addr.zipCode || c.zip),
        incorporationState: str(
            c.businessIncorporationState ||
            biz.incorporationState ||
            c.stateOfIncorporation ||
            c.businessState ||
            addr.state,
        ),
        entityType: str(c.businessEntityType || biz.businessEntityType),
        ein: str(c.businessEinNumber || c.federalTaxIdEin || c.ein || biz.einNumber),
        businessEmail: str(c.businessEmail || biz.email),
        businessPhone: str(c.businessNumber || c.businessPhone || biz.number || c.phone),
        ownerFirst: str(c.ownerFirstName || own.firstName),
        ownerLast: str(c.ownerLastName || own.lastName),
        ownerEmail: str(c.ownerEmail || own.email),
        ownerPhone: str(c.ownerMobileNumber || own.mobileNumber || c.ownerPhone),
        ownerSsn: str(c.ownerSsn || own.ssn),
        ownerDriverLicense: str(c.driverLicense || own.driverLicense),
    };
}

/** Legacy application `note` section for BoldSign prefill (superseded by `Contract.contractPrefillOverrides`). */
export const CONTRACT_PREFILL_OVERRIDES_SECTION = "CONTRACT_PREFILL_OVERRIDES";

/** Normalize `Contract.contractPrefillOverrides` (Prisma Json) for merge into prefill. */
export function normalizeContractPrefillOverrides(
    raw: unknown,
): Partial<BuildContractPrefillFieldsArgs> | null {
    if (raw == null) return null;
    if (typeof raw !== "object" || Array.isArray(raw)) return null;
    return raw as Partial<BuildContractPrefillFieldsArgs>;
}

/**
 * Contract table columns updated alongside `contractPrefillOverrides`
 * (keep in sync with in-house-crm-be `CONTRACT_EXTRA_STRING_FIELDS`).
 */
export const CONTRACT_PREFILL_COLUMN_SYNC_KEYS = [
    "legalName",
    "clientName",
    "entityType",
    "remittance",
    "clientEmail",
    "clientPhone",
    "customerName",
    "purchasePrice",
    "purchaseAmount",
    "purchasePercent",
    "securityTaxEin",
    "businessAddress",
    "businessAddressCity",
    "businessAddressState",
    "businessAddressZip",
    "doingBusinessAs",
    "federalTaxIdEin",
    "exhibitOwnerName",
    "appendixClientName",
    "appendixUnderwritingFees",
    "authorizationApplication",
    "authorizationClientDate",
    "authorizationClientName",
    "authorizationClientNamePrint",
    "authorizationClientTaxId",
    "authorizationClientBankName",
    "authorizationClientBankAccount",
    "authorizationClientBankRouting",
    "authorizedBusinessPhone",
    "businessAddressContract",
    "businessAddressContractCity",
    "businessAddressContractState",
    "businessAddressContractZip",
    "securityBusinessName",
    "securityDoingBusinessAs",
    "securityBusinessAddress",
    "securityBusinessAddressCity",
    "securityBusinessAddressState",
    "securityBusinessAddressZip",
    "securityGuarantor",
] as const satisfies readonly (keyof BuildContractPrefillFieldsArgs)[];

const APPENDIX_FEE_OVERRIDE_ALIASES = [
    "appendixUnderwritingFees",
    "appendix_underwriting_fees",
    "underwriter_fee",
    "underwriterfee",
    "underwriter_fees",
] as const;

/** Map legacy / DocuSign fee field keys onto `appendixUnderwritingFees` for merge + display. */
function expandPrefillOverrideAliases(
    partial: Partial<BuildContractPrefillFieldsArgs>,
): Partial<BuildContractPrefillFieldsArgs> {
    const out = { ...partial } as Record<string, unknown>;
    if (str(out.appendixUnderwritingFees)) return out as Partial<BuildContractPrefillFieldsArgs>;
    for (const key of APPENDIX_FEE_OVERRIDE_ALIASES) {
        const fee = str(out[key]);
        if (fee) {
            out.appendixUnderwritingFees = fee;
            break;
        }
    }
    return out as Partial<BuildContractPrefillFieldsArgs>;
}

/** Merge prefill override layers; later layers win (used for Deal Review + DocuSign build). */
export function mergeContractPrefillOverrideLayers(
    ...layers: Array<Partial<BuildContractPrefillFieldsArgs> | null | undefined>
): Partial<BuildContractPrefillFieldsArgs> {
    const out: Partial<BuildContractPrefillFieldsArgs> = {};
    for (const layer of layers) {
        if (!layer || typeof layer !== "object" || Array.isArray(layer)) continue;
        for (const [key, val] of Object.entries(layer)) {
            if (val === undefined || val === null) continue;
            if (!str(val)) continue;
            if (
                (APPENDIX_FEE_OVERRIDE_ALIASES as readonly string[]).includes(key) &&
                isZeroMoneyPrefillValue(val)
            ) {
                continue;
            }
            (out as Record<string, unknown>)[key] = val;
        }
    }
    return expandPrefillOverrideAliases(out);
}

/**
 * Deal Review shows one "Underwriting fees" row; ensure every fee field id reflects saved overrides
 * (edit prefill may store `appendixUnderwritingFees` while DocuSign ids use `underwriter_fee`, etc.).
 */
export function overlaySavedAppendixFeeOnPrefillFields(
    fields: ContractPrefillField[],
    overrides: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
    sources?: NetToMerchantPrefillSources,
): ContractPrefillField[] {
    if (sources?.offerDecision || sources?.application) {
        // Keep the live-offer fee already computed onto the fields; don't re-apply the stale
        // saved override. Resolve from the explicit OfferDecision or the application's offer/terms.
        const liveFee = str(
            getLiveOfferPrefillArgs(sources.application ?? null, {
                offerDecision: sources.offerDecision ?? null,
                contract: sources.contract ?? null,
            }).appendixUnderwritingFees,
        );
        if (liveFee && !isZeroMoneyPrefillValue(liveFee)) {
            const value = normalizePrefillValueForUsFormat("underwriter_fee", liveFee);
            return fields.map((f) =>
                DEAL_REVIEW_APPENDIX_FEE_IDS.has(normalizeDealReviewFieldId(f.id))
                    ? { ...f, value }
                    : f,
            );
        }
    }

    const normalized = mergeContractPrefillOverrideLayers(overrides);
    const rawFee = str(normalized.appendixUnderwritingFees);
    if (!rawFee) return fields;

    const purchase = sources
        ? resolveOfferAmountDollarsForUnderwritingFees({
              ...sources,
              prefill: normalized,
          })
        : undefined;
    const displayFee = resolveAppendixUnderwritingFeesDisplay(rawFee, purchase) || rawFee;
    const value = normalizePrefillValueForUsFormat("underwriter_fee", displayFee);

    return fields.map((f) =>
        DEAL_REVIEW_APPENDIX_FEE_IDS.has(normalizeDealReviewFieldId(f.id))
            ? { ...f, value }
            : f,
    );
}

/** Map saved prefill to `updateContract` scalar fields so Deal Review / DocuSign see edits. */
export function contractPrefillToContractColumnUpdate(
    partial: Partial<BuildContractPrefillFieldsArgs>,
): Record<string, string | null> {
    const out: Record<string, string | null> = {};
    for (const key of CONTRACT_PREFILL_COLUMN_SYNC_KEYS) {
        if (!(key in partial)) continue;
        const v = str((partial as Record<string, unknown>)[key]);
        out[key] = v || null;
    }
    return out;
}

function escapeRegExpForNote(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Parse a `[SECTION]\n{json}` block from an application note (same pattern as ContractTab). */
export function parseNoteStructuredSection<T>(note: string, sectionLabel: string): T | null {
    if (!note || !sectionLabel) return null;
    const sectionPattern = new RegExp(
        `\\[${escapeRegExpForNote(sectionLabel)}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\n\\[[^\\]]+\\]\\s*\\n|$)`,
        "g",
    );
    let match: RegExpExecArray | null = null;
    let lastPayload = "";
    while ((match = sectionPattern.exec(note)) !== null) {
        lastPayload = String(match[1] || "").trim();
    }
    if (!lastPayload) return null;
    try {
        return JSON.parse(lastPayload) as T;
    } catch {
        return null;
    }
}

export function upsertNoteStructuredSection(
    existingNote: string,
    sectionLabel: string,
    payload: unknown,
): string {
    const serialized = JSON.stringify(payload);
    const blockRegex = new RegExp(
        `(?:\\n\\n)?\\[${escapeRegExpForNote(sectionLabel)}\\]\\s*\\n[\\s\\S]*?(?=(?:\\n\\n\\[[^\\]]+\\]\\s*\\n)|$)`,
        "g",
    );
    const stripped = String(existingNote || "").replace(blockRegex, "").trim();
    const nextBlock = `[${sectionLabel}]\n${serialized}`;
    return stripped ? `${stripped}\n\n${nextBlock}` : nextBlock;
}

/** Later groups only fill ids not already present (application / client wins on overlap). */
function mergePrefillFieldsPreferFirst(...groups: ContractPrefillField[][]): ContractPrefillField[] {
    const map = new Map<string, ContractPrefillField>();
    for (const group of groups) {
        for (const f of group) {
            const val = str(f.value);
            if (!val || map.has(f.id)) continue;
            map.set(f.id, { id: f.id, label: f.label, value: val });
        }
    }
    return Array.from(map.values());
}

/** Merchant legal / business name (DBA/legal entity fields — not owner personal name). */
export function resolveMerchantBusinessNameForPrefill(
    row: Record<string, unknown> | null | undefined,
    clientArgs?: Partial<BuildContractPrefillFieldsArgs>,
): string {
    const r = row ?? {};
    return (
        str(r.legalName) ||
        str(r.securityBusinessName) ||
        str(clientArgs?.legalName) ||
        ""
    );
}

/** Business / legal merchant name for state disclosure recipient and client name fields. */
export function resolveDisclosureBusinessNamePrefill(
    contract?: Record<string, unknown> | null,
    application?: unknown,
): string {
    const c = contract ?? {};
    const overrides = normalizeContractPrefillOverrides(c.contractPrefillOverrides) ?? {};
    const appPrefill = getApplicationClientPrefillArgs(application);
    const linkedClient = (c.client ?? null) as Record<string, unknown> | null;
    const app = (application ?? {}) as Record<string, unknown>;
    const bi = app.businessInfo;
    const firstBi = Array.isArray(bi) ? bi[0] : bi;
    const biRecord = (firstBi ?? {}) as Record<string, unknown>;

    return (
        str(c.legalName) ||
        str(overrides.legalName) ||
        str(appPrefill.legalName) ||
        str(linkedClient?.businessName) ||
        str(c.securityBusinessName) ||
        str(overrides.securityBusinessName) ||
        str(appPrefill.securityBusinessName) ||
        str(c.doingBusinessAs) ||
        str(overrides.doingBusinessAs) ||
        str(appPrefill.doingBusinessAs) ||
        str(biRecord.clientBusinessName) ||
        resolveMerchantBusinessNameForPrefill(c, appPrefill) ||
        ""
    );
}

/** Owner / signer personal name for ACH account holder fields. */
export function resolveDisclosureOwnerNamePrefill(
    contract?: Record<string, unknown> | null,
    application?: unknown,
): string {
    const c = contract ?? {};
    const appPrefill = getApplicationClientPrefillArgs(application);
    const primaryOwner = getApplicationPrimaryRecipientName(application);
    const ownerFromApp =
        primaryOwner && primaryOwner !== "Signer" ? primaryOwner : "";
    return (
        str(c.customerName) ||
        ownerFromApp ||
        str(appPrefill.customerName) ||
        str(c.owner1GuarantorName) ||
        str(c.exhibitOwnerName) ||
        str(appPrefill.exhibitOwnerName) ||
        str(c.clientName) ||
        str(appPrefill.clientName) ||
        ""
    );
}

/** Appendix / guaranty / main contract / ACH authorization signatory tabs — owner name, not business legal name. */
export function resolvePersonalClientNamePrefill(
    row: Record<string, unknown>,
    field:
        | "clientName"
        | "appendixClientName"
        | "guarantyClientName"
        | "authorizationClientName"
        | "authorizationClientNamePrint",
): string {
    const customer = str(row.customerName);
    const legal = str(row.legalName);
    const saved = str(row[field]);
    if (customer && (!saved || (legal && saved === legal))) return customer;
    return saved || customer;
}

/** Prefer owner name when legacy rows stored business legal name in ACH holder fields. */
export function resolveAchAccountHolderNamePrefill(
    row: Record<string, unknown>,
    field: "achAuthorizationAccountHolderName" | "achAuthorizationConcentAccountHolderName",
): string {
    const owner1 =
        str(row.owner1GuarantorName) ||
        str(row.customerName) ||
        str(row.clientName) ||
        str(row.guarantyOwner1Name) ||
        str(row.guarantyGuarantor1Name) ||
        str(row.guarantyClientName);
    const saved = str(row[field]);
    const businessLike = new Set(
        [
            str(row.legalName),
            str(row.securityBusinessName),
            str(row.authorizationApplication),
            str(row.doingBusinessAs),
            resolveMerchantBusinessNameForPrefill(row),
        ].filter(Boolean),
    );
    if (owner1 && (!saved || businessLike.has(saved))) return owner1;
    return saved || owner1;
}

/** ACH account holder tabs use owner 1 personal name, not merchant legal / business name. */
function applyAchAccountHolderOwnerNamePrefill(
    partial: Partial<BuildContractPrefillFieldsArgs>,
): void {
    const owner1 =
        str(partial.owner1GuarantorName) ||
        str(partial.guarantyOwner1Name) ||
        str(partial.guarantyGuarantor1Name) ||
        str(partial.guarantyClientName) ||
        str(partial.customerName) ||
        str(partial.clientName);
    if (!owner1) return;

    const businessLike = new Set(
        [
            str(partial.legalName),
            str(partial.securityBusinessName),
            str(partial.authorizationApplication),
            str(partial.doingBusinessAs),
            resolveMerchantBusinessNameForPrefill(partial),
        ].filter(Boolean),
    );

    const holder = str(partial.achAuthorizationAccountHolderName);
    const consent = str(partial.achAuthorizationConcentAccountHolderName);
    if (!holder || businessLike.has(holder)) {
        partial.achAuthorizationAccountHolderName = owner1;
    }
    if (!consent || businessLike.has(consent)) {
        partial.achAuthorizationConcentAccountHolderName = owner1;
    }
}

function exhibitValuesToPrefillPartial(
    row: Record<string, unknown> | null | undefined,
): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    const overrides = normalizeContractPrefillOverrides(row.contractPrefillOverrides) ?? {};
    const out: Partial<BuildContractPrefillFieldsArgs> = {};
    for (const key of EXHIBIT_A_VALUE_FIELD_KEYS) {
        const v = str(row[key]) || str(overrides[key]);
        if (v) (out as Record<string, string>)[key] = v;
    }
    return out;
}

/** Do not hydrate specified purchase % from offer factor/rate — user must enter in prefill form. */
function stripImpliedPurchasePercentFromOffer(
    partial: Partial<BuildContractPrefillFieldsArgs>,
    offerDecision?: Record<string, unknown> | null,
): void {
    const saved = str(partial.purchasePercent);
    if (!saved) {
        partial.purchasePercent = "";
        return;
    }
    const odRoot = offerDecision ?? null;
    const odEff = offerDecisionEffectiveRecordForNet(odRoot ?? undefined) ?? odRoot;
    const implied = [
        odRoot?.rate,
        odRoot?.factorRate,
        odEff?.rate,
        odEff?.factorRate,
    ]
        .map((v) => truncateDecimalPrefill(v))
        .filter(Boolean);
    if (implied.some((c) => c === saved || c === truncateDecimalPrefill(Number(saved)))) {
        partial.purchasePercent = "";
    }
}

function achRowToPrefillPartial(
    row: Record<string, unknown> | null | undefined,
    ownerName?: string,
): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    const accountHolderName = ownerName || str(row.accountHolderName);
    const out: Partial<BuildContractPrefillFieldsArgs> = {
        achAuthorizationAccountHolderName: accountHolderName,
        achAuthorizationConcentAccountHolderName: accountHolderName,
        achAuthorizationConcentAccountHolderDate:
            prefillIsoDate(row.createdAt) || str(row.createdAt),
        achAuthorizationAccountHolderDba: str(row.dba),
        achAuthorizationAccountHolderPhone: str(row.phone),
        achAuthorizationAccountHolderAddress: str(row.address),
        achAuthorizationAccountHolderCity: str(row.city),
        achAuthorizationAccountHolderState: str(row.state),
        achAuthorizationAccountHolderZip: str(row.zip),
        achAuthorizationAccountHolderBankName: str(row.bankName),
        achAuthorizationAccountHolderBankBranchCity: str(row.bankBranchCity),
        achAuthorizationAccountHolderBankState: str(row.bankState),
        achAuthorizationAccountHolderBankZip: str(row.bankZip),
        achAuthorizationAccountHolderBankRoutingNumber: str(row.routingNumber),
        achAuthorizationAccountHolderBankAccountNumber: str(row.accountNumber),
        achAuthorizationBankPortalWebsite: str(row.ach_authorization_bank_portal_website) || str(row.achAuthorizationBankPortalWebsite),
        achAuthorizationUsername: str(row.ach_authorization_username) || str(row.achAuthorizationUsername),
        achAuthorizationPassword: str(row.ach_authorization_password) || str(row.achAuthorizationPassword),
        achAuthorizationSecurityQuestion1: str(row.ach_authorization_security_question1) || str(row.achAuthorizationSecurityQuestion1),
        achAuthorizationSecurityAnswer1: str(row.ach_authorization_security_answer1) || str(row.achAuthorizationSecurityAnswer1),
        achAuthorizationSecurityQuestion2: str(row.ach_authorization_security_question2) || str(row.achAuthorizationSecurityQuestion2),
        achAuthorizationSecurityAnswer2: str(row.ach_authorization_security_answer2) || str(row.achAuthorizationSecurityAnswer2),
        achAuthorizationSecurityQuestion3: str(row.ach_authorization_security_question3) || str(row.achAuthorizationSecurityQuestion3),
        achAuthorizationSecurityAnswer3: str(row.ach_authorization_security_answer3) || str(row.achAuthorizationSecurityAnswer3),
        achAuthorizationOtherInfomation: str(row.ach_authorization_other_infomation) || str(row.achAuthorizationOtherInfomation),
        achAuthorizationReferenceName1: str(row.ach_authorization_reference_name1) || str(row.achAuthorizationReferenceName1),
        achAuthorizationReferenceNumber1: str(row.ach_authorization_reference_number_1) || str(row.achAuthorizationReferenceNumber1),
        achAuthorizationReferenceRelationship1: str(row.ach_authorization_reference_relationship1) || str(row.achAuthorizationReferenceRelationship1),
        achAuthorizationReferenceName2: str(row.ach_authorization_reference_name2) || str(row.achAuthorizationReferenceName2),
        achAuthorizationReferenceNumber2: str(row.ach_authorization_reference_number2) || str(row.achAuthorizationReferenceNumber2),
        achAuthorizationReferenceRelationship2: str(row.ach_authorization_reference_relationship2) || str(row.achAuthorizationReferenceRelationship2),
        achAuthorizationReferenceName3: str(row.ach_authorization_reference_name3) || str(row.achAuthorizationReferenceName3),
        achAuthorizationReferenceNumber3: str(row.ach_authorization_reference_number3) || str(row.achAuthorizationReferenceNumber3),
        achAuthorizationReferenceRelationship3: str(row.ach_authorization_reference_relationship3) || str(row.achAuthorizationReferenceRelationship3),
    };
    return out;
}

function addendumRowToPrefillPartial(row: Record<string, unknown> | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    return {
        addendumDated: prefillIsoDate(row.addendumDated) || str(row.addendumDated),
        addendumDatedPrincipalOwner: str(row.principalOwner),
        addendumDatedPrincipalBusiness: str(row.principalBusiness),
        addendumDatedBusinessLocation: str(row.businessLocation),
        addendumDatedPrincipalState: str(row.principalState),
        addendumDatedPrincipalOwnerAmount: truncateDecimalPrefill(row.principalOwnerAmount1) || str(row.principalOwnerAmount1),
        addendumDatedPrincipalOwnerAmount2: truncateDecimalPrefill(row.principalOwnerAmount2) || str(row.principalOwnerAmount2),
        addendumDatedPrincipalOwner1Name: str(row.principalOwner1Name),
        addendumDatedPrincipalOwner1Date: prefillIsoDate(row.principalOwner1Date) || str(row.principalOwner1Date),
        addendumDatedPrincipalOwner2Name: str(row.principalOwner2Name),
        addendumDatedPrincipalOwner2Date: prefillIsoDate(row.principalOwner2Date) || str(row.principalOwner2Date),
    };
}

function addendumSlotExtraFields(row: Record<string, unknown> | null | undefined): ContractPrefillField[] {
    if (!row) return [];
    const out: ContractPrefillField[] = [];
    for (const s of [1, 2, 3] as const) {
        out.push(...mapIds([`addendum_legal_name_${s}`], `Addendum Legal Name ${s}`, str(row[`legalName${s}`])));
        out.push(...mapIds([`addendum_dba_${s}`], `Addendum DBA ${s}`, str(row[`dba${s}`])));
        out.push(
            ...mapIds(
                [`addendum_type_of_entity_${s}`],
                `Addendum Entity Type ${s}`,
                normalizeEntityTypeForBoldSignDropdown(str(row[`typeOfEntity${s}`])),
            ),
        );
        out.push(...mapIds([`addendum_ein_${s}`], `Addendum EIN ${s}`, str(row[`ein${s}`])));
        out.push(...mapIds([`addendum_mailing_address_${s}`], `Addendum Mailing ${s}`, str(row[`mailingAddress${s}`])));
    }
    return out;
}

function epoExtraFields(row: Record<string, unknown> | null | undefined): ContractPrefillField[] {
    if (!row) return [];
    const out: ContractPrefillField[] = [];
    for (const s of [1, 2, 3] as const) {
        const rawAmt = row[`amountReceived${s}`];
        const v = truncateDecimalPrefill(rawAmt) || str(rawAmt);
        out.push(...mapIds([`epo_amount_received_${s}`], `EPO Amount ${s}`, v));
        out.push(...mapIds([`epo_received_date_${s}`], `EPO Date ${s}`, str(row[`receivedDate${s}`])));
    }
    return out;
}

/** Mirror each linked owner into Client / Owner / Guarantor slots for that index (1 or 2). */
export function applyOwnerRowsToPrefillMerge(
    partial: Partial<BuildContractPrefillFieldsArgs>,
    rows: Record<string, unknown>[] | null | undefined,
): void {
    if (!rows?.length) return;

    const o1 = rows[0];
    if (o1) {
        const n1 = ownerFullName(o1.firstName, o1.lastName);
        const ssn1 = str(o1.ssnNumber ?? o1.ssn);
        const dl1 = str(o1.driverLicenseNumber ?? o1.driverLicense);
        if (n1 || ssn1 || dl1 || partyEmail(o1)) {
            if (n1) {
                partial.owner1GuarantorName = n1;
                partial.guarantyClientName = n1;
                partial.guarantyOwner1Name = n1;
                partial.guarantyGuarantor1Name = n1;
                partial.securityGuarantor = n1;
                partial.exhibitOwnerName = n1;
            }
            if (ssn1) {
                partial.guarantySs = ssn1;
                partial.guarantyOwner1Ss = ssn1;
                partial.guarantyGuarantor1Ss = ssn1;
            }
            if (dl1) {
                partial.guarantySsDriverLicense = dl1;
                partial.guarantyOwner1DriverLicense = dl1;
                partial.guarantyGuarantor1DriverLicense = dl1;
            }
        }
    }

    const o2 = rows[1];
    const n2 = ownerFullName(o2?.firstName, o2?.lastName);
    const hasSecondOwner = Boolean(
        o2 && isDistinctPartyRow(o1, o2) && (partyEmail(o2) || n2),
    );
    if (hasSecondOwner) {
        const ssn2 = str(o2?.ssnNumber ?? o2?.ssn);
        const dl2 = str(o2?.driverLicenseNumber ?? o2?.driverLicense);
        if (n2) {
            partial.merchant2Name = n2;
            partial.owner2GuarantorName = n2;
            partial.guarantyOwner2Name = n2;
            partial.guarantyGuarantor2Name = n2;
        }
        if (ssn2) {
            partial.guarantyOwner2Ss = ssn2;
            partial.guarantyGuarantor2Ss = ssn2;
        }
        if (dl2) {
            partial.guarantyOwner2DriverLicense = dl2;
            partial.guarantyGuarantor2DriverLicense = dl2;
        }
        const n1 = ownerFullName(rows[0]?.firstName, rows[0]?.lastName);
        partial.exhibitOwnerName = n1 || n2;
    }
}

function ownersToPrefillPartial(rows: Record<string, unknown>[] | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    const out: Partial<BuildContractPrefillFieldsArgs> = {};
    applyOwnerRowsToPrefillMerge(out, rows);
    return out;
}

/** Keep owner 1 / client 1 / guarantor 1 (and owner 2 party) names and IDs aligned on the contract. */
function syncPartyIdentityPrefillFields(partial: Partial<BuildContractPrefillFieldsArgs>): void {
    const party1Name =
        str(partial.owner1GuarantorName) ||
        str(partial.guarantyOwner1Name) ||
        str(partial.guarantyGuarantor1Name) ||
        str(partial.guarantyClientName) ||
        str(partial.clientName) ||
        str(partial.customerName) ||
        str(partial.securityGuarantor);
    if (party1Name) {
        partial.owner1GuarantorName = party1Name;
        partial.guarantyOwner1Name = party1Name;
        partial.guarantyGuarantor1Name = party1Name;
        partial.guarantyClientName = party1Name;
        partial.securityGuarantor = party1Name;
        partial.clientName = party1Name;
    }

    const party1Ss =
        str(partial.guarantyOwner1Ss) ||
        str(partial.guarantyGuarantor1Ss) ||
        str(partial.guarantySs);
    if (party1Ss) {
        partial.guarantyOwner1Ss = party1Ss;
        partial.guarantyGuarantor1Ss = party1Ss;
        partial.guarantySs = party1Ss;
    }

    const party1Dl =
        str(partial.guarantyOwner1DriverLicense) ||
        str(partial.guarantyGuarantor1DriverLicense) ||
        str(partial.guarantySsDriverLicense);
    if (party1Dl) {
        partial.guarantyOwner1DriverLicense = party1Dl;
        partial.guarantyGuarantor1DriverLicense = party1Dl;
        partial.guarantySsDriverLicense = party1Dl;
    }

    const party2Name =
        str(partial.owner2GuarantorName) ||
        str(partial.merchant2Name) ||
        str(partial.guarantyOwner2Name) ||
        str(partial.guarantyGuarantor2Name);
    if (party2Name) {
        partial.owner2GuarantorName = party2Name;
        partial.merchant2Name = party2Name;
        partial.guarantyOwner2Name = party2Name;
        partial.guarantyGuarantor2Name = party2Name;
    }

    const party2Ss =
        str(partial.guarantyOwner2Ss) || str(partial.guarantyGuarantor2Ss);
    if (party2Ss) {
        partial.guarantyOwner2Ss = party2Ss;
        partial.guarantyGuarantor2Ss = party2Ss;
    }

    const party2Dl =
        str(partial.guarantyOwner2DriverLicense) ||
        str(partial.guarantyGuarantor2DriverLicense);
    if (party2Dl) {
        partial.guarantyOwner2DriverLicense = party2Dl;
        partial.guarantyGuarantor2DriverLicense = party2Dl;
    }
}

function partyEmail(row: Record<string, unknown> | undefined): string {
    return String(row?.email ?? "").trim();
}

function guarantorsToPrefillPartial(rows: Record<string, unknown>[] | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    if (!rows?.length) return {};
    const g1 = rows[0];
    const g2 = rows[1];
    const g1Name = ownerFullName(g1?.firstName, g1?.lastName);
    const g1Ss = str(g1?.ssnNumber ?? g1?.ssn);
    const g1Dl = str(g1?.driverLicenseNumber ?? g1?.driverLicense);
    const out: Partial<BuildContractPrefillFieldsArgs> = {
        securityGuarantor: g1Name,
        guarantorEmail: str(g1?.email),
        guarantorPhone: str(g1?.phone),
        guarantorAddress: str(g1?.address),
        guarantorAddressCity: str(g1?.city),
        guarantorAddressState: str(g1?.state),
        guarantorAddressZip: str(g1?.zip),
        guarantyGuarantor1Name: g1Name,
        guarantyGuarantor1Ss: g1Ss,
        guarantyGuarantor1DriverLicense: g1Dl,
    };
    if (g2 && isDistinctPartyRow(g1, g2) && (partyEmail(g2) || g2.firstName || g2.lastName)) {
        const g2Name = ownerFullName(g2?.firstName, g2?.lastName);
        const g2Ss = str(g2?.ssnNumber ?? g2?.ssn);
        const g2Dl = str(g2?.driverLicenseNumber ?? g2?.driverLicense);
        out.guarantyGuarantor2Name = g2Name;
        out.guarantyGuarantor2Ss = g2Ss;
        out.guarantyGuarantor2DriverLicense = g2Dl;
        out.merchant2Name = g2Name;
        out.owner2GuarantorName = g2Name;
        out.guarantyOwner2Name = g2Name;
        out.guarantyOwner2Ss = g2Ss;
        out.guarantyOwner2DriverLicense = g2Dl;
    }
    return out;
}

/** ACH authorization `authorization_application` tab — client name, not CRM application id or business legal name. */
function resolveAuthorizationApplicationPrefill(row: Record<string, unknown>): string {
    const clientName =
        str(row.customerName) || str(row.clientName) || str(row.legalName);
    const raw = str(row.authorizationApplication);
    if (!raw) return clientName;
    if (/^\d+$/.test(raw.replace(/\s/g, ""))) return clientName || raw;
    const legal = str(row.legalName);
    const customer = str(row.customerName);
    if (customer && legal && raw === legal) return customer;
    return raw;
}

// contractRowToPrefillPartial prefill of feilds happens here

function contractRowToPrefillPartial(row: Record<string, unknown> | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    const offer = (row.offer ?? null) as Record<string, unknown> | null;
    const paymentBank = (row.paymentBank ?? null) as Record<string, unknown> | null;

    const purchaseAmount = (() => {
        const offerAmountNum = resolveOfferAdvanceDollars(
            getOfferDecisionPrefillContext({ contract: row, offerDecision: offer }),
            { contract: row, offerDecision: offer },
        );
        if (offerAmountNum > 0) return truncateDecimalPrefill(offerAmountNum);
        return firstTruncateDecimal(row.approvedAmount, row.purchaseAmount);
    })();
    const paybackNum = resolvePaybackAmountDollars({ contract: row, offerDecision: offer });
    const purchasePrice =
        paybackNum !== undefined
            ? truncateDecimalPrefill(paybackNum)
            : firstTruncateDecimal(row.purchasePrice, row.totalAmount);
    const purchasePercent = str(row.purchasePercent);
    const netToMerchant =
        str(row.netToMerchant) ||
        formatNetToMerchantPrefillValue(
            computeNetToMerchantDollars({ contract: row, offerDecision: offer }),
        );
    const frequency =
        str(row.frequency) ||
        resolveOfferFrequencyLabel({ contract: row, offerDecision: offer });

    const agreementDatePrefill =
        prefillIsoDate(row.agreementDate) ||
        prefillIsoDate(row.contractDate) ||
        prefillIsoDate(row.createdAt);
    let authorizationDate = prefillIsoDate(row.authorizationClientDate);
    if (!authorizationDate && agreementDatePrefill) authorizationDate = agreementDatePrefill;

    let authBankName = str(row.authorizationClientBankName);
    if (!authBankName) authBankName = str(paymentBank?.bankName);

    const base = applySplitAddressStreetFields({
        customerName: str(row.customerName),
        entityType: str(row.entityType),
        legalName: str(row.legalName),
        doingBusinessAs: str(row.doingBusinessAs),
        businessAddress: str(row.businessAddress),
        federalTaxIdEin: str(row.federalTaxIdEin),
        agreementDate: agreementDatePrefill || str(row.agreementDate),
        state: str(row.state),
        businessAddressCity: str(row.businessAddressCity),
        businessAddressState: str(row.businessAddressState),
        businessAddressZip: str(row.businessAddressZip),
        businessAddressContract: str(row.businessAddressContract),
        businessAddressContractCity: str(row.businessAddressContractCity),
        businessAddressContractState: str(row.businessAddressContractState),
        businessAddressContractZip: str(row.businessAddressContractZip),
        clientEmail: str(row.clientEmail),
        clientPhone: str(row.clientPhone),
        purchasePrice,
        purchaseAmount,
        purchasePercent,
        frequency,
        netToMerchant,
        remittance:
            resolveRemittancePrefillValue({ contract: row, offerDecision: offer }),
        clientName: resolvePersonalClientNamePrefill(row, "clientName"),
        securityBusinessName: str(row.securityBusinessName),
        securityTaxEin: str(row.securityTaxEin),
        securityDoingBusinessAs: str(row.securityDoingBusinessAs),
        securityBusinessAddress: str(row.securityBusinessAddress),
        securityBusinessAddressCity: str(row.securityBusinessAddressCity),
        securityBusinessAddressState: str(row.securityBusinessAddressState),
        securityBusinessAddressZip: str(row.securityBusinessAddressZip),
        securityGuarantor: str(row.securityGuarantor),
        appendixUnderwritingFees:
            resolvePlatformOfferFeesForPrefill({
                contract: row,
                offerDecision: offer,
            }) ||
            (() => {
                const rowRaw = str(row.appendixUnderwritingFees);
                const offerRaw = str(resolveOfferDecisionFeesRaw(offer));
                const raw = rowRaw || offerRaw;
                if (!rowRaw && offerRaw) {
                    return formatOfferDecisionFeesDollarsForPrefill(offerRaw);
                }
                const prefillOverrides = normalizeContractPrefillOverrides(
                    row.contractPrefillOverrides,
                );
                return resolveAppendixUnderwritingFeesDisplay(
                    raw,
                    resolveOfferAmountDollarsForUnderwritingFees({
                        contract: row,
                        offerDecision: offer,
                        prefill: prefillOverrides ?? undefined,
                    }),
                );
            })(),
        appendixClientName: resolvePersonalClientNamePrefill(row, "appendixClientName"),
        guarantyClientName: resolvePersonalClientNamePrefill(row, "guarantyClientName"),
        authorizationApplication: resolveAuthorizationApplicationPrefill(row),
        authorizationClientBankName: authBankName,
        authorizationClientBankRouting: str(row.authorizationClientBankRouting),
        authorizationClientBankAccount: str(row.authorizationClientBankAccount),
        authorizationClientName: resolvePersonalClientNamePrefill(row, "authorizationClientName"),
        authorizationClientNamePrint: resolvePersonalClientNamePrefill(
            row,
            "authorizationClientNamePrint",
        ),
        authorizationClientTaxId: str(row.authorizationClientTaxId),
        authorizationClientDate: authorizationDate,
        authorizedBusinessPhone: str(row.authorizedBusinessPhone),
        owner1GuarantorName: str(row.owner1GuarantorName),

        achAuthorizationAccountHolderName: resolveAchAccountHolderNamePrefill(
            row,
            "achAuthorizationAccountHolderName",
        ),
        achAuthorizationConcentAccountHolderName: resolveAchAccountHolderNamePrefill(
            row,
            "achAuthorizationConcentAccountHolderName",
        ),
        achAuthorizationConcentAccountHolderDate: prefillIsoDate(
            row.achAuthorizationConcentAccountHolderDate,
        ) || str(row.achAuthorizationConcentAccountHolderDate),

        achAuthorizationBankPortalWebsite: str(row.achAuthorizationBankPortalWebsite),
        achAuthorizationUsername: str(row.achAuthorizationUsername),
        achAuthorizationPassword: str(row.achAuthorizationPassword),
        achAuthorizationSecurityQuestion1: str(row.achAuthorizationSecurityQuestion1),
        achAuthorizationSecurityQuestion2: str(row.achAuthorizationSecurityQuestion2),
        achAuthorizationSecurityQuestion3: str(row.achAuthorizationSecurityQuestion3),
        achAuthorizationSecurityAnswer1: str(row.achAuthorizationSecurityAnswer1),
        achAuthorizationSecurityAnswer2: str(row.achAuthorizationSecurityAnswer2),
        achAuthorizationSecurityAnswer3: str(row.achAuthorizationSecurityAnswer3),
        achAuthorizationOtherInfomation: str(row.achAuthorizationOtherInfomation),

        achAuthorizationReferenceName1: str(row.achAuthorizationReferenceName1),
        achAuthorizationReferenceNumber1: str(row.achAuthorizationReferenceNumber1),
        achAuthorizationReferenceRelationship1: str(row.achAuthorizationReferenceRelationship1),

        achAuthorizationReferenceName2: str(row.achAuthorizationReferenceName2),
        achAuthorizationReferenceNumber2: str(row.achAuthorizationReferenceNumber2),
        achAuthorizationReferenceRelationship2: str(row.achAuthorizationReferenceRelationship2),

        achAuthorizationReferenceName3: str(row.achAuthorizationReferenceName3),
        achAuthorizationReferenceNumber3: str(row.achAuthorizationReferenceNumber3),
        achAuthorizationReferenceRelationship3: str(row.achAuthorizationReferenceRelationship3),
        exhibitOwnerName: str(row.exhibitOwnerName),
    });
    return base;
}

/** Saved manual prefill edits on the contract row (applied after live application/offer merge). */
function contractPrefillOverridesFromRow(
    row: Record<string, unknown> | null | undefined,
): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    return normalizeContractPrefillOverrides(row.contractPrefillOverrides) ?? {};
}

/**
 * Offer-derived deal-terms money keys that must always reflect the live OfferDecision when one
 * is available. Saved contract prefill overrides (a snapshot taken when the contract was last
 * edited) must not clobber these — otherwise updating the offer in the CRM leaves the contract
 * modal showing the old amounts.
 */
export const LIVE_OFFER_MONEY_PREFILL_KEYS: ReadonlyArray<keyof BuildContractPrefillFieldsArgs> = [
    "purchaseAmount",
    "purchasePrice",
    "remittance",
    "frequency",
    "netToMerchant",
    "appendixUnderwritingFees",
    "achAuthorizationAccountHolderBankTransactionFee",
    "achAuthorizationAccountHolderBankNumberOfTransactions",
    // Addendum principal block mirrors the same deal — keep its offer/payback in sync with the live offer.
    "addendumDatedPrincipalOwnerAmount",
    "addendumDatedPrincipalOwnerAmount2",
];

/** Pick only the non-empty offer-derived money values from a live-offer prefill partial. */
function pickLiveOfferMoneyOverlay(
    liveOfferArgs: Partial<BuildContractPrefillFieldsArgs>,
): Partial<BuildContractPrefillFieldsArgs> {
    const overlay: Partial<BuildContractPrefillFieldsArgs> = {};
    for (const key of LIVE_OFFER_MONEY_PREFILL_KEYS) {
        const value = str((liveOfferArgs as Record<string, unknown>)[key]);
        if (value && !isZeroMoneyPrefillValue(value)) {
            (overlay as Record<string, unknown>)[key] = value;
        }
    }
    return overlay;
}

/**
 * True when a live offer source is available for syncing deal-terms money fields.
 *
 * The contract modal/summary fetches the OfferDecision separately, but that request can be
 * null/stale (e.g. nothing was re-approved, or the GET is racing) while the freshly loaded
 * application still carries the updated offer in `offerDecision`/`OfferDecision`/`termsOffers`.
 * Gating the sync only on the explicit `offerDecision` argument made the contract fall back to
 * the stale saved-override snapshot in that case. Treat any of these as a valid live source so
 * the updated CRM offer always wins over cached values.
 */
export function hasLiveOfferPrefillSource(
    anyApp: unknown,
    offerDecision: Record<string, unknown> | null | undefined,
): boolean {
    if (offerDecision && typeof offerDecision === "object") return true;
    const app = (anyApp ?? null) as Record<string, unknown> | null;
    if (app?.offerDecision && typeof app.offerDecision === "object") return true;
    if (app?.OfferDecision && typeof app.OfferDecision === "object") return true;
    const termsRaw = app?.termsOffers;
    if (Array.isArray(termsRaw) && termsRaw.length > 0) return true;
    if (termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)) return true;
    return false;
}

/** Remove stale saved-override snapshots for offer-derived fields when a live offer exists. */
export function stripStaleOfferOverridesFromPersisted(
    persisted: Partial<BuildContractPrefillFieldsArgs> | null | undefined,
    offerDecision: Record<string, unknown> | null | undefined,
    anyApp?: unknown,
): Partial<BuildContractPrefillFieldsArgs> {
    const base = { ...(persisted ?? {}) } as Record<string, unknown>;
    if (!hasLiveOfferPrefillSource(anyApp, offerDecision)) {
        return base as Partial<BuildContractPrefillFieldsArgs>;
    }
    for (const key of LIVE_OFFER_MONEY_PREFILL_KEYS) {
        delete base[key];
    }
    for (const key of APPENDIX_FEE_OVERRIDE_ALIASES) {
        delete base[key];
    }
    return base as Partial<BuildContractPrefillFieldsArgs>;
}

/** Re-apply live OfferDecision values on top of a prefill partial (deal terms + fees + ACH payment rows). */
export function applyLiveOfferSyncToPrefillPartial(
    partial: Partial<BuildContractPrefillFieldsArgs>,
    anyApp: unknown,
    offerDecision: Record<string, unknown> | null | undefined,
): Partial<BuildContractPrefillFieldsArgs> {
    if (!hasLiveOfferPrefillSource(anyApp, offerDecision)) return partial;
    const liveArgs = getLiveOfferPrefillArgs(anyApp, { offerDecision: offerDecision ?? null });
    return { ...partial, ...pickLiveOfferMoneyOverlay(liveArgs) };
}

/** Offer / banking fields recomputed from the current OfferDecision (not stale contract scalars). */
function getLiveOfferPrefillArgs(
    anyApp: unknown,
    options?: {
        offerDecision?: Record<string, unknown> | null;
        contract?: Record<string, unknown> | null;
    },
): Partial<BuildContractPrefillFieldsArgs> {
    const app = (anyApp ?? null) as Record<string, unknown> | null;
    const odRoot =
        options?.offerDecision ??
        (app?.offerDecision as Record<string, unknown> | undefined) ??
        (app?.OfferDecision as Record<string, unknown> | undefined) ??
        null;
    const odEff = offerDecisionEffectiveRecordForNet(odRoot ?? undefined) ?? odRoot;
    const termsRaw = app?.termsOffers;
    const terms0 =
        Array.isArray(termsRaw) && termsRaw[0] && typeof termsRaw[0] === "object"
            ? (termsRaw[0] as Record<string, unknown>)
            : termsRaw && typeof termsRaw === "object" && !Array.isArray(termsRaw)
              ? (termsRaw as Record<string, unknown>)
              : null;

    const sources: NetToMerchantPrefillSources = {
        application: app ?? undefined,
        contract: options?.contract ?? null,
        offerDecision: odRoot,
    };

    const remittance = resolveRemittancePrefillValue(sources);
    const offerAmountNum = resolveOfferAdvanceDollars(
        { app: app ?? undefined, contract: null, odRoot, odEff, terms0 },
        sources,
    );
    const offerAmount =
        offerAmountNum > 0
            ? truncateDecimalPrefill(offerAmountNum)
            : firstTruncateDecimal(odEff?.offer, odRoot?.offer, terms0?.approvedAmount);
    const paybackNum = resolvePaybackAmountDollars(sources);
    const paybackAmount =
        paybackNum !== undefined ? truncateDecimalPrefill(paybackNum) : "";

    return {
        purchaseAmount: offerAmount,
        purchasePrice: paybackAmount,
        frequency: resolveOfferFrequencyLabel(sources),
        remittance,
        netToMerchant: formatNetToMerchantPrefillValue(computeNetToMerchantDollars(sources)),
        appendixUnderwritingFees: resolvePlatformOfferFeesForPrefill(sources),
        achAuthorizationAccountHolderBankTransactionFee: remittance,
        achAuthorizationAccountHolderBankNumberOfTransactions:
            resolveNumberOfPaymentsPrefillValue(sources),
        // Addendum principal block uses the same fresh offer/payback as the main deal terms.
        addendumDatedPrincipalOwnerAmount: offerAmount,
        addendumDatedPrincipalOwnerAmount2: paybackAmount,
    };
}

export function getApplicationClientPrefillArgs(anyApp: unknown): Partial<BuildContractPrefillFieldsArgs> {
    if (!anyApp) return {};
    const a = anyApp as Record<string, any>;
    const r = resolveClientForPrefill(a);
    const bi = Array.isArray(a?.businessInfo) ? a.businessInfo[0] : a?.businessInfo;
    const customerName = getApplicationPrimaryRecipientName(anyApp);
    const legalName = String(r.businessName || bi?.clientBusinessName || customerName || "");
    const street = [r.businessAddress1, r.businessAddress2].filter(Boolean).join(", ").trim();
    const businessAddress = String(street || bi?.businessAddress || "");
    const businessCity = String(r.businessCity || bi?.city || "");
    const businessState = String(r.businessState || bi?.state || "");
    const businessZip = String(r.businessZip || bi?.zip || "");
    const taxEin = String(r.ein || bi?.federalTaxIdEin || "");
    const phone = String(r.businessPhone || r.ownerPhone || "");
    const client = a?.client || {};
    const relatedOwners = client.owners;
    const o0 =
        Array.isArray(relatedOwners) && relatedOwners.length
            ? (relatedOwners[0] as Record<string, unknown>)
            : null;
    const own = (client.owner ?? {}) as Record<string, unknown>;
    const ownerFirst = str(
        o0?.firstName ?? client.ownerFirstName ?? own.firstName ?? r.ownerFirst,
    );
    const ownerLast = str(o0?.lastName ?? client.ownerLastName ?? own.lastName ?? r.ownerLast);
    const ownerSsn = str(o0?.ssn ?? client.ownerSsn ?? own.ssn ?? r.ownerSsn);
    const ownerDriverLicense = str(
        o0?.driverLicense ?? client.driverLicense ?? own.driverLicense ?? r.ownerDriverLicense,
    );
    const ownerName = ownerFullName(ownerFirst, ownerLast) || customerName;
    return {
        customerName,
        legalName,
        clientName: customerName || legalName,
        appendixClientName: customerName || legalName,
        exhibitOwnerName: ownerName || customerName || legalName,
        doingBusinessAs: String(r.dba || bi?.dba || ""),
        securityDoingBusinessAs: String(r.dba || bi?.dba || ""),
        achAuthorizationAccountHolderDba: String(r.dba || bi?.dba || ""),
        businessAddress,
        businessAddressCity: businessCity,
        businessAddressState: businessState,
        businessAddressZip: businessZip,
        businessAddressContract: businessAddress,
        businessAddressContractCity: businessCity,
        businessAddressContractState: businessState,
        businessAddressContractZip: businessZip,
        state: String(
            r.incorporationState || bi?.stateOfIncorporation || "",
        ),
        entityType: String(r.entityType || bi?.entityType || ""),
        federalTaxIdEin: taxEin,
        authorizationClientTaxId: taxEin,
        securityTaxEin: taxEin,
        securityBusinessName: legalName,
        securityBusinessAddress: businessAddress,
        securityBusinessAddressCity: businessCity,
        securityBusinessAddressState: businessState,
        securityBusinessAddressZip: businessZip,
        achAuthorizationAccountHolderAddress: businessAddress,
        achAuthorizationAccountHolderCity: businessCity,
        achAuthorizationAccountHolderState: businessState,
        achAuthorizationAccountHolderZip: businessZip,
        securityGuarantor: ownerName || customerName || legalName,
        clientEmail: String(
            r.businessEmail ||
            r.ownerEmail ||
            bi?.clientBusinessEmail ||
            getApplicationPrimaryRecipientEmail(anyApp) ||
            "",
        ),
        clientPhone: phone,
        authorizedBusinessPhone: phone,
        guarantyClientName: ownerName,
        guarantySs: ownerSsn,
        guarantySsDriverLicense: ownerDriverLicense,
        guarantyOwner1Name: ownerName,
        guarantyOwner1Ss: ownerSsn,
        guarantyOwner1DriverLicense: ownerDriverLicense,
        guarantyGuarantor1Name: ownerName,
        guarantyGuarantor1Ss: ownerSsn,
        guarantyGuarantor1DriverLicense: ownerDriverLicense,
        owner1GuarantorName: ownerName,
        authorizationApplication: customerName || legalName,
        authorizationClientName: customerName || "",
        authorizationClientNamePrint: customerName || "",
        achAuthorizationAccountHolderName: ownerName || customerName || "",
        achAuthorizationConcentAccountHolderName: ownerName || customerName || "",
    };
}

export function getApplicationPrimaryRecipientEmail(anyApp: unknown): string {
    if (!anyApp) return "";
    const a = anyApp as Record<string, any>;
    const r = resolveClientForPrefill(a);
    const bi = Array.isArray(a?.businessInfo) ? a.businessInfo[0] : a?.businessInfo;
    return (
        r.businessEmail ||
        r.ownerEmail ||
        String(bi?.clientBusinessEmail || "").trim() ||
        ""
    );
}

/**
 * Signer email on BoldSign / recipient UI: persisted `Contract.clientEmail` wins, then `Client.businessEmail`, then `ownerEmail`.
 */
export function getSignerRecipientEmailForContract(
    application: unknown,
    contract: Record<string, unknown> | null | undefined,
): string {
    const c = contract ?? null;
    const fromContract = String(
        (c as Record<string, unknown>)?.clientEmail ??
        (c as Record<string, unknown>)?.client_email ??
        "",
    ).trim();
    if (fromContract) return fromContract;

    const app = application as Record<string, unknown> | null | undefined;
    const nestedClient =
        (c as { application?: { client?: Record<string, unknown> } } | null)?.application
            ?.client ?? app?.client;
    if (nestedClient && typeof nestedClient === "object") {
        const nestedEmail = String(
            (nestedClient as { businessEmail?: string; ownerEmail?: string }).businessEmail ||
                (nestedClient as { businessEmail?: string; ownerEmail?: string }).ownerEmail ||
                "",
        ).trim();
        if (nestedEmail) return nestedEmail;
    }

    return String(getApplicationPrimaryRecipientEmail(application) || "").trim();
}

export type DocuSignSignerEmailSource =
    | "contract"
    | "client"
    | "template"
    | "owner"
    | null;

/**
 * Email used to send the DocuSign signing request (not CC).
 * CC chips in the footer are separate — they do not count as the signer.
 */
export function resolveEffectiveDocuSignSignerEmail(
    application: unknown,
    contract: Record<string, unknown> | null | undefined,
    templateRoleRows?: Array<Record<string, unknown>>,
    extraSignerEmails?: string[],
): { email: string; source: DocuSignSignerEmailSource } {
    const fromContractField = String(
        (contract as Record<string, unknown> | null)?.clientEmail ??
            (contract as Record<string, unknown> | null)?.client_email ??
            "",
    ).trim();
    const crm = getSignerRecipientEmailForContract(application, contract).trim();
    if (crm) {
        return {
            email: crm,
            source: fromContractField ? "contract" : "client",
        };
    }

    for (const row of templateRoleRows ?? []) {
        const label = String(
            (row as { roleName?: string; signerRole?: string }).roleName ??
                (row as { roleName?: string; signerRole?: string }).signerRole ??
                "",
        )
            .trim()
            .toLowerCase();
        if (label.includes("guarantor")) continue;
        const templateEmail = String(
            (row as { signerEmail?: string; email?: string; SignerEmail?: string }).signerEmail ??
                (row as { signerEmail?: string; email?: string }).email ??
                (row as { SignerEmail?: string }).SignerEmail ??
                "",
        ).trim();
        if (templateEmail) {
            return { email: templateEmail, source: "template" };
        }
    }

    for (const raw of extraSignerEmails ?? []) {
        const em = String(raw || "").trim();
        if (em) return { email: em, source: "owner" };
    }

    return { email: "", source: null };
}

export function getApplicationPrimaryRecipientName(anyApp: unknown): string {
    if (!anyApp) return "Signer";
    const r = resolveClientForPrefill(anyApp as Record<string, any>);
    const combined = `${r.ownerFirst} ${r.ownerLast}`.trim();
    if (combined) return combined;
    const email = getApplicationPrimaryRecipientEmail(anyApp);
    return email ? email.split("@")[0] : "Signer";
}

/** Names and address for Balance Transfer Sheet and similar addenda (contract columns + application client). */
export function resolveBalanceTransferMerchantContext(
    contract: Record<string, unknown> | null | undefined,
    application: unknown,
    sctx?: { recipientName?: string; recipientAddress?: string },
): {
    clientName: string;
    businessName: string;
    clientDba: string;
    clientNameBy: string;
    clientLegalName: string;
    physicalAddress: string;
} {
    const c = contract ?? {};
    const overrides = normalizeContractPrefillOverrides(c.contractPrefillOverrides) ?? {};
    const app = getApplicationClientPrefillArgs(application);
    const ownerName = getApplicationPrimaryRecipientName(application);
    const recipientFallback = str(sctx?.recipientName);
    const linkedClient = (c.client ?? null) as Record<string, unknown> | null;
    const linkedBusinessName = str(linkedClient?.businessName);
    const linkedOwnerName = ownerFullName(linkedClient?.ownerFirstName, linkedClient?.ownerLastName);

    const businessName =
        str(c.legalName) ||
        str(overrides.legalName) ||
        str(app.legalName) ||
        linkedBusinessName ||
        str(c.clientName) ||
        str(overrides.clientName) ||
        str(app.clientName);

    const clientDba =
        str(c.doingBusinessAs) ||
        str(overrides.doingBusinessAs) ||
        str(app.doingBusinessAs) ||
        str(c.securityDoingBusinessAs) ||
        str(overrides.securityDoingBusinessAs);

    const businessNorm = businessName.trim().toLowerCase();
    const isDistinctFromBusiness = (name: string) => {
        const n = name.trim();
        if (!n) return false;
        return !businessNorm || n.toLowerCase() !== businessNorm;
    };

    const ownerMerchantCandidates = [
        ownerName,
        linkedOwnerName,
        str(c.customerName),
        str(overrides.customerName),
        str(c.owner1GuarantorName),
        str(overrides.owner1GuarantorName),
        str(c.guarantyClientName),
        str(overrides.guarantyClientName),
        str(c.guarantyOwner1Name),
        str(overrides.guarantyOwner1Name),
        recipientFallback,
    ];

    const clientNameBy =
        ownerMerchantCandidates.find(isDistinctFromBusiness) || ownerName || recipientFallback;

    const clientName =
        str(c.clientName) ||
        str(overrides.clientName) ||
        str(app.clientName) ||
        clientNameBy ||
        recipientFallback;

    const clientLegalName =
        ownerMerchantCandidates.find(isDistinctFromBusiness) || ownerName || linkedOwnerName || recipientFallback;

    const contractLine = [
        str(c.businessAddress) || str(overrides.businessAddress),
        str(c.businessAddressCity) || str(overrides.businessAddressCity),
        str(c.businessAddressState) || str(overrides.businessAddressState),
        str(c.businessAddressZip) || str(overrides.businessAddressZip),
    ]
        .filter(Boolean)
        .join(", ");
    const appLine = [
        str(app.businessAddress),
        str(app.businessAddressCity),
        str(app.businessAddressState),
        str(app.businessAddressZip),
    ]
        .filter(Boolean)
        .join(", ");
    const physicalAddress = contractLine || appLine || str(sctx?.recipientAddress);

    return {
        clientName,
        businessName,
        clientDba,
        clientNameBy,
        clientLegalName,
        physicalAddress,
    };
}

/**
 * Flat map of client + ACH/addendum/owners/guarantors used for the BoldSign prefill edit form
 * and for building core prefill fields (client wins over record-backed keys on overlap).
 */
export function getContractPrefillEditDefaultsFromApplication(
    anyApp: unknown,
    options?: {
        agreementDate?: string;
        contractRecords?: ContractPrefillContractRecords;
        offerDecision?: Record<string, unknown> | null;
    },
): Partial<BuildContractPrefillFieldsArgs> & { customerName: string; agreementDate: string } {
    const rec = options?.contractRecords;
    const clientArgs = getApplicationClientPrefillArgs(anyApp);
    const contractPartial = contractRowToPrefillPartial(rec?.contract ?? null);
    const resolvedOwners = resolveOwnerRowsForContractPrefill(anyApp, rec?.owners ?? null);
    const ownerNameForAch =
        resolveDisclosureOwnerNamePrefill(rec?.contract ?? null, anyApp) ||
        ownerFullName(resolvedOwners[0]?.firstName, resolvedOwners[0]?.lastName);
    const recordPartial: Partial<BuildContractPrefillFieldsArgs> = {
        ...contractPartial,
        ...exhibitValuesToPrefillPartial(rec?.contract ?? null),
        ...achRowToPrefillPartial(rec?.ach ?? null, ownerNameForAch),
        ...addendumRowToPrefillPartial(rec?.addendum ?? null),
        ...guarantorsToPrefillPartial(rec?.guarantors ?? null),
        ...ownersToPrefillPartial(resolvedOwners),
        ...bankDetailRowToPrefillPartial(rec?.bankDetail ?? null),
    };
    const contractOverrides = contractPrefillOverridesFromRow(rec?.contract ?? null);
    const liveOfferArgs = getLiveOfferPrefillArgs(anyApp, {
        offerDecision: options?.offerDecision ?? null,
        contract: rec?.contract ?? null,
    });
    const ownerFallback = ownerFullName(resolvedOwners[0]?.firstName, resolvedOwners[0]?.lastName);
    const customerName =
        str(clientArgs.customerName) ||
        str(contractPartial.customerName) ||
        ownerFallback ||
        "Signer";
    const agreementDate =
        str(options?.agreementDate) ||
        prefillIsoDate(contractPartial.agreementDate) ||
        str(contractPartial.agreementDate);

    const resolverRow = {
        ...recordPartial,
        ...clientArgs,
        ...liveOfferArgs,
        customerName,
    };

    const mergedBase = applySplitAddressStreetFields({
        /** Contract ACH/addendum rows, then live application + offer, then saved manual overrides. */
        ...mergeNonemptyPrefillPartial(
            mergeNonemptyPrefillPartial(
                mergeNonemptyPrefillPartial(recordPartial, clientArgs),
                liveOfferArgs,
            ),
            contractOverrides,
        ),
        customerName,
        agreementDate,
        clientName: resolvePersonalClientNamePrefill(resolverRow, "clientName"),
        appendixClientName: resolvePersonalClientNamePrefill(resolverRow, "appendixClientName"),
        guarantyClientName: resolvePersonalClientNamePrefill(resolverRow, "guarantyClientName"),
        authorizationApplication: resolveAuthorizationApplicationPrefill(resolverRow),
        authorizationClientName: resolvePersonalClientNamePrefill(
            resolverRow,
            "authorizationClientName",
        ),
        authorizationClientNamePrint: resolvePersonalClientNamePrefill(
            resolverRow,
            "authorizationClientNamePrint",
        ),
    });
    const mergedBeforeFees = applyLiveBankDetailsToPrefillMerge(recordPartial, mergedBase);
    if (hasLiveOfferPrefillSource(anyApp, options?.offerDecision)) {
        // Live offer wins over the stale saved-override snapshot for offer-derived money fields.
        Object.assign(mergedBeforeFees, pickLiveOfferMoneyOverlay(liveOfferArgs));
    }
    stripImpliedPurchasePercentFromOffer(mergedBeforeFees, options?.offerDecision ?? null);
    if (!str(mergedBeforeFees.authorizationClientName) && customerName) {
        mergedBeforeFees.authorizationClientName = customerName;
        mergedBeforeFees.authorizationClientNamePrint = customerName;
    }
    if (!str(mergedBeforeFees.authorizationApplication) && customerName) {
        mergedBeforeFees.authorizationApplication = customerName;
    }

    syncPartyIdentityPrefillFields(mergedBeforeFees);
    applyAchAccountHolderOwnerNamePrefill(mergedBeforeFees);

    const activeOwnerCount = resolveActiveOwnerCount({
        owners: resolvedOwners,
        guarantors: rec?.guarantors ?? null,
    });
    clearParty2PrefillPartial(
        mergedBeforeFees as Record<string, unknown>,
        activeOwnerCount,
    );

    return applyAppendixUnderwritingFeesAmount(mergedBeforeFees, {
        application: anyApp as Record<string, unknown> | undefined,
        contract: rec?.contract ?? null,
        offerDecision: options?.offerDecision ?? null,
        prefill: mergedBeforeFees,
    }) as Partial<BuildContractPrefillFieldsArgs> & {
        customerName: string;
        agreementDate: string;
    };
}

/**
 * Maps application client/businessInfo plus optional contract rows (ACH, addendum, EPO, owners, guarantors)
 * into BoldSign-style prefill rows.
 *
 * @param options.overrides Optional saved overrides (from `Contract.contractPrefillOverrides` or legacy application `note`); merged on top of computed defaults.
 */
export function buildContractPrefillFieldsFromApplication(
    anyApp: unknown,
    options?: {
        agreementDate?: string;
        contractRecords?: ContractPrefillContractRecords;
        overrides?: Partial<BuildContractPrefillFieldsArgs> | null;
        offerDecision?: Record<string, unknown> | null;
        mainContractLayoutKey?: string | null;
        funderName?: string | null;
        contractState?: string | null;
    },
): ContractPrefillField[] {
    const rec = options?.contractRecords;
    const savedOverrides = mergeContractPrefillOverrideLayers(options?.overrides);
    const liveOfferAvailable = hasLiveOfferPrefillSource(anyApp, options?.offerDecision);
    if (liveOfferAvailable) {
        // Always reflect the freshly fetched offer for deal-terms money fields; drop the stale
        // saved-override snapshot so an updated CRM offer is shown on the contract modal.
        for (const key of LIVE_OFFER_MONEY_PREFILL_KEYS) {
            delete (savedOverrides as Record<string, unknown>)[key];
        }
        for (const key of APPENDIX_FEE_OVERRIDE_ALIASES) {
            delete (savedOverrides as Record<string, unknown>)[key];
        }
    }
    const baseMerged = getContractPrefillEditDefaultsFromApplication(anyApp, {
        agreementDate: options?.agreementDate,
        contractRecords: rec,
        offerDecision: options?.offerDecision ?? null,
    });
    const merged: Partial<BuildContractPrefillFieldsArgs> = applyLiveBankDetailsToPrefillMerge(
        baseMerged,
        {
            ...baseMerged,
            ...savedOverrides,
        },
    );
    if (!str(merged.frequency)) {
        const freq = resolveOfferFrequencyLabel({
            application: anyApp as Record<string, unknown> | undefined,
            contract: rec?.contract ?? null,
            offerDecision: options?.offerDecision ?? null,
        });
        if (freq) merged.frequency = freq;
    }
    if (!str(merged.remittance)) {
        const remit = resolveRemittancePrefillValue({
            application: anyApp as Record<string, unknown> | undefined,
            contract: rec?.contract ?? null,
            offerDecision: options?.offerDecision ?? null,
        });
        if (remit) merged.remittance = remit;
    }
    if (!str(merged.netToMerchant)) {
        const computed = formatNetToMerchantPrefillValue(
            computeNetToMerchantDollars({
                application: anyApp as Record<string, unknown> | undefined,
                contract: rec?.contract ?? null,
                offerDecision: options?.offerDecision ?? null,
            }),
        );
        if (computed) merged.netToMerchant = computed;
    }
    const moneySources: NetToMerchantPrefillSources = {
        application: anyApp as Record<string, unknown> | undefined,
        contract: rec?.contract ?? null,
        offerDecision: options?.offerDecision ?? null,
        prefill: merged,
    };
    Object.assign(merged, finalizeContractPrefillMoneyFields(merged, moneySources));
    if (Object.keys(savedOverrides).length > 0) {
        const patch = { ...savedOverrides } as Record<string, unknown>;
        for (const key of [
            ...LIVE_OFFER_MONEY_PREFILL_KEYS,
            ...APPENDIX_FEE_OVERRIDE_ALIASES,
        ]) {
            const patchValue = patch[key];
            if (!str(patchValue) || isZeroMoneyPrefillValue(patchValue)) {
                delete patch[key];
            }
        }
        Object.assign(merged, patch);
    }
    if (liveOfferAvailable) {
        Object.assign(
            merged,
            pickLiveOfferMoneyOverlay(
                getLiveOfferPrefillArgs(anyApp, {
                    offerDecision: options?.offerDecision ?? null,
                    contract: rec?.contract ?? null,
                }),
            ),
        );
    }
    coerceNumericPrefillMoneyStrings(merged);
    if (!str(savedOverrides.purchasePercent)) {
        stripImpliedPurchasePercentFromOffer(merged, options?.offerDecision ?? null);
    }
    const customerName = str(merged.customerName) || "Signer";
    const legalName = str(merged.legalName) || customerName;

    const definedOnly = Object.fromEntries(
        Object.entries(merged).filter(([, v]) => v !== undefined && v !== null),
    ) as Partial<BuildContractPrefillFieldsArgs>;

    const fromCore = buildContractPrefillFields({
        ...(definedOnly as BuildContractPrefillFieldsArgs),
        customerName,
        agreementDate: str(merged.agreementDate ?? ""),
        legalName,
    });

    const prefillFields = mergePrefillFieldsPreferFirst(
        fromCore,
        addendumSlotExtraFields(rec?.addendum ?? null),
        epoExtraFields(rec?.epo ?? null),
    );
    if (
        shouldApplyAllianceBridgeContractPrefill({
            layoutKey: options?.mainContractLayoutKey,
            funderName:
                String(options?.funderName ?? "").trim() ||
                str(rec?.contract?.funder) ||
                str((rec?.contract as { funderName?: string } | null)?.funderName),
            state:
                String(options?.contractState ?? "").trim() ||
                str(rec?.contract?.state),
        })
    ) {
        return applyAllianceBridgeContractPrefillToFields(prefillFields, moneySources);
    }
    return prefillFields;
}
