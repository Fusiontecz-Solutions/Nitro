import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import prisma from '../config/prismaClient';
import uploadService from '../services/uploadService';
import pdfExtractionService from '../services/pdfExtractionService';
import * as fs from 'fs';
import path from 'path';
import {
    mergeApplicationVisibilityWhere,
    getApplicationForUser,
    createClientAndApplicationFromPDFBuffer,
    InsufficientParsedPdfError,
    assertReadyToCreateNewClientFromPdf,
    type AuthenticatedUser,
} from '../services/applicationService';
import { mapClientToApi, resolveClientOwners } from '../utils/clientMapper';
import { getUnderwriterClaimMutationDenial } from '../services/underwriterClaimGuard';
import { getApplicationStageAccessForUser } from '../services/applicationStageAccess';
import {
    aggregateApplicationStats,
    aggregateApplicationMonthlyTrend,
} from '../services/applicationStatsService';
import { classifyFundedApprovedRejected } from '../services/applicationStatsPredicates';
import {
    getApplicationStatsCache,
    setApplicationStatsCache,
    invalidateAllApplicationStatsCache,
} from '../services/applicationStatsCache';
import { DashboardCacheKind, withDashboardCache } from '../services/dashboardCache';
import {
    aggregateDashboardPipelineFunnel,
    aggregateApplicationTrendChart,
    listDashboardRecentApplications,
} from '../services/dashboardAggregatesService';
import {
    aggregateOperationsDashboardSummary,
    listOperationsDashboardRecentCases,
} from '../services/operationsDashboardSummaryService';
import {
    buildOperationsStatusFilterWhere,
    resolveOperationsListFilterMode,
    dashboardStateQueueAliases,
    isContractedOpsKey,
} from '../services/operationsStatusFilter';
import {
    buildApplicationStatsBucketWhere,
    type ApplicationStatsBucketWhereOptions,
} from '../services/applicationStatsBucketWhere';
import { getBalancesForApplicationIds } from '../services/collectionPaymentFinancials';
import { applyContractCompletedSyncToApplicationRecord } from '../services/contractApplicationWorkflowSync';
import {
    buildApplicationApprovalEmailHtml,
    buildApplicationOfferUpdatedEmailHtml,
    injectApplicationApprovalEmailValues,
    sendApplicationApprovalEmail,
    sendApplicationRejectionEmail,
    APPROVAL_EMAIL_PDF_FILENAME,
    OFFER_UPDATED_EMAIL_PDF_FILENAME,
    REJECTION_EMAIL_PDF_FILENAME,
    resolveMerchantContactForOfferEmail,
    sendApplicationOfferUpdatedEmail,
    sendUnderwriterNewApplicationEmail,
} from '../services/emailService';
import { recordCommunicationAudit } from '../services/systemActivityLogService';
import { storeSgMessageIdOnOutbound } from '../services/outboundCommunicationService';
import {
    buildPublicApprovalPortalUrl,
    resolveCrmFrontendBaseUrl,
} from '../utils/crmFrontendUrl';
import { applicationCreateUncheckedData } from '../utils/prisma/applicationCreateUncheckedData';
import {
    resolveApplicationAttributedUserId,
    resolveTenantUserId,
} from '../middleware/authMiddleware';
import { createPublicPortalToken } from '../services/publicPortalTokenService';
import { syncTermsOfferFromOfferDecision } from '../services/syncTermsOfferFromOfferDecision';
import { fetchPaginatedApplicationsForList } from '../services/applicationListSort';
import {
    createApplicationActivityLog,
    getApplicationActivityLogsForUser,
    type ApplicationActivityActionType,
} from '../services/applicationActivityLogService';
import {
    listPaymentMailLogs,
    enrichPaymentMailLogsForApi,
    createPaymentMailLog as persistPaymentMailLog,
    fromPrismaMailLogStatus,
} from '../services/paymentMailLogService';
import { extractPdfPlainTextForParsing } from '../services/pdfIngestionService';
import { normalizeOcrTextForParsing } from '../services/ocrFieldExtraction';
import { parseBusinessData } from "../services/parseBusinessData";
import { formatOcrBusinessBlock } from "../services/ocrLineParser";
import { toCanonicalApplicationJson } from "../services/canonicalApplicationJson";
import { attachBufferAsApplicationFile } from '../services/applicationPdfAttachService';
import { convertToCSV, logExtractedBusinessDataCsv } from "../services/csvConverter";
import {
    processApplicationBulkExcelBuffer,
    parseApplicationBulkSheet,
    ingestApplicationBulkRows,
    type BulkImportRowError,
    type BulkImportSummary,
} from '../services/applicationBulkExcelIngestService';
import { approveApplication } from '../services/business/applicationApprovalService';
import {
    scheduleApplicationStageNotification,
    notifyApplicationRejected,
} from '../services/applicationStageNotificationService';

type ApplicationState =
    | 'DRAFT'
    | 'PENDING'
    | 'SUBMITTED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'CONTRACT_PENDING'
    | 'CONTRACTS_OUT'
    | 'SIGNED_CONTRACTS'
    | 'FUNDING_CALL'
    | 'DISBURSMENT'
    | 'FUNDED'
    | 'FINAL';

const ApplicationState = {
    DRAFT: 'DRAFT',
    /** Agent / intake queue: waiting on agent or next action (distinct from active underwriting work). */
    PENDING: 'PENDING',
    SUBMITTED: 'SUBMITTED',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    CANCELLED: 'CANCELLED',
    CONTRACT_PENDING: 'CONTRACT_PENDING',
    CONTRACTS_OUT: 'CONTRACTS_OUT',
    SIGNED_CONTRACTS: 'SIGNED_CONTRACTS',
    FUNDING_CALL: 'FUNDING_CALL',
    DISBURSMENT: 'DISBURSMENT',
    FUNDED: 'FUNDED',
    FINAL: 'FINAL',
} as const;

type BulkUploadJobStatus = 'processing' | 'completed' | 'failed';
type BulkUploadJob = {
    id: string;
    createdAtMs: number;
    /**
     * Refreshed every time the job state changes (progress tick, completion, failure).
     * Used by `cleanupExpiredBulkUploadJobs` to skip jobs that are still making progress and to
     * give completed jobs a long enough window for the UI to fetch the final result.
     */
    updatedAtMs: number;
    status: BulkUploadJobStatus;
    totalRows: number;
    processedRows: number;
    successCount: number;
    /** Rows that updated an existing application by matching deal id. */
    updatedCount: number;
    failedCount: number;
    currentExcelRowNumber?: number;
    message?: string;
    errors: BulkImportRowError[];
    result?: BulkImportSummary;
};

const bulkUploadJobs = new Map<string, BulkUploadJob>();

/**
 * How long to retain a completed/failed job in memory after its last update so the polling UI can
 * read the final result. Generously sized (4h) to survive long sheets and brief client absences.
 */
const BULK_UPLOAD_TERMINAL_JOB_TTL_MS = 1000 * 60 * 60 * 4;
/**
 * Idle threshold for a `processing` job. If nothing has been touched in this window we treat the
 * job as orphaned (e.g. the server restarted between polls) and reap it. Otherwise running jobs
 * are kept alive indefinitely, which is required for sheets with thousands of rows.
 */
const BULK_UPLOAD_PROCESSING_IDLE_TTL_MS = 1000 * 60 * 60 * 6;

function cleanupExpiredBulkUploadJobs(nowMs = Date.now()) {
    for (const [jobId, job] of bulkUploadJobs.entries()) {
        const lastTouched = job.updatedAtMs || job.createdAtMs;
        const ttl =
            job.status === 'processing'
                ? BULK_UPLOAD_PROCESSING_IDLE_TTL_MS
                : BULK_UPLOAD_TERMINAL_JOB_TTL_MS;
        if (nowMs - lastTouched > ttl) {
            bulkUploadJobs.delete(jobId);
        }
    }
}

/** Stamp the job's last-touched timestamp so the cleanup sweep treats it as alive. */
function touchBulkUploadJob(job: BulkUploadJob): void {
    job.updatedAtMs = Date.now();
}

