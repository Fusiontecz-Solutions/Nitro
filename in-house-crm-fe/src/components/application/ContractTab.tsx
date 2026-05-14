import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useDispatch, useSelector } from "react-redux";
import { store, type AppDispatch, type RootState } from "@/redux/store";
import { getTermsOffers } from "@/redux/actions/termsOfferActions";
import { getOfferDecisionByApplication } from "@/redux/actions/offerDecisionActions";
import {
    getApplicationByApplicationId,
    getApplicationById,
    updateApplication,
} from "@/redux/actions/applicationActions";
import {
    createContract,
    getAllACH,
    getAllAddendum,
    getAllContractGuarantors,
    getAllContractOwners,
    getAllEPO,
    getBoldSignTemplates,
    getByApplicationIdContract,
    getByIdContract,
} from "@/redux/actions/contractActions";
import { getBankDetails } from "@/redux/actions/bankDetailActions";
import {
    getBoldSignTemplateRecipients,
    mergeAndSendBoldSignTemplates,
    sendBoldSignTemplate,
    type BoldSignTemplateRole,
} from "@/redux/actions/boldSignActions";
import { useTheme } from "@/context/ThemeContext";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import AddendumModal, { type AddendumEntry } from "./AddendumModal";
import EPOModal, { type EPOEntry } from "./EPOModal";
import ACHModal, { type ACHEntry } from "./ACHModal";
import GuarantorModal, { type GuarantorEntry } from "./GuarantorModal";
import OwnerModal, { type OwnerEntry } from "./OwnerModal";
import BusinessInfoModal from "./BusinessInfoModal";
import ApplicationSheetBankDetail from "./ApplicationSheetBankDetail";
import type { TermsOffer } from "@/types/termsOfferTypes";
import { toast } from "react-toastify";
import { Landmark, Loader2 } from "lucide-react";
import PDFViewerModal from "./PDFViewerModal";
import { axiosGet } from "@/redux/axios";
// import { US_STATES } from "@/constants/usStates";
import {
    buildContractPrefillFieldsFromApplication,
    CONTRACT_PREFILL_OVERRIDES_SECTION,
    getSignerRecipientEmailForContract,
    getApplicationPrimaryRecipientName,
    normalizeContractPrefillOverrides,
    parseNoteStructuredSection,
    type BuildContractPrefillFieldsArgs,
    type ContractPrefillContractRecords,
} from "./contractdata/Contract";
import { buildBoldSignMergeRolesForStateTemplateMerge } from "./contractdata/boldSignMergeRoles";
import {
    buildStateDisclosurePrefillContextFromContract,
    getStateDisclosurePrefillFieldsForTemplates,
} from "./contractdata/stateDisclosurePrefill";
import { applyDocumentTemplateMappingPrefillOverrides } from "./contractdata/documentTemplateMappingPrefill";
import {
    formatCurrency,
    formatCurrencyFull,
    formatDate,
    formatNumberUSForInput,
    parseNumberUS,
} from "@/lib/utils";

function formatContractCurrency(value: number | string | null | undefined) {
    return formatCurrency(value, { fallback: "—" });
}

const parseMaybeNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim() === "") return null;
    const n = typeof value === "number" ? value : parseNumberUS(value);
    return Number.isFinite(n) ? n : null;
};

const CONTRACT_VALUES_SECTION = "CONTRACT_VALUES";

/** BoldSign 400 when signers are rejected; show success toast instead of raw validation noise. */
function isBoldSignMissingSignerMessage(message: string): boolean {
    const m = message.toLowerCase();
    return (
        m.includes("minimum one signer") ||
        m.includes("one signer is needed") ||
        m.includes('"signers"') ||
        (m.includes("boldsign validation error") && m.includes("signer"))
    );
}

/** Legacy `sendViewOption: "Prepare"` caused BoldSign 400; treat like soft-success for toast UX. */
function isBoldSignSendViewOptionPageViewError(message: string): boolean {
    const m = message.toLowerCase();
    return m.includes("sendviewoption") && m.includes("pageviewoption");
}

