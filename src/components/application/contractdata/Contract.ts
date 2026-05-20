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

    clientName?: string;
    owner1GuarantorName?: string;
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
}

const FIELD_IDS = {
    agreementDate: ["agreement_date"],
    legalName: ["client_legal_name"],
    stateOfInc: ["state_of_inc"],
    doingBusinessAs: ["doing_business_as"],
    federalTaxIdEin: ["federal_tax_id_EIN"],
    entityType: ["entity_type"],
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
    purchasePercent: ["purchase_percent"],
    remittance: ["remittance"],

    clientName: ["client_name"],
    owner1GuarantorName: ["owner1_guarantor_name"],
    owner2GuarantorName: ["owner2_guarantor_name"],
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

    appendixUnderwritingFees: ["appendix_underwriting_fees"],
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


    clientName = "",
    owner1GuarantorName = "",
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
        // Entity type is already set on the BoldSign template; skip prefill to avoid overwriting contract defaults.
        // ...mapIds(FIELD_IDS.entityType, "Entity Type", normalizeEntityTypeForBoldSignDropdown(entityType)),
        ...mapIds(FIELD_IDS.federalTaxIdEin, "Federal Tax ID EIN", federalTaxIdEin),
        ...mapIds(FIELD_IDS.agreementDate, "Agreement Date", agreementDate),
        ...mapIds(FIELD_IDS.purchasePrice, "Purchase Price", purchasePrice),
        ...mapIds(FIELD_IDS.purchaseAmount, "Purchase Amount", purchaseAmount),
        ...mapIds(FIELD_IDS.purchasePercent, "Purchase Percent", purchasePercent),
        ...mapIds(FIELD_IDS.remittance, "Remittance", remittance),
        ...mapIds(FIELD_IDS.clientName, "Client Name", clientName),
        ...mapIds(FIELD_IDS.owner1GuarantorName, "Owner1 Guarantor Name", owner1GuarantorName),
        ...mapIds(FIELD_IDS.owner2GuarantorName, "Owner2 Guarantor Name", owner2GuarantorName),
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
        ...mapIds(FIELD_IDS.authorizationApplication, "Authorization Application", authorizationApplication),
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
};

function str(v: unknown): string {
    return String(v ?? "").trim();
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
    "appendixUnderwritingFees",
    "addendumDatedPrincipalOwnerAmount",
    "addendumDatedPrincipalOwnerAmount2",
];

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