function createBulkUploadJobId(): string {
    return `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Human-friendly summary line shown in toasts / progress for bulk upload outcomes. */
function buildBulkUploadCompletionMessage(insertedCount: number, updatedCount: number): string {
    if (insertedCount === 0 && updatedCount === 0) {
        return 'No applications were imported.';
    }
    const parts: string[] = [];
    if (insertedCount > 0) {
        parts.push(`Inserted ${insertedCount} application(s)`);
    }
    if (updatedCount > 0) {
        parts.push(`updated ${updatedCount} application(s)`);
    }
    return `${parts.join(' and ')}.`;
}

export const normalizePDFText = (text: string) => {
    return text
        // add space between lowercase and uppercase letters
        .replace(/([a-z])([A-Z])/g, "$1 $2")

        // add space between letters and numbers
        .replace(/([A-Za-z])(\d)/g, "$1 $2")

        // add space between numbers and letters
        .replace(/(\d)([A-Za-z])/g, "$1 $2")

        // normalize whitespace
        .replace(/\s+/g, " ")
        .trim();
};

// Utility to process a PDF file (Claude hybrid extraction → parse, CSV export)
export const processPDF = async (filePath: string) => {
    const buffer = fs.readFileSync(filePath);
    const name = path.basename(filePath) || 'application.pdf';
    // Extraction + parsing run outside any DB transaction (see createClientAndApplicationFromPDFBuffer / autoCreateFromPDF).
    const textRaw = await extractPdfPlainTextForParsing(buffer, name, filePath);
    const previewLen = Math.max(200, Number(process.env.PDF_EXTRACT_DEBUG_PREVIEW_CHARS || 800));
    console.log(
        '[processPDF] Synthetic extract text preview (first chars):\n',
        (textRaw || '').length > previewLen ? `${(textRaw || '').slice(0, previewLen)}…` : textRaw || '',
    );
    const text = normalizeOcrTextForParsing(textRaw);

    const parsedData = parseBusinessData(text);

    console.log(
        '[processPDF] Business (5-field) preview:',
        JSON.stringify(formatOcrBusinessBlock(parsedData.business), null, 2),
    );
    console.log(
        '[processPDF] Canonical application JSON:',
        JSON.stringify(toCanonicalApplicationJson(parsedData as { business: Record<string, unknown>; owner: Record<string, unknown> }), null, 2),
    );
    console.log('[processPDF] Parsed structured data:', JSON.stringify(parsedData, null, 2));

    logExtractedBusinessDataCsv(parsedData, { tag: "[processPDF]", fileName: name });
    convertToCSV(parsedData);

    return parsedData;
};

const applicationStateApiToPrisma: Record<string, ApplicationState> = {
    Draft: 'DRAFT' as ApplicationState,
    New: 'DRAFT' as ApplicationState,
    Submitted: 'SUBMITTED' as ApplicationState,
    'In Progress': 'IN_PROGRESS' as ApplicationState,
    In_Progress: 'IN_PROGRESS' as ApplicationState,
    IN_PROGRESS: 'IN_PROGRESS' as ApplicationState,
    Pending: 'PENDING' as ApplicationState,
    Completed: 'COMPLETED' as ApplicationState,
    Approved: 'COMPLETED' as ApplicationState,
    Cancelled: 'CANCELLED' as ApplicationState,
    Contract_Pending: 'CONTRACT_PENDING' as ApplicationState,
    Contracts_Out: 'CONTRACTS_OUT' as ApplicationState,
    /** Legacy spelling — still accepted on input. */
    'Contracts Out': 'CONTRACTS_OUT' as ApplicationState,
    /** Alias for UI label "Contracted" (same DB value as Contracts_Out). */
    Contracted: 'CONTRACTS_OUT' as ApplicationState,
    Signed_Contracts: 'SIGNED_CONTRACTS' as ApplicationState,
    'Funding Call': 'FUNDING_CALL' as ApplicationState,
    Disbursment: 'DISBURSMENT' as ApplicationState,
    Disbursement: 'DISBURSMENT' as ApplicationState,
    DISBURSEMENT: 'DISBURSMENT' as ApplicationState,
    Funded: 'FUNDED' as ApplicationState,
    FUNDED: 'FUNDED' as ApplicationState,
    FINAL: 'FINAL' as ApplicationState,
    Final: 'FINAL' as ApplicationState,
};

/** API input → verbatim `Application.currentState` string (not a Prisma workflow enum). */
const verbatimApplicationStateByInput: Record<string, string> = {
    'Contract Out': 'Contract Out',
    Contract_Generated: 'CONTRACT_GENERATED',
    CONTRACT_GENERATED: 'CONTRACT_GENERATED',
    'Contract Generated': 'CONTRACT_GENERATED',
};

const applicationStatePrismaToApi: Record<ApplicationState, string> = {
    [ApplicationState.DRAFT]: 'Draft',
    [ApplicationState.PENDING]: 'Pending',
    [ApplicationState.SUBMITTED]: 'Submitted',
    [ApplicationState.IN_PROGRESS]: 'In Progress',
    [ApplicationState.COMPLETED]: 'Completed',
    [ApplicationState.CANCELLED]: 'Cancelled',
    [ApplicationState.CONTRACT_PENDING]: 'Contract_Pending',
    [ApplicationState.CONTRACTS_OUT]: 'Contract Sent',
    [ApplicationState.SIGNED_CONTRACTS]: 'Signed_Contracts',
    [ApplicationState.FUNDING_CALL]: 'Funding Call',
    [ApplicationState.DISBURSMENT]: 'Disbursment',
    [ApplicationState.FUNDED]: 'Funded',
    [ApplicationState.FINAL]: 'FINAL',
};

const toPrismaApplicationState = (value: unknown): ApplicationState | undefined => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim();
    const upper = trimmed.toUpperCase().replace(/[\s-]+/g, '_');
    const normalizedKey = trimmed.replace(/[\s-]+/g, '_');
    const canonicalized =
        normalizedKey
            .split('_')
            .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
            .join('_');

    if (upper === 'FUNDING_CALL' || upper === 'FUNDINGCALL') return ApplicationState.FUNDING_CALL;
    if (upper === 'DISBURSMENT' || upper === 'DISBURSEMENT') return ApplicationState.DISBURSMENT;
    if (upper === 'PENDING') return ApplicationState.PENDING;
    if (upper === 'IN_PROGRESS') return ApplicationState.IN_PROGRESS;

    return (
        applicationStateApiToPrisma[trimmed] ||
        applicationStateApiToPrisma[normalizedKey] ||
        applicationStateApiToPrisma[canonicalized]
    );
};

const normalizeContractSentWorkflowLabel = (value: string): string | null => {
    const compact = value.trim().replace(/[\s_-]+/g, '').toLowerCase();
    if (
        compact === 'contractout' ||
        compact === 'contractsout' ||
        compact === 'contractsent' ||
        value.trim() === 'CONTRACT_SENT' ||
        value.trim() === 'Contract_Sent'
    ) {
        return 'Contract Sent';
    }
    return null;
};

const toApiApplicationState = (value: ApplicationState | string | null | undefined): string | undefined => {
    if (!value) return undefined;
    const asString = String(value);
    const contractSentLabel = normalizeContractSentWorkflowLabel(asString);
    if (contractSentLabel) return contractSentLabel;
    if (value in applicationStatePrismaToApi) {
        return applicationStatePrismaToApi[value as ApplicationState];
    }
    return asString;
};

const normalizeWorkflowQueueForApi = (queue: string | null | undefined): string | undefined => {
    if (!queue) return undefined;
    const trimmed = String(queue).trim();
    const contractSentLabel = normalizeContractSentWorkflowLabel(trimmed);
    return contractSentLabel ?? trimmed;
};

const WORKFLOW_QUEUES = {
    AGENT: 'Agent',
    UNDERWRITER: 'Underwriter',
    /** Stored in `Application.currentQueue` (human-readable label used across the app). */
    FINAL_UNDERWRITER: 'Final Underwriter',
} as const;

/** Stored in `Application.currentState` when a Final Underwriter approves (queue stays Final Underwriter). */
const FINAL_UNDERWRITER_APPROVED_STATE = 'Approved' as const;

const PENDING_QUEUES = [
    'New',
    WORKFLOW_QUEUES.AGENT,
    'On Hold',
    'Contracted',
    'Contract Out',
    'Contracts Out',
    'Review',
    'Underwriting',
    WORKFLOW_QUEUES.UNDERWRITER,
    'Final Review',
    WORKFLOW_QUEUES.FINAL_UNDERWRITER,
];

type WorkflowTransition = {
    queue: string;
    state?: ApplicationState | typeof FINAL_UNDERWRITER_APPROVED_STATE;
    action?: 'SEND_TO_UNDERWRITER' | 'SEND_TO_FINAL_UNDERWRITER' | 'APPROVED';
};

const normalizeQueueToken = (value: unknown): string => {
    if (typeof value !== 'string') return '';
    return value.trim().toUpperCase().replace(/[\s-]+/g, '_');
};

/** Clear exclusive underwriter claim when a deal enters or leaves the Underwriter queue. */
const patchClearUnderwriterClaimIfQueueChanged = (
    previousQueue: string | null | undefined,
    nextQueue: string | null | undefined,
): Pick<Prisma.ApplicationUpdateInput, 'claimedByUnderwriter' | 'claimedAt'> | undefined => {
    const prevIs = normalizeQueueToken(previousQueue ?? '') === 'UNDERWRITER';
    const nextIs = normalizeQueueToken(nextQueue ?? '') === 'UNDERWRITER';
    if (prevIs === nextIs) return undefined;
    return {
        claimedByUnderwriter: { disconnect: true },
        claimedAt: null,
    };
};

const resolveWorkflowQueueTransition = (targetQueue: string, actorRole?: string | null): WorkflowTransition => {
    const normalizedQueue = normalizeQueueToken(targetQueue);
    const normalizedRole = normalizeQueueToken(actorRole || '');

    const isUnderwriterTarget = normalizedQueue === 'UNDERWRITING' || normalizedQueue === 'UNDERWRITER';
    if (isUnderwriterTarget) {
        return {
            queue: WORKFLOW_QUEUES.UNDERWRITER,
            state: ApplicationState.IN_PROGRESS,
            action: 'SEND_TO_UNDERWRITER',
        };
    }

    const isFinalUnderwriterTarget = normalizedQueue === 'FINAL_REVIEW' || normalizedQueue === 'FINAL_UNDERWRITER';
    if (isFinalUnderwriterTarget) {
        return {
            queue: WORKFLOW_QUEUES.FINAL_UNDERWRITER,
            state: ApplicationState.IN_PROGRESS,
            action: 'SEND_TO_FINAL_UNDERWRITER',
        };
    }

    const isFinalUnderwriterActor =
        normalizedRole === 'FINAL_UNDERWRITER' || normalizedRole === 'FINALUNDERWRITER';
    if (normalizedQueue === 'APPROVED' && isFinalUnderwriterActor) {
        return {
            queue: WORKFLOW_QUEUES.FINAL_UNDERWRITER,
            state: FINAL_UNDERWRITER_APPROVED_STATE,
            action: 'APPROVED',
        };
    }

    if (normalizedQueue === 'AGENT') {
        return { queue: WORKFLOW_QUEUES.AGENT, state: ApplicationState.PENDING };
    }
    if (normalizedQueue === 'NEW') {
        return { queue: 'New', state: ApplicationState.PENDING };
    }

    /** Operations deal pipeline (matches GET /applications filters and `toWorkflowApiState`). */
    if (normalizedQueue === 'FINAL') {
        return { queue: 'Final', state: ApplicationState.FINAL };
    }
    if (normalizedQueue === 'FUNDING_CALL' || normalizedQueue === 'FUNDINGCALL') {
        return { queue: 'Funding Call', state: ApplicationState.FUNDING_CALL };
    }
    if (normalizedQueue === 'DISBURSMENT' || normalizedQueue === 'DISBURSEMENT') {
        return { queue: 'Disbursment', state: ApplicationState.DISBURSMENT };
    }
    if (normalizedQueue === 'FUNDED') {
        return { queue: 'Funded', state: ApplicationState.FUNDED };
    }

    return { queue: targetQueue };
};

const toWorkflowApiState = (queue: string | null | undefined, state: ApplicationState | string | null | undefined): string | undefined => {
    const normalizedQueue = normalizeQueueToken(queue || '');
    const mappedState = toApiApplicationState(state);
    const rawState = typeof state === 'string' ? state.trim() : '';
    const rawStateUpper = rawState.toUpperCase().replace(/[\s-]+/g, '_');

    // Operations pipeline: API `currentState` mirrors the deal stage (uppercase labels).
    if (normalizedQueue === 'FINAL') return 'FINAL';
    if (normalizedQueue === 'FUNDING_CALL' || normalizedQueue === 'FUNDINGCALL') return 'FUNDING CALL';
    if (normalizedQueue === 'DISBURSEMENT') return 'DISBURSEMENT';
    if (normalizedQueue === 'FUNDED') return 'FUNDED';

    if (normalizedQueue === 'APPROVED') {
        if (state === ApplicationState.COMPLETED) return mappedState;
        return 'Approved';
    }

    if (normalizedQueue === 'AGENT' || normalizedQueue === 'NEW') return 'Pending';

    if (normalizedQueue === 'UNDERWRITER' || normalizedQueue === 'UNDERWRITING' || normalizedQueue === 'REVIEW') {
        return 'In Progress';
    }

    if (normalizedQueue === 'FINAL_UNDERWRITER' || normalizedQueue === 'FINAL_REVIEW') {
        const stateLower = typeof state === 'string' ? state.trim().toLowerCase() : '';
        if (state === ApplicationState.COMPLETED || stateLower === 'approved') return 'Approved';
        return 'In Progress';
    }

    if (
        rawStateUpper === 'FUNDING_CALL' ||
        rawStateUpper === 'FUNDINGCALL' ||
        state === ApplicationState.FUNDING_CALL
    ) {
        return 'FUNDING CALL';
    }
    if (
        rawStateUpper === 'DISBURSMENT' ||
        rawStateUpper === 'DISBURSEMENT' ||
        state === ApplicationState.DISBURSMENT
    ) {
        return 'DISBURSEMENT';
    }
    if (rawStateUpper === 'FUNDED' || state === ApplicationState.FUNDED) {
        return 'FUNDED';
    }
    if (rawStateUpper === 'FINAL' || state === ApplicationState.FINAL) {
        return 'FINAL';
    }

    return mappedState;
};

/** Normalize deal-pipeline queue labels for comparison (matches funding-call controller pattern). */
const normalizeWorkflowQueueKeyForDisbursement = (queue: string | null | undefined) =>
    String(queue ?? '')
        .trim()
        .replace(/[\s_-]+/g, '')
        .toLowerCase();

const QUEUES_THAT_CAN_MOVE_TO_DISBURSEMENT = new Set([
    'agent',
    'underwriter',
    'finalunderwriter',
    'contracted',
    'contractout',
    'contractsout',
    'final',
    'fundingcall',
]);

const shouldSetApplicationQueueToDisbursement = (currentQueue: string | null | undefined) =>
    QUEUES_THAT_CAN_MOVE_TO_DISBURSEMENT.has(normalizeWorkflowQueueKeyForDisbursement(currentQueue));

// Helper to map Prisma Application (with includes) to the API shape previously returned by Mongoose
export const mapApplicationToApi = (app: any) => {
    if (!app) return app;

    const {
        id,
        applicationId,
        priority,
        type,
        loanAmount,
        note,
        currentQueue,
        currentState,
        createdAt,
        updatedAt,
        referringAgent,
        salesRepresentative,
        createdBy,
        client,
        iso,
        isoApplicationPayouts,
        files,
        claimedByUnderwriterId,
        claimedAt,
        claimedByUnderwriter,
        ...rest
    } = app;

    const mapUserLite = (u: any) =>
        u
            ? {
                _id: u.id,
                id: u.id,
                firstName: u.firstName,
                lastName: u.lastName,
                email: u.email,
                ...(u.role != null ? { role: u.role } : {}),
            }
            : undefined;

    const owners = client ? resolveClientOwners(client) : [];
    const primaryOwner = owners[0];

    const mappedClient =
        client &&
        ({
            ...client,
            _id: client.id,
            id: client.id,
            clientId: client.clientId,
            business: {
                name: client.businessName,
                email: client.businessEmail || '',
                number: client.businessNumber || '',
                website: client.businessWebsite || '',
                incorporationDate: client.businessIncorporationDate,
                incorporationState: client.businessIncorporationState || '',
                businessEntityType: client.businessEntityType || '',
                einNumber: client.businessEinNumber || '',
                annualRevenue: client.businessAnnualRevenue ?? undefined,
                monthlyRevenue: client.businessMonthlyRevenue ?? undefined,
                address: {
                    address1: client.businessAddress1 || '',
                    address2: client.businessAddress2 || '',
                    city: client.businessCity || '',
                    state: client.businessState || '',
                    zipCode: client.businessZipCode || '',
                },
            },
            owner: primaryOwner ?? {
                firstName: client.ownerFirstName,
                middleName: client.ownerMiddleName || '',
                lastName: client.ownerLastName,
                email: client.ownerEmail || '',
                mobileNumber: client.ownerMobileNumber || '',
                dateOfBirth: client.ownerDateOfBirth,
                ssn: client.ownerSsn || '',
                ficoScore: client.ownerFicoScore ?? undefined,
                ownershipStartDate: client.ownerOwnershipStartDate,
                ownershipPercentage: client.ownerOwnershipPercentage ?? undefined,
                address: {
                    address1: client.ownerAddress1 || '',
                    address2: client.ownerAddress2 || '',
                    city: client.ownerCity || '',
                    state: client.ownerState || '',
                    zipCode: client.ownerZipCode || '',
                },
            },
            owners,
        } as any);

    // files in Mongo were subdocuments with _id; here we synthesize _id from id
    const mappedFiles =
        files?.map((f: any) => ({
            _id: f.id,
            id: f.id,
            url: f.url,
            publicId: f.publicId,
            originalName: f.originalName,
            mimeType: f.mimeType,
            size: f.size,
            uploadedAt: f.uploadedAt,
            requestedDocumentSlug: f.requestedDocumentSlug,
            documentType: f.requestedDocumentSlug,
        })) || [];

    /** Matches ISO portal `/iso/:id/application-payout-status` (IsoApplicationPayout). */
    let isoCommissionPayout: {
        payoutStatus: 'paid' | 'pending' | 'clawbacks';
        scheduledPayDate: string | null;
        paidAt: string | null;
    } | null = null;
    const appIsoId = (app as { isoId?: string | null }).isoId;
    if (
        appIsoId &&
        Array.isArray(isoApplicationPayouts) &&
        isoApplicationPayouts.length > 0
    ) {
        const row =
            isoApplicationPayouts.find((p: any) => String(p?.isoId) === String(appIsoId)) ??
            isoApplicationPayouts[0];
        if (row && row.payoutStatus != null) {
            const schedRaw = row.scheduledPayDate;
            const paidRaw = row.paidAt;
            isoCommissionPayout = {
                payoutStatus: (() => {
                    const u = String(row.payoutStatus).toUpperCase();
                    if (u === 'PAID') return 'paid' as const;
                    if (u === 'CLAWBACKS') return 'clawbacks' as const;
                    return 'pending' as const;
                })(),
                scheduledPayDate:
                    schedRaw instanceof Date
                        ? schedRaw.toISOString().slice(0, 10)
                        : schedRaw
                            ? String(schedRaw).slice(0, 10)
                            : null,
                paidAt:
                    paidRaw instanceof Date
                        ? paidRaw.toISOString()
                        : paidRaw
                            ? String(paidRaw)
                            : null,
            };
        }
    }

    return {
        ...rest,
        _id: id,
        id,
        applicationId,
        priority,
        type,
        loanAmount: loanAmount ?? undefined,
        note,
        currentQueue: normalizeWorkflowQueueForApi(currentQueue) ?? currentQueue,
        currentState: toWorkflowApiState(currentQueue, currentState),
        /** DB `currentState` before workflow API mapping — use for dashboard buckets matching `/applications/stats`. */
        statsCurrentState: currentState,
        createdAt,
        updatedAt,
        referringAgent: mapUserLite(referringAgent),
        salesRepresentative: mapUserLite(salesRepresentative),
        createdBy: mapUserLite(createdBy),
        claimedByUnderwriterId: claimedByUnderwriterId ?? undefined,
        claimedAt:
            claimedAt instanceof Date
                ? claimedAt.toISOString()
                : claimedAt
                    ? String(claimedAt)
                    : undefined,
        claimedByUnderwriter: mapUserLite(claimedByUnderwriter),
        client: mappedClient,
        iso: iso
            ? {
                ...iso,
                _id: iso.id,
                id: iso.id,
            }
            : null,
        isoCommissionPayout,
        files: mappedFiles,
    };
};

const getAuthenticatedUser = (req: Request): AuthenticatedUser | null => {
    const user = req.user;
    if (!user) return null;
    return {
        id: user.id,
        role: user.role as any,
    };
};

/** @returns true when the response was already sent (403). */
const blockIfUnderwriterUnclaimedDeal = (
    res: Response,
    authUser: AuthenticatedUser | null,
    app: { currentQueue: string; claimedByUnderwriterId?: string | null } | null,
): boolean => {
    const deny = getUnderwriterClaimMutationDenial(authUser, app);
    if (!deny) return false;
    res.status(deny.status).json({ success: false, message: deny.message });
    return true;
};

/** PUT body only sets `isoId` — allowed on overview without an underwriter claim. */
const isApplicationIsoLinkOnlyBody = (body: Record<string, unknown>): boolean => {
    const keys = Object.keys(body ?? {}).filter((k) => body[k] !== undefined);
    return keys.length === 1 && keys[0] === 'isoId';
};

/**
 * Returns 403 when a workflow role (Agent/Underwriter/Final Underwriter) tries to
 * mutate an application that has advanced past their stage. Non-workflow roles
 * (Operations/Admin/Super Admin/Accountant/etc.) always pass through.
 *
 * Returns `true` when the request handler should `return` after the helper
 * sent the 403 response.
 */
const sendPreviewOnlyForbidden = (
    res: Response,
    user: AuthenticatedUser | null | undefined,
    application:
        | { currentQueue?: string | null; currentState?: string | null }
        | null
        | undefined,
): boolean => {
    if (!application) return false;
    const access = getApplicationStageAccessForUser(user, application);
    if (access.isPreview) {
        res.status(403).json({
            success: false,
            message:
                access.reason ||
                'This deal has moved past your stage and is read-only for your role.',
            code: 'STAGE_PREVIEW_ONLY',
            stageAccess: {
                stageKey: access.stageKey,
                nextStageLabel: access.nextStageLabel,
                roleKey: access.roleKey,
            },
        });
        return true;
    }
    return false;
};

const APPLICATION_ROUTE_ID_UUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resolveApplicationWhere = (
    idParam: string,
): Prisma.ApplicationWhereUniqueInput | null => {
    const ref = String(idParam ?? '').trim();
    if (!ref) return null;
    if (/^\d+$/.test(ref)) {
        const numericId = Number(ref);
        return Number.isFinite(numericId) ? { applicationId: numericId } : null;
    }
    if (!APPLICATION_ROUTE_ID_UUID.test(ref)) return null;
    return { id: ref };
};

class ApplicationController {
    // Create a new application
    async create(req: Request, res: Response) {
        try {
            const { priority, type, referringAgent, salesRepresentative, client, note, loanAmount, isoId } = req.body;

            // Validate required fields
            if (!priority || !type || !salesRepresentative || !client) {
                return res.status(400).json({
                    success: false,
                    message: 'Priority, application type, sales representative, and client are required',
                });
            }

            // Verify client exists; body `client` may be a UUID (id) or numeric clientId
            let clientRecord = null;
            if (typeof client === 'number' || (typeof client === 'string' && /^\d+$/.test(client))) {
                clientRecord = await prisma.client.findUnique({
                    where: { clientId: Number(client) },
                });
            } else {
                clientRecord = await prisma.client.findUnique({
                    where: { id: String(client) },
                });
            }
            if (!clientRecord) {
                return res.status(404).json({
                    success: false,
                    message: 'Client not found',
                });
            }

            let normalizedIsoId: string | null = null;
            let commissionPercentageFromIso = 0;
            if (isoId !== undefined && isoId !== null && String(isoId).trim() !== '') {
                normalizedIsoId = String(isoId).trim();
                const isoRecord = await (prisma as any).iso.findUnique({
                    where: { id: normalizedIsoId },
                    select: { id: true, commissionPercentage: true },
                });
                if (!isoRecord) {
                    return res.status(404).json({
                        success: false,
                        message: 'ISO not found',
                    });
                }
                commissionPercentageFromIso = Number(isoRecord.commissionPercentage ?? 0);
            }

            // Process uploaded files if any
            const uploadedFiles: any[] = [];
            const reqFiles = (req as any).files;

            // Check if files exist in the request (files field from FormData)
            if (reqFiles && reqFiles.files) {
                let filesToUpload = reqFiles.files;

                // Handle both single file and multiple files
                if (!Array.isArray(filesToUpload)) {
                    filesToUpload = [filesToUpload];
                }

                const folder = 'ih-crm/applications';
                const uploadResults = await uploadService.uploadMultipleFiles(filesToUpload, folder);

                for (const result of uploadResults) {
                    if (result.success && result.data) {
                        uploadedFiles.push({
                            url: result.data.secure_url,
                            publicId: result.data.public_id,
                            originalName: result.fileName,
                            mimeType: result.data.format,
                            size: result.data.bytes,
                            uploadedAt: new Date(),
                        });
                    }
                }
            }

            const authUser = getAuthenticatedUser(req);
            const createdById = resolveTenantUserId(req);
            // When an AGENT creates an application, set referringAgentId to them so they see it in their list
            const effectiveReferringAgentId = referringAgent
                ? String(referringAgent)
                : (authUser && String(authUser.role).toUpperCase() === 'AGENT' ? authUser.id : null);

            const loanAmountNum = loanAmount !== undefined && loanAmount !== '' && loanAmount !== null
                ? (typeof loanAmount === 'number' ? loanAmount : parseFloat(String(loanAmount).replace(/[^0-9.-]+/g, '')))
                : null;
            const roleUpper = String(authUser?.role || '').toUpperCase();
            const creationQueue = roleUpper === 'AGENT' ? WORKFLOW_QUEUES.AGENT : undefined;
            const creationState = roleUpper === 'AGENT' ? ApplicationState.PENDING : undefined;

            const application = await prisma.application.create({
                data: applicationCreateUncheckedData({
                    priority,
                    type,
                    salesRepresentativeId: String(salesRepresentative),
                    clientId: clientRecord.id,
                    note: note || '',
                    loanAmount: !isNaN(loanAmountNum as number) ? (loanAmountNum as number) : null,
                    commissionPercentage: commissionPercentageFromIso,
                    createdById,
                    referringAgentId: effectiveReferringAgentId,
                    isoId: normalizedIsoId,
                    currentQueue: creationQueue,
                    currentState: creationState,
                    files: uploadedFiles.length
                        ? {
                            createMany: {
                                data: uploadedFiles.map((f) => ({
                                    url: f.url,
                                    publicId: f.publicId,
                                    originalName: f.originalName,
                                    mimeType: f.mimeType,
                                    size: f.size,
                                    uploadedAt: f.uploadedAt,
                                })),
                            },
                        }
                        : undefined,
                }),
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    files: true,
                },
            });

            const populatedApplication = mapApplicationToApi(application);

            // Best-effort activity log (do not block main response)
            try {
                const authUserForLog = getAuthenticatedUser(req);
                const roleLabel = authUserForLog?.role
                    ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorName = (req as any).user?.name || '';
                const actionDescription = `${roleLabel} ${actorName}`.trim() + ' created the application.';

                await createApplicationActivityLog({
                    applicationId: application.id,
                    user: authUserForLog,
                    req,
                    actionType: 'CREATE_APPLICATION' as ApplicationActivityActionType,
                    actionDescription,
                    previousStatus: null,
                    currentStatus: `${application.currentQueue} / ${application.currentState}`,
                    metadata: {
                        queue: application.currentQueue,
                        state: application.currentState,
                    },
                });
            } catch (logError) {
                console.error('Failed to create activity log for application creation:', logError);
            }

            scheduleApplicationStageNotification({
                application: application as any,
                transitionAction: 'CREATED',
                actorId: createdById,
                actorName: (req as any).user?.name || '',
                actorRole: authUser?.role || null,
            });

            invalidateAllApplicationStatsCache();

            return res.status(201).json({
                success: true,
                message: 'Application created successfully',
                data: populatedApplication,
            });
        } catch (error) {
            console.error('Create application error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Add files to existing application
    async addFiles(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);

            const whereUnique: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(id)
                ? { applicationId: Number(id) }
                : { id };

            const { application, forbidden } = await getApplicationForUser(
                whereUnique,
                authUser,
                { files: true }
            );

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, application)) {
                return;
            }

            // Process uploaded files
            const reqFiles = (req as any).files;
            if (!reqFiles || !reqFiles.files) {
                return res.status(400).json({
                    success: false,
                    message: 'No files uploaded',
                });
            }

            let filesToUpload = reqFiles.files;
            // Handle both single and multiple files
            if (!Array.isArray(filesToUpload)) {
                filesToUpload = [filesToUpload];
            }

            console.log(`Uploading ${filesToUpload.length} file(s) for application ${application.id}`);

            const folder = 'ih-crm/applications';
            const uploadResults = await uploadService.uploadMultipleFiles(filesToUpload, folder);

            const newFiles: any[] = [];
            const failedUploads: string[] = [];

            for (let i = 0; i < uploadResults.length; i++) {
                const result = uploadResults[i];
                const fileName = filesToUpload[i]?.name || 'unknown';

                if (result.success && result.data) {
                    newFiles.push({
                        url: result.data.secure_url,
                        publicId: result.data.public_id,
                        originalName: result.fileName || fileName,
                        mimeType: result.data.format,
                        size: result.data.bytes,
                        uploadedAt: new Date(),
                    });
                } else {
                    console.error(`Failed to upload file ${fileName}:`, result.error || result.message);
                    failedUploads.push(fileName);
                }
            }

            if (newFiles.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `Failed to upload all files. ${failedUploads.length > 0 ? `Failed files: ${failedUploads.join(', ')}` : ''}`,
                });
            }

            const requestedDocumentSlug = String(
                (req.body as { requestedDocumentSlug?: string; documentType?: string })?.requestedDocumentSlug ||
                    // ISO approval-portal uploads tag the file with a documentType (driving_license / voided_check / other).
                    (req.body as { documentType?: string })?.documentType ||
                    '',
            )
                .trim()
                .toLowerCase();

            // Add new files to database
            try {
                await prisma.applicationFile.createMany({
                    data: newFiles.map((f) => ({
                        applicationId: application.id,
                        url: f.url,
                        publicId: f.publicId,
                        originalName: f.originalName,
                        mimeType: f.mimeType,
                        size: f.size,
                        uploadedAt: f.uploadedAt,
                        ...(requestedDocumentSlug ? { requestedDocumentSlug } : {}),
                    })),
                });
            } catch (dbError: any) {
                console.error('Database error while saving files:', dbError);
                return res.status(500).json({
                    success: false,
                    message: 'Failed to save files to database',
                });
            }

            // Fetch updated application with all relations
            const applicationIdForLookup = /^\d+$/.test(id) ? { applicationId: Number(id) } : { id };
            const updatedApplicationRecord = await prisma.application.findUnique({
                where: applicationIdForLookup,
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    files: true,
                },
            });

            if (!updatedApplicationRecord) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found after upload',
                });
            }

            const updatedApplication = mapApplicationToApi(updatedApplicationRecord);

            const responseMessage = failedUploads.length > 0
                ? `Successfully uploaded ${newFiles.length} file(s). Failed: ${failedUploads.join(', ')}`
                : `Successfully uploaded ${newFiles.length} file(s)`;

            // Best-effort activity log for file upload
            try {
                const authUserForLog = getAuthenticatedUser(req);
                const roleLabel = authUserForLog?.role
                    ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorName = (req as any).user?.name || '';

                await createApplicationActivityLog({
                    applicationId: updatedApplicationRecord.id,
                    user: authUserForLog,
                    req,
                    actionType: 'FILE_UPLOADED' as ApplicationActivityActionType,
                    actionDescription:
                        `${roleLabel} ${actorName}`.trim() + ` uploaded ${newFiles.length} file(s) to the application.`,
                    previousStatus: `${(application as any).currentQueue} / ${(application as any).currentState}`,
                    currentStatus: `${updatedApplicationRecord.currentQueue} / ${updatedApplicationRecord.currentState}`,
                    metadata: {
                        filesUploaded: newFiles.map((f) => ({
                            originalName: f.originalName,
                            url: f.url,
                            size: f.size,
                        })),
                        failedUploads,
                    },
                });
            } catch (logError) {
                console.error('Failed to create activity log for file upload:', logError);
            }

            if (requestedDocumentSlug && authUser?.id) {
                try {
                    const { notifyRequestersDocumentReceived } = await import(
                        '../services/documentRequestFulfillmentService'
                    );
                    await notifyRequestersDocumentReceived({
                        applicationUuid: application.id,
                        documentSlug: requestedDocumentSlug,
                        uploadedByUserId: String(authUser.id),
                    });
                } catch (notifyErr) {
                    console.error('Failed to notify document request fulfillment:', notifyErr);
                }
            }

            return res.status(200).json({
                success: true,
                message: responseMessage,
                data: updatedApplication,
                ...(failedUploads.length > 0 && { failedFiles: failedUploads }),
            });
        } catch (error: any) {
            console.error('Add files error:', error);
            console.error('Error stack:', error?.stack);

            // Handle database connection errors
            if (error?.code === 'ECONNRESET' || error?.code === '08P01' || error?.cause?.code === '08P01') {
                return res.status(503).json({
                    success: false,
                    message: 'Database connection error. Please try again later.',
                });
            }

            // Handle Prisma errors
            if (error?.code === 'P2025') {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    // Remove file from application
    async removeFile(req: Request, res: Response) {
        try {
            const { id, fileId } = req.params;

            if (!fileId || !id) {
                return res.status(400).json({
                    success: false,
                    message: 'ID is required',
                });
            }

            const authUser = getAuthenticatedUser(req);
            const { application, forbidden } = await getApplicationForUser(
                { id },
                authUser,
                { files: true }
            );

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, application)) {
                return;
            }

            const file = application.files?.find((f: any) => f.id === fileId);
            if (!file) {
                return res.status(404).json({
                    success: false,
                    message: 'File not found',
                });
            }

            await prisma.applicationFile.delete({ where: { id: fileId } });

            return res.status(200).json({
                success: true,
                message: 'File removed successfully',
            });
        } catch (error: any) {
            console.error('Remove file error:', error);

            // Handle Prisma P2025 error (record not found)
            if (error?.code === 'P2025') {
                return res.status(404).json({
                    success: false,
                    message: 'File not found or already deleted',
                });
            }

            // Handle database connection errors
            if (error?.code === 'ECONNRESET' || error?.code === '08P01' || error?.cause?.code === '08P01') {
                return res.status(503).json({
                    success: false,
                    message: 'Database connection error. Please try again later.',
                });
            }

            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    // Get all applications with pagination and filters
    async getAll(req: Request, res: Response) {
        try {
            const {
                page = 1,
                limit = 10,
                priority,
                type,
                currentQueue,
                currentState,
                operationsStatus,
                statsBucket,
                client,
                salesRepresentative,
                search,
                sortBy = 'createdAt',
                sortOrder = 'desc',
                lite,
            } = req.query;

            const authUser = getAuthenticatedUser(req);

            const rawUwClaim = req.query.underwriterClaim;
            const uwClaimNorm =
                rawUwClaim != null
                    ? String(Array.isArray(rawUwClaim) ? rawUwClaim[0] : rawUwClaim)
                        .trim()
                        .toLowerCase()
                    : '';
            const authRoleUpper = authUser?.role
                ? String(authUser.role).toUpperCase().replace(/-/g, '_')
                : '';

            const pageNum = Math.max(1, Number(page) || 1);
            const limitNum = Math.min(Math.max(1, Number(limit) || 10), 500);
            const skip = (pageNum - 1) * limitNum;
            const useLitePayload = String(lite ?? '').trim() === '1';

            let where: Prisma.ApplicationWhereInput = {};

            if (currentQueue) {
                where.currentQueue = String(currentQueue);
            }

            if (priority) where.priority = String(priority);
            if (type) where.type = { contains: String(type), mode: 'insensitive' };
            if (operationsStatus) {
                const operationsFilter = buildOperationsStatusFilterWhere(
                    String(operationsStatus),
                    resolveOperationsListFilterMode(authUser?.role),
                );
                const existingAnd = where.AND
                    ? Array.isArray(where.AND)
                        ? where.AND
                        : [where.AND]
                    : [];
                where = {
                    ...where,
                    AND: [...existingAnd, operationsFilter],
                };
            }
            if (currentState) {
                const rawState = String(currentState).trim();
                const mappedState = isContractedOpsKey(rawState)
                    ? undefined
                    : toPrismaApplicationState(rawState);
                const aliasValues =
                    dashboardStateQueueAliases[rawState] ||
                    dashboardStateQueueAliases[rawState.replace(/\s+/g, '_')] ||
                    dashboardStateQueueAliases[rawState.replace(/_/g, ' ')] ||
                    [];
                const queueFallbackVariants = Array.from(
                    new Set([
                        rawState,
                        rawState.replace(/_/g, ' '),
                        rawState.replace(/\s+/g, '_'),
                        ...aliasValues,
                    ])
                );

                // Some historical records store workflow status in currentQueue.
                // Match either enum state or queue text so dashboard-card filters remain reliable.
                const contractedStateLiterals = [
                    'Contract Out',
                    'CONTRACTS_OUT',
                    'Contracts Out',
                    'Contracted',
                ];
                const stateOrQueueFilter: Prisma.ApplicationWhereInput = mappedState
                    ? {
                        OR: [
                            { currentState: mappedState },
                            { currentQueue: { in: queueFallbackVariants } },
                        ],
                    }
                    : isContractedOpsKey(rawState)
                        ? {
                            OR: [
                                { currentQueue: { in: queueFallbackVariants } },
                                { currentState: { in: contractedStateLiterals } },
                            ],
                        }
                        : {
                            currentQueue: { in: queueFallbackVariants },
                        };

                const existingAnd = where.AND
                    ? Array.isArray(where.AND)
                        ? where.AND
                        : [where.AND]
                    : [];

                where = {
                    ...where,
                    AND: [...existingAnd, stateOrQueueFilter],
                };
            }

            if (statsBucket) {
                let uwBucketOpts: ApplicationStatsBucketWhereOptions | undefined;
                if (
                    (uwClaimNorm === 'unclaimed' || uwClaimNorm === 'mine') &&
                    authRoleUpper === 'UNDERWRITER' &&
                    authUser?.id
                ) {
                    uwBucketOpts = {
                        uwInbox: {
                            tab: uwClaimNorm as 'mine' | 'unclaimed',
                            viewerId: authUser.id,
                        },
                    };
                }

                const bucketWhere = buildApplicationStatsBucketWhere(String(statsBucket), uwBucketOpts);
                if (bucketWhere) {
                    const existingAnd = where.AND
                        ? Array.isArray(where.AND)
                            ? where.AND
                            : [where.AND]
                        : [];
                    where = {
                        ...where,
                        AND: [...existingAnd, bucketWhere],
                    };
                }
            }

            if (salesRepresentative) {
                where.salesRepresentativeId = String(salesRepresentative);
            }

            if (client) {
                let clientRecord = null;
                if (typeof client === 'string' && /^\d+$/.test(client)) {
                    clientRecord = await prisma.client.findUnique({
                        where: { clientId: Number(client) },
                    });
                } else if (typeof client === 'number') {
                    clientRecord = await prisma.client.findUnique({
                        where: { clientId: client },
                    });
                } else {
                    clientRecord = await prisma.client.findUnique({
                        where: { id: String(client) },
                    });
                }
                if (clientRecord) {
                    where.clientId = clientRecord.id;
                } else {
                    where.clientId = '__non_existing__';
                }
            }

            if (search) {
                const searchStr = String(search);
                where.OR = [
                    { type: { contains: searchStr, mode: 'insensitive' } },
                    { note: { contains: searchStr, mode: 'insensitive' } },
                    {
                        client: {
                            OR: [
                                { businessName: { contains: searchStr, mode: 'insensitive' } },
                                { businessEmail: { contains: searchStr, mode: 'insensitive' } },
                                { ownerFirstName: { contains: searchStr, mode: 'insensitive' } },
                                { ownerLastName: { contains: searchStr, mode: 'insensitive' } },
                                { ownerEmail: { contains: searchStr, mode: 'insensitive' } },
                            ],
                        },
                    },
                ];
            }

            if (
                (uwClaimNorm === 'unclaimed' || uwClaimNorm === 'mine') &&
                authRoleUpper === 'UNDERWRITER' &&
                authUser?.id
            ) {
                const existingAnd = where.AND
                    ? Array.isArray(where.AND)
                        ? where.AND
                        : [where.AND]
                    : [];
                const claimFilter: Prisma.ApplicationWhereInput =
                    uwClaimNorm === 'unclaimed'
                        ? { claimedByUnderwriterId: null }
                        : { claimedByUnderwriterId: authUser.id };
                where = {
                    ...where,
                    AND: [
                        ...existingAnd,
                        { currentQueue: WORKFLOW_QUEUES.UNDERWRITER },
                        claimFilter,
                    ],
                };
            }

            const listInclude: Prisma.ApplicationInclude = useLitePayload
                ? {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            businessName: true,
                            businessEmail: true,
                            ownerFirstName: true,
                            ownerLastName: true,
                            ownerEmail: true,
                            businessNumber: true,
                            businessWebsite: true,
                            businessIncorporationDate: true,
                            businessIncorporationState: true,
                            businessEntityType: true,
                            businessEinNumber: true,
                            businessAnnualRevenue: true,
                            businessMonthlyRevenue: true,
                            businessAddress1: true,
                            businessAddress2: true,
                            businessCity: true,
                            businessState: true,
                            businessZipCode: true,
                            ownerMiddleName: true,
                            ownerMobileNumber: true,
                            ownerDateOfBirth: true,
                            ownerSsn: true,
                            ownerFicoScore: true,
                            ownerOwnershipStartDate: true,
                            ownerOwnershipPercentage: true,
                            ownerAddress1: true,
                            ownerAddress2: true,
                            ownerCity: true,
                            ownerState: true,
                            ownerZipCode: true,
                        },
                    },
                    iso: { select: { id: true, name: true, email: true, phone: true } },
                    claimedByUnderwriter: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    OfferDecision: {
                        select: { offer: true },
                    },
                }
                : {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
                    client: true,
                    iso: true,
                    claimedByUnderwriter: {
                        select: { id: true, firstName: true, lastName: true, email: true },
                    },
                    isoApplicationPayouts: true,
                    termsOffers: {
                        orderBy: { updatedAt: 'desc' },
                        take: 1,
                        select: {
                            approvedAmount: true,
                            factorRate: true,
                            paybackAmount: true,
                            commissionAmount: true,
                        },
                    },
                    OfferDecision: {
                        select: {
                            offer: true,
                            decision: true,
                            rate: true,
                            fees: true,
                            refinanceAmount: true,
                            totalRemit: true,
                            ourRemit: true,
                            repayPerPeriod: true,
                            monthlyPayment: true,
                            frequency: true,
                        },
                    },
                };

            const { apps, total } = await fetchPaginatedApplicationsForList(prisma, {
                where,
                skip,
                take: limitNum,
                sortBy,
                sortOrder,
                include: listInclude,
            });

            let collectionBalanceByApplicationId = new Map<
                string,
                {
                    balanceDue: number;
                    sumOfRepaid: number;
                    paybackAmount: number;
                    grossRepaidDealEconomics: number;
                }
            >();

            const statsBucketKey =
                statsBucket != null ? String(statsBucket).trim().toLowerCase() : '';
            if (statsBucketKey === 'funded' && apps.length > 0) {
                try {
                    const balRows = await getBalancesForApplicationIds(
                        prisma,
                        apps.map((a) => a.id),
                    );
                    for (const row of balRows) {
                        collectionBalanceByApplicationId.set(row.applicationId, {
                            balanceDue: row.balanceDue,
                            sumOfRepaid: row.sumOfRepaid,
                            paybackAmount: row.paybackAmount,
                            grossRepaidDealEconomics: row.grossRepaidDealEconomics,
                        });
                    }
                } catch (embedErr) {
                    console.error('Embed collection balances (funded list):', embedErr);
                }
            }

            const applications = apps.map((app) => {
                const dto = mapApplicationToApi(app) as Record<string, unknown>;
                const bal = collectionBalanceByApplicationId.get(app.id);
                if (bal) {
                    dto.collectionBalanceDue = bal.balanceDue;
                    dto.collectionSumOfRepaid = bal.sumOfRepaid;
                    dto.collectionPaybackAmount = bal.paybackAmount;
                    dto.collectionGrossRepaidDealEconomics = bal.grossRepaidDealEconomics;
                }
                return dto;
            });

            return res.status(200).json({
                success: true,
                data: applications,
                pagination: {
                    currentPage: pageNum,
                    totalPages: Math.ceil(total / limitNum),
                    totalItems: total,
                    itemsPerPage: limitNum,
                },
            });
        } catch (error) {
            console.error('Get all applications error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    /**
     * Get applications by agent ID (referringAgentId).
     * - Frontend may send agentId in query (e.g. ?agentId=uuid).
     * - If logged-in user is AGENT: agentId is ignored and only their own applications are returned.
     * - If logged-in user is ADMIN/UNDERWRITER/FINAL_UNDERWRITER/ACCOUNTANT: applications for the given agentId are returned.
     */
    async getApplicationsByAgentId(req: Request, res: Response) {
        try {
            const raw = req.query;
            const queryAgentId = Array.isArray(raw.agentId) ? raw.agentId[0] : raw.agentId;
            const pageRaw = Array.isArray(raw.page) ? raw.page[0] : raw.page;
            const limitRaw = Array.isArray(raw.limit) ? raw.limit[0] : raw.limit;
            const sortByRaw = Array.isArray(raw.sortBy) ? raw.sortBy[0] : raw.sortBy;
            const sortOrderRaw = Array.isArray(raw.sortOrder) ? raw.sortOrder[0] : raw.sortOrder;

            const authUser = getAuthenticatedUser(req);
            const role = authUser?.role ? String(authUser.role).trim().toUpperCase().replace(/-/g, '_') : '';

            // AGENT can only see their own; ignore frontend agentId to prevent privilege escalation
            const effectiveAgentId =
                role === 'AGENT'
                    ? (authUser?.id ?? '')
                    : (queryAgentId ? String(queryAgentId).trim() : authUser?.id ?? '');

            if (!effectiveAgentId) {
                return res.status(400).json({
                    success: false,
                    message: 'Agent ID is required (or log in as an agent to see your own applications)',
                });
            }

            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (!uuidRegex.test(effectiveAgentId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid agent ID format (expected UUID)',
                });
            }

            const pageNum = Math.max(1, parseInt(String(pageRaw), 10) || 1);
            const limitNum = Math.min(Math.max(1, parseInt(String(limitRaw), 10) || 10), 100);
            const skip = (pageNum - 1) * limitNum;

            const where: Prisma.ApplicationWhereInput = {
                referringAgentId: effectiveAgentId,
            };

            const orderByField = sortByRaw === 'applicationId' ? 'applicationId' : 'createdAt';
            const orderDir = String(sortOrderRaw).toLowerCase() === 'asc' ? 'asc' : 'desc';
            const orderBy: Prisma.ApplicationOrderByWithRelationInput = {
                [orderByField]: orderDir,
            };

            const [apps, total] = await Promise.all([
                prisma.application.findMany({
                    where,
                    orderBy,
                    skip,
                    take: limitNum,
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
                        client: true,
                        iso: true,
                    },
                }),
                prisma.application.count({ where }),
            ]);

            const applications = apps.map(mapApplicationToApi);

            return res.status(200).json({
                success: true,
                data: applications,
                pagination: {
                    currentPage: pageNum,
                    totalPages: Math.ceil(total / limitNum) || 1,
                    totalItems: total,
                    itemsPerPage: limitNum,
                },
            });
        } catch (error: unknown) {
            const err = error as Error & { code?: string };
            console.error('Get applications by agent ID error:', err?.message ?? err, err?.stack);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Get application stats (counts and total loan amounts by queue/state)
    // Aligns with frontend getApplicationStatus: Pending = New, On Hold, Review, Underwriting, Final Review
    // Supports optional date range filtering via ?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
    async getStats(req: Request, res: Response) {
        try {
            const authUser = getAuthenticatedUser(req);
            const currentUserRole = authUser?.role;

            const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

            let start: Date | null = null;
            let end: Date | null = null;

            if (startDate) {
                const d = new Date(startDate);
                if (!isNaN(d.getTime())) {
                    d.setHours(0, 0, 0, 0);
                    start = d;
                }
            }
            if (endDate) {
                const d = new Date(endDate);
                if (!isNaN(d.getTime())) {
                    d.setHours(23, 59, 59, 999);
                    end = d;
                }
            }

            const uwRaw = req.query.underwriterClaim;
            const uwClaimNorm =
                uwRaw != null
                    ? String(Array.isArray(uwRaw) ? uwRaw[0] : uwRaw)
                        .trim()
                        .toLowerCase()
                    : '';
            let underwriterClaimParam: 'unclaimed' | 'mine' | null = null;
            if (uwClaimNorm === 'unclaimed' || uwClaimNorm === 'mine') {
                const roleUpper = String(currentUserRole ?? '')
                    .trim()
                    .toUpperCase()
                    .replace(/-/g, '_');
                if (roleUpper !== 'UNDERWRITER') {
                    return res.status(403).json({
                        success: false,
                        message: 'underwriterClaim stats are only available for the Underwriter role',
                    });
                }
                if (!authUser?.id) {
                    return res.status(401).json({
                        success: false,
                        message: 'Unauthorized',
                    });
                }
                underwriterClaimParam = uwClaimNorm as 'unclaimed' | 'mine';
            }

            const cacheKey = [
                authUser?.id ?? 'none',
                String(currentUserRole ?? ''),
                start ? start.toISOString() : '',
                end ? end.toISOString() : '',
                underwriterClaimParam ?? '',
            ].join('|');

            const cached = await getApplicationStatsCache(cacheKey);
            if (cached) {
                res.set('Cache-Control', 'private, max-age=5');
                return res.status(200).json({
                    success: true,
                    data: cached,
                });
            }

            const data = await aggregateApplicationStats({
                authUser,
                role: currentUserRole,
                startDate: start,
                endDate: end,
                underwriterClaim: underwriterClaimParam,
            });

            await setApplicationStatsCache(cacheKey, data);
            res.set('Cache-Control', 'private, max-age=5');

            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            console.error('Get application stats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    /**
     * Operations / Super Admin dashboard: all pipeline totals in one request (parallel counts, same filters as list).
     */
    async getOperationsDashboardSummary(req: Request, res: Response) {
        try {
            const authUser = getAuthenticatedUser(req);
            if (!authUser) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized',
                });
            }
            const roleKey = String(authUser.role ?? '').trim();
            const opsCacheKey = `${authUser.id}|${roleKey}`;
            const data = await withDashboardCache(
                DashboardCacheKind.OPS_SUMMARY,
                opsCacheKey,
                () => aggregateOperationsDashboardSummary(authUser),
            );
            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            console.error('Get operations dashboard summary error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }


    /**
     * Operations dashboard recent list: backend-filtered contracted pipeline rows.
     */
    async getOperationsDashboardRecentCases(req: Request, res: Response) {
        try {
            const authUser = getAuthenticatedUser(req);
            if (!authUser) {
                return res.status(401).json({
                    success: false,
                    message: 'Unauthorized',
                });
            }
            const rawLimit = Number(req.query.limit);
            const limit = Number.isFinite(rawLimit) ? rawLimit : 200;
            const roleKey = String(authUser.role ?? '').trim();
            const opsRecentKey = `${authUser.id}|${roleKey}|${limit}`;
            const data = await withDashboardCache(
                DashboardCacheKind.OPS_RECENT,
                opsRecentKey,
                () => listOperationsDashboardRecentCases(authUser, limit),
            );
            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            console.error('Get operations dashboard recent cases error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    /**
     * Admin dashboard stats
     * Aggregated metrics for the admin overview dashboard.
     */
    async getAdminDashboardStats(req: Request, res: Response) {
        try {
            const authUser = getAuthenticatedUser(req);
            const adminCached = await withDashboardCache(
                DashboardCacheKind.ADMIN,
                'global',
                async () => this.buildAdminDashboardStatsPayload(authUser),
            );
            return res.status(200).json({
                success: true,
                data: adminCached,
            });
        } catch (error) {
            console.error('Get admin dashboard stats error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    /** Heavy admin dashboard aggregation (cached via Redis / memory). */
    private async buildAdminDashboardStatsPayload(authUser: AuthenticatedUser | null) {
            const now = new Date();
            const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            last7Days.setHours(0, 0, 0, 0);
            const endOfToday = new Date(now);
            endOfToday.setHours(23, 59, 59, 999);

            const [lifetimeStats, last7Stats] = await Promise.all([
                aggregateApplicationStats({
                    authUser,
                    role: authUser?.role ?? '',
                    startDate: null,
                    endDate: null,
                }),
                aggregateApplicationStats({
                    authUser,
                    role: authUser?.role ?? '',
                    startDate: last7Days,
                    endDate: endOfToday,
                }),
            ]);

            const funded = lifetimeStats.funded;
            const approved = lifetimeStats.approved;
            const rejected = lifetimeStats.rejected;
            const pending = lifetimeStats.pending;

            const fundedLast7 = last7Stats.funded.count;
            const approvedLast7 = last7Stats.approved.count;
            const rejectedLast7 = last7Stats.rejected.count;
            const pendingLast7 = last7Stats.pending.count;

            // =========================
            // Users & related entities
            // =========================
            const [
                totalUsers,
                agents,
                underwriters,
                finalUnderwriters,
                operations,
                admins,
                totalClients,
                totalSyndicators,
            ] = await Promise.all([
                prisma.user.count(),
                prisma.user.count({ where: { role: 'AGENT' } }),
                prisma.user.count({ where: { role: 'UNDERWRITER' } }),
                prisma.user.count({ where: { role: 'FINAL_UNDERWRITER' } }),
                prisma.user.count({ where: { role: 'OPERATIONS' } }),
                prisma.user.count({ where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } }),
                prisma.client.count(),
                prisma.syndicator.count(),
            ]);

            // =========================
            // Monthly Trend (chart)
            // =========================
            const last12MonthsStart = new Date(now);
            last12MonthsStart.setMonth(now.getMonth() - 11);
            last12MonthsStart.setHours(0, 0, 0, 0);

            // ========= Monthly trend (12 months) =========
            const monthlySource = await prisma.application.findMany({
                where: {
                    createdAt: { gte: last12MonthsStart },
                },
                select: {
                    createdAt: true,
                    currentQueue: true,
                    currentState: true,
                    loanAmount: true,
                },
            });

            const monthLabels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthlyTrend = monthLabels.map((label) => ({
                period: label,
                approved: 0,
                funded: 0,
                rejected: 0,
            }));

            for (const app of monthlySource) {
                const created = new Date(app.createdAt);
                const monthIndex = created.getMonth(); // 0-11
                const bucket = monthlyTrend[monthIndex];
                const amount = app.loanAmount ?? 0;

                const kind = classifyFundedApprovedRejected(app.currentQueue, app.currentState);
                if (kind === 'funded') bucket.funded += amount;
                else if (kind === 'approved') bucket.approved += amount;
                else if (kind === 'rejected') bucket.rejected += amount;
            }

            // ========= Weekly trend (last 8 weeks) =========
            const last8WeeksStart = new Date(now);
            last8WeeksStart.setDate(now.getDate() - 7 * 7); // ~8 weeks back
            last8WeeksStart.setHours(0, 0, 0, 0);

            const weeklySource = await prisma.application.findMany({
                where: {
                    createdAt: { gte: last8WeeksStart },
                },
                select: {
                    createdAt: true,
                    currentQueue: true,
                    currentState: true,
                    loanAmount: true,
                },
            });

            // Helper: get week label as YYYY-Www (ISO-like)
            const getWeekKey = (date: Date) => {
                const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
                const dayNum = d.getUTCDay() || 7;
                d.setUTCDate(d.getUTCDate() + 4 - dayNum);
                const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
                const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
                return `${d.getUTCFullYear()}-W${weekNum.toString().padStart(2, '0')}`;
            };

            const weeklyBuckets: Record<string, { period: string; approved: number; funded: number; rejected: number }> =
                {};

            for (const app of weeklySource) {
                const created = new Date(app.createdAt);
                const key = getWeekKey(created);
                if (!weeklyBuckets[key]) {
                    weeklyBuckets[key] = { period: key, approved: 0, funded: 0, rejected: 0 };
                }
                const bucket = weeklyBuckets[key];
                const amount = app.loanAmount ?? 0;

                const kind = classifyFundedApprovedRejected(app.currentQueue, app.currentState);
                if (kind === 'funded') bucket.funded += amount;
                else if (kind === 'approved') bucket.approved += amount;
                else if (kind === 'rejected') bucket.rejected += amount;
            }

            // Sort by week and limit to last 8 buckets
            const weeklyTrend = Object.values(weeklyBuckets).sort((a, b) =>
                a.period.localeCompare(b.period),
            ).slice(-8);

            // ========= Yearly trend (by calendar year) =========
            const yearlySource = await prisma.application.findMany({
                select: {
                    createdAt: true,
                    currentQueue: true,
                    currentState: true,
                    loanAmount: true,
                },
            });

            const yearlyBuckets: Record<string, { period: string; approved: number; funded: number; rejected: number }> =
                {};

            for (const app of yearlySource) {
                const created = new Date(app.createdAt);
                const yearKey = created.getFullYear().toString();
                if (!yearlyBuckets[yearKey]) {
                    yearlyBuckets[yearKey] = { period: yearKey, approved: 0, funded: 0, rejected: 0 };
                }
                const bucket = yearlyBuckets[yearKey];
                const amount = app.loanAmount ?? 0;

                const kind = classifyFundedApprovedRejected(app.currentQueue, app.currentState);
                if (kind === 'funded') bucket.funded += amount;
                else if (kind === 'approved') bucket.approved += amount;
                else if (kind === 'rejected') bucket.rejected += amount;
            }

            const yearlyTrend = Object.values(yearlyBuckets).sort((a, b) =>
                a.period.localeCompare(b.period),
            );

            // ==================================
            // Application Pipeline Funnel chart
            // (weekly / monthly / yearly + rolling 12 months — matches dashboard dropdown)
            // ==================================
            const buildPipelineFunnelSnapshot = (
                rows: { createdAt: Date; currentQueue: string | null }[],
                periodStart: Date,
                periodEnd: Date,
            ) => {
                const filtered = rows.filter((r) => r.createdAt >= periodStart && r.createdAt <= periodEnd);
                const submit = filtered.length;
                let inProgress = 0;
                let waitingForDocuments = 0;
                let decisionMade = 0;

                const inProgressQueues = [
                    'New',
                    WORKFLOW_QUEUES.AGENT,
                    'Review',
                    'Underwriting',
                    WORKFLOW_QUEUES.UNDERWRITER,
                    'Final Review',
                    WORKFLOW_QUEUES.FINAL_UNDERWRITER,
                ];
                const waitingQueues = ['On Hold', 'Waiting for Documents'];
                const decisionQueues = ['Approved', 'Declined', 'Contracted', 'Contract Out', 'Contracts Out'];

                for (const app of filtered) {
                    const q = app.currentQueue;
                    if (q && inProgressQueues.includes(q)) inProgress += 1;
                    if (q && waitingQueues.includes(q)) waitingForDocuments += 1;
                    if (q && decisionQueues.includes(q)) decisionMade += 1;
                }

                const pct = submit > 0 ? (decisionMade / submit) * 100 : 0;
                return {
                    submit,
                    inProgress,
                    waitingForDocuments,
                    decisionMade,
                    conversionRate: {
                        percentage: Math.round(pct),
                        numerator: decisionMade,
                        denominator: submit,
                    },
                };
            };

            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());
            weekStart.setHours(0, 0, 0, 0);

            const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
            monthStart.setHours(0, 0, 0, 0);

            const yearStart = new Date(now.getFullYear(), 0, 1);
            yearStart.setHours(0, 0, 0, 0);

            const funnelFetchStart = new Date(
                Math.min(
                    weekStart.getTime(),
                    monthStart.getTime(),
                    yearStart.getTime(),
                    last12MonthsStart.getTime(),
                ),
            );

            const funnelRows = await prisma.application.findMany({
                where: {
                    createdAt: { gte: funnelFetchStart, lte: endOfToday },
                },
                select: {
                    createdAt: true,
                    currentQueue: true,
                },
            });

            const pipelineFunnel = {
                weekly: buildPipelineFunnelSnapshot(funnelRows, weekStart, endOfToday),
                monthly: buildPipelineFunnelSnapshot(funnelRows, monthStart, endOfToday),
                yearly: buildPipelineFunnelSnapshot(funnelRows, yearStart, endOfToday),
                rolling12Months: buildPipelineFunnelSnapshot(funnelRows, last12MonthsStart, endOfToday),
            };

            // =========================
            // Recent applications table
            // =========================
            const recentApplicationsRaw = await prisma.application.findMany({
                orderBy: { createdAt: 'desc' },
                take: 10,
                include: { client: true },
            });

            const recentApplications = recentApplicationsRaw.map((app) => ({
                id: app.id,
                applicationId: app.applicationId,
                date: app.createdAt,
                status: app.currentQueue,
                applicationName: app.client?.businessName || '',
                advanceAmount: app.loanAmount ?? null,
            }));

            return {
                users: {
                    total: totalUsers,
                    agents,
                    underwriters,
                    finalUnderwriters,
                    operations,
                    admins,
                    clients: totalClients,
                    syndicators: totalSyndicators,
                },
                applications: {
                    funded,
                    approved,
                    rejected,
                    pending,
                    last7Days: {
                        funded: fundedLast7,
                        approved: approvedLast7,
                        rejected: rejectedLast7,
                        pending: pendingLast7,
                    },
                },
                charts: {
                    monthlyTrend,
                    weeklyTrend,
                    yearlyTrend,
                    pipelineFunnel,
                },
                recentApplications,
            };
    }

    // Get single application by UUID or numeric applicationId
    async getById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);
            const where = resolveApplicationWhere(String(id ?? ''));
            if (!where) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid application ID (expected UUID or numeric applicationId).',
                });
            }

            const applicationInclude = {
                referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                client: {
                    include: {
                        owners: {
                            orderBy: { sortOrder: 'asc' as const },
                        },
                    },
                },
                iso: true,
                files: true,
                claimedByUnderwriter: { select: { id: true, firstName: true, lastName: true, email: true } },
            } as const;

            // OPERATIONS / SUPER_ADMIN can fetch any application directly, bypassing visibility filters
            if (authUser?.role === 'OPERATIONS' || authUser?.role === 'SUPER_ADMIN') {
                const applicationRecord = await prisma.application.findUnique({
                    where,
                    include: applicationInclude,
                });

                if (!applicationRecord) {
                    return res.status(404).json({
                        success: false,
                        message: 'Application not found',
                    });
                }

                await applyContractCompletedSyncToApplicationRecord(
                    prisma,
                    applicationRecord,
                    'application.getById.operations',
                );
                const application = mapApplicationToApi(applicationRecord);

                return res.status(200).json({
                    success: true,
                    data: application,
                });
            }

            const { application: applicationRecord, forbidden } = await getApplicationForUser(
                where,
                authUser,
                applicationInclude,
            );

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!applicationRecord) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            await applyContractCompletedSyncToApplicationRecord(
                prisma,
                applicationRecord,
                'application.getById',
            );
            const application = mapApplicationToApi(applicationRecord);

            return res.status(200).json({
                success: true,
                data: application,
            });
        } catch (error) {
            console.error('Get application by ID error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Get application by applicationId (numeric ID)
    async getByApplicationId(req: Request, res: Response) {
        try {
            const { applicationId } = req.params;
            const authUser = getAuthenticatedUser(req);

            // OPERATIONS / SUPER_ADMIN can fetch any application by numeric applicationId directly, bypassing visibility filters
            if (authUser?.role === 'OPERATIONS' || authUser?.role === 'SUPER_ADMIN') {
                const numericId = Number(applicationId);
                if (!applicationId || Number.isNaN(numericId)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid applicationId (expected numeric value)',
                    });
                }

                const applicationRecord = await prisma.application.findUnique({
                    where: { applicationId: numericId },
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        client: true,
                        iso: true,
                        files: true,
                    },
                });

                if (!applicationRecord) {
                    return res.status(404).json({
                        success: false,
                        message: 'Application not found',
                    });
                }

                await applyContractCompletedSyncToApplicationRecord(
                    prisma,
                    applicationRecord,
                    'application.getByApplicationId.operations',
                );
                const application = mapApplicationToApi(applicationRecord);

                return res.status(200).json({
                    success: true,
                    data: application,
                });
            }

            const { application: applicationRecord, forbidden } = await getApplicationForUser(
                { applicationId: Number(applicationId) },
                authUser,
                {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    files: true,
                }
            );

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!applicationRecord) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            await applyContractCompletedSyncToApplicationRecord(
                prisma,
                applicationRecord,
                'application.getByApplicationId',
            );
            const application = mapApplicationToApi(applicationRecord);

            return res.status(200).json({
                success: true,
                data: application,
            });
        } catch (error: any) {
            console.error('Get application by applicationId error:', error);

            // Handle database connection errors
            if (error?.code === 'ECONNRESET' || error?.code === '08P01' || error?.cause?.code === '08P01') {
                return res.status(503).json({
                    success: false,
                    message: 'Database connection error. Please try again later.',
                });
            }

            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    // Get applications by client
    async getByClient(req: Request, res: Response) {
        try {
            const { clientId } = req.params;
            const { page = 1, limit = 10 } = req.query;

            const pageNum = Number(page);
            const limitNum = Number(limit);
            const skip = (pageNum - 1) * limitNum;

            // clientId is numeric application-level clientId
            const clientRecord = await prisma.client.findUnique({
                where: { clientId: Number(clientId) },
            });
            if (!clientRecord) {
                return res.status(200).json({
                    success: true,
                    data: [],
                    pagination: {
                        currentPage: pageNum,
                        totalPages: 0,
                        totalItems: 0,
                        itemsPerPage: limitNum,
                    },
                });
            }

            const authUser = getAuthenticatedUser(req);
            let where: Prisma.ApplicationWhereInput = { clientId: clientRecord.id };
            where = mergeApplicationVisibilityWhere(where, authUser);

            const [apps, total] = await Promise.all([
                prisma.application.findMany({
                    where,
                    orderBy: { createdAt: 'desc' },
                    skip,
                    take: limitNum,
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
                        client: true,
                        iso: true,
                    },
                }),
                prisma.application.count({ where }),
            ]);

            const applications = apps.map(mapApplicationToApi);

            return res.status(200).json({
                success: true,
                data: applications,
                pagination: {
                    currentPage: pageNum,
                    totalPages: Math.ceil(total / limitNum),
                    totalItems: total,
                    itemsPerPage: limitNum,
                },
            });
        } catch (error) {
            console.error('Get applications by client error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Update application
    async update(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const {
                priority,
                type,
                referringAgent,
                salesRepresentative,
                client,
                note,
                currentQueue,
                currentState,
                loanAmount,
                /** CRM-only; not a DB column — maps to currentQueue + currentState */
                status,
                isoId,
                commissionPercentage,
                category,
            } = req.body;
            const authUser = getAuthenticatedUser(req);

            const idStr = String(id ?? '');
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(idStr)
                ? { applicationId: Number(idStr) }
                : { id: idStr };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const isoLinkOnlyUpdate = isApplicationIsoLinkOnlyBody(
                (req.body ?? {}) as Record<string, unknown>,
            );

            if (
                !isoLinkOnlyUpdate &&
                blockIfUnderwriterUnclaimedDeal(res, authUser, application)
            ) {
                return;
            }

            const data: any = {};

            if (client !== undefined) {
                let clientRecord = null;
                if (typeof client === 'string' && /^\d+$/.test(client)) {
                    clientRecord = await prisma.client.findUnique({ where: { clientId: Number(client) } });
                } else {
                    clientRecord = await prisma.client.findUnique({ where: { id: String(client) } });
                }
                if (!clientRecord) {
                    return res.status(404).json({
                        success: false,
                        message: 'Client not found',
                    });
                }
                data.clientId = clientRecord.id;
            }

            if (isoId !== undefined) {
                const trimmedIsoId = String(isoId ?? '').trim();
                if (!trimmedIsoId) {
                    data.isoId = null;
                    data.commissionPercentage = 0;
                } else {
                    const isoRecord = await (prisma as any).iso.findUnique({
                        where: { id: trimmedIsoId },
                        select: { id: true, commissionPercentage: true },
                    });
                    if (!isoRecord) {
                        return res.status(404).json({
                            success: false,
                            message: 'ISO not found',
                        });
                    }
                    data.isoId = trimmedIsoId;
                    data.commissionPercentage = Number(isoRecord.commissionPercentage ?? 0);
                }
            }

            if (priority !== undefined) data.priority = priority;
            if (type !== undefined) data.type = type;
            if (referringAgent !== undefined) data.referringAgentId = referringAgent || null;
            if (salesRepresentative !== undefined) data.salesRepresentativeId = salesRepresentative;
            if (note !== undefined) data.note = note;
            if (currentQueue !== undefined) {
                const queueKey = normalizeWorkflowQueueKeyForDisbursement(application.currentQueue);
                if (currentQueue === 'Disbursement') {
                    if (
                        queueKey === 'disbursement' ||
                        shouldSetApplicationQueueToDisbursement(application.currentQueue)
                    ) {
                        data.currentQueue = 'Disbursement';
                        if (currentState === undefined) {
                            data.currentState = ApplicationState.DISBURSMENT;
                        }
                    }
                } else if (currentQueue === 'Funded') {
                    if (queueKey === 'disbursement' || queueKey === 'funded') {
                        data.currentQueue = 'Funded';
                        if (currentState === undefined) {
                            data.currentState = ApplicationState.FUNDED;
                        }
                    }
                } else {
                    data.currentQueue = currentQueue;
                    if (currentState === undefined) {
                        if (currentQueue === 'Final') {
                            data.currentState = ApplicationState.FINAL;
                        } else if (currentQueue === 'Funding Call') {
                            data.currentState = ApplicationState.FUNDING_CALL;
                        }
                    }
                }
            }
            if (currentState !== undefined) {
                const trimmedState = String(currentState).trim();
                const queueForState =
                    currentQueue !== undefined ? String(currentQueue) : String(application.currentQueue || '');
                const stateIsApproved = trimmedState.toLowerCase() === 'approved';
                const queueIsFinalUw =
                    normalizeQueueToken(queueForState) === 'FINAL_UNDERWRITER';
                if (stateIsApproved && queueIsFinalUw) {
                    data.currentState = FINAL_UNDERWRITER_APPROVED_STATE;
                } else if (verbatimApplicationStateByInput[trimmedState] !== undefined) {
                    data.currentState = verbatimApplicationStateByInput[trimmedState];
                } else {
                    const mappedState = toPrismaApplicationState(currentState);
                    if (!mappedState) {
                        return res.status(400).json({
                            success: false,
                            message: `Valid state is required (${Object.keys(applicationStateApiToPrisma).join(', ')}, ${Object.keys(verbatimApplicationStateByInput).join(', ')})`,
                        });
                    }
                    data.currentState = mappedState;
                }
            }

            if (status !== undefined) {
                const roleUpper = String(authUser?.role || '')
                    .toUpperCase()
                    .replace(/-/g, '_');
                const st = String(status).trim().toLowerCase();
                if (st === 'approved') {
                    const canFuApprove = [
                        'FINAL_UNDERWRITER',
                        'SUPER_ADMIN',
                        'ADMIN',
                        'OPERATIONS',
                    ].includes(roleUpper);
                    if (canFuApprove) {
                        data.currentQueue = WORKFLOW_QUEUES.FINAL_UNDERWRITER;
                        data.currentState = FINAL_UNDERWRITER_APPROVED_STATE;
                    }
                } else if (st === 'sent to final underwriter') {
                    const canSendToFu = [
                        'AGENT',
                        'UNDERWRITER',
                        'ADMIN',
                        'SUPER_ADMIN',
                        'OPERATIONS',
                        'FINAL_UNDERWRITER',
                        'ACCOUNTANT',
                        'ACCOUNTS',
                    ].includes(roleUpper);
                    if (canSendToFu) {
                        data.currentQueue = WORKFLOW_QUEUES.FINAL_UNDERWRITER;
                        data.currentState = ApplicationState.IN_PROGRESS;
                    }
                }
            }

            if (loanAmount !== undefined) {
                const loanAmountNum = loanAmount === '' || loanAmount === null
                    ? null
                    : (typeof loanAmount === 'number' ? loanAmount : parseFloat(String(loanAmount).replace(/[^0-9.-]+/g, '')));
                data.loanAmount = loanAmountNum !== null && !isNaN(loanAmountNum) ? loanAmountNum : null;
            }

            if (commissionPercentage !== undefined) {
                const raw =
                    typeof commissionPercentage === 'number'
                        ? commissionPercentage
                        : parseFloat(String(commissionPercentage).replace(/[^0-9.-]+/g, ''));
                if (Number.isNaN(raw) || raw < 0 || raw > 100) {
                    return res.status(400).json({
                        success: false,
                        message: 'commissionPercentage must be a number between 0 and 100',
                    });
                }
                data.commissionPercentage = raw;
            }

            if (category !== undefined) {
                if (category === null) {
                    data.category = null;
                } else {
                    const trimmedCategory = String(category).trim();
                    data.category = trimmedCategory.length > 0 ? trimmedCategory : null;
                }
            }

            if (Object.keys(data).length === 0) {
                const fromQueue = currentQueue !== undefined ? String(currentQueue) : '';
                if (fromQueue === 'Disbursement') {
                    return res.status(400).json({
                        success: false,
                        message: `Cannot move to Disbursement from queue "${application.currentQueue}".`,
                    });
                }
                if (fromQueue === 'Funded') {
                    return res.status(400).json({
                        success: false,
                        message: `Cannot mark as Funded unless the application is in Disbursement (current queue: "${application.currentQueue}").`,
                    });
                }
                return res.status(400).json({
                    success: false,
                    message: 'No valid fields to update.',
                });
            }

            if (data.currentQueue !== undefined) {
                const uwClaimPatch = patchClearUnderwriterClaimIfQueueChanged(
                    application.currentQueue,
                    data.currentQueue,
                );
                if (uwClaimPatch) {
                    Object.assign(data, uwClaimPatch);
                }
            }

            const previousQueue = application.currentQueue;
            const previousState = application.currentState;
            const statusSentToFu =
                status !== undefined &&
                String(status).trim().toLowerCase() === 'sent to final underwriter';

            const updatedRecord = await prisma.application.update({
                where: whereClause,
                data,
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    files: true,
                    claimedByUnderwriter: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
            });

            const updatedApplication = mapApplicationToApi(updatedRecord);

            if (
                data.currentQueue !== undefined ||
                data.currentState !== undefined ||
                status !== undefined
            ) {
                const authUserForNotif = getAuthenticatedUser(req);
                scheduleApplicationStageNotification({
                    application: updatedRecord as any,
                    previousQueue,
                    previousState,
                    actorId: authUserForNotif?.id || null,
                    actorName: (req as any).user?.name || '',
                    actorRole: authUserForNotif?.role || null,
                    transitionAction: statusSentToFu ? 'SEND_TO_FINAL_UNDERWRITER' : 'QUEUE_CHANGED',
                });
            }

            invalidateAllApplicationStatsCache();

            return res.status(200).json({
                success: true,
                message: 'Application updated successfully',
                data: updatedApplication,
            });
        } catch (error) {
            console.error('Update application error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Update application queue
    async updateQueue(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { currentQueue } = req.body;

            const validQueues = [
                'New',
                'Review',
                'Underwriting',
                'Underwriter',
                'Final Review',
                'Final Underwriter',
                'Approved',
                'Declined',
                'On Hold',
                'Contracted',
                'Contract Out',
                'Contracts Out',
                'Agent',
                'Final',
                'Funding Call',
                'Disbursment',
                'Funded',
            ];
            if (!currentQueue || !validQueues.includes(currentQueue)) {
                return res.status(400).json({
                    success: false,
                    message: `Valid queue is required (${validQueues.join(', ')})`,
                });
            }

            const authUser = getAuthenticatedUser(req);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(id)
                ? { applicationId: Number(id) }
                : { id };

            const { application: existingApplication, forbidden } = await getApplicationForUser(
                whereClause,
                authUser
            );

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!existingApplication) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, existingApplication)) {
                return;
            }

            const previousQueue = existingApplication.currentQueue;
            const roleUpper = String((req as any).user?.role || '').toUpperCase();
            const transition = resolveWorkflowQueueTransition(currentQueue, roleUpper);

            const updateData: Prisma.ApplicationUpdateInput = {
                currentQueue: transition.queue,
            };
            if (transition.state) {
                updateData.currentState = transition.state;
            }
            const claimClear = patchClearUnderwriterClaimIfQueueChanged(previousQueue, transition.queue);
            if (claimClear) {
                Object.assign(updateData, claimClear);
            }

            const applicationRecord = await prisma.application.update({
                where: whereClause,
                data: updateData,
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    files: true,
                    claimedByUnderwriter: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
            });

            const application = mapApplicationToApi(applicationRecord);

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            // Best-effort activity log for queue change
            try {
                const authUserForLog = getAuthenticatedUser(req);
                const roleLabel = authUserForLog?.role
                    ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorName = (req as any).user?.name || '';

                let actionType: ApplicationActivityActionType = 'QUEUE_CHANGED';
                let description = `${roleLabel} ${actorName}`.trim() + ` moved application from ${previousQueue} to ${currentQueue}.`;

                const upperQueue = normalizeQueueToken(applicationRecord.currentQueue);
                const roleUpper = String(authUserForLog?.role || '').toUpperCase();

                if (transition.action === 'SEND_TO_UNDERWRITER' && roleUpper === 'AGENT') {
                    actionType = 'SEND_TO_UNDERWRITER';
                    description = `${roleLabel} ${actorName}`.trim() + ' sent the application to Underwriter.';
                } else if (transition.action === 'SEND_TO_FINAL_UNDERWRITER' && roleUpper === 'UNDERWRITER') {
                    actionType = 'SEND_TO_FINAL_UNDERWRITER';
                    description = `${roleLabel} ${actorName}`.trim() + ' forwarded the application to Final Underwriter.';
                } else if (transition.action === 'APPROVED') {
                    actionType = 'APPROVED';
                    description = `${roleLabel} ${actorName}`.trim() + ' approved the application.';
                }

                await createApplicationActivityLog({
                    applicationId: applicationRecord.id,
                    user: authUserForLog,
                    req,
                    actionType,
                    actionDescription: description,
                    previousStatus: `${previousQueue} / ${existingApplication.currentState}`,
                    currentStatus: `${applicationRecord.currentQueue} / ${applicationRecord.currentState}`,
                    metadata: {
                        previousQueue,
                        newQueue: applicationRecord.currentQueue,
                    },
                });
            } catch (logError) {
                console.error('Failed to create activity log for queue update:', logError);
            }

            // Stage notifications (all queue transitions + realtime push)
            try {
                const authUserForNotif = getAuthenticatedUser(req);
                scheduleApplicationStageNotification({
                    application: applicationRecord as any,
                    previousQueue,
                    previousState: existingApplication.currentState,
                    actorId: authUserForNotif?.id || null,
                    actorName: (req as any).user?.name || '',
                    actorRole: authUserForNotif?.role || null,
                    transitionAction: transition.action ?? 'QUEUE_CHANGED',
                });

                // Best-effort email when Agent sends to Underwriter (unchanged behaviour)
                const upperQueue = normalizeQueueToken(applicationRecord.currentQueue);
                const roleUpper = String(authUserForNotif?.role || '').toUpperCase();
                if (upperQueue === 'UNDERWRITER' && roleUpper === 'AGENT') {
                    const attributedSenderId = await resolveApplicationAttributedUserId(
                        req,
                        applicationRecord,
                    );
                    const senderId = attributedSenderId ? String(attributedSenderId) : '';
                    const senderName = String((req as any).user?.name || 'Agent').trim() || 'Agent';

                    const clientName =
                        (applicationRecord as any)?.client?.businessName ||
                        `${(applicationRecord as any)?.client?.ownerFirstName || ''} ${(applicationRecord as any)?.client?.ownerLastName || ''}`.trim() ||
                        'Client';
                    const appIdNumber = (applicationRecord as any)?.applicationId ?? '';

                    const underwriters = await prisma.user.findMany({
                        where: { role: 'UNDERWRITER', isActive: true },
                        select: { id: true, email: true, firstName: true, lastName: true },
                    });

                    const recipients = underwriters
                        .map((u) => ({
                            id: String(u.id),
                            email: String((u as any).email || ''),
                            name: `${(u as any).firstName || ''} ${(u as any).lastName || ''}`.trim(),
                        }))
                        .filter((u) => u.id && u.id !== senderId);

                    const baseUrl = resolveCrmFrontendBaseUrl();
                    const appRouteId =
                        (applicationRecord as any)?.applicationId != null &&
                            String((applicationRecord as any).applicationId).trim() !== ''
                            ? String((applicationRecord as any).applicationId)
                            : String((applicationRecord as any)?.id || applicationRecord.id);
                    const viewApplicationUrl = baseUrl
                        ? `${baseUrl.replace(/\/$/, '')}/application-details/${appRouteId}`
                        : undefined;

                    setImmediate(() => {
                        void Promise.allSettled(
                            recipients
                                .filter((r) => r.email)
                                .map((r) =>
                                    sendUnderwriterNewApplicationEmail({
                                        to: r.email,
                                        underwriterName: r.name || r.email,
                                        agentName: senderName,
                                        applicationNumber: appIdNumber,
                                        clientName,
                                        viewApplicationUrl,
                                    })
                                ),
                        );
                    });
                }
            } catch (notifError) {
                console.error('Failed to create stage notification for queue update:', notifError);
            }

            invalidateAllApplicationStatsCache();

            return res.status(200).json({
                success: true,
                message: 'Application queue updated successfully',
                data: application,
            });
        } catch (error) {
            console.error('Update application queue error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async claimUnderwriterDeal(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);
            const roleUpper = authUser?.role ? String(authUser.role).toUpperCase().replace(/-/g, '_') : '';
            if (roleUpper !== 'UNDERWRITER') {
                return res.status(403).json({
                    success: false,
                    message: 'Only underwriters can claim deals',
                });
            }
            const userId = authUser?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            const idStr = String(id ?? '');
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(idStr)
                ? { applicationId: Number(idStr) }
                : { id: idStr };

            const claimInclude: Prisma.ApplicationInclude = {
                referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
                client: true,
                iso: true,
                claimedByUnderwriter: { select: { id: true, firstName: true, lastName: true, email: true } },
            };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser, claimInclude);

            if (forbidden) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
            if (!application) {
                return res.status(404).json({ success: false, message: 'Application not found' });
            }

            if (normalizeQueueToken(application.currentQueue) !== 'UNDERWRITER') {
                return res.status(400).json({
                    success: false,
                    message: 'Only applications in the Underwriter queue can be claimed',
                });
            }

            const appRow = application as typeof application & {
                claimedByUnderwriterId?: string | null;
            };

            if (appRow.claimedByUnderwriterId && appRow.claimedByUnderwriterId === userId) {
                return res.status(200).json({
                    success: true,
                    message: 'Already claimed',
                    data: mapApplicationToApi(application),
                });
            }

            const updated = await prisma.application.updateMany({
                where: {
                    id: application.id,
                    currentQueue: WORKFLOW_QUEUES.UNDERWRITER,
                    claimedByUnderwriterId: null,
                },
                data: {
                    claimedByUnderwriterId: userId,
                    claimedAt: new Date(),
                },
            });

            if (updated.count === 0) {
                const refreshedLost = await prisma.application.findUnique({
                    where: { id: application.id },
                    include: claimInclude,
                });
                if (refreshedLost?.claimedByUnderwriterId === userId) {
                    return res.status(200).json({
                        success: true,
                        message: 'Already claimed',
                        data: mapApplicationToApi(refreshedLost),
                    });
                }
                return res.status(409).json({
                    success: false,
                    message: 'This deal was claimed by another underwriter',
                });
            }

            const refreshed = await prisma.application.findUnique({
                where: { id: application.id },
                include: claimInclude,
            });
            if (!refreshed) {
                return res.status(404).json({ success: false, message: 'Application not found' });
            }

            try {
                const actorName = String((req as any).user?.name || '').trim() || 'Underwriter';
                await createApplicationActivityLog({
                    applicationId: refreshed.id,
                    user: authUser,
                    req,
                    actionType: 'UNDERWRITER_CLAIMED',
                    actionDescription: `${actorName} claimed this deal for underwriting.`,
                    previousStatus: `${application.currentQueue} / ${application.currentState}`,
                    currentStatus: `${refreshed.currentQueue} / ${refreshed.currentState}`,
                    metadata: { claimedByUnderwriterId: userId },
                });
            } catch (logErr) {
                console.error('Failed to log underwriter claim:', logErr);
            }

            return res.status(200).json({
                success: true,
                message: 'Deal claimed',
                data: mapApplicationToApi(refreshed),
            });
        } catch (error) {
            console.error('Claim underwriter deal error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async releaseUnderwriterDeal(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);
            const roleUpper = authUser?.role
                ? String(authUser.role).toUpperCase().replace(/-/g, '_')
                : '';
            const allowedRoles = new Set(['ADMIN', 'SUPER_ADMIN']);
            if (!allowedRoles.has(roleUpper)) {
                return res.status(403).json({
                    success: false,
                    message: 'Only admin can take back a deal from Underwriter',
                });
            }
            const userId = authUser?.id;
            if (!userId) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }

            const idStr = String(id ?? '');
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(idStr)
                ? { applicationId: Number(idStr) }
                : { id: idStr };

            const claimInclude: Prisma.ApplicationInclude = {
                referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                createdBy: { select: { id: true, firstName: true, lastName: true, email: true, role: true } },
                client: true,
                iso: true,
                claimedByUnderwriter: { select: { id: true, firstName: true, lastName: true, email: true } },
            };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser, claimInclude);

            if (forbidden) {
                return res.status(403).json({ success: false, message: 'Forbidden' });
            }
            if (!application) {
                return res.status(404).json({ success: false, message: 'Application not found' });
            }

            if (normalizeQueueToken(application.currentQueue) !== 'UNDERWRITER') {
                return res.status(400).json({
                    success: false,
                    message: 'Only applications in the Underwriter queue can be released to the queue',
                });
            }

            const appRow = application as typeof application & {
                claimedByUnderwriterId?: string | null;
            };
            const claimedByUnderwriterId = appRow.claimedByUnderwriterId ?? null;
            if (!claimedByUnderwriterId) {
                return res.status(400).json({
                    success: false,
                    message: 'This deal is not currently claimed by an underwriter',
                });
            }

            await prisma.application.updateMany({
                where: {
                    id: application.id,
                    currentQueue: WORKFLOW_QUEUES.UNDERWRITER,
                    claimedByUnderwriterId,
                },
                data: {
                    claimedByUnderwriterId: null,
                    claimedAt: null,
                },
            });

            const refreshed = await prisma.application.findUnique({
                where: { id: application.id },
                include: claimInclude,
            });
            if (!refreshed) {
                return res.status(404).json({ success: false, message: 'Application not found' });
            }

            try {
                const actorName = String((req as any).user?.name || '').trim() || 'Underwriter';
                await createApplicationActivityLog({
                    applicationId: refreshed.id,
                    user: authUser,
                    req,
                    actionType: 'UNDERWRITER_RELEASED',
                    actionDescription: `${actorName} returned this deal to the underwriter queue.`,
                    previousStatus: `${application.currentQueue} / ${application.currentState}`,
                    currentStatus: `${refreshed.currentQueue} / ${refreshed.currentState}`,
                });
            } catch (logErr) {
                console.error('Failed to log underwriter release:', logErr);
            }

            return res.status(200).json({
                success: true,
                message: 'Claim released',
                data: mapApplicationToApi(refreshed),
            });
        } catch (error) {
            console.error('Release underwriter deal error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Update application state
    async updateState(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { currentState } = req.body;

            const trimmedState = String(currentState ?? '').trim();
            const validStates = [
                ...Object.keys(applicationStateApiToPrisma),
                ...Object.keys(verbatimApplicationStateByInput),
            ];
            const verbatimStored = verbatimApplicationStateByInput[trimmedState];
            const mappedState = verbatimStored ?? toPrismaApplicationState(currentState);
            if (!mappedState) {
                return res.status(400).json({
                    success: false,
                    message: `Valid state is required (${validStates.join(', ')})`,
                });
            }

            const authUser = getAuthenticatedUser(req);
            const idStr = String(id ?? '');
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(idStr)
                ? { applicationId: Number(idStr) }
                : { id: idStr };

            const { application: existingApplication, forbidden } = await getApplicationForUser(whereClause, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!existingApplication) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, existingApplication)) {
                return;
            }

            const previousState = existingApplication.currentState;

            const nextState = verbatimStored ?? mappedState;
            const applicationRecord = await prisma.application.update({
                where: whereClause,
                data: { currentState: nextState },
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    files: true,
                },
            });

            const application = mapApplicationToApi(applicationRecord);

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            // Best-effort activity log for state change
            try {
                const authUserForLog = getAuthenticatedUser(req);
                const roleLabel = authUserForLog?.role
                    ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorName = (req as any).user?.name || '';

                await createApplicationActivityLog({
                    applicationId: applicationRecord.id,
                    user: authUserForLog,
                    req,
                    actionType: 'STATUS_CHANGED' as ApplicationActivityActionType,
                    actionDescription:
                        `${roleLabel} ${actorName}`.trim() +
                        ` changed application state from ${previousState} to ${currentState}.`,
                    previousStatus: `${applicationRecord.currentQueue} / ${previousState}`,
                    currentStatus: `${applicationRecord.currentQueue} / ${applicationRecord.currentState}`,
                    metadata: {
                        previousState,
                        newState: currentState,
                    },
                });
            } catch (logError) {
                console.error('Failed to create activity log for state update:', logError);
            }

            invalidateAllApplicationStatsCache();

            return res.status(200).json({
                success: true,
                message: 'Application state updated successfully',
                data: application,
            });
        } catch (error) {
            console.error('Update application state error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Update document checklist (checked document labels)
    async updateDocumentChecklist(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { checkedLabels } = req.body as { checkedLabels?: string[] };

            const labels = Array.isArray(checkedLabels) ? checkedLabels : [];

            const authUser = getAuthenticatedUser(req);
            const { application: existingApplication, forbidden } = await getApplicationForUser({ id }, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!existingApplication) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, existingApplication)) {
                return;
            }

            const previousQueue = existingApplication.currentQueue;
            const previousState = existingApplication.currentState;

            const applicationRecord = await prisma.application.update({
                where: { id },
                data: { documentChecklistChecked: labels } as any,
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    files: true,
                },
            });

            const application = mapApplicationToApi(applicationRecord);

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            // Best-effort activity log for document checklist update
            try {
                const authUserForLog = getAuthenticatedUser(req);
                const roleLabel = authUserForLog?.role
                    ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                    : 'User';
                const actorName = (req as any).user?.name || '';

                await createApplicationActivityLog({
                    applicationId: applicationRecord.id,
                    user: authUserForLog,
                    req,
                    actionType: 'APPLICATION_UPDATED' as ApplicationActivityActionType,
                    actionDescription:
                        `${roleLabel} ${actorName}`.trim() + ' updated the document checklist.',
                    previousStatus: `${applicationRecord.currentQueue} / ${applicationRecord.currentState}`,
                    currentStatus: `${applicationRecord.currentQueue} / ${applicationRecord.currentState}`,
                    metadata: {
                        documentChecklistChecked: labels,
                    },
                });
            } catch (logError) {
                console.error('Failed to create activity log for document checklist update:', logError);
            }

            return res.status(200).json({
                success: true,
                message: 'Document checklist updated',
                data: application,
            });
        } catch (error) {
            console.error('Update document checklist error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Reject/Decline application
    async rejectApplication(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { reason, additionalComments, emailHtml, emailSubject } = req.body;
            const authUser = getAuthenticatedUser(req);
            const currentUserRole = authUser?.role;
            const isFinalUnderwriter = currentUserRole === 'FINAL_UNDERWRITER';

            if (!reason || reason.trim() === '') {
                return res.status(400).json({
                    success: false,
                    message: 'Rejection reason is required',
                });
            }

            const additionalCommentsText = additionalComments && additionalComments.trim() ? additionalComments.trim() : '';
            const fullNote = additionalCommentsText
                ? `${reason.trim()}\n\nAdditional comments: ${additionalCommentsText}`
                : reason.trim();

            const applicationStr = String(id);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(applicationStr)
                ? { applicationId: Number(applicationStr) }
                : { id: applicationStr };

            const { application: existingApplication, forbidden } = await getApplicationForUser(
                whereClause,
                authUser
            );

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!existingApplication) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, existingApplication)) {
                return;
            }

            const previousQueue = existingApplication.currentQueue;
            const previousState = existingApplication.currentState;

            const applicationRecord = await prisma.application.update({
                where: whereClause,
                data: {
                    currentQueue: 'Declined',
                    currentState: ApplicationState.CANCELLED,
                    note: fullNote,
                },
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    files: true,
                },
            });

            const application = mapApplicationToApi(applicationRecord);

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            // Send notification to Agent and Underwriters (when Final Underwriter rejects)
            try {
                const appRecord = applicationRecord as any;
                const attributedCreatedById = await resolveApplicationAttributedUserId(
                    req,
                    appRecord,
                );

                const recipientIds = new Set<string>();
                const addIfNotSender = (id: string) => {
                    const sid = String(id);
                    if (sid && sid !== String(attributedCreatedById)) recipientIds.add(sid);
                };
                if (appRecord.referringAgentId) addIfNotSender(appRecord.referringAgentId);
                if (appRecord.salesRepresentativeId) addIfNotSender(appRecord.salesRepresentativeId);
                if (isFinalUnderwriter) {
                    const underwriters = await prisma.user.findMany({
                        where: { role: 'UNDERWRITER' },
                        select: { id: true },
                    });
                    underwriters.forEach((u) => addIfNotSender(u.id));
                }

                await notifyApplicationRejected({
                    application: appRecord,
                    actorId: attributedCreatedById,
                    reason: fullNote,
                    extraRecipientIds: Array.from(recipientIds),
                });

                if (recipientIds.size === 0) {
                    console.warn('No recipient found for rejection notification. Application:', appRecord.id);
                }
            } catch (notificationError: any) {
                // Log notification error but don't fail the rejection
                console.error('Failed to send rejection notification:', notificationError);
                console.error('Notification error details:', {
                    message: notificationError?.message,
                    stack: notificationError?.stack
                });
            }

            // Best-effort activity log for rejection (skipped when the new decline template email is audited)
            let rejectionCommunicationLogged = false;
            const authUserForLog = getAuthenticatedUser(req);
            const roleLabel = authUserForLog?.role
                ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                : 'User';
            const actorName = (req as any).user?.name || '';
            const reasonText = reason.trim();

            // Best-effort: notify the linked ISO with the branded decline template.
            try {
                const iso = (applicationRecord as any).iso;
                const isoEmail = String(iso?.email ?? '').trim();
                if (isoEmail) {
                    const isoName = String(iso?.name ?? '').trim();
                    const clientEmailHtml =
                        typeof emailHtml === 'string' && emailHtml.trim() ? emailHtml.trim() : undefined;
                    const clientEmailSubject =
                        typeof emailSubject === 'string' && emailSubject.trim()
                            ? emailSubject.trim()
                            : undefined;
                    let trackingId: string | undefined;

                    if (clientEmailHtml) {
                        trackingId = randomUUID();
                        try {
                            await recordCommunicationAudit(req, {
                                outboundCommunicationId: trackingId,
                                applicationId: applicationRecord.id,
                                channel: 'EMAIL',
                                recipientType: 'ISO',
                                recipient: isoEmail,
                                subject: clientEmailSubject || 'Application Rejected',
                                body: clientEmailHtml,
                                templateName: 'Application declined template',
                                actionType: 'APPLICATION_REJECTED',
                                actionDescription:
                                    `${roleLabel} ${actorName}`.trim() +
                                    ` rejected the application and sent the decline template to the ISO. Reason: ${reasonText}`,
                                currentStatus: `${applicationRecord.currentQueue} / ${applicationRecord.currentState}`,
                                user: authUserForLog,
                                metadata: {
                                    reason: reasonText,
                                    additionalComments: additionalCommentsText,
                                    template: 'rejection',
                                    status: 'sent',
                                    hasLetterPdf: true,
                                    attachments: [REJECTION_EMAIL_PDF_FILENAME],
                                    delivery: {
                                        status: 'sent',
                                        sentAt: new Date().toISOString(),
                                    },
                                },
                            });
                            rejectionCommunicationLogged = true;
                        } catch (auditErr) {
                            console.error(
                                'Failed to create communication audit for rejection email:',
                                auditErr,
                            );
                        }
                    }

                    await sendApplicationRejectionEmail({
                        to: isoEmail,
                        clientName: isoName || isoEmail,
                        primaryReason: reason.trim(),
                        otherReasons: additionalCommentsText,
                        html: clientEmailHtml,
                        subject: clientEmailSubject,
                        trackingId,
                    });
                } else {
                    console.warn(
                        '[reject] Skipped ISO decline email — no linked ISO email on application',
                        applicationRecord.id,
                    );
                }
            } catch (rejectionEmailError) {
                console.error('Failed to send ISO rejection email:', rejectionEmailError);
            }

            if (!rejectionCommunicationLogged) {
            try {
                await createApplicationActivityLog({
                    applicationId: applicationRecord.id,
                    user: authUserForLog,
                    req,
                    actionType: 'APPLICATION_REJECTED' as ApplicationActivityActionType,
                    actionDescription:
                        `${roleLabel} ${actorName}`.trim() + ` rejected the application. Reason: ${reasonText}`,
                    previousStatus: `${previousQueue} / ${previousState}`,
                    currentStatus: `${applicationRecord.currentQueue} / ${applicationRecord.currentState}`,
                    metadata: {
                        reason: reasonText,
                        additionalComments: additionalCommentsText,
                    },
                });
            } catch (logError) {
                console.error('Failed to create activity log for rejection:', logError);
            }
            }

            return res.status(200).json({
                success: true,
                message: 'Application rejected successfully',
                data: application,
            });
        } catch (error) {
            console.error('Reject application error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    // Delete application and all dependent records in a single transaction
    async delete(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);

            const { application, forbidden } = await getApplicationForUser({ id }, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (sendPreviewOnlyForbidden(res, authUser, application)) return;

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, application)) {
                return;
            }

            await prisma.$transaction(
                async (tx: Prisma.TransactionClient) => {
                    await tx.scheduledRePayment.deleteMany({ where: { applicationId: id } });

                    const months = await tx.month.findMany({
                        where: { applicationId: id },
                        select: { id: true },
                    });
                    const monthIds = months.map((m) => m.id);
                    if (monthIds.length > 0) {
                        await tx.monthlyTransaction.deleteMany({
                            where: { monthId: { in: monthIds } },
                        });
                    }
                    await tx.month.deleteMany({ where: { applicationId: id } });

                    const analyses = await tx.bankAnalysis.findMany({
                        where: { applicationId: id },
                        select: { id: true },
                    });
                    const analysisIds = analyses.map((a) => a.id);
                    if (analysisIds.length > 0) {
                        await tx.bankAnalysisRow.deleteMany({
                            where: { bankAnalysisId: { in: analysisIds } },
                        });
                    }
                    await tx.bankAnalysis.deleteMany({ where: { applicationId: id } });

                    await tx.applicationFile.deleteMany({ where: { applicationId: id } });
                    await tx.comment.deleteMany({ where: { applicationId: id } });
                    await tx.complianceCheck.deleteMany({ where: { applicationId: id } });
                    await tx.note.deleteMany({ where: { applicationId: id } });
                    await tx.position.deleteMany({ where: { applicationId: id } });
                    await tx.applicationQuestionResponse.deleteMany({
                        where: { applicationId: id },
                    });

                    await tx.document.deleteMany({ where: { applicationId: id } });
                    await tx.fundingInfo.deleteMany({ where: { applicationId: id } });

                    await tx.docuSignEnvelope.deleteMany({
                        where: {
                            OR: [
                                { termsOffer: { applicationId: id } },
                                { contract: { applicationId: id } },
                            ],
                        },
                    });

                    await tx.paymentTerms.deleteMany({
                        where: { contract: { applicationId: id } },
                    });

                    await tx.termsOffer.deleteMany({ where: { applicationId: id } });

                    // Break optional FKs pointing at this application's contract(s) so Contract delete
                    // does not fail when the DB uses RESTRICT (TermsOffer / ACH / EPO / Addendum).
                    await tx.termsOffer.updateMany({
                        where: { contracts: { applicationId: id } },
                        data: { contractId: null },
                    });
                    await tx.aCH.updateMany({
                        where: { contract: { applicationId: id } },
                        data: { contractId: null },
                    });
                    await tx.ePO.updateMany({
                        where: { contract: { applicationId: id } },
                        data: { contractId: null },
                    });
                    await tx.addendum.updateMany({
                        where: { contract: { applicationId: id } },
                        data: { contractId: null },
                    });

                    // Contract rows reference OfferDecision (FK on Contract). Delete contracts first,
                    // otherwise OfferDecision delete fails on DBs without ON DELETE CASCADE to Contract.
                    await tx.funding.deleteMany({ where: { applicationId: id } });
                    await tx.disclosure.deleteMany({ where: { applicationId: id } });
                    await tx.contract.deleteMany({ where: { applicationId: id } });
                    await tx.offerDecision.deleteMany({ where: { applicationId: id } });

                    await tx.bankDetail.deleteMany({ where: { applicationId: id } });

                    await tx.documentRequest.deleteMany({ where: { applicationId: id } });
                    await tx.applicationSyndicatorDetails.deleteMany({ where: { applicationId: id } });
                    await tx.commissionRequest.deleteMany({ where: { applicationId: id } });

                    await tx.clientBankInfo.updateMany({
                        where: { applicationId: id },
                        data: { applicationId: null },
                    });

                    await tx.notification.updateMany({
                        where: { applicationId: id },
                        data: { applicationId: null },
                    });
                    await tx.conversation.updateMany({
                        where: { applicationId: id },
                        data: { applicationId: null },
                    });

                    await tx.applicationActivityLog.deleteMany({ where: { applicationId: id } });
                    await tx.fundingCall.deleteMany({ where: { applicationId: id } });
                    await tx.finalAnswer.deleteMany({ where: { applicationId: id } });
                    await tx.publicApprovalToken.deleteMany({ where: { applicationId: id } });
                    await tx.collectionPayment.deleteMany({ where: { applicationId: id } });
                    await tx.offers.deleteMany({ where: { applicationId: id } });
                    await tx.skippedActumTransactions.deleteMany({ where: { applicationId: id } });

                    const withSyndicators = await tx.application.findUnique({
                        where: { id },
                        select: { syndicator: { select: { id: true } } },
                    });
                    if (withSyndicators && withSyndicators.syndicator.length > 0) {
                        await tx.application.update({
                            where: { id },
                            data: { syndicator: { set: [] } },
                        });
                    }

                    await tx.application.delete({ where: { id } });
                },
                {
                    maxWait: 15_000,
                    timeout: 120_000,
                },
            );

            invalidateAllApplicationStatsCache();

            return res.status(200).json({
                success: true,
                message: 'Application deleted successfully',
            });
        } catch (error) {
            console.error('Delete application error:', error);
            const isDev = process.env.NODE_ENV !== 'production';
            let message = 'Internal server error';
            if (
                typeof error === 'object' &&
                error !== null &&
                'code' in error &&
                typeof (error as { code: unknown }).code === 'string' &&
                (error as { code: string }).code.startsWith('P')
            ) {
                const pe = error as { code: string; message: string; meta?: unknown };
                message = `${pe.code}: ${pe.message}`;
                console.error('Prisma error meta:', pe.meta);
            } else if (isDev && error instanceof Error) {
                message = error.message;
            }
            return res.status(500).json({
                success: false,
                message: isDev ? message : 'Internal server error',
            });
        }
    }

    // Extract information from PDF using Groq API
    // async extractPDFData(req: Request, res: Response) {
    //     try {
    //         const reqFiles = (req as any).files;
    //         if (!reqFiles || !reqFiles.pdf) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: 'No PDF file uploaded. Please upload a PDF file with field name "pdf"',
    //             });
    //         }

    //         const pdfFile = reqFiles.pdf;

    //         // Validate file type
    //         if (pdfFile.mimetype !== 'application/pdf') {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: 'Invalid file type. Please upload a PDF file.',
    //             });
    //         }

    //         // Get the temporary file path
    //         const tempFilePath = pdfFile.tempFilePath || pdfFile.filepath || pdfFile.path;

    //         if (!tempFilePath || !fs.existsSync(tempFilePath)) {
    //             return res.status(400).json({
    //                 success: false,
    //                 message: 'File not found. Please try uploading again.',
    //             });
    //         }

    //         // Extract data from PDF using Groq
    //         const extractedData = await pdfExtractionService.extractFromPDF(tempFilePath);

    //         // Print extracted information to console (for testing)
    //         console.log('='.repeat(80));
    //         console.log('PDF EXTRACTION RESULTS');
    //         console.log('='.repeat(80));
    //         console.log('File Name:', pdfFile.name || 'Unknown');
    //         console.log('File Size:', pdfFile.size, 'bytes');
    //         console.log('Extracted Data:');
    //         console.log(JSON.stringify(extractedData, null, 2));
    //         console.log('='.repeat(80));

    //         // Clean up temporary file
    //         try {
    //             if (fs.existsSync(tempFilePath)) {
    //                 fs.unlinkSync(tempFilePath);
    //             }
    //         } catch (cleanupError) {
    //             console.warn('Failed to cleanup temporary file:', cleanupError);
    //         }

    //         return res.status(200).json({
    //             success: true,
    //             message: 'PDF data extracted successfully. Check server console for extracted information.',
    //             data: extractedData,
    //         });
    //     } catch (error: any) {
    //         const msg = error?.message || 'Failed to extract data from PDF';
    //         console.error('PDF extraction error:', error);
    //         const isInsufficientText = /too little|no text|image-only|scanned|OCR/i.test(msg);
    //         return res.status(isInsufficientText ? 400 : 500).json({
    //             success: false,
    //             message: msg,
    //         });
    //     }
    // }

    // Process an uploaded application PDF coming from the frontend
    async processPDFUpload(req: Request, res: Response) {
        try {
            const reqFiles = (req as any).files;
            if (!reqFiles || !reqFiles.pdf) {
                return res.status(400).json({
                    success: false,
                    message: 'No PDF file uploaded. Please upload a PDF file with field name "pdf"',
                });
            }

            const pdfFile = reqFiles.pdf;
            const tempFilePath = pdfFile.tempFilePath || pdfFile.filepath || pdfFile.path;

            if (!tempFilePath || !fs.existsSync(tempFilePath)) {
                return res.status(400).json({
                    success: false,
                    message: 'File not found. Please try uploading again.',
                });
            }

            let parsedData: any;
            try {
                parsedData = await processPDF(tempFilePath);
            } finally {
                // Best-effort cleanup of temporary file
                try {
                    if (tempFilePath && fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                    }
                } catch {
                    // ignore cleanup errors
                }
            }

            return res.status(200).json({
                success: true,
                message: 'PDF processed successfully',
                data: parsedData,
            });
        } catch (error: any) {
            console.error('Process application PDF error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to process application PDF',
            });
        }
    }

    /**
     * POST multipart field `pdf` (multer): Claude hybrid PDF extraction → parseBusinessData →
     * existing `createClientAndApplicationFromPDFBuffer` (same persistence as Gmail / PDF buffer flow).
     */
    async uploadApplicationPdfOcrCreate(req: Request, res: Response) {
        try {
            const uploaded = (req as any).file as { buffer?: Buffer; originalname?: string } | undefined;
            if (!uploaded?.buffer?.length) {
                return res.status(400).json({
                    success: false,
                    message: 'No PDF uploaded. Use multipart field "pdf".',
                });
            }

            const pdfBuffer = uploaded.buffer;
            const pdfOriginalName =
                String(uploaded.originalname || 'application.pdf').trim() || 'application.pdf';

            const syntheticText = await extractPdfPlainTextForParsing(
                pdfBuffer,
                pdfOriginalName,
            );
            const previewLen = Math.max(200, Number(process.env.PDF_EXTRACT_DEBUG_PREVIEW_CHARS || 800));
            console.log(
                '[PDF upload] Synthetic parse text preview:\n',
                syntheticText.length > previewLen
                    ? `${syntheticText.slice(0, previewLen)}…`
                    : syntheticText,
            );

            const normalized = normalizeOcrTextForParsing(syntheticText);
            const parsedData = parseBusinessData(normalized);
            console.log('[PDF upload] Parsed structured data:', JSON.stringify(parsedData, null, 2));
            logExtractedBusinessDataCsv(parsedData, {
                tag: "[PDF upload]",
                fileName: pdfOriginalName,
            });

            if (!parsedData || typeof parsedData !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: 'Failed to parse Claude-extracted text into business/owner fields',
                });
            }

            const currentUserId = (req as any).user?.id;
            if (!currentUserId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }

            const requestedIsoIdRaw = (req as any).body?.isoId;
            const isoFromBody =
                typeof requestedIsoIdRaw === 'string' ? requestedIsoIdRaw.trim() : '';

            let result: Awaited<ReturnType<typeof createClientAndApplicationFromPDFBuffer>>;
            try {
                result = await createClientAndApplicationFromPDFBuffer(pdfBuffer, currentUserId, {
                    originalFileName: pdfOriginalName,
                    isoId: isoFromBody || null,
                    preParsedData: parsedData,
                });
            } catch (createErr) {
                if (createErr instanceof InsufficientParsedPdfError) {
                    return res.status(400).json({
                        success: false,
                        message: createErr.message,
                    });
                }
                throw createErr;
            }

            const populatedApplication = mapApplicationToApi(result.application);
            const mappedClient = mapClientToApi(result.client);
            console.log('[PDF upload] Created client:', JSON.stringify(mappedClient, null, 2));
            console.log('[PDF upload] Created application:', JSON.stringify(populatedApplication, null, 2));

            return res.status(200).json({
                success: true,
                message: result.existingClient
                    ? 'Client already existed; application created from PDF extraction.'
                    : 'Client and application created from PDF extraction.',
                data: {
                    client: mappedClient,
                    application: populatedApplication,
                    existingClient: result.existingClient,
                },
            });
        } catch (error: any) {
            console.error('[PDF upload] Error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed PDF upload pipeline',
            });
        }
    }

    // Auto-create Client + Application from uploaded PDF with SSN-based duplicate handling
    async autoCreateFromPDF(req: Request, res: Response) {
        try {
            const reqFiles = (req as any).files;
            if (!reqFiles || !reqFiles.pdf) {
                return res.status(400).json({
                    success: false,
                    message: 'No PDF file uploaded. Please upload a PDF file with field name "pdf"',
                });
            }

            const pdfFile = reqFiles.pdf;
            const tempFilePath = pdfFile.tempFilePath || pdfFile.filepath || pdfFile.path;

            if (!tempFilePath || !fs.existsSync(tempFilePath)) {
                return res.status(400).json({
                    success: false,
                    message: 'File not found. Please try uploading again.',
                });
            }

            const pdfBuffer = fs.readFileSync(tempFilePath);
            const pdfOriginalName = String(pdfFile.name || 'application.pdf').trim() || 'application.pdf';

            // Extract structured business/owner data from PDF
            let parsedData: any;
            try {
                parsedData = await processPDF(tempFilePath);
            } finally {
                // Best-effort cleanup of temporary file
                try {
                    if (tempFilePath && fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                    }
                } catch {
                    // ignore cleanup errors
                }
            }

            if (!parsedData || typeof parsedData !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: 'Failed to extract structured data from PDF',
                });
            }

            console.log(
                '[autoCreateFromPDF] Parsed structured data (extract/parse complete; DB transaction next):',
                JSON.stringify(parsedData, null, 2),
            );

            const business = parsedData.business || {};
            const owner = parsedData.owner || {};

            // Helper to normalize SSN (digits only)
            const normalizeSsn = (ssn: string | null | undefined) =>
                ssn ? String(ssn).replace(/\D/g, '') : null;

            // Helper to parse numeric amounts like "$12,345.67"
            const parseNumericAmount = (value: string | number | null | undefined): number | null => {
                if (value === null || value === undefined) return null;
                const str = String(value).replace(/[$,\s]/g, '').trim();
                if (!str) return null;
                const num = parseFloat(str);
                return isNaN(num) ? null : num;
            };

            // Helper to parse ISO-like date strings into Date objects
            const parseDate = (dateStr: string | null | undefined): Date | null => {
                if (!dateStr) return null;

                const parsed = new Date(dateStr);
                return isNaN(parsed.getTime()) ? null : parsed;
            };

            const ownerSsnRaw =
                owner.owner_ssn ||
                owner.ownerSsn ||
                owner.ssn ||
                null;
            const ownerSsnNorm = normalizeSsn(ownerSsnRaw);

            const currentUserId = (req as any).user?.id;
            if (!currentUserId) {
                return res.status(401).json({
                    success: false,
                    message: 'User authentication required',
                });
            }

            const pdfRoleUpper = String((req as any).user?.role || '').toUpperCase();
            // Same as Gmail PDF auto-create (`createClientAndApplicationFromPDFBuffer`): always land in Underwriter.
            const pdfAgentCreationQueue = WORKFLOW_QUEUES.UNDERWRITER;
            const pdfAgentCreationState = ApplicationState.IN_PROGRESS;
            const requestedApplicationTypeRaw = (req as any).body?.applicationType;
            const requestedIsoIdRaw = (req as any).body?.isoId;
            const requestedApplicationType = String(requestedApplicationTypeRaw || '')
                .trim()
                .replace(/-/g, '_')
                .toUpperCase();
            const requestedIsoId = String(requestedIsoIdRaw || '').trim();
            let validatedIsoId: string | null = null;
            let commissionPercentageFromIso = 0;
            if (requestedIsoId) {
                const isoRecord = await (prisma as any).iso.findUnique({
                    where: { id: requestedIsoId },
                    select: { id: true, commissionPercentage: true },
                });
                if (!isoRecord) {
                    return res.status(404).json({
                        success: false,
                        message: 'ISO not found',
                    });
                }
                validatedIsoId = isoRecord.id;
                commissionPercentageFromIso = Number(isoRecord.commissionPercentage ?? 0);
            }
            const applicationTypeForCreate =
                pdfRoleUpper === 'OPERATIONS' && requestedApplicationType === 'BYPASS'
                    ? 'Bypass'
                    : 'New';

            // Try to find existing client by SSN (full match or last 4 digits)
            let clientRecord: any | null = null;
            let existingClient = false;

            if (ownerSsnNorm && ownerSsnNorm.length >= 4) {
                const ssnLast4 = ownerSsnNorm.slice(-4);
                const clientsWithSsn = await prisma.client.findMany({
                    where: { ownerSsn: { not: null } },
                    orderBy: { createdAt: 'desc' },
                    take: 200,
                });
                clientRecord =
                    clientsWithSsn.find((c) => {
                        const cNorm = normalizeSsn(c.ownerSsn);
                        return cNorm && (cNorm === ownerSsnNorm || cNorm.slice(-4) === ssnLast4);
                    }) || null;

                if (clientRecord) {
                    existingClient = true;
                }
            }

            // Parse requested loan amount from business_requested_amount (or fallback aliases)
            const requestedAmountRaw =
                business.business_requested_amount ||
                business.requested_amount ||
                null;
            const loanAmountNum = parseNumericAmount(requestedAmountRaw);

            // Parse Gross Annual Sales and calculate monthly revenue (annual ÷ 12)
            const grossAnnualRaw = business.business_monthly_revenue; // parsed from "Gross Annual Sales"
            const annualRevenue = parseNumericAmount(grossAnnualRaw);
            const monthlyRevenue =
                annualRevenue != null ? Math.round((annualRevenue / 12) * 100) / 100 : null;

            let createdClient: any;
            let createdApplication: any;

            if (clientRecord) {
                // Case 1: Client already exists → create application only
                createdClient = clientRecord;

                createdApplication = await prisma.application.create({
                    data: applicationCreateUncheckedData({
                        priority: 'High',
                        type: applicationTypeForCreate,
                        salesRepresentativeId: currentUserId,
                        referringAgentId: currentUserId,
                        clientId: createdClient.id,
                        isoId: validatedIsoId,
                        commissionPercentage: commissionPercentageFromIso,
                        loanAmount: !isNaN(loanAmountNum as number) ? (loanAmountNum as number) : null,
                        createdById: currentUserId,
                        currentQueue: pdfAgentCreationQueue,
                        currentState: pdfAgentCreationState,
                    }),
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                        client: true,
                        iso: true,
                        files: true,
                    },
                });

                await attachBufferAsApplicationFile(createdApplication.id, pdfBuffer, pdfOriginalName);
                const applicationAfterPdf = await prisma.application.findUnique({
                    where: { id: createdApplication.id },
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                        client: true,
                        iso: true,
                        files: true,
                    },
                });
                const populatedApplication = mapApplicationToApi(applicationAfterPdf || createdApplication);
                const mappedClient = mapClientToApi(createdClient);

                console.log(
                    '[autoCreateFromPDF] Final DB response (existing client):',
                    JSON.stringify(
                        { client: mappedClient, application: populatedApplication, existingClient: true },
                        null,
                        2,
                    ),
                );

                scheduleApplicationStageNotification({
                    application: (applicationAfterPdf || createdApplication) as any,
                    transitionAction: 'CREATED',
                    actorId: currentUserId,
                    actorName: (req as any).user?.name || '',
                });

                return res.status(200).json({
                    success: true,
                    message: 'Client already exists. Application has been created for the existing client.',
                    data: {
                        client: mappedClient,
                        application: populatedApplication,
                        existingClient: true,
                    },
                });
            }

            try {
                assertReadyToCreateNewClientFromPdf(parsedData, clientRecord);
            } catch (assertErr) {
                if (assertErr instanceof InsufficientParsedPdfError) {
                    return res.status(400).json({
                        success: false,
                        message: assertErr.message,
                    });
                }
                throw assertErr;
            }

            // Case 2: Client does not exist → create client + application atomically
            const result = await prisma.$transaction(async (tx) => {
                const newClient = await tx.client.create({
                    data: {
                        businessName: business.business_name || business.dba_name || null,
                        businessEmail: business.business_email || null,
                        businessNumber: business.phone_number || null,
                        businessWebsite: business.business_website || null,
                        businessIncorporationDate: parseDate(business.business_incorporation_date),
                        businessIncorporationState:
                            business.business_incorporation_state || business.business_state || null,
                        businessEntityType: business.business_type_of_entity || null,
                        businessEinNumber: business.business_ein_number || null,
                        businessAnnualRevenue: annualRevenue ?? null,
                        businessMonthlyRevenue: monthlyRevenue ?? null,
                        businessAddress1: business.business_address1 || null,
                        businessAddress2: business.business_address2 || null,
                        businessCity: business.business_city || null,
                        businessState: business.business_state || null,
                        businessZipCode: business.business_zip_code || null,
                        ownerFirstName: owner.owner_first_name || null,
                        ownerMiddleName: owner.owner_middle_name || null,
                        ownerLastName: owner.owner_last_name || null,
                        ownerEmail: owner.owner_email || null,
                        ownerMobileNumber: owner.owner_mobile_number || null,
                        ownerDateOfBirth: parseDate(owner.owner_date_of_birth),
                        ownerSsn: ownerSsnNorm || null,
                        ownerFicoScore: owner.owner_fico_score
                            ? Number(owner.owner_fico_score)
                            : null,
                        ownerOwnershipStartDate: null,
                        ownerOwnershipPercentage: owner.owner_ownership_percentage
                            ? Number(owner.owner_ownership_percentage)
                            : null,
                        ownerAddress1: owner.owner_address1 || null,
                        ownerAddress2: null,
                        ownerCity: owner.owner_city || null,
                        ownerState: owner.owner_state || null,
                        ownerZipCode: owner.owner_zip_code || null,
                        createdById: currentUserId,
                    },
                });

                const newApplication = await tx.application.create({
                    data: applicationCreateUncheckedData({
                        priority: 'High',
                        type: applicationTypeForCreate,
                        salesRepresentativeId: currentUserId,
                        referringAgentId: currentUserId,
                        clientId: newClient.id,
                        isoId: validatedIsoId,
                        commissionPercentage: commissionPercentageFromIso,
                        loanAmount: !isNaN(loanAmountNum as number) ? (loanAmountNum as number) : null,
                        createdById: currentUserId,
                        currentQueue: pdfAgentCreationQueue,
                        currentState: pdfAgentCreationState,
                    }),
                    include: {
                        referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                        salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                        createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                        client: true,
                        iso: true,
                        files: true,
                    },
                });

                return { newClient, newApplication };
            }, { maxWait: 20_000, timeout: 120_000 });

            createdClient = result.newClient;
            createdApplication = result.newApplication;

            await attachBufferAsApplicationFile(createdApplication.id, pdfBuffer, pdfOriginalName);
            const applicationAfterPdf = await prisma.application.findUnique({
                where: { id: createdApplication.id },
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    files: true,
                },
            });
            const populatedApplication = mapApplicationToApi(applicationAfterPdf || createdApplication);
            const mappedClient = mapClientToApi(createdClient);

            console.log(
                '[autoCreateFromPDF] Final DB response (new client):',
                JSON.stringify(
                    { client: mappedClient, application: populatedApplication, existingClient: false },
                    null,
                    2,
                ),
            );

            scheduleApplicationStageNotification({
                application: (applicationAfterPdf || createdApplication) as any,
                transitionAction: 'CREATED',
                actorId: currentUserId,
                actorName: (req as any).user?.name || '',
            });

            return res.status(200).json({
                success: true,
                message: 'Client created successfully and application generated.',
                data: {
                    client: mappedClient,
                    application: populatedApplication,
                    existingClient: false,
                },
            });
        } catch (error: any) {
            console.error('Auto-create from PDF error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to auto-create client and application from PDF',
            });
        }
    }

    // Extract business and owner details from PDF using Groq API
    //     async extractBusinessDetails(req: Request, res: Response) {
    //         try {
    //             console.log('[extractBusinessDetails] Request received');
    //             const reqFiles = (req as any).files;
    //             if (!reqFiles || !reqFiles.pdf) {
    //                 console.log('[extractBusinessDetails] Status: FAILED - No PDF file in request (field name must be "pdf")');
    //                 return res.status(400).json({
    //                     success: false,
    //                     message: 'No PDF file uploaded. Please upload a PDF file with field name "pdf"',
    //                 });
    //             }

    //             const pdfFile = reqFiles.pdf;
    //             console.log('[extractBusinessDetails] Status: PDF file received from frontend', {
    //                 name: pdfFile.name,
    //                 size: pdfFile.size,
    //                 mimetype: pdfFile.mimetype,
    //             });

    //             // Validate file type
    //             if (pdfFile.mimetype !== 'application/pdf') {
    //                 console.log('[extractBusinessDetails] Status: FAILED - Invalid file type:', pdfFile.mimetype);
    //                 return res.status(400).json({
    //                     success: false,
    //                     message: 'Invalid file type. Please upload a PDF file.',
    //                 });
    //             }

    //             // Get the temporary file path
    //             const tempFilePath = pdfFile.tempFilePath || pdfFile.filepath || pdfFile.path;

    //             if (!tempFilePath || !fs.existsSync(tempFilePath)) {
    //                 console.log('[extractBusinessDetails] Status: FAILED - Temp file not found at path:', tempFilePath);
    //                 return res.status(400).json({
    //                     success: false,
    //                     message: 'File not found. Please try uploading again.',
    //                 });
    //             }

    //             console.log('[extractBusinessDetails] Status: PDF successfully received and saved on backend', { tempFilePath });

    //             // Custom prompt for business and owner details extraction (matching form fields)
    //             const prompt = `Read the business application form and extract ONLY the fields listed below.

    // Rules:
    // - Return ONLY valid JSON. No explanations or extra text.
    // - Map values to the exact field names below. Do not mix or duplicate values.
    // - If a field is not found, use null.
    // - Use smart matching: map similar labels to the correct field (e.g. "Company Name" → business_name, "FICO Score" → fico_score).
    // - Combine Address 1 and Address 2 (if present) into a single address field, separated by comma or newline.
    // - Return a single JSON object with two keys: "business" and "owner", each containing only these fields:

    // business (object with exactly these keys):
    // - business_name (map from "Business Name", "Company Name")
    // - email (map from "Email", "Business Email")
    // - telephone (map from "Phone Number", "Phone", "Business Phone")
    // - website (map from "Website", "Web Address")
    // - incorporation_date (map from "Incorporation Date", format: dd-mm-yyyy or yyyy-mm-dd)
    // - incorporation_state (map from "Incorporation State", e.g. "FL", "NY")
    // - type_of_entity (map from "Type of Business Entity", "Entity Type")
    // - ein_number (map from "EIN Number", "EIN", "Federal Tax ID")
    // - gross_annual_sales (map from "Gross Annual Sales", "Annual Revenue", "Annual Sales", numeric value without $ symbol or commas)
    // - requested_amount (map from "Requested Amount", "Loan Amount", "Amount Requested", numeric value without $ symbol)
    // - business_address (combine "Address 1" and "Address 2" if both exist)
    // - city (map from "City")
    // - state (map from "State" - business address state)
    // - zip (map from "Zip Code", "ZIP Code")

    // owner (object with exactly these keys):
    // - owner_first_name (map from "First Name")
    // - owner_middle_name (map from "Middle Name" - optional, use null if not found)
    // - owner_last_name (map from "Last Name")
    // - owner_email (map from "Email", "Owner Email")
    // - phone (map from "Mobile Number", "Phone", "Cell Phone")
    // - date_of_birth (map from "Date of Birth", format: dd-mm-yyyy or yyyy-mm-dd)
    // - ssn (map from "Social Security Number", "SSN", format: XXX-XX-XXXX)
    // - fico_score (map from "FICO Score", "Credit Score", numeric value 300-850)
    // - ownership_start_date (map from "Ownership Start Date", format: dd-mm-yyyy or yyyy-mm-dd)
    // - ownership_percentage (map from "Ownership Percentage", numeric value 0-100, without % symbol)
    // - owner_home_address (combine "Address 1" and "Address 2" if both exist)
    // - owner_city (map from "City")
    // - owner_state (map from "State")
    // - owner_zip (map from "Zip Code", "ZIP Code")

    // Example structure: {"business":{"business_name":"ABC Corp","email":"info@abc.com","telephone":"(555) 123-4567",...},"owner":{"owner_first_name":"John","owner_last_name":"Doe",...}}`;

    //             // Extract data from PDF using Groq with custom prompt
    //             console.log('[extractBusinessDetails] Status: Starting PDF extraction (Groq)...');
    //             let extractedData: any;
    //             try {
    //                 extractedData = await pdfExtractionService.extractFromPDF(tempFilePath, prompt);
    //                 console.log('[extractBusinessDetails] Status: PDF extraction completed successfully');
    //             } catch (extractionError: any) {
    //                 console.error('PDF extraction service error:', {
    //                     message: extractionError?.message || extractionError,
    //                     stack: extractionError?.stack,
    //                 });
    //                 throw new Error(`PDF extraction failed: ${extractionError?.message || 'Unknown error'}`);
    //             }

    //             // Validate extracted data structure
    //             if (!extractedData || typeof extractedData !== 'object') {
    //                 throw new Error('Invalid extracted data structure. Expected {business: {...}, owner: {...}}');
    //             }
    //             if (!extractedData.business || typeof extractedData.business !== 'object') {
    //                 extractedData.business = {};
    //             }
    //             if (!extractedData.owner || typeof extractedData.owner !== 'object') {
    //                 extractedData.owner = {};
    //             }

    //             // Normalize keys: AI may return camelCase or mixed; ensure snake_case for expected fields
    //             const pickFirst = (obj: any, keys: string[]): any => {
    //                 if (!obj) return null;
    //                 for (const k of keys) {
    //                     const v = obj[k];
    //                     if (v != null && String(v).trim() !== '') return v;
    //                 }
    //                 return null;
    //             };
    //             // Pick from business, then fallback to root (in case AI put fields at top level)
    //             const pickBusiness = (keys: string[]): any =>
    //                 pickFirst(extractedData.business, keys) ?? pickFirst(extractedData, keys);
    //             const pickOwner = (keys: string[]): any =>
    //                 pickFirst(extractedData.owner, keys) ?? pickFirst(extractedData, keys);
    //             // Split "FirstName LastName" or "LastName, FirstName" into first and last
    //             const splitFullName = (full: string | null | undefined): { first: string | null; last: string | null } => {
    //                 if (!full || typeof full !== 'string') return { first: null, last: null };
    //                 const s = full.trim();
    //                 if (!s) return { first: null, last: null };
    //                 if (s.includes(',')) {
    //                     const [last, ...firstParts] = s.split(',').map((p) => p.trim());
    //                     return { first: firstParts.join(' ').trim() || null, last: last || null };
    //                 }
    //                 const parts = s.split(/\s+/).filter((p) => p);
    //                 if (parts.length === 1) return { first: parts[0], last: null };
    //                 return { first: parts[0], last: parts.slice(1).join(' ') };
    //             };

    //             const businessData: Record<string, any> = {
    //                 business_name: pickBusiness(['business_name', 'businessName', 'name', 'companyName', 'company_name']),
    //                 email: pickBusiness(['email']),
    //                 telephone: pickBusiness(['telephone', 'phone']),
    //                 website: pickBusiness(['website']),
    //                 incorporation_date: pickBusiness(['incorporation_date', 'incorporationDate']),
    //                 incorporation_state: pickBusiness(['incorporation_state', 'incorporationState']),
    //                 type_of_entity: pickBusiness(['type_of_entity', 'typeOfEntity']),
    //                 ein_number: pickBusiness(['ein_number', 'einNumber']),
    //                 gross_annual_sales: pickBusiness(['gross_annual_sales', 'grossAnnualSales']),
    //                 requested_amount: pickBusiness(['requested_amount', 'requestedAmount']),
    //                 business_address: pickBusiness(['business_address', 'businessAddress']),
    //                 city: pickBusiness(['city']),
    //                 state: pickBusiness(['state']),
    //                 zip: pickBusiness(['zip', 'zipCode']),
    //             };
    //             const ownerFirst = pickOwner(['owner_first_name', 'ownerFirstName', 'firstName', 'first_name']);
    //             const ownerLast = pickOwner(['owner_last_name', 'ownerLastName', 'lastName', 'last_name']);
    //             const ownerFullName = pickOwner(['owner_name', 'ownerName', 'name', 'full_name', 'fullName']);
    //             const { first: splitFirst, last: splitLast } = splitFullName(ownerFullName);
    //             const ownerData: Record<string, any> = {
    //                 owner_first_name: ownerFirst ?? splitFirst,
    //                 owner_middle_name: pickOwner(['owner_middle_name', 'ownerMiddleName', 'middleName', 'middle_name']),
    //                 owner_last_name: ownerLast ?? splitLast,
    //                 owner_email: pickOwner(['owner_email', 'ownerEmail', 'email']),
    //                 phone: pickOwner(['phone', 'mobileNumber']),
    //                 date_of_birth: pickOwner(['date_of_birth', 'dateOfBirth']),
    //                 ssn: pickOwner(['ssn']),
    //                 fico_score: pickOwner(['fico_score', 'ficoScore']),
    //                 ownership_start_date: pickOwner(['ownership_start_date', 'ownershipStartDate']),
    //                 ownership_percentage: pickOwner(['ownership_percentage', 'ownershipPercentage']),
    //                 owner_home_address: pickOwner(['owner_home_address', 'ownerHomeAddress']),
    //                 owner_city: pickOwner(['owner_city', 'ownerCity', 'city']),
    //                 owner_state: pickOwner(['owner_state', 'ownerState', 'state']),
    //                 owner_zip: pickOwner(['owner_zip', 'ownerZip', 'zip']),
    //             };
    //             extractedData.business = businessData;
    //             extractedData.owner = ownerData;
    //             const requiredStr = (v: any) => (v != null && String(v).trim() !== '' ? String(v).trim() : null);
    //             const hasRequiredFields = !!(
    //                 requiredStr(businessData.business_name) &&
    //                 requiredStr(ownerData.owner_first_name) &&
    //                 requiredStr(ownerData.owner_last_name)
    //             );

    //             // If required fields are missing, return partial extraction (200) so frontend can show extracted data
    //             if (!hasRequiredFields) {
    //                 console.log('[extractBusinessDetails] Status: Partial extraction - missing required fields', {
    //                     business_name: !!requiredStr(businessData.business_name),
    //                     owner_first_name: !!requiredStr(ownerData.owner_first_name),
    //                     owner_last_name: !!requiredStr(ownerData.owner_last_name),
    //                     normalized: { business_name: businessData.business_name, owner_first_name: ownerData.owner_first_name, owner_last_name: ownerData.owner_last_name },
    //                 });
    //                 try {
    //                     if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath);
    //                 } catch (_) {}
    //                 return res.status(200).json({
    //                     success: true,
    //                     message: 'Partial extraction: some required fields (business name, owner first/last name) could not be extracted. Please complete and submit manually.',
    //                     data: {
    //                         business: businessData,
    //                         owner: ownerData,
    //                         extractedData: { business: businessData, owner: ownerData },
    //                         partialExtraction: true,
    //                     },
    //                 });
    //             }

    //             // Get current logged-in user
    //             const currentUserId = (req as any).user?.id;
    //             if (!currentUserId) {
    //                 throw new Error('User authentication required');
    //             }

    //             // Helper function to parse address (split combined address into address1 and address2)
    //             const parseAddress = (address: string | null | undefined): { address1: string; address2: string } => {
    //                 if (!address) return { address1: '', address2: '' };
    //                 const parts = address.split(/[,\n]/).map(p => p.trim()).filter(p => p);
    //                 return {
    //                     address1: parts[0] || '',
    //                     address2: parts.slice(1).join(', ') || '',
    //                 };
    //             };

    //             // Helper to parse numeric amount (remove commas, spaces, $, etc.)
    //             const parseNumericAmount = (value: string | number | null | undefined): number | null => {
    //                 if (value === null || value === undefined) return null;
    //                 const str = String(value).replace(/[$,\s]/g, '').trim();
    //                 if (!str) return null;
    //                 const num = parseFloat(str);
    //                 return isNaN(num) ? null : num;
    //             };

    //             // Parse Gross Annual Sales and calculate monthly revenue (annual ÷ 12)
    //             const grossAnnualRaw = businessData.gross_annual_sales;
    //             const annualRevenue = parseNumericAmount(grossAnnualRaw);
    //             const monthlyRevenue = annualRevenue != null ? Math.round((annualRevenue / 12) * 100) / 100 : null;

    //             // Helper function to parse date string to Date object
    //             const parseDate = (dateStr: string | null | undefined): Date | null => {
    //                 if (!dateStr) return null;
    //                 try {
    //                     // Try common date formats: dd-mm-yyyy, yyyy-mm-dd, mm/dd/yyyy
    //                     const formats = [
    //                         /^(\d{2})-(\d{2})-(\d{4})$/, // dd-mm-yyyy
    //                         /^(\d{4})-(\d{2})-(\d{2})$/, // yyyy-mm-dd
    //                         /^(\d{2})\/(\d{2})\/(\d{4})$/, // mm/dd/yyyy
    //                     ];

    //                     for (const format of formats) {
    //                         const match = dateStr.match(format);
    //                         if (match) {
    //                             if (format === formats[0]) {
    //                                 // dd-mm-yyyy
    //                                 return new Date(`${match[3]}-${match[2]}-${match[1]}`);
    //                             } else if (format === formats[1]) {
    //                                 // yyyy-mm-dd
    //                                 return new Date(dateStr);
    //                             } else if (format === formats[2]) {
    //                                 // mm/dd/yyyy
    //                                 return new Date(`${match[3]}-${match[1]}-${match[2]}`);
    //                             }
    //                         }
    //                     }
    //                     // Fallback: try direct Date parsing
    //                     const parsed = new Date(dateStr);
    //                     return isNaN(parsed.getTime()) ? null : parsed;
    //                 } catch {
    //                     return null;
    //                 }
    //             };

    //             // Transform extracted data to client creation format
    //             const businessAddress = parseAddress(businessData.business_address);
    //             const ownerAddress = parseAddress(ownerData.owner_home_address);

    //             // Normalize for comparison: EIN = digits only (last 9), SSN = digits only (last 4 or full 9)
    //             const normalizeEin = (ein: string | null | undefined) =>
    //                 ein ? String(ein).replace(/\D/g, '').slice(-9) : null;
    //             const normalizeSsn = (ssn: string | null | undefined) =>
    //                 ssn ? String(ssn).replace(/\D/g, '') : null;

    //             // Avoid duplicate client: find existing by EIN, then business name + email, then owner SSN + business name
    //             let createdClient: any;
    //             let existingClient = false;
    //             const einNormalized = normalizeEin(businessData.ein_number);
    //             const businessNameNorm = businessData.business_name?.trim() || '';
    //             const businessEmailNorm = businessData.email?.trim().toLowerCase() || '';
    //             const ownerSsnNorm = normalizeSsn(ownerData.ssn);

    //             // 1) Match by EIN (strongest)
    //             if (einNormalized) {
    //                 const clientsWithEin = await prisma.client.findMany({
    //                     where: { businessEinNumber: { not: null } },
    //                     orderBy: { createdAt: 'desc' },
    //                     take: 500,
    //                 });
    //                 const existingByEin = clientsWithEin.find(
    //                     (c) => normalizeEin(c.businessEinNumber) === einNormalized
    //                 );
    //                 if (existingByEin) {
    //                     createdClient = existingByEin;
    //                     existingClient = true;
    //                     console.log(`♻️ Using existing client (matched by EIN): ${createdClient.businessName} (ID: ${createdClient.clientId})`);
    //                 }
    //             }

    //             // 2) Match by business name + business email (case-insensitive)
    //             if (!createdClient && businessNameNorm && businessEmailNorm) {
    //                 const existingByBusiness = await prisma.client.findFirst({
    //                     where: {
    //                         businessName: { equals: businessNameNorm, mode: 'insensitive' },
    //                         businessEmail: { equals: businessEmailNorm, mode: 'insensitive' },
    //                     },
    //                     orderBy: { createdAt: 'desc' },
    //                 });
    //                 if (existingByBusiness) {
    //                     createdClient = existingByBusiness;
    //                     existingClient = true;
    //                     console.log(`♻️ Using existing client (matched by business name + email): ${createdClient.businessName} (ID: ${createdClient.clientId})`);
    //                 }
    //             }

    //             // 3) Match by owner SSN + business name (when EIN/email missing or different)
    //             if (!createdClient && ownerSsnNorm && businessNameNorm && ownerSsnNorm.length >= 4) {
    //                 const ssnLast4 = ownerSsnNorm.slice(-4);
    //                 const clientsWithSsn = await prisma.client.findMany({
    //                     where: {
    //                         ownerSsn: { not: null },
    //                         businessName: { equals: businessNameNorm, mode: 'insensitive' },
    //                     },
    //                     orderBy: { createdAt: 'desc' },
    //                     take: 200,
    //                 });
    //                 const existingByOwner = clientsWithSsn.find((c) => {
    //                     const cSsn = normalizeSsn(c.ownerSsn);
    //                     return cSsn && (cSsn === ownerSsnNorm || cSsn.slice(-4) === ssnLast4);
    //                 });
    //                 if (existingByOwner) {
    //                     createdClient = existingByOwner;
    //                     existingClient = true;
    //                     console.log(`♻️ Using existing client (matched by owner SSN + business name): ${createdClient.businessName} (ID: ${createdClient.clientId})`);
    //                 }
    //             }

    //             if (!createdClient) {
    //                 // Create client only when no duplicate found
    //                 console.log('\n📝 Creating client automatically...');
    //                 try {
    //                     createdClient = await prisma.client.create({
    //                         data: {
    //                             businessName: businessData.business_name,
    //                             businessEmail: businessData.email || null,
    //                             businessNumber: businessData.telephone || null,
    //                             businessWebsite: businessData.website || null,
    //                             businessIncorporationDate: parseDate(businessData.incorporation_date),
    //                             businessIncorporationState: businessData.incorporation_state || null,
    //                             businessEntityType: businessData.type_of_entity || null,
    //                             businessEinNumber: businessData.ein_number || null,
    //                             businessAnnualRevenue: annualRevenue ?? null,
    //                             businessMonthlyRevenue: monthlyRevenue ?? null,
    //                             businessAddress1: businessAddress.address1 || null,
    //                             businessAddress2: businessAddress.address2 || null,
    //                             businessCity: businessData.city || null,
    //                             businessState: businessData.state || null,
    //                             businessZipCode: businessData.zip || null,
    //                             ownerFirstName: ownerData.owner_first_name,
    //                             ownerMiddleName: ownerData.owner_middle_name || null,
    //                             ownerLastName: ownerData.owner_last_name,
    //                             ownerEmail: ownerData.owner_email || null,
    //                             ownerMobileNumber: ownerData.phone || null,
    //                             ownerDateOfBirth: parseDate(ownerData.date_of_birth),
    //                             ownerSsn: ownerData.ssn || null,
    //                             ownerFicoScore: ownerData.fico_score ? Number(ownerData.fico_score) : null,
    //                             ownerOwnershipStartDate: parseDate(ownerData.ownership_start_date),
    //                             ownerOwnershipPercentage: ownerData.ownership_percentage ? Number(ownerData.ownership_percentage) : null,
    //                             ownerAddress1: ownerAddress.address1 || null,
    //                             ownerAddress2: ownerAddress.address2 || null,
    //                             ownerCity: ownerData.owner_city || null,
    //                             ownerState: ownerData.owner_state || null,
    //                             ownerZipCode: ownerData.owner_zip || null,
    //                             createdById: currentUserId,
    //                         },
    //                     });
    //                     console.log(`✅ Client created successfully: ${createdClient.businessName} (ID: ${createdClient.clientId})`);
    //                 } catch (clientError: any) {
    //                     console.error('Failed to create client:', clientError);
    //                     throw new Error(`Client creation failed: ${clientError?.message || 'Unknown error'}`);
    //                 }
    //             }

    //             // Update existing client with extracted annual/monthly revenue (runs after PDF extraction)
    //             if (createdClient && existingClient && (annualRevenue != null || monthlyRevenue != null)) {
    //                 try {
    //                     createdClient = await prisma.client.update({
    //                         where: { id: createdClient.id },
    //                         data: {
    //                             ...(annualRevenue != null && { businessAnnualRevenue: annualRevenue }),
    //                             ...(monthlyRevenue != null && { businessMonthlyRevenue: monthlyRevenue }),
    //                         },
    //                     });
    //                     console.log(`✅ Updated client revenue from PDF: annual=${annualRevenue}, monthly=${monthlyRevenue}`);
    //                 } catch (updateErr: any) {
    //                     console.warn('Failed to update client revenue:', updateErr?.message);
    //                 }
    //             }

    //             // Transform client to API format (similar to mapClientToApi)
    //             const mapClientToApi = (client: any) => {
    //                 if (!client) return client;
    //                 return {
    //                     _id: client.id,
    //                     id: client.id,
    //                     clientId: client.clientId,
    //                     business: {
    //                         name: client.businessName,
    //                         email: client.businessEmail || '',
    //                         number: client.businessNumber || '',
    //                         website: client.businessWebsite || '',
    //                         incorporationDate: client.businessIncorporationDate,
    //                         incorporationState: client.businessIncorporationState || '',
    //                         businessEntityType: client.businessEntityType || '',
    //                         einNumber: client.businessEinNumber || '',
    //                         annualRevenue: client.businessAnnualRevenue ?? undefined,
    //                         monthlyRevenue: client.businessMonthlyRevenue ?? undefined,
    //                         address: {
    //                             address1: client.businessAddress1 || '',
    //                             address2: client.businessAddress2 || '',
    //                             city: client.businessCity || '',
    //                             state: client.businessState || '',
    //                             zipCode: client.businessZipCode || '',
    //                         },
    //                     },
    //                     owner: {
    //                         firstName: client.ownerFirstName,
    //                         middleName: client.ownerMiddleName || '',
    //                         lastName: client.ownerLastName,
    //                         email: client.ownerEmail || '',
    //                         mobileNumber: client.ownerMobileNumber || '',
    //                         dateOfBirth: client.ownerDateOfBirth,
    //                         ssn: client.ownerSsn || '',
    //                         ficoScore: client.ownerFicoScore ?? undefined,
    //                         ownershipStartDate: client.ownerOwnershipStartDate,
    //                         ownershipPercentage: client.ownerOwnershipPercentage ?? undefined,
    //                         address: {
    //                             address1: client.ownerAddress1 || '',
    //                             address2: client.ownerAddress2 || '',
    //                             city: client.ownerCity || '',
    //                             state: client.ownerState || '',
    //                             zipCode: client.ownerZipCode || '',
    //                         },
    //                     },
    //                     status: client.status,
    //                     notes: client.notes || '',
    //                     createdAt: client.createdAt,
    //                     updatedAt: client.updatedAt,
    //                 };
    //             };

    //             // Upload PDF file to Cloudinary and attach to application
    //             const uploadedFiles: any[] = [];
    //             try {
    //                 const folder = 'ih-crm/applications';
    //                 // Use the temp file for upload (uploadService expects a file object with path)
    //                 const fileToUpload = {
    //                     ...pdfFile,
    //                     tempFilePath: tempFilePath,
    //                     filepath: tempFilePath,
    //                     path: tempFilePath,
    //                 };
    //                 const uploadResult = await uploadService.uploadFile(fileToUpload, folder);
    //                 if (uploadResult.success && uploadResult.data) {
    //                     uploadedFiles.push({
    //                         url: uploadResult.data.secure_url,
    //                         publicId: uploadResult.data.public_id,
    //                         originalName: pdfFile.name,
    //                         mimeType: 'application/pdf',
    //                         size: pdfFile.size,
    //                         uploadedAt: new Date(),
    //                     });
    //                     console.log(`✅ PDF uploaded to Cloudinary: ${uploadResult.data.secure_url}`);
    //                 }
    //             } catch (uploadError) {
    //                 console.warn('Failed to upload PDF to Cloudinary:', uploadError);
    //                 // Continue with application creation even if PDF upload fails
    //             }

    //             // Parse loan amount from requested_amount
    //             const loanAmount = businessData.requested_amount
    //                 ? parseFloat(String(businessData.requested_amount).replace(/[^0-9.-]+/g, ''))
    //                 : null;

    //             // Avoid duplicate application: same client + same user + type New within last 24 hours
    //             let existingApplication = false;
    //             const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    //             let createdApplication: any = await prisma.application.findFirst({
    //                 where: {
    //                     clientId: createdClient.id,
    //                     type: 'New',
    //                     createdById: currentUserId,
    //                     createdAt: { gte: since },
    //                 },
    //                 orderBy: { createdAt: 'desc' },
    //                 include: {
    //                     referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                     salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                     createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                     client: true,
    //                     files: true,
    //                 },
    //             });

    //             if (createdApplication) {
    //                 existingApplication = true;
    //                 console.log(`♻️ Using existing application (no duplicate): Application #${createdApplication.applicationId}`);
    //                 if (uploadedFiles.length > 0) {
    //                     try {
    //                         await prisma.applicationFile.createMany({
    //                             data: uploadedFiles.map((f) => ({
    //                                 applicationId: createdApplication.id,
    //                                 url: f.url,
    //                                 publicId: f.publicId,
    //                                 originalName: f.originalName,
    //                                 mimeType: f.mimeType,
    //                                 size: f.size,
    //                                 uploadedAt: f.uploadedAt,
    //                             })),
    //                         });
    //                         const withFiles = await prisma.application.findUnique({
    //                             where: { id: createdApplication.id },
    //                             include: {
    //                                 referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                                 salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                                 createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                                 client: true,
    //                                 files: true,
    //                             },
    //                         });
    //                         if (withFiles) createdApplication = withFiles;
    //                     } catch (e) {
    //                         console.warn('Failed to attach PDF to existing application:', e);
    //                     }
    //                 }
    //             } else {
    //                 // Create application when no recent duplicate
    //                 console.log('\n📝 Creating application automatically...');
    //                 try {
    //                     createdApplication = await prisma.application.create({
    //                         data: {
    //                             priority: 'High', // Priority 1 = High priority
    //                             type: 'New', // New Application
    //                             salesRepresentativeId: currentUserId,
    //                             referringAgentId: currentUserId,
    //                             clientId: createdClient.id,
    //                             loanAmount: !isNaN(loanAmount as number) ? (loanAmount as number) : null,
    //                             createdById: currentUserId,
    //                             files: uploadedFiles.length
    //                                 ? {
    //                                       createMany: {
    //                                           data: uploadedFiles.map((f) => ({
    //                                               url: f.url,
    //                                               publicId: f.publicId,
    //                                               originalName: f.originalName,
    //                                               mimeType: f.mimeType,
    //                                               size: f.size,
    //                                               uploadedAt: f.uploadedAt,
    //                                           })),
    //                                       },
    //                                   }
    //                                 : undefined,
    //                         },
    //                         include: {
    //                             referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                             salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                             createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    //                             client: true,
    //                             files: true,
    //                         },
    //                     });
    //                     console.log(`✅ Application created successfully: Application #${createdApplication.applicationId}`);
    //                 } catch (appError: any) {
    //                     console.error('Failed to create application:', appError);
    //                     throw new Error(`Application creation failed: ${appError?.message || 'Unknown error'}`);
    //                 }
    //             }

    //             const populatedApplication = mapApplicationToApi(createdApplication);
    //             const mappedClient = mapClientToApi(createdClient);

    //             // Clean up temporary file
    //             try {
    //                 if (fs.existsSync(tempFilePath)) {
    //                     fs.unlinkSync(tempFilePath);
    //                 }
    //             } catch (cleanupError) {
    //                 console.warn('Failed to cleanup temporary file:', cleanupError);
    //             }

    //             console.log('[extractBusinessDetails] Status: SUCCESS - Client and Application created from PDF extraction');
    //             return res.status(200).json({
    //                 success: true,
    //                 message: 'Client and Application created successfully from PDF extraction.',
    //                 data: {
    //                     client: mappedClient,
    //                     application: populatedApplication,
    //                     extractedData: extractedData, // Include raw extracted data for reference
    //                     existingClient,
    //                     existingApplication,
    //                 },
    //             });
    //         } catch (error: any) {
    //             const msg = error?.message || 'Failed to extract business details from PDF';
    //             console.error('Business details extraction error:', {
    //                 message: msg,
    //                 stack: error?.stack,
    //                 name: error?.name,
    //                 code: error?.code,
    //             });
    //             // 400 when PDF has no/insufficient text (image-only, scanned, or empty)
    //             const isInsufficientText = /too little|no text|image-only|scanned|OCR/i.test(msg);
    //             return res.status(isInsufficientText ? 400 : 500).json({
    //                 success: false,
    //                 message: msg,
    //                 error: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
    //             });
    //         }
    //     }
    // Send approval email to client for a given application (async email, non-blocking)
    async sendApprovalEmail(req: Request, res: Response) {
        try {
            const { applicationId, resend, emailHtml: clientEmailHtmlRaw, emailSubject: clientEmailSubjectRaw } = req.body as {
                applicationId?: string | number;
                resend?: boolean;
                /** Frontend-rendered branded approval HTML (backend injects URL / ISO name / business name). */
                emailHtml?: string;
                emailSubject?: string;
            };
            const clientEmailSubject =
                typeof clientEmailSubjectRaw === 'string' && clientEmailSubjectRaw.trim()
                    ? clientEmailSubjectRaw.trim()
                    : undefined;

            if (!applicationId) {
                return res.status(400).json({
                    success: false,
                    message: 'applicationId is required',
                });
            }

            const authUser = getAuthenticatedUser(req);
            const applicationIdStr = String(applicationId);

            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(applicationIdStr)
                ? { applicationId: Number(applicationIdStr) }
                : { id: applicationIdStr };

            const { application, forbidden } = await getApplicationForUser(
                whereClause,
                authUser,
                {
                    client: true,
                    iso: true,
                    termsOffers: {
                        orderBy: { updatedAt: 'desc' },
                        take: 1,
                        select: {
                            approvedAmount: true,
                            factorRate: true,
                            paybackAmount: true,
                        },
                    },
                }
            );

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const client: any = (application as any).client;
            let iso: any = (application as any).iso;

            const clientBusinessName = client?.businessName || 'Unknown Business';
            let isoName = String(iso?.name || '').trim();
            let isoEmailRaw = String(iso?.email || '').trim();
            const appIsoId = (application as any).isoId ? String((application as any).isoId).trim() : '';

            if (!appIsoId) {
                return res.status(400).json({
                    success: false,
                    message:
                        'This application is not linked to an ISO. Link an ISO to the deal before sending the approval email (only the ISO record receives this message).',
                });
            }

            if (!iso || !isoEmailRaw) {
                const isoRow = await prisma.iso.findUnique({
                    where: { id: appIsoId },
                    select: { name: true, email: true },
                });
                if (isoRow) {
                    iso = { ...iso, ...isoRow };
                    isoName = isoName || String(isoRow.name || '').trim();
                    isoEmailRaw = isoEmailRaw || String(isoRow.email || '').trim();
                }
            }

            const merchantGreetingName =
                `${client?.ownerFirstName || ''} ${client?.ownerLastName || ''}`.trim() ||
                clientBusinessName ||
                'there';
            const companyName = clientBusinessName;

            const merchantFullName =
                `${client?.ownerFirstName || ''} ${client?.ownerLastName || ''}`.trim() || undefined;
            const { merchantEmail, merchantPhone } = resolveMerchantContactForOfferEmail(client);
            const latestTermsOffer = (application as any).termsOffers?.[0] ?? null;
            const offerApprovedAmount =
                latestTermsOffer?.approvedAmount != null ? Number(latestTermsOffer.approvedAmount) : undefined;
            const offerFactorRate =
                latestTermsOffer?.factorRate != null ? Number(latestTermsOffer.factorRate) : undefined;
            const offerRepaymentAmount =
                latestTermsOffer?.paybackAmount != null ? Number(latestTermsOffer.paybackAmount) : undefined;
            const offerApplicationNumber = (application as any).applicationId ?? undefined;

            if (!isoEmailRaw) {
                return res.status(400).json({
                    success: false,
                    message:
                        'The linked ISO has no email on file. Add an email to that ISO in the broker/ISO settings, then try again.',
                });
            }

            try {
                await syncTermsOfferFromOfferDecision(
                    (application as any).id,
                    authUser?.id ?? null,
                );
            } catch (syncErr) {
                console.error('Send approval email: failed to sync terms offer from offer decision:', syncErr);
            }

            const baseUrl = resolveCrmFrontendBaseUrl() || '';

            const fallbackId = (application as any).id;

            if (!fallbackId) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to resolve application id for approval link',
                });
            }

            let approvalLinkToken = fallbackId;
            try {
                const portalToken = await createPublicPortalToken(fallbackId, { expiresInDays: 90 });
                if (portalToken) {
                    approvalLinkToken = portalToken;
                }
            } catch (tokenErr) {
                console.error('Approval email: public portal token failed, using application id in link:', tokenErr);
            }

            const publicApprovalUrl = baseUrl
                ? buildPublicApprovalPortalUrl(baseUrl, approvalLinkToken)
                : undefined;
            const viewApplicationUrl = publicApprovalUrl;
            const calculateApprovalUrl = publicApprovalUrl;

            const isoRecipientName = isoName || isoEmailRaw || merchantGreetingName;
            const recipients: { to: string; clientName: string }[] = [
                { to: isoEmailRaw, clientName: isoRecipientName },
            ];

            const emailSubject =
                clientEmailSubject ||
                (resend ? 'Your Offer Values Have Been Updated' : 'Your Application Has Been Approved');
            const approvalPdfFilename = resend
                ? OFFER_UPDATED_EMAIL_PDF_FILENAME
                : APPROVAL_EMAIL_PDF_FILENAME;

            /**
             * Prefer the frontend-rendered branded template (the approval/update-offer HTML is now
             * owned by the frontend). Server-only values — the signed public-portal URL, the resolved
             * ISO recipient name, and the deal business name — are injected here. The backend builders
             * remain only as a safety fallback when no frontend HTML is supplied.
             */
            const frontendEmailHtml =
                typeof clientEmailHtmlRaw === 'string' && clientEmailHtmlRaw.trim()
                    ? injectApplicationApprovalEmailValues(clientEmailHtmlRaw.trim(), {
                        approvalUrl: calculateApprovalUrl,
                        clientName: isoRecipientName,
                        companyName,
                    })
                    : undefined;
            const emailHtml =
                frontendEmailHtml ??
                (resend
                    ? buildApplicationOfferUpdatedEmailHtml({
                        clientName: isoRecipientName,
                        companyName,
                        calculateApprovalUrl,
                        viewApplicationUrl,
                    })
                    : buildApplicationApprovalEmailHtml({
                        clientName: isoRecipientName,
                        companyName,
                        calculateApprovalUrl,
                        viewApplicationUrl,
                    }));

            const trackingId = randomUUID();
            const approvalEmailLogSuffix = resend
                ? ' resent updated offer email to the linked ISO.'
                : ' sent approval email to the linked ISO.';
            const authUserForLog = getAuthenticatedUser(req);
            const roleLabel = authUserForLog?.role
                ? String(authUserForLog.role).toUpperCase().replace(/_/g, ' ')
                : 'User';
            const actorName = (req as any).user?.name || '';

            try {
                await recordCommunicationAudit(req, {
                    outboundCommunicationId: trackingId,
                    applicationId: (application as any).id,
                    channel: 'EMAIL',
                    recipientType: 'ISO',
                    recipient: recipients.map((r) => r.to).join(', '),
                    subject: emailSubject,
                    body: emailHtml,
                    templateName: resend ? 'Update offer template' : 'Application approved template',
                    actionType: 'APPROVED',
                    user: authUserForLog,
                    currentStatus: `${(application as any).currentQueue} / ${(application as any).currentState}`,
                    actionDescription: `${roleLabel} ${actorName}`.trim() + approvalEmailLogSuffix,
                    metadata: {
                        emailSentTo: recipients.map((r) => r.to),
                        sentToLinkedIsoOnly: true,
                        resend: !!resend,
                        template: resend ? 'offer-updated' : 'approval',
                        status: 'sent',
                        hasLetterPdf: true,
                        attachments: [approvalPdfFilename],
                        delivery: {
                            status: 'sent',
                            sentAt: new Date().toISOString(),
                        },
                    },
                });
            } catch (logError) {
                console.error('Failed to create activity log for approval email:', logError);
            }

            const deliveryResults = await Promise.all(
                recipients.map(async ({ to, clientName }) => {
                    const sendResult = resend
                        ? await sendApplicationOfferUpdatedEmail({
                            to,
                            clientName,
                            companyName,
                            viewApplicationUrl,
                            calculateApprovalUrl,
                            applicationNumber: offerApplicationNumber,
                            merchantName: merchantFullName,
                            merchantEmail,
                            merchantPhone,
                            approvedAmount: offerApprovedAmount,
                            factorRate: offerFactorRate,
                            repaymentAmount: offerRepaymentAmount,
                            html: emailHtml,
                            subject: emailSubject,
                            trackingId,
                        })
                        : await sendApplicationApprovalEmail({
                            to,
                            clientName,
                            companyName,
                            viewApplicationUrl,
                            calculateApprovalUrl,
                            html: emailHtml,
                            subject: emailSubject,
                            trackingId,
                        });
                    return {
                        to,
                        ok: sendResult.sent,
                        sgMessageId: sendResult.sgMessageId,
                    };
                }),
            );
            const anyDelivered = deliveryResults.some((r) => r.ok);
            if (!anyDelivered) {
                return res.status(502).json({
                    success: false,
                    message:
                        'Could not deliver approval notification email. Check: (1) DISABLE_CLIENT_APPLICATION_EMAILS is not true, (2) SENDGRID_API_KEY or SMTP_AUTH_USER / SMTP_AUTH_PASS, (3) recipient spam folder.',
                    data: { attempted: deliveryResults },
                });
            }

            try {
                const outbound = await prisma.outbound_communications.findUnique({
                    where: { id: trackingId },
                    select: { metadata: true },
                });
                const prior =
                    outbound?.metadata &&
                    typeof outbound.metadata === 'object' &&
                    !Array.isArray(outbound.metadata)
                        ? (outbound.metadata as Record<string, unknown>)
                        : {};
                await prisma.outbound_communications.update({
                    where: { id: trackingId },
                    data: {
                        metadata: {
                            ...prior,
                            emailDelivery: deliveryResults,
                        } as object,
                    },
                });
            } catch (metaErr) {
                console.error('Failed to update approval email delivery metadata:', metaErr);
            }

            const deliveredSgMessageId = deliveryResults.find(
                (r) => r.ok && r.sgMessageId,
            )?.sgMessageId;
            if (deliveredSgMessageId) {
                try {
                    await storeSgMessageIdOnOutbound(trackingId, deliveredSgMessageId);
                } catch (metaErr) {
                    console.error('Failed to store SendGrid message id for approval email:', metaErr);
                }
            }

            return res.status(200).json({
                success: true,
                message: resend ? 'Updated offer email sent' : 'Approval email sent',
                data: { delivered: deliveryResults.filter((r) => r.ok).map((r) => r.to) },
            });
        } catch (error: any) {
            console.error('Send approval email error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    /** Funded / funds-released email — best-effort (same idea as funding-call email); any user with app access. */
    async sendFundedEmail(req: Request, res: Response) {
        try {
            const { applicationId } = req.body as { applicationId?: string | number };

            if (!applicationId) {
                return res.status(400).json({
                    success: false,
                    message: 'applicationId is required',
                });
            }

            const authUser = getAuthenticatedUser(req);

            const applicationIdStr = String(applicationId);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(applicationIdStr)
                ? { applicationId: Number(applicationIdStr) }
                : { id: applicationIdStr };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser, {
                client: true,
                iso: true,
            });

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const client: any = (application as any).client;
            const iso: any = (application as any).iso;
            const isoEmail = String(iso?.email || '').trim();

            if (!isoEmail) {
                return res.status(200).json({
                    success: true,
                    message: 'No ISO email on file for this deal; funded notification skipped.',
                    skipped: true,
                });
            }

            return res.status(200).json({
                success: true,
                message: 'Funded notification is not sent to ISO; only approval and offer-update emails are delivered to the linked ISO.',
                skipped: true,
            });
        } catch (error: any) {
            console.error('Send funded email error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

    // Get activity logs for a specific application
    async getActivityLogs(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);

            const appIdStr = String(id);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(appIdStr)
                ? { applicationId: Number(appIdStr) }
                : { id: appIdStr };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const { logs } = await getApplicationActivityLogsForUser(application.id, authUser);

            const { mapApplicationActivityLogEntry } = await import('../services/applicationActivityLogMapper');
            const mappedLogs = logs.map((log) => mapApplicationActivityLogEntry(log as any));

            return res.status(200).json({
                success: true,
                data: mappedLogs,
            });
        } catch (error: any) {
            console.error('Get application activity logs error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async getActivityLogContent(req: Request, res: Response) {
        try {
            const { id, logId } = req.params;
            const authUser = getAuthenticatedUser(req);

            const appIdStr = String(id);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(appIdStr)
                ? { applicationId: Number(appIdStr) }
                : { id: appIdStr };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const activityLog = await prisma.applicationActivityLog.findFirst({
                where: { id: String(logId), applicationId: application.id },
            });

            if (!activityLog) {
                return res.status(404).json({
                    success: false,
                    message: 'Activity log not found for this application',
                });
            }

            const { getSystemActivityLogContent } = await import('../services/systemActivityLogService');
            const content = await getSystemActivityLogContent(activityLog.id);

            if (!content) {
                return res.status(404).json({
                    success: false,
                    message: 'No viewable content for this log entry',
                });
            }

            return res.status(200).json({ success: true, data: content });
        } catch (error: any) {
            console.error('Get application activity log content error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async getPaymentMailLogs(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);

            const appIdStr = String(id);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(appIdStr)
                ? { applicationId: Number(appIdStr) }
                : { id: appIdStr };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const result = await listPaymentMailLogs(application.id, authUser);

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            const data = await enrichPaymentMailLogsForApi([...result.logs]);

            return res.status(200).json({ success: true, data });
        } catch (error: any) {
            console.error('Get payment mail logs error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async createPaymentMailLog(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);

            const appIdStr = String(id);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(appIdStr)
                ? { applicationId: Number(appIdStr) }
                : { id: appIdStr };

            const { application, forbidden } = await getApplicationForUser(whereClause, authUser);

            if (forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!application) {
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            const body = req.body as Record<string, unknown>;
            const dealKey = typeof body.dealKey === 'string' ? body.dealKey.trim() : '';
            const templateName = typeof body.templateName === 'string' ? body.templateName.trim() : '';
            const category = typeof body.category === 'string' ? body.category.trim() : '';
            const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : '';
            const subject = typeof body.subject === 'string' ? body.subject.trim() : '';
            const statusRaw = typeof body.status === 'string' ? body.status.trim().toLowerCase() : '';
            const mailBody = typeof body.body === 'string' ? body.body : undefined;

            if (!dealKey || !templateName || !category || !recipient || !subject || !statusRaw) {
                return res.status(400).json({
                    success: false,
                    message: 'dealKey, templateName, category, recipient, subject, and status are required',
                });
            }

            const result = await persistPaymentMailLog(application.id, authUser, {
                dealKey,
                templateName,
                category,
                recipient,
                subject,
                body: mailBody,
                status: statusRaw as 'queued' | 'sent' | 'failed',
            }, req);

            if (result.forbidden) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (result.badRequest) {
                return res.status(400).json({
                    success: false,
                    message: 'status must be queued, sent, or failed',
                });
            }

            if (!result.log) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to save mail log',
                });
            }

            const log = result.log;
            return res.status(201).json({
                success: true,
                data: {
                    id: log.id,
                    at: log.createdAt?.toISOString() ?? new Date().toISOString(),
                    dealKey: log.dealKey,
                    applicationId: log.applicationId,
                    templateName: log.templateName,
                    category: log.category,
                    recipient: log.recipient,
                    subject: log.subject,
                    body: log.body ?? undefined,
                    status: fromPrismaMailLogStatus(log.status),
                },
            });
        } catch (error: any) {
            console.error('Create payment mail log error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async getDashboardPipelineFunnel(req: Request, res: Response) {
        try {
            const data = await withDashboardCache(
                DashboardCacheKind.FUNNEL,
                'global',
                () => aggregateDashboardPipelineFunnel(),
            );
            return res.status(200).json({ success: true, data });
        } catch (error) {
            console.error('Get dashboard pipeline funnel error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async getDashboardTrendChart(req: Request, res: Response) {
        try {
            const authUser = getAuthenticatedUser(req);
            const currentUserRole = authUser?.role;
            const { startDate, endDate, trendView } = req.query as {
                startDate?: string;
                endDate?: string;
                trendView?: string;
            };

            let start: Date | null = null;
            let end: Date | null = null;
            if (startDate) {
                const d = new Date(startDate);
                if (!isNaN(d.getTime())) {
                    d.setHours(0, 0, 0, 0);
                    start = d;
                }
            }
            if (endDate) {
                const d = new Date(endDate);
                if (!isNaN(d.getTime())) {
                    d.setHours(23, 59, 59, 999);
                    end = d;
                }
            }

            const viewRaw = String(trendView ?? 'monthly').toLowerCase();
            const trendViewNorm =
                viewRaw === 'weekly' || viewRaw === 'yearly' ? viewRaw : 'monthly';

            const rawUwClaim = req.query.underwriterClaim;
            const uwClaimNorm =
                rawUwClaim != null
                    ? String(Array.isArray(rawUwClaim) ? rawUwClaim[0] : rawUwClaim)
                          .trim()
                          .toLowerCase()
                    : '';
            let underwriterClaimParam: 'unclaimed' | 'mine' | null = null;
            if (uwClaimNorm === 'unclaimed' || uwClaimNorm === 'mine') {
                underwriterClaimParam = uwClaimNorm;
            }

            const trendCacheKey = [
                authUser?.id ?? 'none',
                String(currentUserRole ?? ''),
                start ? start.toISOString() : '',
                end ? end.toISOString() : '',
                trendViewNorm,
                underwriterClaimParam ?? '',
            ].join('|');

            const data = await withDashboardCache(
                DashboardCacheKind.TREND,
                trendCacheKey,
                () =>
                    aggregateApplicationTrendChart({
                        authUser,
                        role: currentUserRole,
                        startDate: start,
                        endDate: end,
                        trendView: trendViewNorm,
                        underwriterClaim: underwriterClaimParam,
                    }),
            );

            return res.status(200).json({ success: true, data });
        } catch (error) {
            console.error('Get dashboard trend chart error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async getDashboardRecentApplications(req: Request, res: Response) {
        try {
            const authUser = getAuthenticatedUser(req);
            if (!authUser) {
                return res.status(401).json({ success: false, message: 'Unauthorized' });
            }
            const limitRaw = req.query.limit;
            const limit = Number.isFinite(Number(limitRaw)) ? Number(limitRaw) : 10;
            const roleKey = String(authUser.role ?? '').trim();
            const recentCacheKey = `${authUser.id}|${roleKey}|${limit}`;
            const cachedPayload = await withDashboardCache(
                DashboardCacheKind.RECENT,
                recentCacheKey,
                async () => {
                    const { applications, totalItems } = await listDashboardRecentApplications({
                        authUser,
                        role: authUser.role,
                        limit,
                    });
                    return {
                        data: applications.map((app) => mapApplicationToApi(app)),
                        pagination: { totalItems },
                    };
                },
            );
            return res.status(200).json({
                success: true,
                data: cachedPayload.data,
                pagination: cachedPayload.pagination,
            });
        } catch (error) {
            console.error('Get dashboard recent applications error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    async getMonthlyTrend(req: Request, res: Response) {
        try {
            const authUser = getAuthenticatedUser(req);
            const currentUserRole = authUser?.role;

            const { startDate, endDate } = req.query as { startDate?: string; endDate?: string };

            let start: Date | null = null;
            let end: Date | null = null;

            if (startDate) {
                const d = new Date(startDate);
                if (!isNaN(d.getTime())) {
                    d.setHours(0, 0, 0, 0);
                    start = d;
                }
            }
            if (endDate) {
                const d = new Date(endDate);
                if (!isNaN(d.getTime())) {
                    d.setHours(23, 59, 59, 999);
                    end = d;
                }
            }

            const data = await aggregateApplicationMonthlyTrend({
                authUser,
                role: currentUserRole,
                startDate: start,
                endDate: end,
            });

            return res.status(200).json({
                success: true,
                data,
            });
        } catch (error) {
            console.error('Get monthly application trend error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }



    // Get duplicate applications (dedupes) for Underwriters/Admins
    async getDuplicates(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const authUser = getAuthenticatedUser(req);

            const role = String(authUser?.role || '').toUpperCase().replace(/-/g, '_');
            const allowedRoles = ['UNDERWRITER', 'FINAL_UNDERWRITER', 'ADMIN', 'SUPER_ADMIN'];
            if (!allowedRoles.includes(role)) {
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: Dupes view is only available to Underwriters and Admins',
                });
            }

            const idStr = String(id);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(idStr)
                ? { applicationId: Number(idStr) }
                : { id: idStr };

            const applicationRecord = await prisma.application.findUnique({
                where: whereClause,
                include: {
                    client: true,
                    files: { select: { originalName: true, size: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
            });

            if (!applicationRecord || !applicationRecord.client) {
                return res.status(404).json({
                    success: false,
                    message: 'Application or client not found',
                });
            }

            const client = applicationRecord.client as any;
            const businessName: string | null = client.businessName || null;
            const ein: string | null = client.businessEinNumber || null;
            const ssn: string | null = client.ownerSsn || null;

            const orConditions: Prisma.ClientWhereInput[] = [];
            if (businessName) {
                orConditions.push({ businessName });
            }
            if (ein) {
                orConditions.push({ businessEinNumber: ein });
            }
            if (ssn) {
                orConditions.push({ ownerSsn: ssn });
            }

            if (orConditions.length === 0) {
                return res.status(200).json({
                    success: true,
                    data: [],
                });
            }

            const duplicates = await prisma.application.findMany({
                where: {
                    id: { not: applicationRecord.id },
                    client: {
                        OR: orConditions,
                    },
                },
                include: {
                    client: true,
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            const mapDuplicateRow = (
                app: (typeof duplicates)[number],
                matchWith: string[],
            ) => {
                const dupClient: any = app.client;
                const agent = app.createdBy as any;
                const agentName = agent
                    ? `${agent.firstName || ''} ${agent.lastName || ''}`.trim() || agent.email
                    : null;

                let status: string = 'Pending';
                if (app.currentQueue === 'Approved' || app.currentState === ApplicationState.COMPLETED) {
                    status = 'Approved';
                } else if (app.currentQueue === 'Declined' || app.currentState === ApplicationState.CANCELLED) {
                    status = 'Rejected';
                }

                return {
                    id: app.id,
                    applicationId: app.applicationId,
                    businessName: dupClient?.businessName || null,
                    agentName,
                    submittedAt: app.createdAt,
                    status,
                    fundedAmount: app.loanAmount ?? null,
                    businessEinNumber: dupClient?.businessEinNumber || null,
                    ownerSsn: dupClient?.ownerSsn || null,
                    matchWith,
                };
            };

            const byId = new Map<string, ReturnType<typeof mapDuplicateRow>>();

            for (const app of duplicates) {
                const matchWith: string[] = [];
                const dupClient: any = app.client;
                if (businessName && dupClient?.businessName && dupClient.businessName === businessName) {
                    matchWith.push('Business name');
                }
                if (ein && dupClient?.businessEinNumber && dupClient.businessEinNumber === ein) {
                    matchWith.push('EIN');
                }
                if (ssn && dupClient?.ownerSsn && dupClient.ownerSsn === ssn) {
                    matchWith.push('SSN');
                }
                byId.set(app.id, mapDuplicateRow(app, matchWith));
            }

            const { findSamePdfFileApplications, pickPrimaryPdfFile, readPdfFileDedupeDays } =
                await import('../services/pdfFileDedupeService');
            const pdfSig = pickPrimaryPdfFile(applicationRecord.files);
            const createdById = applicationRecord.createdById;
            if (pdfSig && createdById) {
                const dedupeDays = readPdfFileDedupeDays();
                const samePdfApps = await findSamePdfFileApplications({
                    excludeApplicationId: applicationRecord.id,
                    createdById,
                    file: pdfSig,
                    referenceCreatedAt: applicationRecord.createdAt,
                    dedupeDays,
                });
                const pdfMatchLabel = `Same PDF file (within ${dedupeDays} days)`;
                for (const app of samePdfApps) {
                    const existing = byId.get(app.id);
                    if (existing) {
                        if (!existing.matchWith.includes(pdfMatchLabel)) {
                            existing.matchWith.push(pdfMatchLabel);
                        }
                    } else {
                        byId.set(app.id, mapDuplicateRow(app, [pdfMatchLabel]));
                    }
                }
            }

            const mapped = Array.from(byId.values()).sort(
                (a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime(),
            );

            return res.status(200).json({
                success: true,
                data: mapped,
            });
        } catch (error: any) {
            console.error('Get duplicate applications error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    /**
     * SUPER_ADMIN: bulk import applications from Excel/CSV (first sheet; row 1 headers, row 2 summary skipped).
     * Multipart field name: `file`.
     */
    async bulkUploadApplicationsExcel(req: Request, res: Response) {
        try {
            const userId = String((req as any).user?.id ?? '').trim();
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User context missing' });
            }
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file?.buffer?.length) {
                return res.status(400).json({ success: false, message: 'Excel file is required (field name: file)' });
            }

            const summary = await processApplicationBulkExcelBuffer(file.buffer, userId);

            return res.status(200).json({
                success: true,
                message: buildBulkUploadCompletionMessage(summary.successCount, summary.updatedCount),
                data: summary,
            });
        } catch (error: any) {
            console.error('bulkUploadApplicationsExcel error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Bulk upload failed',
            });
        }
    }

    /**
     * SUPER_ADMIN: starts bulk import as background job and returns jobId for live polling.
     * Multipart field name: `file`.
     */
    async startBulkUploadApplicationsExcel(req: Request, res: Response) {
        cleanupExpiredBulkUploadJobs();
        try {
            const userId = String((req as any).user?.id ?? '').trim();
            if (!userId) {
                return res.status(401).json({ success: false, message: 'User context missing' });
            }
            const file = (req as any).file as Express.Multer.File | undefined;
            if (!file?.buffer?.length) {
                return res.status(400).json({ success: false, message: 'Excel file is required (field name: file)' });
            }

            const jobId = createBulkUploadJobId();
            const nowMs = Date.now();
            const initialJob: BulkUploadJob = {
                id: jobId,
                createdAtMs: nowMs,
                updatedAtMs: nowMs,
                status: 'processing',
                totalRows: 0,
                processedRows: 0,
                successCount: 0,
                updatedCount: 0,
                failedCount: 0,
                errors: [],
            };
            bulkUploadJobs.set(jobId, initialJob);

            void (async () => {
                const job = bulkUploadJobs.get(jobId);
                if (!job) return;
                try {
                    const { rows, errors: parseErrors } = parseApplicationBulkSheet(file.buffer);
                    job.totalRows = rows.length;
                    job.failedCount = parseErrors.length;
                    job.errors = [...parseErrors];
                    job.processedRows = parseErrors.length;
                    touchBulkUploadJob(job);
                    console.log(
                        `[bulk-import] job ${jobId}: parsed ${rows.length} row(s), ${parseErrors.length} parse error(s); starting ingest`,
                    );

                    let lastLogProcessed = 0;
                    const ingestSummary = await ingestApplicationBulkRows(rows, userId, (progress) => {
                        const runningJob = bulkUploadJobs.get(jobId);
                        if (!runningJob) return;
                        runningJob.totalRows = progress.totalRows;
                        runningJob.processedRows = progress.processedRows;
                        runningJob.successCount = progress.successCount;
                        runningJob.updatedCount = progress.updatedCount;
                        runningJob.failedCount = progress.failedCount + parseErrors.length;
                        runningJob.currentExcelRowNumber = progress.currentExcelRowNumber;
                        touchBulkUploadJob(runningJob);

                        // Server-side heartbeat every 50 rows so long imports leave a breadcrumb
                        // trail in the logs.
                        if (progress.processedRows - lastLogProcessed >= 50) {
                            lastLogProcessed = progress.processedRows;
                            console.log(
                                `[bulk-import] job ${jobId}: ${progress.processedRows}/${progress.totalRows} processed (` +
                                    `inserted=${progress.successCount}, updated=${progress.updatedCount}, failed=${progress.failedCount})`,
                            );
                        }
                    });

                    const mergedErrors = [...parseErrors, ...ingestSummary.errors];
                    const finalSummary: BulkImportSummary = {
                        totalRows: rows.length,
                        successCount: ingestSummary.successCount,
                        updatedCount: ingestSummary.updatedCount,
                        failedCount: mergedErrors.length,
                        errors: mergedErrors,
                    };
                    job.result = finalSummary;
                    job.status = 'completed';
                    job.successCount = finalSummary.successCount;
                    job.updatedCount = finalSummary.updatedCount;
                    job.failedCount = finalSummary.failedCount;
                    job.processedRows = finalSummary.totalRows;
                    job.currentExcelRowNumber = undefined;
                    job.errors = mergedErrors;
                    job.message = buildBulkUploadCompletionMessage(
                        finalSummary.successCount,
                        finalSummary.updatedCount,
                    );
                    touchBulkUploadJob(job);
                    console.log(
                        `[bulk-import] job ${jobId}: completed — inserted=${finalSummary.successCount}, updated=${finalSummary.updatedCount}, failed=${finalSummary.failedCount}/${finalSummary.totalRows}`,
                    );
                    if (mergedErrors.length) {
                        console.warn(
                            `[bulk-import] job ${jobId}: ${mergedErrors.length} row(s) failed:`,
                        );
                        for (const rowError of mergedErrors) {
                            console.warn(
                                `[bulk-import]   row ${rowError.excelRowNumber}` +
                                    `${rowError.dealId ? ` (deal ${rowError.dealId})` : ''}` +
                                    `${rowError.dealName ? ` [${rowError.dealName}]` : ''}: ${rowError.message}`,
                            );
                        }
                    }
                } catch (error: any) {
                    job.status = 'failed';
                    job.message = error?.message || 'Bulk upload failed';
                    touchBulkUploadJob(job);
                    console.error(
                        `[bulk-import] job ${jobId}: fatal error — ${job.message}`,
                        error,
                    );
                }
            })();

            return res.status(202).json({
                success: true,
                message: 'Bulk upload started',
                data: { jobId },
            });
        } catch (error: any) {
            console.error('startBulkUploadApplicationsExcel error:', error);
            return res.status(500).json({
                success: false,
                message: error?.message || 'Failed to start bulk upload',
            });
        }
    }

    /** SUPER_ADMIN: poll live row-level progress for bulk import job. */
    async getBulkUploadApplicationsExcelProgress(req: Request, res: Response) {
        cleanupExpiredBulkUploadJobs();
        const jobId = String(req.params.jobId ?? '').trim();
        if (!jobId) {
            return res.status(400).json({ success: false, message: 'jobId is required' });
        }
        const job = bulkUploadJobs.get(jobId);
        if (!job) {
            return res.status(404).json({ success: false, message: 'Bulk upload job not found or expired' });
        }
        return res.status(200).json({
            success: true,
            data: {
                jobId: job.id,
                status: job.status,
                totalRows: job.totalRows,
                processedRows: job.processedRows,
                successCount: job.successCount,
                updatedCount: job.updatedCount,
                failedCount: job.failedCount,
                currentExcelRowNumber: job.currentExcelRowNumber,
                message: job.message,
                errors: job.status === 'completed' || job.status === 'failed' ? job.errors : [],
            },
        });
    }

    // Get applications by ISO id
    async getByIsoId(req: Request, res: Response) {
        try {
            const rawIsoId = req.params.isoId || req.query.isoId;
            const isoId = String(rawIsoId ?? '').trim();
            if (!isoId) {
                return res.status(400).json({
                    success: false,
                    message: 'isoId is required',
                });
            }

            const authUser = getAuthenticatedUser(req);
            const where: any = { isoId };
            const visibilityAwareWhere = mergeApplicationVisibilityWhere(where, authUser);

            const applications = await (prisma as any).application.findMany({
                where: visibilityAwareWhere,
                orderBy: { createdAt: 'desc' },
                include: {
                    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
                    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
                    client: true,
                    iso: true,
                    termsOffers: {
                        orderBy: { updatedAt: 'desc' },
                        take: 1,
                        select: { approvedAmount: true, factorRate: true, paybackAmount: true },
                    },
                    OfferDecision: {
                        select: {
                            offer: true,
                            decision: true,
                            rate: true,
                        },
                    },
                },
            });

            return res.status(200).json({
                success: true,
                data: applications.map(mapApplicationToApi),
            });
        } catch (error) {
            console.error('Get applications by ISO id error:', error);
            return res.status(500).json({
                success: false,
                message: 'Internal server error',
            });
        }
    }

    /**
     * Approve an application (idempotent webhook-style endpoint).
     *
     * Trigger surfaces:
     *   1. Authenticated CRM user (Final Underwriter / Admin / Operations…) clicks Approve.
     *   2. ISO clicks Approve from the public approval portal — the portal first
     *      mints a short-lived JWT (see PublicApprovalController.createApprovalSession)
     *      that flows through `authenticateToken` and lands here with
     *      `req.user.publicApprovalActor === 'ISO'`.
     *
     * Concurrency / scale guarantees come from `applicationApprovalService.approveApplication`:
     *   - Single conditional `updateMany` (no race between simultaneous clicks).
     *   - Optional `Idempotency-Key` request header to coalesce client retries.
     *   - Side-effects (notifications, ISO/agent emails) are queued via BullMQ
     *     when REDIS_URL is set, otherwise dispatched via setImmediate.
     */
    async approve(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { note } = (req.body ?? {}) as { note?: string };
            const idempotencyKeyHeader =
                (req.headers['idempotency-key'] as string | undefined) ||
                (req.headers['x-idempotency-key'] as string | undefined);

            const authUser = getAuthenticatedUser(req);
            const reqUser = (req as any).user as
                | { id?: string; name?: string; publicApprovalActor?: string; role?: string }
                | undefined;

            console.log('[POST /applications/:id/approve] received', {
                paramId: id,
                authUserId: authUser?.id ?? null,
                authUserRole: authUser?.role ?? null,
                publicApprovalActor: reqUser?.publicApprovalActor ?? null,
                hasIdempotencyKey: Boolean(idempotencyKeyHeader),
            });

            const applicationStr = String(id);
            const whereClause: Prisma.ApplicationWhereUniqueInput = /^\d+$/.test(applicationStr)
                ? { applicationId: Number(applicationStr) }
                : { id: applicationStr };

            const { application: existingApplication, forbidden } = await getApplicationForUser(
                whereClause,
                authUser,
            );

            if (forbidden) {
                console.warn('[POST /applications/:id/approve] forbidden', {
                    paramId: id,
                    authUserId: authUser?.id ?? null,
                    authUserRole: authUser?.role ?? null,
                });
                return res.status(403).json({
                    success: false,
                    message: 'Forbidden: you do not have access to this application',
                });
            }

            if (!existingApplication) {
                console.warn('[POST /applications/:id/approve] not found', { paramId: id });
                return res.status(404).json({
                    success: false,
                    message: 'Application not found',
                });
            }

            if (blockIfUnderwriterUnclaimedDeal(res, authUser, existingApplication)) {
                return;
            }

            const result = await approveApplication(whereClause, {
                actor: authUser,
                req,
                actorType: reqUser?.publicApprovalActor || authUser?.role || null,
                actorName: reqUser?.name ?? null,
                note: typeof note === 'string' ? note : null,
                idempotencyKey: typeof idempotencyKeyHeader === 'string' ? idempotencyKeyHeader : null,
            });

            const apiApplication = mapApplicationToApi(result.application);

            console.log('[POST /applications/:id/approve] responding', {
                applicationDbId: result.application?.id ?? null,
                alreadyApproved: result.alreadyApproved,
                responseCurrentQueue: (apiApplication as { currentQueue?: string })?.currentQueue ?? null,
                responseCurrentState: (apiApplication as { currentState?: string })?.currentState ?? null,
            });

            return res.status(200).json({
                success: true,
                message: result.alreadyApproved
                    ? 'Application was already approved'
                    : 'Application approved successfully',
                data: apiApplication,
                alreadyApproved: result.alreadyApproved,
            });
        } catch (error: any) {
            const status =
                typeof error?.statusCode === 'number' && error.statusCode >= 400
                    ? error.statusCode
                    : 500;
            if (status >= 500) {
                console.error('Approve application error:', error);
            }
            return res.status(status).json({
                success: false,
                message: error?.message || 'Internal server error',
            });
        }
    }

}

const applicationController = new ApplicationController();
export default applicationController;