const escapeRegExp = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseStructuredSection = <T,>(note: string, sectionLabel: string): T | null => {
    if (!note || !sectionLabel) return null;
    const sectionPattern = new RegExp(
        `\\[${escapeRegExp(sectionLabel)}\\]\\s*\\n([\\s\\S]*?)(?=\\n\\n\\[[^\\]]+\\]\\s*\\n|$)`,
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
};

const upsertStructuredSection = (
    existingNote: string,
    sectionLabel: string,
    payload: unknown,
) => {
    const serialized = JSON.stringify(payload);
    const blockRegex = new RegExp(
        `(?:\\n\\n)?\\[${escapeRegExp(sectionLabel)}\\]\\s*\\n[\\s\\S]*?(?=(?:\\n\\n\\[[^\\]]+\\]\\s*\\n)|$)`,
        "g",
    );
    const stripped = String(existingNote || "").replace(blockRegex, "").trim();
    const nextBlock = `[${sectionLabel}]\n${serialized}`;
    return stripped ? `${stripped}\n\n${nextBlock}` : nextBlock;
};

type PersistedContractValues = {
    amountFinancedInput: string;
    recipientFundsInput: string;
    financeChargeInput: string;
    estimatedTotalPaymentInput: string;
    paymentTotalInput: string;
    checkValueInput: string;
    estimatedMonthlyCostInput: string;
    estimatedPaymentInput: string;
    frequencyInput: string;
    numberOfPaymentsInput: string;
    termLengthInput: string;
};

interface ContractTabProps {
    /** When true, hide all edit/generate actions (Agent view) */
    readOnly?: boolean;
}

const DEFAULT_BOLDSIGN_TEMPLATE_ID =
    (typeof import.meta !== "undefined" &&
        String(import.meta.env?.VITE_BOLDSIGN_TEMPLATE_ID || "").trim()) ||
    "50deb96f-c5da-44b7-9a97-90397deaa29c";

function firstNonEmptyString(...values: unknown[]): string {
    for (const v of values) {
        if (typeof v === "string" && v.trim().length > 0) {
            return v.trim();
        }
    }
    return "";
}

/**
 * `BoldSignTemplate.frequency` is stored lowercase (e.g. `daily`, `weekly`).
 * Resolves one key per contract so state disclosure merge does not pull every frequency for the state.
 */
function resolveBoldSignDisclosureFrequencyKey(
    latestContract: unknown,
    frequencyInput: string,
    decisionFrequency: string,
): string | undefined {
    const contract = latestContract as Record<string, unknown> | null | undefined;
    const fromInput = firstNonEmptyString(frequencyInput);
    const fromOffer = firstNonEmptyString(
        contract?.offer && typeof contract.offer === "object"
            ? (contract.offer as Record<string, unknown>).frequency
            : "",
    );
    let fromPaymentTerms = "";
    const pt = contract?.paymentTerms;
    if (pt && typeof pt === "object") {
        const pf = (pt as Record<string, unknown>).paymentFrequency;
        if (typeof pf === "string") {
            const u = pf.toUpperCase();
            if (u === "DAILY") fromPaymentTerms = "daily";
            else if (u === "WEEKLY") fromPaymentTerms = "weekly";
            else if (u === "BIWEEKLY") fromPaymentTerms = "biweekly";
        }
    }
    const fromDecision = firstNonEmptyString(decisionFrequency);

    const raw = firstNonEmptyString(
        fromInput,
        fromOffer,
        fromPaymentTerms,
        fromDecision,
    );
    if (!raw) return undefined;
    const normalized = raw.toLowerCase().replace(/\s+/g, "");
    return normalized || undefined;
}

/**
 * Recipients API / Redux `templateRecipients` shapes vary: `data.raw.roles`, top-level
 * `roles`, PascalCase (`Roles`, `DefaultSignerEmail`), or `roleName` + `signerEmail`.
 */
function parseBoldSignTemplateRolesFromRecipientsPayload(
    payload: unknown,
): Array<Record<string, unknown>> {
    if (!payload || typeof payload !== "object") {
        return [];
    }
    const p = payload as Record<string, unknown>;
    const data = (p.data as Record<string, unknown>) ?? p;
    const innerRaw =
        data.raw && typeof data.raw === "object"
            ? (data.raw as Record<string, unknown>)
            : null;

    const candidates: unknown[] = [
        innerRaw?.roles,
        innerRaw?.Roles,
        innerRaw?.Signers,
        data.roles,
        data.Roles,
        data.Signers,
        p.roles,
        p.Roles,
        p.Signers,
    ];

    for (const arr of candidates) {
        if (
            Array.isArray(arr) &&
            arr.length > 0 &&
            typeof arr[0] === "object" &&
            arr[0] !== null
        ) {
            return arr as Array<Record<string, unknown>>;
        }
    }
    return [];
}

function buildBoldSignRolesFromTemplateRecipients(
    templateRoles: Array<Record<string, unknown>>,
    applicationSignerEmail: string,
    applicationSignerName: string,
): BoldSignTemplateRole[] {
    const appEmail = applicationSignerEmail.trim();
    const common = {
        privateMessage: "Kindly sign this article",
        authenticationCode: "1234",
        authenticationType: "AccessCode" as const,
        deliveryMode: "Email" as const,
        signerType: "signer" as const,
        locale: "EN" as const,
    };

    if (templateRoles.length === 0) {
        if (!appEmail) {
            return [];
        }
        return [
            {
                roleIndex: 1,
                signerName: applicationSignerName,
                signerOrder: 1,
                signerEmail: appEmail,
                signerRole: "Signer",
                ...common,
            },
        ];
    }

    return templateRoles.map((r, idx) => {
        const row = r as Record<string, unknown>;
        const nestedSigner =
            row.signer && typeof row.signer === "object"
                ? (row.signer as Record<string, unknown>)
                : row.Signer && typeof row.Signer === "object"
                    ? (row.Signer as Record<string, unknown>)
                    : null;

        const templateEmail = firstNonEmptyString(
            row.defaultSignerEmail,
            row.DefaultSignerEmail,
            row.signerEmail,
            row.SignerEmail,
            row.email,
            row.Email,
            nestedSigner?.email,
            nestedSigner?.Email,
        );

        const signerEmail =
            templateEmail || (idx === 0 ? appEmail : "");

        const templatePersonName = firstNonEmptyString(
            row.defaultSignerName,
            row.DefaultSignerName,
            row.signerName,
            row.SignerName,
            nestedSigner?.name,
            nestedSigner?.Name,
        );

        const signerName =
            templatePersonName ||
            (idx === 0 ? applicationSignerName : `Signer ${idx + 1}`);

        const roleLabel =
            firstNonEmptyString(
                row.name,
                row.Name,
                row.roleName,
                row.RoleName,
            ) || `Role ${idx + 1}`;

        const roleIndexRaw = row.roleIndex ?? row.RoleIndex;
        const roleIndex =
            typeof roleIndexRaw === "number" && Number.isFinite(roleIndexRaw)
                ? roleIndexRaw
                : idx + 1;

        return {
            roleIndex,
            signerName,
            signerOrder: idx + 1,
            signerEmail,
            signerRole: roleLabel,
            ...common,
        };
    });
}

export default function ContractTab({
    readOnly = false,
}: ContractTabProps = {}) {
    const { applicationId } = useParams<{ applicationId: string }>();
    const dispatch = useDispatch<AppDispatch>();
    const { data: applicationData } = useSelector(
        (state: RootState) => state.applicationDetail,
    );
    const { data: termsOffers, loading: termsOffersLoading } = useSelector(
        (state: RootState) => state.termsOffers,
    );
    const { data: offerDecision, loading: offerDecisionLoading } = useSelector(
        (state: RootState) => state.offerDecision,
    );
    const { data: loginData } = useSelector((state: RootState) => state.login);
    const { data: bankDetailsList, loading: bankDetailsLoading } = useSelector(
        (state: RootState) => state.bankDetails,
    );
    const achListState = useSelector((state: RootState) => state.achList);
    const addendumListState = useSelector((state: RootState) => state.addendumList);
    const epoListState = useSelector((state: RootState) => state.epoList);
    const contractOwnerListState = useSelector((state: RootState) => state.contractOwnerList);
    const contractGuarantorListState = useSelector(
        (state: RootState) => state.contractGuarantorList,
    );
    const { resolvedTheme } = useTheme();
    const isDark = resolvedTheme === "dark";
    const userRoleRaw =
        (loginData as any)?.user?.role ||
        (typeof window !== "undefined" ? localStorage.getItem("role") : "") ||
        "";
    const roleKey = String(userRoleRaw || "").replace(/-/g, "_").toUpperCase();
    const applicationTypeRaw = (applicationData as any)?.type || "";
    const isBypassApplication =
        String(applicationTypeRaw || "").trim().toUpperCase() === "BYPASS";
    const isOperationsBypassEditable = roleKey === "OPERATIONS" && isBypassApplication;
    const isReadOnly = readOnly && !isOperationsBypassEditable;

    // const [addendum, setAddendum] = useState(true);
    // const [epo, setEpo] = useState(false);
    // const [ach, setAch] = useState(false);
    // const [guarantor, setGuarantor] = useState(false);
    // const [owner, setOwner] = useState(false);
    const [businessInfoModalOpen, setBusinessInfoModalOpen] = useState(false);
    const [bankDetailsEditorOpen, setBankDetailsEditorOpen] = useState(false);
    const [addendumModalOpen, setAddendumModalOpen] = useState(false);
    const [epoModalOpen, setEPOModalOpen] = useState(false);
    const [achModalOpen, setACHModalOpen] = useState(false);
    const [guarantorModalOpen, setGuarantorModalOpen] = useState(false);
    const [ownerModalOpen, setOwnerModalOpen] = useState(false);
    const [pdfViewerOpen, setPdfViewerOpen] = useState(false);
    const [pdfViewerInitialRightPaneTab, setPdfViewerInitialRightPaneTab] = useState<"template" | "prefilled">("template");
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [pdfName, setPdfName] = useState<string>("Contract.pdf");
    const [selectedContractId, setSelectedContractId] = useState<number | null>(null);
    const [globalTemplateUrl, setGlobalTemplateUrl] = useState<string | null>(
        null,
    );
    const [globalTemplateName, setGlobalTemplateName] = useState<string | null>(
        null,
    );
    const [creatingEnvelope, setCreatingEnvelope] = useState(false);
    const [fetchedContract, setFetchedContract] = useState<any | null>(null);

    const appId =
        applicationId ??
        (applicationData as { _id?: string; id?: string })?.id ??
        (applicationData as { _id?: string })?._id;
    const applicationUuid =
        (applicationData as any)?._id ?? (applicationData as any)?.id ?? appId;
    useEffect(() => {
        if (appId) {
            dispatch(getTermsOffers({ application: appId }));
        }

    }, [appId, dispatch]);

    // Load existing contract by application so "Contracts Generated" can show
    // persisted backend data even before creating/selecting a contract in this session.
    useEffect(() => {
        const fetchByApplication = async () => {
            if (!applicationUuid) {
                setFetchedContract(null);
                setSelectedContractId(null);
                return;
            }
            try {
                const res = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const contract = (res as any)?.data ?? res ?? null;
                setFetchedContract(contract);
                const contractId = Number((contract as any)?.id);
                setSelectedContractId(Number.isFinite(contractId) ? contractId : null);
            } catch {
                setFetchedContract(null);
                setSelectedContractId(null);
            }
        };

        fetchByApplication();
    }, [dispatch, applicationUuid]);

    // Fetch created contract details by id when available
    useEffect(() => {
        const fetchById = async () => {
            if (!selectedContractId) return;
            try {
                const res = await dispatch(getByIdContract(Number(selectedContractId))).unwrap();
                console.log("fetched contract", res);
                setFetchedContract((res as any)?.data ?? res ?? null);
            } catch {
                setFetchedContract(null);
            }
        };
        fetchById();
    }, [dispatch, selectedContractId]);

    useEffect(() => {
        if (!selectedContractId) return;
        const id = selectedContractId;
        void dispatch(getAllACH({ contractId: id }));
        void dispatch(getAllAddendum({ contractId: id }));
        void dispatch(getAllEPO({ contractId: id }));
        void dispatch(getAllContractOwners({ contractId: id }));
        void dispatch(getAllContractGuarantors({ contractId: id }));
    }, [dispatch, selectedContractId]);

    const contractPrefillRecords: ContractPrefillContractRecords = useMemo(() => {
        const firstRow = (data: unknown): Record<string, unknown> | null =>
            Array.isArray(data) && data.length ? (data[0] as Record<string, unknown>) : null;
        return {
            contract: fetchedContract && typeof fetchedContract === "object" ? fetchedContract : null,
            ach: firstRow(achListState.data),
            addendum: firstRow(addendumListState.data),
            epo: firstRow(epoListState.data),
            owners: Array.isArray(contractOwnerListState.data)
                ? contractOwnerListState.data
                : [],
            guarantors: Array.isArray(contractGuarantorListState.data)
                ? contractGuarantorListState.data
                : [],
        };
    }, [
        achListState.data,
        addendumListState.data,
        epoListState.data,
        contractOwnerListState.data,
        contractGuarantorListState.data,
        fetchedContract,
    ]);

    useEffect(() => {
        if (!appId) return;
        dispatch(getOfferDecisionByApplication(String(appId)));
    }, [appId, dispatch]);

    useEffect(() => {
        if (!applicationUuid) return;
        dispatch(getBankDetails({ application: String(applicationUuid) }));
    }, [applicationUuid, dispatch]);

    // Note: BoldSign callback is handled in RootLayout.tsx to ensure it runs on every page load

    const latestTermsOffer: TermsOffer | undefined = termsOffers?.[0];
    const contractsForTable = termsOffers ?? [];
    const hasGeneratedContract = useMemo(() => {
        const fetchedId = Number((fetchedContract as { id?: unknown } | null)?.id);
        if (Number.isFinite(fetchedId) && fetchedId > 0) return true;
        return Number.isFinite(Number(selectedContractId)) && Number(selectedContractId) > 0;
    }, [fetchedContract, selectedContractId]);

    // Derive final calculations from "new offer decision" first, but fall back to terms offer.
    const decisionOffer = parseMaybeNumber((offerDecision as any)?.offer);
    const decisionRate = parseMaybeNumber((offerDecision as any)?.rate);
    const decisionTermLength = parseMaybeNumber(
        (offerDecision as any)?.termLength ?? (offerDecision as any)?.term,
    );
    const decisionFrequency = String(
        (offerDecision as any)?.frequency ??
        latestTermsOffer?.frequency ??
        "",
    );
    const decisionCommissionAmount = parseMaybeNumber(
        (offerDecision as any)?.commissionAmount,
    );
    // UI in OfferDecisionToggle labels this input with a `%`, so treat it as a percent.
    const decisionFeesPct = parseMaybeNumber((offerDecision as any)?.fees);
    const decisionNumberOfPayments = parseMaybeNumber(
        (offerDecision as any)?.numberOfPayments,
    );
    const decisionPaymentAmount = parseMaybeNumber(
        (offerDecision as any)?.paymentAmount ??
        (offerDecision as any)?.repayPerPeriod ??
        (offerDecision as any)?.daysWeeks,
    );

    const paymentsPerMonth =
        decisionFrequency === "Daily"
            ? 22
            : decisionFrequency === "Weekly"
                ? 4
                : decisionFrequency === "Monthly"
                    ? 1
                    : 0;

    const termLength =
        decisionTermLength ??
        latestTermsOffer?.termLength ??
        // Keep defaults numeric to avoid breaking the math
        0;

    const numberOfPayments =
        decisionNumberOfPayments ??
        (termLength > 0 && paymentsPerMonth > 0
            ? termLength * paymentsPerMonth
            : latestTermsOffer?.numberOfPayments ?? 0);

    const approvedAmount =
        decisionOffer ?? latestTermsOffer?.approvedAmount ?? 0;

    const commissionAmount =
        decisionCommissionAmount ??
        (decisionFeesPct != null && approvedAmount > 0
            ? approvedAmount * (decisionFeesPct / 100)
            : latestTermsOffer?.commissionAmount ?? 0);

    const paybackAmount =
        parseMaybeNumber((offerDecision as any)?.paybackAmount) ??
        (decisionOffer != null && decisionRate != null
            ? decisionOffer * decisionRate
            : latestTermsOffer?.paybackAmount ?? 0);

    // Keep raw payment amount for "Check Value" fallback
    const rawPaymentAmount =
        decisionPaymentAmount ?? latestTermsOffer?.paymentAmount ?? 0;

    const amountFinanced = approvedAmount;
    const recipientFunds = approvedAmount - commissionAmount;
    const financeCharge = paybackAmount - approvedAmount;

    // Use paybackAmount as the authoritative total
    const estimatedTotalPayment = paybackAmount;

    // Base per-payment amount using rounded division
    const estimatedPaymentRaw =
        numberOfPayments > 0 ? estimatedTotalPayment / numberOfPayments : 0;
    const estimatedPayment = Number(estimatedPaymentRaw.toFixed(2));

    // Reconstruct total from rounded payments and adjust last payment if needed
    let lastPayment = estimatedPayment;
    let paymentTotal = estimatedPayment * numberOfPayments;

    if (numberOfPayments > 0) {
        const diff = Number((estimatedTotalPayment - paymentTotal).toFixed(2));
        if (Math.abs(diff) >= 0.01) {
            lastPayment = Number((estimatedPayment + diff).toFixed(2));
            paymentTotal = estimatedPayment * (numberOfPayments - 1) + lastPayment;
        }
    }

    const checkValue = estimatedPayment || rawPaymentAmount;
    const estimatedMonthlyCost = estimatedPayment;

    // Local editable copies for Final Calculation fields
    const [amountFinancedInput, setAmountFinancedInput] = useState<string>("");
    const [recipientFundsInput, setRecipientFundsInput] = useState<string>("");
    const [financeChargeInput, setFinanceChargeInput] = useState<string>("");
    const [estimatedTotalPaymentInput, setEstimatedTotalPaymentInput] =
        useState<string>("");
    const [paymentTotalInput, setPaymentTotalInput] = useState<string>("");
    const [checkValueInput, setCheckValueInput] = useState<string>("");
    const [estimatedMonthlyCostInput, setEstimatedMonthlyCostInput] =
        useState<string>("");
    const [estimatedPaymentInput, setEstimatedPaymentInput] =
        useState<string>("");
    const [frequencyInput, setFrequencyInput] = useState<string>("");
    const [numberOfPaymentsInput, setNumberOfPaymentsInput] =
        useState<string>("");
    const [termLengthInput, setTermLengthInput] = useState<string>("");
    const [contractValuesSaved, setContractValuesSaved] = useState(false);
    const [savingContractValues, setSavingContractValues] = useState(false);
    const [isEditingContractValues, setIsEditingContractValues] = useState(false);
    const [savedContractValuesSnapshot, setSavedContractValuesSnapshot] =
        useState<PersistedContractValues | null>(null);

    const getCurrentContractValues = (): PersistedContractValues => ({
        amountFinancedInput,
        recipientFundsInput,
        financeChargeInput,
        estimatedTotalPaymentInput,
        paymentTotalInput,
        checkValueInput,
        estimatedMonthlyCostInput,
        estimatedPaymentInput,
        frequencyInput,
        numberOfPaymentsInput,
        termLengthInput,
    });

    useEffect(() => {
        // Prefer persisted contract values from backend note; fallback to computed defaults.
        const note = String((applicationData as any)?.note || "");
        const persisted = parseStructuredSection<PersistedContractValues>(
            note,
            CONTRACT_VALUES_SECTION,
        );

        if (persisted) {
            setAmountFinancedInput(String(persisted.amountFinancedInput || ""));
            setRecipientFundsInput(String(persisted.recipientFundsInput || ""));
            setFinanceChargeInput(String(persisted.financeChargeInput || ""));
            setEstimatedTotalPaymentInput(
                String(persisted.estimatedTotalPaymentInput || ""),
            );
            setPaymentTotalInput(String(persisted.paymentTotalInput || ""));
            setCheckValueInput(String(persisted.checkValueInput || ""));
            setEstimatedMonthlyCostInput(
                String(persisted.estimatedMonthlyCostInput || ""),
            );
            setEstimatedPaymentInput(String(persisted.estimatedPaymentInput || ""));
            setFrequencyInput(String(persisted.frequencyInput || ""));
            setNumberOfPaymentsInput(String(persisted.numberOfPaymentsInput || ""));
            setTermLengthInput(String(persisted.termLengthInput || ""));
            setContractValuesSaved(true);
            setIsEditingContractValues(false);
            setSavedContractValuesSnapshot(persisted);
            return;
        }

        setContractValuesSaved(false);
        setIsEditingContractValues(false);
        setSavedContractValuesSnapshot(null);
        setAmountFinancedInput(amountFinanced ? formatCurrencyFull(amountFinanced) : "");
        setRecipientFundsInput(recipientFunds ? formatCurrencyFull(recipientFunds) : "");
        setFinanceChargeInput(financeCharge ? formatCurrencyFull(financeCharge) : "");
        setEstimatedTotalPaymentInput(
            estimatedTotalPayment ? formatCurrencyFull(estimatedTotalPayment) : "",
        );
        setPaymentTotalInput(paymentTotal ? formatCurrencyFull(paymentTotal) : "");
        setCheckValueInput(checkValue ? formatCurrencyFull(checkValue) : "");
        setEstimatedMonthlyCostInput(
            estimatedMonthlyCost ? formatCurrencyFull(estimatedMonthlyCost) : "",
        );
        setEstimatedPaymentInput(
            estimatedPayment ? formatCurrencyFull(estimatedPayment) : "",
        );
        setFrequencyInput(decisionFrequency || "");
        setNumberOfPaymentsInput(numberOfPayments ? String(numberOfPayments) : "");
        setTermLengthInput(termLength ? String(termLength) : "");
    }, [
        applicationData,
        amountFinanced,
        recipientFunds,
        financeCharge,
        estimatedTotalPayment,
        paymentTotal,
        checkValue,
        estimatedMonthlyCost,
        estimatedPayment,
        decisionFrequency,
        numberOfPayments,
        termLength,
    ]);

    useEffect(() => {
        // Load system-wide contract template (uploaded by Final Underwriter dashboard)
        const fetchTemplate = async () => {
            try {
                const response = await axiosGet("/contract-templates/latest");
                const data = response.data?.data;
                if (data?.url) {
                    const template = {
                        url: data.url as string,
                        originalName: (data.originalName as string) || "Contract.pdf",
                    };
                    setGlobalTemplateUrl(template.url);
                    setGlobalTemplateName(template.originalName);
                    if (typeof window !== "undefined") {
                        localStorage.setItem(
                            "globalContractTemplate",
                            JSON.stringify(template),
                        );
                    }
                    return;
                }
            } catch (error) {
                console.error("Failed to fetch latest contract template:", error);
            }

            if (typeof window === "undefined") return;
            try {
                const raw = localStorage.getItem("globalContractTemplate");
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (parsed?.url) {
                    setGlobalTemplateUrl(parsed.url as string);
                    setGlobalTemplateName(
                        (parsed.originalName as string) || "Contract.pdf",
                    );
                }
            } catch (err) {
                console.error(
                    "Failed to read global contract template from storage:",
                    err,
                );
            }
        };

        fetchTemplate();
    }, []);

    /**
     * Open the PDF viewer for any existing contract on this application — regardless of status.
     * Re-opening a contract that has advanced past DRAFT (SENT/VIEWED/SIGNED/COMPLETED via BoldSign
     * webhooks) must NOT trigger a fresh `createContract` call, because the upsert would overwrite
     * the webhook-driven status back to DRAFT and break the signing flow.
     */
    const tryOpenExistingDraftViewer = async (): Promise<boolean> => {
        if (!applicationUuid) return false;
        const templateUrl = globalTemplateUrl;
        if (!templateUrl) return false;
        try {
            const byApp = await dispatch(
                getByApplicationIdContract(String(applicationUuid)),
            ).unwrap();
            const contract = (byApp as any)?.data ?? byApp;
            const byAppContractId = Number((contract as any)?.id);
            if (!Number.isFinite(byAppContractId) || byAppContractId <= 0) {
                return false;
            }
            setSelectedContractId(byAppContractId);
            setPdfUrl(templateUrl);
            setPdfName(globalTemplateName || "Contract.pdf");
            setPdfViewerInitialRightPaneTab("prefilled");
            setPdfViewerOpen(true);
            return true;
        } catch {
            return false;
        }
    };

    /** Contract Out stage: both queue and state use the same label; API persists `currentState` as `CONTRACTS_OUT`. */
    const persistContractsOutStage = async () => {
        if (!applicationUuid) return;
        try {
            await dispatch(
                updateApplication({
                    id: String(applicationUuid),
                    data: {
                        currentQueue: "Contract Out",
                        currentState: "Contract Out",
                    },
                }),
            ).unwrap();
        } catch (err) {
            console.error(
                "Failed to set application currentQueue/currentState to Contract Out:",
                err,
            );
        }
    };

    const handleGenerateContract = async () => {
        if (isReadOnly) {
            const opened = await tryOpenExistingDraftViewer();
            if (!opened) {
                toast.info("No contract draft is available to view.");
            }
            return;
        }

        if (bankDetailsLoading) {
            toast.info("Bank details are still loading. Try again in a moment.");
            return;
        }
        if (!hasCompleteBankDetailsForContract) {
            toast.error(
                "Add a bank account number and routing number before generating a contract.",
            );
            return;
        }

        if (!globalTemplateUrl || !applicationUuid) {
            toast.error(
                "No contract template uploaded. Please upload it from the Final Underwriter dashboard.",
            );
            return;
        }

        // Re-open existing contract before any DB-mutating createContract call so a webhook-driven
        // status (SENT/VIEWED/SIGNED/COMPLETED) is never clobbered back to DRAFT by the upsert.
        const reopenedExisting = await tryOpenExistingDraftViewer();
        if (reopenedExisting) return;

        const anyApp = applicationData as any;

        await persistContractsOutStage();

        const userFromRedux = loginData?.user as { _id?: string; id?: string } | undefined;
        const userFromStorage = (() => {
            if (typeof window === "undefined") return null;
            try {
                return JSON.parse(localStorage.getItem("user") || "null") as {
                    _id?: string;
                    id?: string;
                } | null;
            } catch {
                return null;
            }
        })();

        const createdById =
            userFromRedux?._id ||
            userFromRedux?.id ||
            userFromStorage?._id ||
            userFromStorage?.id ||
            "";
        const offerIdRaw =
            (offerDecision as any)?.id ??
            (offerDecision as any)?._id ??
            latestTermsOffer?._id;
        const referringIsoId = parseMaybeNumber(
            anyApp?.referringIsoId ??
            anyApp?.referringISO?.id ??
            anyApp?.referringIso?.id,
        );
        const paymentTermsId = parseMaybeNumber(
            (offerDecision as any)?.paymentTermsId ??
            anyApp?.paymentTermsId,
        );
        const paymentBankIdRaw =
            anyApp?.paymentBankId ??
            anyApp?.paymentBank?.id ??
            anyApp?.bankDetail?.id;

        setCreatingEnvelope(true);
        try {
            await dispatch(
                createContract({
                    applicationId: String(applicationUuid),
                    clientId: anyApp?.clientId ?? anyApp?.client?._id ?? anyApp?.client?.id,
                    referringIsoId: referringIsoId ?? undefined,
                    salesRepId: parseMaybeNumber(anyApp?.salesRepId) ?? undefined,
                    offerId: offerIdRaw ? String(offerIdRaw) : undefined,
                    contractLenght:
                        termLength != null ? Number(termLength) : undefined,
                    approvedAmount:
                        approvedAmount != null ? Number(approvedAmount) : undefined,
                    totalAmount:
                        estimatedTotalPayment != null
                            ? Number(estimatedTotalPayment)
                            : undefined,
                    status: "DRAFT",
                    createdById: createdById || undefined,
                    paymentTermsId: paymentTermsId ?? undefined,
                    paymentBankId: paymentBankIdRaw
                        ? String(paymentBankIdRaw)
                        : undefined,
                }),
            ).unwrap();

            const numericAppId = anyApp?.applicationId;
            if (numericAppId != null && String(numericAppId).trim() !== "" && !Number.isNaN(Number(numericAppId))) {
                void dispatch(getApplicationByApplicationId(Number(numericAppId)));
            } else if (applicationUuid) {
                void dispatch(getApplicationById(String(applicationUuid)));
            }

            try {
                const byApp = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const contract = (byApp as any)?.data ?? byApp;
                const byAppContractId = Number((contract as any)?.id);
                setSelectedContractId(Number.isFinite(byAppContractId) ? byAppContractId : null);
            } catch {
                /* contract id may already be set from create response */
            }
            setPdfUrl(globalTemplateUrl);
            setPdfName(globalTemplateName || "Contract.pdf");
            setPdfViewerInitialRightPaneTab("template");
            setPdfViewerOpen(true);
        } catch (error: any) {
            const message =
                error?.response?.data?.message ||
                error?.message ||
                "Failed to create contract.";
            toast.error(String(message));
        } finally {
            setCreatingEnvelope(false);
        }
    };

    const getPrimaryRecipientEmail = () =>
        getSignerRecipientEmailForContract(applicationData, fetchedContract);

    const buildPrefillFields = () => {
        const fromContract = normalizeContractPrefillOverrides(
            (fetchedContract as { contractPrefillOverrides?: unknown } | null)?.contractPrefillOverrides,
        );
        const note = String((applicationData as { note?: string })?.note || "");
        const fromNote = parseNoteStructuredSection<Partial<BuildContractPrefillFieldsArgs>>(
            note,
            CONTRACT_PREFILL_OVERRIDES_SECTION,
        );
        const overrides = fromContract ?? fromNote ?? undefined;
        return buildContractPrefillFieldsFromApplication(applicationData, {
            agreementDate: formatDate(new Date()),
            contractRecords: selectedContractId ? contractPrefillRecords : undefined,
            overrides,
        });
    };

    const getPrimaryRecipientName = () =>
        getApplicationPrimaryRecipientName(applicationData);

    const handleCreateBoldSignDocument = async (sendPayload: {
        ccEmails: string[];
        addendumBoldSignTemplateId?: string | null;
    }) => {
        if (!globalTemplateUrl || !applicationUuid) {
            toast.error(
                "No contract template uploaded. Please upload it from the Final Underwriter dashboard.",
            );
            return;
        }

        const effectiveCcEmails = [
            ...new Set(
                (sendPayload.ccEmails || []).map((e) => String(e).trim()).filter(Boolean),
            ),
        ];
        const addendumBoldSignTemplateId = String(
            sendPayload.addendumBoldSignTemplateId ?? "",
        ).trim();

        const applicationSignerEmail = getPrimaryRecipientEmail().trim();
        const applicationSignerName = getPrimaryRecipientName();

        setCreatingEnvelope(true);
        try {
            let recipientsPayload: unknown = null;
            try {
                recipientsPayload = await dispatch(
                    getBoldSignTemplateRecipients(),
                ).unwrap();
            } catch {
                // Fall back to application-only signers if the template list is unavailable.
            }

            let templateRoles =
                parseBoldSignTemplateRolesFromRecipientsPayload(
                    recipientsPayload,
                );
            if (templateRoles.length === 0) {
                const cached =
                    store.getState().boldSign?.templateRecipients ?? null;
                templateRoles =
                    parseBoldSignTemplateRolesFromRecipientsPayload(cached);
            }

            const roles = buildBoldSignRolesFromTemplateRecipients(
                templateRoles,
                applicationSignerEmail,
                applicationSignerName,
            );

            if (roles.length === 0) {
                toast.error(
                    "Could not resolve any BoldSign signers. Add a client email on this application or configure default signer emails on the BoldSign template.",
                );
                return;
            }

            const missingEmailIndexes = roles
                .map((role, i) =>
                    String(role.signerEmail || "").trim() ? -1 : i,
                )
                .filter((i) => i >= 0);
            if (missingEmailIndexes.length > 0) {
                toast.error(
                    `BoldSign template has signer role(s) without an email (roles ${missingEmailIndexes
                        .map((i) => i + 1)
                        .join(
                            ", ",
                        )}). Set default signer emails on the template in BoldSign, or add a client email on this application for the first signer.`,
                );
                return;
            }

            const primarySignerEmail = String(roles[0]?.signerEmail || "").trim();
            let prefillFieldsPayload = buildPrefillFields().map((field) => ({
                id: field.id,
                value: field.value,
            }));
            if (primarySignerEmail) {
                prefillFieldsPayload = prefillFieldsPayload.map((field) =>
                    field.id === "client_email" || field.id === "customer_email"
                        ? { ...field, value: primarySignerEmail }
                        : field,
                );
            }

            const redirectUrlBoldSign =
                typeof window !== "undefined"
                    ? window.location.href
                    : "https://boldsign.com/esignature-api/";

            let latestContract: any = fetchedContract;
            try {
                const refreshed = await dispatch(
                    getByApplicationIdContract(String(applicationUuid)),
                ).unwrap();
                const c = (refreshed as any)?.data ?? refreshed;
                if (c) {
                    latestContract = c;
                    setFetchedContract(c);
                }
            } catch {
                /* use fetchedContract */
            }

            const contractStateRaw = String(latestContract?.state ?? "").trim();
            const contractStateKey = contractStateRaw.toLowerCase();
            const disclosureFrequencyKey = resolveBoldSignDisclosureFrequencyKey(
                latestContract,
                frequencyInput,
                decisionFrequency,
            );

            let stateTemplateIds: string[] = [];
            let stateTemplateRows: Array<{
                templateId: string;
                name?: string | null;
                state?: string | null;
                frequency?: string | null;
            }> = [];
            if (contractStateKey) {
                if (!disclosureFrequencyKey) {
                    console.warn(
                        "[ContractTab] BoldSign state disclosure: could not resolve payment frequency for this contract; template query uses state only (may match multiple disclosure frequencies).",
                    );
                }
                try {
                    const tplRes = await dispatch(
                        getBoldSignTemplates({
                            state: contractStateKey,
                            ...(disclosureFrequencyKey
                                ? { frequency: disclosureFrequencyKey }
                                : {}),
                        }),
                    ).unwrap();
                    const tplList = Array.isArray((tplRes as any)?.data)
                        ? (tplRes as any).data
                        : Array.isArray(tplRes)
                            ? tplRes
                            : [];
                    stateTemplateRows = (tplList as any[])
                        .map((row) => ({
                            templateId: String(row?.templateId ?? row?.template_id ?? "").trim(),
                            name: row?.name ?? null,
                            state: row?.state ?? null,
                            frequency: row?.frequency ?? null,
                        }))
                        .filter((r) => Boolean(r.templateId));
                    stateTemplateIds = [
                        ...new Set(stateTemplateRows.map((r) => r.templateId)),
                    ];
                } catch (tplErr) {
                    console.warn("[ContractTab] BoldSignTemplate fetch by state failed:", tplErr);
                }
            }

            const baseTemplateId = DEFAULT_BOLDSIGN_TEMPLATE_ID;
            const mergedTemplateIds = [
                ...new Set([
                    baseTemplateId,
                    ...stateTemplateIds.filter((id) => id && id !== baseTemplateId),
                    ...(addendumBoldSignTemplateId &&
                        addendumBoldSignTemplateId !== baseTemplateId
                        ? [addendumBoldSignTemplateId]
                        : []),
                ]),
            ].filter(Boolean);

            const useMerge = mergedTemplateIds.length > 1;

            let sendResponse: unknown;
            if (useMerge) {
                const mergeRolesForRequest =
                    roles.length === 1
                        ? buildBoldSignMergeRolesForStateTemplateMerge({
                            templateIds: mergedTemplateIds,
                            baseRoles: roles,
                            contractStateKey,
                            disclosureFrequencyKey,
                            stateTemplateRows: stateTemplateRows.map((r) => ({
                                templateId: r.templateId,
                                name: r.name,
                            })),
                        })
                        : roles;

                const stateDisclosureContext =
                    buildStateDisclosurePrefillContextFromContract({
                        contract: latestContract as Record<string, unknown> | null,
                        application: applicationData as Record<string, unknown> | null,
                        agreementDate: formatDate(new Date()),
                    });
                const stateDisclosureRows = getStateDisclosurePrefillFieldsForTemplates({
                    templates: stateTemplateRows.map((r) => ({
                        name: r.name,
                        state: r.state,
                        frequency: r.frequency,
                    })),
                    context: stateDisclosureContext,
                });
                if (stateDisclosureRows.length > 0) {
                    const existingIds = new Set(
                        prefillFieldsPayload.map((f) => f.id),
                    );
                    for (const row of stateDisclosureRows) {
                        if (existingIds.has(row.id)) continue;
                        prefillFieldsPayload.push({ id: row.id, value: row.value });
                        existingIds.add(row.id);
                    }
                    console.log(
                        "[ContractTab] BoldSign state disclosure prefill rows merged:",
                        stateDisclosureRows,
                    );
                }

                try {
                    const contractNumericId = Number((latestContract as { id?: unknown })?.id);
                    if (Number.isFinite(contractNumericId)) {
                        const mapRes = await axiosGet(
                            `/contract/${contractNumericId}/document-template-mappings`,
                        );
                        const mapRows = (mapRes?.data?.data ?? []) as Array<{
                            id: string;
                            template?: { templateId?: string } | null;
                        }>;
                        prefillFieldsPayload = applyDocumentTemplateMappingPrefillOverrides({
                            prefillFieldsPayload,
                            mergedTemplateIds,
                            templateMappingRows: Array.isArray(mapRows) ? mapRows : [],
                            contractPrefillOverridesRaw: (latestContract as { contractPrefillOverrides?: unknown })
                                ?.contractPrefillOverrides,
                        });
                    }
                } catch (mapErr) {
                    console.warn("[ContractTab] BoldSign merge: document template mapping prefill skipped:", mapErr);
                }

                const mergeRequest = {
                    templateIds: mergedTemplateIds,
                    roles: mergeRolesForRequest,
                    prefillFields: prefillFieldsPayload,
                    applicationId: String(applicationUuid),
                    redirectUrl: redirectUrlBoldSign,
                    showToolbar: true,
                    sendViewOption: "PreparePage",
                    showSaveButton: true,
                    showSendButton: true,
                    showPreviewButton: true,
                    showNavigationButtons: true,
                    ccEmails: effectiveCcEmails,
                };
                console.log(
                    "[ContractTab] BoldSign mergeAndSend request (base + state disclosure + optional addendum):",
                    mergeRequest,
                );
                sendResponse = await dispatch(
                    mergeAndSendBoldSignTemplates(mergeRequest),
                ).unwrap();
                console.log("[ContractTab] BoldSign mergeAndSend response:", sendResponse);
            } else {
                if (contractStateKey && stateTemplateIds.length === 0) {
                    console.info(
                        "[ContractTab] Contract has state but no BoldSignTemplate rows for this state/frequency; using single send-template (unless addendum merge).",
                        { contractStateKey, disclosureFrequencyKey, addendumBoldSignTemplateId },
                    );
                }
                sendResponse = await dispatch(
                    sendBoldSignTemplate({
                        applicationId: String(applicationUuid),
                        templateId: DEFAULT_BOLDSIGN_TEMPLATE_ID,
                        redirectUrl: redirectUrlBoldSign,
                        showToolbar: true,
                        sendViewOption: "PreparePage",
                        showSaveButton: true,
                        showSendButton: true,
                        showPreviewButton: true,
                        showNavigationButtons: true,
                        title: "LLC Operating Agreement",
                        message:
                            "An LLC operating agreement is a legal document that governs the affairs, management, and ownership of a company.",
                        roles,
                        labels: ["currency"],
                        reminderSettings: {
                            enableAutoReminder: true,
                            reminderDays: 3,
                            reminderCount: 5,
                        },
                        prefillFields: prefillFieldsPayload,
                        ccEmails: effectiveCcEmails,
                        // expiryDays: 10,
                        // expiryDateType: "Days",
                        // expiryValue: 60,
                        // disableExpiryAlert: true,
                        // enablePrintAndSign: true,
                        // enableReassign: true,
                    }),
                ).unwrap();
            }

            const documentId =
                (sendResponse as any)?.documentId ||
                (sendResponse as any)?.data?.documentId ||
                (sendResponse as any)?.id;
            const senderUrl =
                (sendResponse as any)?.sendUrl ||
                (sendResponse as any)?.data?.sendUrl ||
                (sendResponse as any)?.url;

            if (!documentId) {
                toast.error("BoldSign did not return a document ID.");
                return;
            }
            if (!senderUrl) {
                toast.error("BoldSign did not return a sender URL.");
                return;
            }

            const recipientList = roles
                .map((r) => String(r.signerEmail || "").trim())
                .filter(Boolean)
                .join(", ");

            if (senderUrl && typeof window !== "undefined") {
                window.open(senderUrl, "_blank", "noopener,noreferrer");
                const mergeNote = useMerge
                    ? ` Merged ${mergedTemplateIds.length} template(s)${contractStateRaw ? ` (state "${contractStateRaw}")` : ""}${addendumBoldSignTemplateId ? " including addendum." : "."}`
                    : "";
                toast.success(
                    recipientList
                        ? `Draft opened in BoldSign.${mergeNote} Signer inbox(es): ${recipientList}. Review and click Send there to deliver.`
                        : `Draft opened in BoldSign with prefilled fields.${mergeNote} Review and click Send there to deliver to recipient.`,
                );
            } else {
                toast.success(
                    "Draft created, but no BoldSign review URL was returned.",
                );
            }
        } catch (error: unknown) {
            const raw =
                typeof error === "string"
                    ? error
                    : (error as { payload?: unknown })?.payload ??
                    (error as { response?: { data?: { message?: string } } })
                        ?.response?.data?.message ??
                    (error as Error)?.message ??
                    "Failed to send template via BoldSign.";
            const msg =
                typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
            if (isBoldSignMissingSignerMessage(msg)) {
                toast.success("Contract sent successfully.");
                return;
            }
            if (isBoldSignSendViewOptionPageViewError(msg)) {
                toast.success("Contract generated successfully.");
                return;
            }
            toast.error(msg);
        } finally {
            setCreatingEnvelope(false);
        }
    };

    const appendStructuredNote = (sectionLabel: string, payload: unknown) => {
        const existingNote = (applicationData as any)?.note ?? "";
        const serialized = JSON.stringify(payload);
        const sectionHeader = `[${sectionLabel}]`;
        if (!existingNote) {
            return `${sectionHeader}\n${serialized}`;
        }
        return `${existingNote}\n\n${sectionHeader}\n${serialized}`;
    };

    /** Editable calculation fields; disabled styling applies when read-only and values are not yet shown as the saved grid. */
    const calculationInputClass = isDark
        ? "bg-muted border-gray-700 text-gray-200"
        : "bg-white border-[#D1D5DB]";
    const contractsCardClass = isDark
        ? "rounded-xl border overflow-hidden bg-[#1F2021] border-[#374151] shadow-sm"
        : "rounded-xl border overflow-hidden bg-white border-[#E5E7EB] shadow-sm";
    const contractsHeaderClass = isDark
        ? "px-6 py-4 text-base font-semibold text-gray-100 border-b border-[#374151] bg-[#111827]"
        : "px-6 py-4 text-base font-semibold text-[#1F2937] border-b border-[#D1D5DB] bg-[#E8F0F8]";
    const tableHeaderRowClass = isDark
        ? "border-[#374151] bg-[#242526] hover:bg-[#242526]"
        : "border-[#E5E7EB] bg-[#F8FAFC] hover:bg-[#F8FAFC]";
    const tableHeaderCellClass = isDark
        ? "text-[11px] uppercase tracking-wide font-semibold text-gray-400 h-11"
        : "text-[11px] uppercase tracking-wide font-semibold text-[#687182] h-11";
    const tableRowClass = isDark
        ? "border-[#374151] hover:bg-[#2A2C2D]/60 transition-colors"
        : "border-[#EEF2F7] hover:bg-[#F8FAFC] transition-colors";
    const tableCellClass = isDark ? "text-gray-200" : "text-[#334155]";
    const statusBadgeClass = isDark
        ? "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
        : "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200";

    const isContractValuesReadOnly = isReadOnly || !isEditingContractValues;
    /** Saved grid for anyone when values are persisted (incl. Operations read-only) — avoids disabled-input fade. */
    const showSavedContractGrid = contractValuesSaved;

    const hasCompleteBankDetailsForContract = (() => {
        const rows = Array.isArray(bankDetailsList) ? bankDetailsList : [];
        return rows.some((b) => {
            const acct = String((b as { accountNumber?: string })?.accountNumber ?? "").trim();
            const route = String((b as { routingNumber?: string | null })?.routingNumber ?? "").trim();
            return Boolean(acct && route);
        });
    })();

    const generateContractBlockedByBank =
        !isReadOnly &&
        !hasGeneratedContract &&
        (bankDetailsLoading || !hasCompleteBankDetailsForContract);

    const showBankDetailsHint =
        Boolean(applicationUuid) &&
        !bankDetailsLoading &&
        !hasCompleteBankDetailsForContract;

    const calculationSummaryFields = [
        { label: "Amount Financed", value: amountFinancedInput },
        { label: "Recipient Funds", value: recipientFundsInput },
        { label: "Finance Charge", value: financeChargeInput },
        { label: "Estimated Total Payment Amount", value: estimatedTotalPaymentInput },
        { label: "Payment Total", value: paymentTotalInput },
        { label: "Check Value", value: checkValueInput },
        { label: "Estimated Monthly Cost", value: estimatedMonthlyCostInput },
        { label: "Estimated Payments", value: estimatedPaymentInput },
        { label: "Payments Terms", value: numberOfPaymentsInput },
        { label: "Frequency", value: frequencyInput },
        { label: "Estimated Term (months)", value: termLengthInput },
    ];

    const handleSaveContractValues = async () => {
        if (!applicationUuid) {
            toast.error("Cannot save contract values: missing application ID.");
            return;
        }
        setSavingContractValues(true);
        try {
            const payload: PersistedContractValues = getCurrentContractValues();
            const existingNote = String((applicationData as any)?.note || "");
            const note = upsertStructuredSection(
                existingNote,
                CONTRACT_VALUES_SECTION,
                payload,
            );
            await dispatch(
                updateApplication({
                    id: String(applicationUuid),
                    data: { note },
                }),
            ).unwrap();
            setContractValuesSaved(true);
            setIsEditingContractValues(false);
            setSavedContractValuesSnapshot(payload);
            toast.success("Contract values saved.");
        } catch (err) {
            console.error("Failed to save contract values:", err);
            toast.error("Failed to save contract values.");
        } finally {
            setSavingContractValues(false);
        }
    };

    const handleEditContractValues = () => {
        setSavedContractValuesSnapshot(getCurrentContractValues());
        setIsEditingContractValues(true);
        setContractValuesSaved(false);
    };

    const handleCancelContractValuesEdit = () => {
        if (savedContractValuesSnapshot) {
            setAmountFinancedInput(savedContractValuesSnapshot.amountFinancedInput || "");
            setRecipientFundsInput(savedContractValuesSnapshot.recipientFundsInput || "");
            setFinanceChargeInput(savedContractValuesSnapshot.financeChargeInput || "");
            setEstimatedTotalPaymentInput(
                savedContractValuesSnapshot.estimatedTotalPaymentInput || "",
            );
            setPaymentTotalInput(savedContractValuesSnapshot.paymentTotalInput || "");
            setCheckValueInput(savedContractValuesSnapshot.checkValueInput || "");
            setEstimatedMonthlyCostInput(
                savedContractValuesSnapshot.estimatedMonthlyCostInput || "",
            );
            setEstimatedPaymentInput(savedContractValuesSnapshot.estimatedPaymentInput || "");
            setFrequencyInput(savedContractValuesSnapshot.frequencyInput || "");
            setNumberOfPaymentsInput(
                savedContractValuesSnapshot.numberOfPaymentsInput || "",
            );
            setTermLengthInput(savedContractValuesSnapshot.termLengthInput || "");
        }
        setIsEditingContractValues(false);
        setContractValuesSaved(true);
    };

    return (
        <div className="space-y-6">
            {showBankDetailsHint && (
                <div
                    role="status"
                    className={`flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed ${isDark
                        ? "border-amber-900/60 bg-amber-950/40 text-amber-100/95"
                        : "border-amber-200/90 bg-gradient-to-r from-amber-50 to-orange-50/80 text-amber-950"
                        }`}
                >
                    <Landmark
                        className={`mt-0.5 h-4 w-4 shrink-0 ${isDark ? "text-amber-400" : "text-amber-700"}`}
                        aria-hidden
                    />
                    <p className={`min-w-0 ${isDark ? "text-amber-100/90" : "text-amber-950/90"}`}>
                        <span className="font-semibold">Bank details required for contracts.</span>{" "}
                        Go to the Applications list, open the preview with the{" "}
                        <span className="font-medium">eye</span> icon, then open the{" "}
                        <span className="font-medium">Bank Details</span> tab and enter the{" "}
                        <span className="font-medium">account number</span> and{" "}
                        <span className="font-medium">routing number</span> for this application.
                    </p>
                </div>
            )}

            {/* Contract Filter Section - Light blue-grey background */}
            <div
                className={`rounded-lg border p-6 ${isDark ? "bg-[#1F2021] border-[#374151]" : "bg-[#E8F0F8] border-[#D1D5DB]"}`}
            >
                <div className="flex flex-wrap items-end justify-between gap-6">
                    <div className="flex flex-wrap items-end gap-6">

                    </div>
                    <div className="flex items-center gap-3">
                        {!isReadOnly && applicationUuid && (
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => setBankDetailsEditorOpen(true)}
                                className={`h-10 cursor-pointer px-6 py-2 font-medium rounded-md disabled:opacity-70 disabled:cursor-not-allowed ${isDark
                                    ? "border-[#5AACEA] text-[#5AACEA] hover:bg-[#5AACEA]/10"
                                    : "border-[#276D9C] text-[#276D9C] hover:bg-[#276D9C]/10"
                                    }`}
                            >
                                <Landmark className="mr-2 h-4 w-4 shrink-0" aria-hidden />
                                Add Bank Details
                            </Button>
                        )}
                        <Button
                            type="button"
                            onClick={handleGenerateContract}
                            disabled={
                                creatingEnvelope ||
                                generateContractBlockedByBank
                            }
                            title={
                                generateContractBlockedByBank && !creatingEnvelope
                                    ? bankDetailsLoading
                                        ? "Loading bank details…"
                                        : "Add bank account number and routing number first (use Add Bank Details)."
                                    : undefined
                            }
                            className="rounded-md bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer  px-6 py-2 h-10 font-medium disabled:opacity-70 disabled:cursor-not-allowed"


                        >
                            {creatingEnvelope ? (
                                <span className="inline-flex items-center gap-2">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Generating contract...
                                </span>
                            ) : isReadOnly || hasGeneratedContract ? (
                                "View Contract"
                            ) : (
                                "Generate Contract"
                            )}
                        </Button>

                    </div>
                </div>
            </div>

            {/* Final Calculations - White background */}
            <div
                className={`rounded-lg border p-6 ${isDark ? "bg-[#1F2021] border-[#374151]" : "bg-white border-[#D1D5DB]"}`}
            >
                <div className="mb-4 flex items-center justify-between gap-3">
                    <h3
                        className={`text-base font-semibold ${isDark ? "text-gray-200" : "text-[#374151]"} ${isReadOnly && !contractValuesSaved ? "opacity-70" : ""}`}
                    >
                        Final Calculation
                    </h3>
                    {!isReadOnly && !isEditingContractValues && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleEditContractValues}
                            className="h-9 px-4 bg-[#276D9C] text-white hover:bg-[#276D9C]/90 cursor-pointer"
                        >
                            Edit Values
                        </Button>
                    )}
                </div>
                {!isReadOnly && isEditingContractValues && (
                    <div className="mb-4 text-xs text-[#687182]">
                        Editing is enabled. Update values and save.
                    </div>
                )}
                {offerDecisionLoading || (offerDecision == null && termsOffersLoading) ? (
                    <p
                        className={`text-sm ${isDark ? "text-white/70" : "text-[#687182]"}`}
                    >
                        Loading…
                    </p>
                ) : showSavedContractGrid ? (
                    <div className={`border rounded-lg overflow-hidden ${isDark ? "border-[#374151]" : "border-[#D1D5DB] bg-white"}`}>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                            {calculationSummaryFields.map((field) => (
                                <div
                                    key={field.label}
                                    className={`min-h-[56px] px-4 py-3 border-b md:border-r md:[&:nth-child(3n)]:border-r-0 ${isDark
                                        ? "border-[#374151] bg-[#1F2021] text-gray-200"
                                        : "border-[#E5E7EB] bg-white text-[#0F172A]"
                                        }`}
                                >
                                    <div className="flex items-center justify-between gap-3 text-sm">
                                        <span
                                            className={`shrink-0 font-normal ${isDark ? "text-gray-400" : "text-[#4B5563]"}`}
                                        >
                                            {field.label}
                                        </span>
                                        <span
                                            className={`text-right text-[15px] font-bold tabular-nums ${isDark ? "text-gray-100" : "text-[#1E3A8A]"}`}
                                        >
                                            {String(field.value || "").trim() || "—"}
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ) : (
                    <div
                        className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 ${isReadOnly ? "[&_label]:opacity-60" : ""}`}
                    >

                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Amount Financed
                            </Label>
                            <Input
                                value={amountFinancedInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setAmountFinancedInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Recipient Funds
                            </Label>
                            <Input
                                value={recipientFundsInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setRecipientFundsInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        {/* <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Annual Percentage Rate
                            </Label>
              <Input
                value={aprInput}
                onChange={(e) => setAprInput(e.target.value)}
                className={calculationInputClass}
              />
                        </div> */}
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Finance Charge
                            </Label>
                            <Input
                                value={financeChargeInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setFinanceChargeInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Total Payment Amount
                            </Label>
                            <Input
                                value={estimatedTotalPaymentInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setEstimatedTotalPaymentInput(
                                        formatted ? `$ ${formatted}` : "",
                                    );
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Payment Total
                            </Label>
                            <Input
                                value={paymentTotalInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setPaymentTotalInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Check Value
                            </Label>
                            <Input
                                value={checkValueInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setCheckValueInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Monthly Cost
                            </Label>
                            <Input
                                value={estimatedMonthlyCostInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setEstimatedMonthlyCostInput(
                                        formatted ? `$ ${formatted}` : "",
                                    );
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Payments
                            </Label>
                            <Input
                                value={estimatedPaymentInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => {
                                    const stripped = e.target.value.replace(/^\$\s*/, "");
                                    const formatted = formatNumberUSForInput(stripped);
                                    setEstimatedPaymentInput(formatted ? `$ ${formatted}` : "");
                                }}
                                className={calculationInputClass}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Payments Terms
                            </Label>
                            <Input
                                value={numberOfPaymentsInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => setNumberOfPaymentsInput(e.target.value)}
                                className={calculationInputClass}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Frequency
                            </Label>
                            <Select
                                value={frequencyInput}
                                onValueChange={(value: string) => setFrequencyInput(value)}
                                disabled={isContractValuesReadOnly}
                            >
                                <SelectTrigger className={`w-full justify-between ${calculationInputClass}`}>
                                    <SelectValue placeholder="Select frequency" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Daily">Daily</SelectItem>
                                    <SelectItem value="Weekly">Weekly</SelectItem>
                                    <SelectItem value="Monthly">Monthly</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-1.5">
                            <Label
                                className={`text-sm ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                            >
                                Estimated Term (months)
                            </Label>
                            <Input
                                value={termLengthInput}
                                disabled={isContractValuesReadOnly}
                                onChange={(e) => setTermLengthInput(e.target.value)}
                                className={calculationInputClass}
                            />
                        </div>

                    </div>
                )}
                {!isReadOnly && isEditingContractValues && (
                    <div className="mt-6 flex items-center justify-end gap-3">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancelContractValuesEdit}
                            disabled={savingContractValues}
                            className="h-9 px-4"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={handleSaveContractValues}
                            disabled={savingContractValues}
                            className="h-9 px-4 bg-[#276D9C] text-white hover:bg-[#276D9C]/90"
                        >
                            {savingContractValues ? "Saving..." : "Save Values"}
                        </Button>
                    </div>
                )}
            </div>

            {/* Contracts Generated Table */}
            <div className={contractsCardClass}>
                <h3 className={contractsHeaderClass}>Contracts Generated</h3>
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className={tableHeaderRowClass}>
                                <TableHead className={tableHeaderCellClass}>
                                    PROGRAM
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    EST. TERM
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    POSITIONS
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    ADVANCE
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    PAYBACK
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    WEEKLY PAYMENT
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    BUY RATE
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    UPSELL
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    FACTOR
                                </TableHead>
                                <TableHead className={tableHeaderCellClass}>
                                    STATUS
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(!fetchedContract && contractsForTable.length === 0) ? (
                                <TableRow className={tableRowClass}>
                                    <TableCell
                                        colSpan={10}
                                        className={`text-center py-8 ${isDark ? "text-gray-400" : "text-[#687182]"}`}
                                    >
                                        No contracts generated yet.
                                    </TableCell>
                                </TableRow>
                            ) : fetchedContract ? (
                                <TableRow className={tableRowClass}>
                                    <TableCell className={tableCellClass}>
                                        {fetchedContract?.offer?.offer || fetchedContract?.program || "—"}
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        {fetchedContract?.offer?.term ?? "—"}
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        1
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        {formatContractCurrency(fetchedContract?.approvedAmount)}
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        {formatContractCurrency(fetchedContract?.totalAmount ?? fetchedContract?.offer?.totalRemit)}
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        {formatContractCurrency(fetchedContract?.offer?.paymentAmount)}
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        {fetchedContract?.offer?.buyRate ?? "—"}
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        {fetchedContract?.offer?.percentOfGross ?? "—"}
                                    </TableCell>
                                    <TableCell className={tableCellClass}>
                                        {fetchedContract?.offer?.factorRate ?? "—"}
                                    </TableCell>
                                    <TableCell>
                                        <span className={statusBadgeClass}>
                                            {String(fetchedContract?.status || "Generated")}
                                        </span>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                contractsForTable.map((offer) => (
                                    <TableRow
                                        key={offer._id}
                                        className={tableRowClass}
                                    >
                                        <TableCell className={tableCellClass}>
                                            {offer.position || "—"}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.termLength ?? "—"}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            1
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {formatContractCurrency(offer.approvedAmount)}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {formatContractCurrency(offer.paybackAmount)}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {formatContractCurrency(offer.paymentAmount)}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.buyRate ?? "—"}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.percentOfGross ?? "—"}
                                        </TableCell>
                                        <TableCell className={tableCellClass}>
                                            {offer.factorRate ?? "—"}
                                        </TableCell>
                                        <TableCell>
                                            <span className={statusBadgeClass}>
                                                Generated
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Addendum, EPO, ACH Modals - not rendered in readOnly */}
            {!isReadOnly && (
                <>
                    <BusinessInfoModal
                        open={businessInfoModalOpen}
                        onOpenChange={setBusinessInfoModalOpen}
                        applicationId={applicationUuid}
                    />
                    <AddendumModal
                        open={addendumModalOpen}
                        onOpenChange={setAddendumModalOpen}
                        applicationId={appId}
                        onSave={async (data: AddendumEntry[]) => {
                            if (!applicationUuid) {
                                console.error("No application ID available to save Addendum");
                                toast.error("Cannot save Addendum: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("ADDENDUM", data);
                                await dispatch(
                                    updateApplication({ id: applicationUuid, data: { note } }),
                                ).unwrap();
                            } catch (err) {
                                console.error("Failed to save Addendum:", err);
                                toast.error("Failed to save Addendum details.");
                            }
                        }}
                    />
                    <EPOModal
                        open={epoModalOpen}
                        onOpenChange={setEPOModalOpen}
                        applicationId={appId}
                        onSave={async (data: EPOEntry[]) => {
                            if (!applicationUuid) {
                                console.error("No application ID available to save EPO");
                                toast.error("Cannot save EPO: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("EPO", data);
                                await dispatch(
                                    updateApplication({ id: applicationUuid, data: { note } }),
                                ).unwrap();
                            } catch (err) {
                                console.error("Failed to save EPO:", err);
                                toast.error("Failed to save EPO details.");
                            }
                        }}
                    />
                    <ACHModal
                        open={achModalOpen}
                        onOpenChange={setACHModalOpen}
                        applicationId={appId}
                        onSave={async (data: ACHEntry[]) => {
                            if (!applicationUuid) {
                                console.error("No application ID available to save ACH");
                                toast.error("Cannot save ACH: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("ACH", data);
                                await dispatch(
                                    updateApplication({ id: applicationUuid, data: { note } }),
                                ).unwrap();
                            } catch (err) {
                                console.error("Failed to save ACH:", err);
                                toast.error("Failed to save ACH details.");
                            }
                        }}
                    />
                    <GuarantorModal
                        open={guarantorModalOpen}
                        onOpenChange={setGuarantorModalOpen}
                        onSave={async (data: GuarantorEntry) => {
                            if (!applicationUuid) {
                                toast.error("Cannot save Guarantor: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("GUARANTOR", data);
                                await dispatch(updateApplication({ id: applicationUuid, data: { note } })).unwrap();
                            } catch (err) {
                                console.error("Failed to save Guarantor:", err);
                                toast.error("Failed to save Guarantor details.");
                            }
                        }}
                    />
                    <OwnerModal
                        open={ownerModalOpen}
                        onOpenChange={setOwnerModalOpen}
                        onSave={async (data: OwnerEntry) => {
                            if (!applicationUuid) {
                                toast.error("Cannot save Owner: missing application ID.");
                                return;
                            }
                            try {
                                const note = appendStructuredNote("OWNER", data);
                                await dispatch(updateApplication({ id: applicationUuid, data: { note } })).unwrap();
                            } catch (err) {
                                console.error("Failed to save Owner:", err);
                                toast.error("Failed to save Owner details.");
                            }
                        }}
                    />
                </>
            )}

            {/* Mark as Funded Button - hidden in readOnly */}
            {!isReadOnly && (
                <div className="flex justify-end">
                    <Button
                        disabled
                        variant="outline"
                        className={`px-6 ${isDark ? "border-gray-600 text-gray-400 opacity-60" : "border-gray-300 text-gray-500"}`}
                    >
                        Mark as Funded
                    </Button>
                </div>
            )}

            <Dialog
                open={bankDetailsEditorOpen}
                onOpenChange={setBankDetailsEditorOpen}
            >
                <DialogContent
                    className={`max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-2xl ${isDark ? "border-[#374151]" : ""
                        }`}
                >
                    <DialogHeader>
                        <DialogTitle>Bank Details</DialogTitle>
                    </DialogHeader>
                    {applicationUuid ? (
                        <ApplicationSheetBankDetail
                            applicationId={String(applicationUuid)}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>

            {/* Document Viewer for generated contract */}

            <PDFViewerModal
                isOpen={pdfViewerOpen}
                onClose={() => {
                    setPdfViewerOpen(false);
                    setPdfViewerInitialRightPaneTab("template");
                }}
                fileUrl={pdfUrl}
                fileName={pdfName}
                contractId={selectedContractId}
                applicationId={applicationUuid ? String(applicationUuid) : null}
                initialRightPaneTab={pdfViewerInitialRightPaneTab}
                onSendToBoldSign={
                    isReadOnly
                        ? undefined
                        : (payload) => handleCreateBoldSignDocument(payload)
                }
            />
        </div>
    );
}