function achRowToPrefillPartial(row: Record<string, unknown> | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    const out: Partial<BuildContractPrefillFieldsArgs> = {
        achAuthorizationAccountHolderName: str(row.accountHolderName),
        achAuthorizationConcentAccountHolderName: str(row.accountHolderName),
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

function ownersToPrefillPartial(rows: Record<string, unknown>[] | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    if (!rows?.length) return {};
    const o1 = rows[0];
    const o2 = rows[1];
    const n1 = ownerFullName(o1?.firstName, o1?.lastName);
    const n2 = ownerFullName(o2?.firstName, o2?.lastName);
    const ssn1 = str(o1?.ssnNumber ?? o1?.ssn);
    const ssn2 = str(o2?.ssnNumber ?? o2?.ssn);
    const dl1 = str(o1?.driverLicenseNumber ?? o1?.driverLicense);
    const dl2 = str(o2?.driverLicenseNumber ?? o2?.driverLicense);
    return {
        owner1GuarantorName: n1,
        owner2GuarantorName: n2,
        guarantyOwner1Name: n1,
        guarantyOwner1Ss: ssn1,
        guarantyOwner1DriverLicense: dl1,
        guarantyOwner2Name: n2,
        guarantyOwner2Ss: ssn2,
        guarantyOwner2DriverLicense: dl2,
        exhibitOwnerName: n1 || n2,
    };
}

function guarantorsToPrefillPartial(rows: Record<string, unknown>[] | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    if (!rows?.length) return {};
    const g1 = rows[0];
    const g2 = rows[1];
    const guarantorName = ownerFullName(g1?.firstName, g1?.lastName);
    return {
        owner2GuarantorName: guarantorName,
        securityGuarantor: guarantorName,
        guarantorEmail: str(g1?.email),
        guarantorPhone: str(g1?.phone),
        guarantorAddress: str(g1?.address),
        guarantorAddressCity: str(g1?.city),
        guarantorAddressState: str(g1?.state),
        guarantorAddressZip: str(g1?.zip),
        guarantyGuarantor1Name: ownerFullName(g1?.firstName, g1?.lastName),
        guarantyGuarantor1Ss: str(g1?.ssnNumber ?? g1?.ssn),
        guarantyGuarantor1DriverLicense: str(g1?.driverLicenseNumber ?? g1?.driverLicense),
        guarantyGuarantor2Name: ownerFullName(g2?.firstName, g2?.lastName),
        guarantyGuarantor2Ss: str(g2?.ssnNumber ?? g2?.ssn),
        guarantyGuarantor2DriverLicense: str(g2?.driverLicenseNumber ?? g2?.driverLicense),
    };
}

// contractRowToPrefillPartial prefill of feilds happens here

function contractRowToPrefillPartial(row: Record<string, unknown> | null | undefined): Partial<BuildContractPrefillFieldsArgs> {
    if (!row) return {};
    const offer = (row.offer ?? null) as Record<string, unknown> | null;
    const paymentBank = (row.paymentBank ?? null) as Record<string, unknown> | null;

    const purchaseAmount = firstTruncateDecimal(row.purchaseAmount, offer?.offer, row.approvedAmount);
    const purchasePrice = firstTruncateDecimal(row.purchasePrice, offer?.totalRemit, row.totalAmount);
    const purchasePercent =
        firstTruncateDecimal(row.purchasePercent, offer?.rate) || str(row.purchasePercent);

    const agreementDatePrefill =
        prefillIsoDate(row.agreementDate) || prefillIsoDate(row.contractDate);
    let authorizationDate = prefillIsoDate(row.authorizationClientDate);
    if (!authorizationDate && agreementDatePrefill) authorizationDate = agreementDatePrefill;

    let authBankName = str(row.authorizationClientBankName);
    if (!authBankName) authBankName = str(paymentBank?.bankName);

    return {
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
        remittance:
            str(row.remittance) || "",
        clientName: str(row.clientName),
        securityBusinessName: str(row.securityBusinessName),
        securityTaxEin: str(row.securityTaxEin),
        securityDoingBusinessAs: str(row.securityDoingBusinessAs),
        securityBusinessAddress: str(row.securityBusinessAddress),
        securityBusinessAddressCity: str(row.securityBusinessAddressCity),
        securityBusinessAddressState: str(row.securityBusinessAddressState),
        securityBusinessAddressZip: str(row.securityBusinessAddressZip),
        securityGuarantor: str(row.securityGuarantor),
        appendixUnderwritingFees: truncateDecimalPrefill(row.appendixUnderwritingFees) || str(row.appendixUnderwritingFees),
        appendixClientName: str(row.appendixClientName),
        authorizationApplication: str(row.authorizationApplication),
        authorizationClientBankName: authBankName,
        authorizationClientBankRouting: str(row.authorizationClientBankRouting),
        authorizationClientBankAccount: str(row.authorizationClientBankAccount),
        authorizationClientName: str(row.authorizationClientName),
        authorizationClientNamePrint: str(row.authorizationClientNamePrint),
        authorizationClientTaxId: str(row.authorizationClientTaxId),
        authorizationClientDate: authorizationDate,
        authorizedBusinessPhone: str(row.authorizedBusinessPhone),
        owner1GuarantorName: str(row.owner1GuarantorName),

        achAuthorizationConcentAccountHolderName: str(
            row.achAuthorizationConcentAccountHolderName,
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
    };
}

function getApplicationClientPrefillArgs(anyApp: unknown): Partial<BuildContractPrefillFieldsArgs> {
    if (!anyApp) return {};
    const a = anyApp as Record<string, any>;
    const r = resolveClientForPrefill(a);
    const bi = Array.isArray(a?.businessInfo) ? a.businessInfo[0] : a?.businessInfo;
    const customerName = getApplicationPrimaryRecipientName(anyApp);
    const legalName = String(r.businessName || bi?.clientBusinessName || customerName || "");
    const street = [r.businessAddress1, r.businessAddress2].filter(Boolean).join(", ").trim();
    return {
        customerName,
        legalName,
        clientName: legalName || customerName,
        doingBusinessAs: String(r.dba || bi?.dba || ""),
        businessAddress: String(street || bi?.businessAddress || ""),
        businessAddressCity: String(r.businessCity || bi?.city || ""),
        businessAddressState: String(r.businessState || bi?.state || ""),
        businessAddressZip: String(r.businessZip || bi?.zip || ""),
        state: String(
            r.incorporationState || bi?.stateOfIncorporation || "",
        ),
        entityType: String(r.entityType || bi?.entityType || ""),
        federalTaxIdEin: String(r.ein || bi?.federalTaxIdEin || ""),
        clientEmail: String(
            r.businessEmail ||
            r.ownerEmail ||
            bi?.clientBusinessEmail ||
            getApplicationPrimaryRecipientEmail(anyApp) ||
            "",
        ),
        clientPhone: String(r.businessPhone || r.ownerPhone || ""),
        guarantyClientName: legalName || customerName,
        guarantySs: String(r.ownerSsn || ""),
        guarantySsDriverLicense: String(r.ownerDriverLicense || ""),
        guarantyOwner1Name: ownerFullName(r.ownerFirst, r.ownerLast),
        guarantyOwner1Ss: String(r.ownerSsn || ""),
        guarantyOwner1DriverLicense: String(r.ownerDriverLicense || ""),
        authorizationApplication: legalName || customerName,
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
    return String(getApplicationPrimaryRecipientEmail(application) || "").trim();
}

export function getApplicationPrimaryRecipientName(anyApp: unknown): string {
    if (!anyApp) return "Signer";
    const r = resolveClientForPrefill(anyApp as Record<string, any>);
    const combined = `${r.ownerFirst} ${r.ownerLast}`.trim();
    if (combined) return combined;
    const email = getApplicationPrimaryRecipientEmail(anyApp);
    return email ? email.split("@")[0] : "Signer";
}

/**
 * Flat map of client + ACH/addendum/owners/guarantors used for the BoldSign prefill edit form
 * and for building core prefill fields (client wins over record-backed keys on overlap).
 */
export function getContractPrefillEditDefaultsFromApplication(
    anyApp: unknown,
    options?: { agreementDate?: string; contractRecords?: ContractPrefillContractRecords },
): Partial<BuildContractPrefillFieldsArgs> & { customerName: string; agreementDate: string } {
    const rec = options?.contractRecords;
    const clientArgs = getApplicationClientPrefillArgs(anyApp);
    const contractPartial = contractRowToPrefillPartial(rec?.contract ?? null);
    const recordPartial: Partial<BuildContractPrefillFieldsArgs> = {
        ...contractPartial,
        ...achRowToPrefillPartial(rec?.ach ?? null),
        ...addendumRowToPrefillPartial(rec?.addendum ?? null),
        ...ownersToPrefillPartial(rec?.owners ?? null),
        ...guarantorsToPrefillPartial(rec?.guarantors ?? null),
    };
    const ownerFallback = ownerFullName(rec?.owners?.[0]?.firstName, rec?.owners?.[0]?.lastName);
    const customerName =
        str(contractPartial.customerName) ||
        str(clientArgs.customerName) ||
        ownerFallback ||
        "Signer";
    const agreementDate =
        str(options?.agreementDate) ||
        prefillIsoDate(contractPartial.agreementDate) ||
        str(contractPartial.agreementDate);


    console.log("customerName", customerName);
    console.log("agreementDate", agreementDate);
    console.log("recordPartial", recordPartial);
    console.log("clientArgs", clientArgs);
    console.log("contractPartial", contractPartial);
    // console.log("options", options);
    // console.log("ownerFallback", ownerFallback);


    return {
        /** Application-derived defaults first, then persisted Contract / ACH / Addendum rows (preferred). */
        ...clientArgs,
        ...recordPartial,
        customerName,
        agreementDate,
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
    },
): ContractPrefillField[] {
    const rec = options?.contractRecords;
    const baseMerged = getContractPrefillEditDefaultsFromApplication(anyApp, options);
    const merged: Partial<BuildContractPrefillFieldsArgs> = {
        ...baseMerged,
        ...(options?.overrides ?? {}),
    };
    coerceNumericPrefillMoneyStrings(merged);
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

    return mergePrefillFieldsPreferFirst(
        fromCore,
        addendumSlotExtraFields(rec?.addendum ?? null),
        epoExtraFields(rec?.epo ?? null),
    );
}
