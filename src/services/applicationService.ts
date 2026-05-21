import type { Prisma, Application, Role } from '@prisma/client';
import fs from 'fs/promises';
import path from 'path';
import prisma from '../config/prismaClient';
import { parseBusinessData } from './parseBusinessData';
import { attachBufferAsApplicationFile } from './applicationPdfAttachService';
import { extractPdfPlainTextForParsing } from './pdfIngestionService';
import { normalizeOcrTextForParsing } from './ocrFieldExtraction';
import { logExtractedBusinessDataCsv } from './csvConverter';
import { allocateNextDealId, withAllocatedDealId } from './nextDealIdService';
import { applicationCreateUncheckedData } from '../utils/prisma/applicationCreateUncheckedData';

export type UserRole = Role;

export interface AuthenticatedUser {
    id: string;
    role: UserRole | string;
}


function normalizeRole(role: string | UserRole | null | undefined): UserRole | null {
    if (!role) return null;
    const normalized = String(role).trim().toUpperCase().replace(/-/g, '_');
    const valid: UserRole[] = [
        'AGENT',
        'UNDERWRITER',
        'FINAL_UNDERWRITER',
        'ACCOUNTANT',
        'ADMIN',
        'SUPER_ADMIN',
        'OPERATIONS',
    ];
    return (valid as string[]).includes(normalized) ? (normalized as UserRole) : null;
}

/** List/detail queries use the same filters for every CRM role (no per-agent or per-queue hiding). */
export function mergeApplicationVisibilityWhere(
    base: Prisma.ApplicationWhereInput,
    _user: AuthenticatedUser | null | undefined
): Prisma.ApplicationWhereInput {
    return base;
}

/** Any authenticated user with a known CRM role may open an application (matches full list visibility). */
export function canUserAccessApplication(
    _application: Pick<Application, 'referringAgentId' | 'createdById'>,
    user: AuthenticatedUser | null | undefined
): boolean {
    if (!user) return false;
    return normalizeRole(user.role) != null;
}

/** Application type that may include relation fields when include is used */
type ApplicationWithRelations = Application & { files?: Array<{ id: string }> };

/**
 * Fetches a single application and enforces user-based access control.
 * When include is passed, the returned application may have relation fields (e.g. files).
 */
export async function getApplicationForUser(
    where: Prisma.ApplicationWhereUniqueInput,
    user: AuthenticatedUser | null | undefined,
    include?: Prisma.ApplicationInclude
): Promise<{ application: ApplicationWithRelations | null; forbidden: boolean }> {
    const application = await prisma.application.findUnique({
        where,
        include,
    }) as ApplicationWithRelations | null;

    if (!application) {
        return { application: null, forbidden: false };
    }

    if (!canUserAccessApplication(application, user)) {
        return { application: null, forbidden: true };
    }

    return { application, forbidden: false };
}

/* =========================================================================
   Create Client + Application from a PDF buffer (reusable across controllers)
   ========================================================================= */

/** Helper to strip non-digits from SSN */
const normalizeSsn = (ssn: string | null | undefined) =>
    ssn ? String(ssn).replace(/\D/g, '') : null;

/** Helper to parse numeric amounts like "$12,345.67" */
const parseNumericAmount = (value: string | number | null | undefined): number | null => {
    if (value === null || value === undefined) return null;
    const str = String(value).replace(/[$,\s]/g, '').trim();
    if (!str) return null;
    const num = parseFloat(str);
    return isNaN(num) ? null : num;
};

/** Helper to parse date strings */
const parseDate = (dateStr: string | null | undefined): Date | null => {
    if (!dateStr) return null;
    const parsed = new Date(dateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
};

const looksLikeEmail = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s);

/**
 * OCR/Claude occasionally puts the wrong line into date fields (e.g. “Requested Amount :”).
 */
const parseDateForClientFields = (dateStr: string | null | undefined): Date | null => {
    const t = String(dateStr ?? '').trim();
    if (!t || t.length > 80) return null;
    if (/requested\s+amount|gross\s+annual\s+sales|business\s+name|dba|email\b/i.test(t)) return null;
    if (!/\d/.test(t)) return null;
    return parseDate(t);
};

/**
 * When the same owner SSN matches an existing client, we still ingest a new Application but historically
 * left Client.* empty → CRM showed no email even though CSV extraction logged them.
 */
async function mergePdfExtractIntoExistingClient(
    clientId: string,
    business: Record<string, unknown>,
    owner: Record<string, unknown>,
): Promise<void> {
    const cur = await prisma.client.findUnique({
        where: { id: clientId },
        select: {
            businessEmail: true,
            ownerEmail: true,
            businessWebsite: true,
            businessNumber: true,
            ownerMobileNumber: true,
        },
    });
    if (!cur) return;

    const patch: Prisma.ClientUpdateInput = {};
    const bizEm = String(business.business_email ?? '').trim();
    const ownEm = String(owner.owner_email ?? '').trim();
    const web = String(business.business_website ?? '')
        .trim()
        .replace(/[,;)]+$/, '');
    const phone = String(business.phone_number ?? '').trim();
    const ownerMobile = String(owner.owner_mobile_number ?? '').trim();

    if (!(cur.businessEmail ?? '').trim() && bizEm && looksLikeEmail(bizEm)) patch.businessEmail = bizEm;
    if (!(cur.ownerEmail ?? '').trim() && ownEm && looksLikeEmail(ownEm)) patch.ownerEmail = ownEm;
    if (!(cur.businessWebsite ?? '').trim() && web && /\./.test(web)) patch.businessWebsite = web.slice(0, 500);
    if (!(cur.businessNumber ?? '').trim() && phone) patch.businessNumber = phone.slice(0, 80);
    if (!(cur.ownerMobileNumber ?? '').trim() && ownerMobile) patch.ownerMobileNumber = ownerMobile.slice(0, 80);

    if (Object.keys(patch).length === 0) return;
    await prisma.client.update({
        where: { id: clientId },
        data: patch,
    });
}

export interface PdfApplicationResult {
    client: any;
    application: any;
    existingClient: boolean;
}

export interface CreatePdfApplicationOptions {
    isoId?: string | null;
    /** Original filename for the stored ApplicationFile (e.g. Gmail attachment name). */
    originalFileName?: string | null;
    /**
     * When provided (e.g. OCR + `parseBusinessData` already ran in the controller),
     * skips PDF text extraction and parsing inside this helper.
     */
    preParsedData?: unknown;
}

/** Thrown when parsed PDF data cannot satisfy Prisma for a *new* client (e.g. missing business name). */
export class InsufficientParsedPdfError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'InsufficientParsedPdfError';
    }
}

/**
 * New-client path needs owner name fields; businessName falls back when missing.
 */
export function assertReadyToCreateNewClientFromPdf(parsedData: unknown, clientRecord: unknown): void {
    if (clientRecord) {
        return;
    }
    const o =
        (parsedData as { owner?: { owner_first_name?: string | null; owner_last_name?: string | null } })?.owner ??
        {};
    const fn = o.owner_first_name != null ? String(o.owner_first_name).trim() : '';
    const ln = o.owner_last_name != null ? String(o.owner_last_name).trim() : '';
    if (!fn || !ln) {
        throw new InsufficientParsedPdfError(
            'Could not determine owner first and last name from this PDF. Prisma requires both; ensure Claude key_data includes owner_first_name / owner_last_name.',
        );
    }
}

/**
 * Accepts a raw PDF buffer, extracts business/owner data, finds or creates
 * a Client, then creates an Application linked to that client.
 *
 * This is the same logic used by ApplicationController.autoCreateFromPDF
 * but decoupled from Express (Request/Response) so it can be reused by
 * the Gmail auto-import flow or any other caller.
 */
const PDF_EMAIL_AUTO_CREATE_QUEUE = 'Underwriter';
/** Route PDF-created applications directly to underwriter review queue. */
const PDF_EMAIL_AUTO_CREATE_STATE = 'IN_PROGRESS';

const applicationWithFilesInclude = {
    referringAgent: { select: { id: true, firstName: true, lastName: true, email: true } },
    salesRepresentative: { select: { id: true, firstName: true, lastName: true, email: true } },
    createdBy: { select: { id: true, firstName: true, lastName: true, email: true } },
    client: true,
    files: true,
} as const;

async function refetchApplicationWithFiles(applicationId: string) {
    return prisma.application.findUnique({
        where: { id: applicationId },
        include: applicationWithFilesInclude,
    });
}

export async function createClientAndApplicationFromPDFBuffer(
    pdfBuffer: Buffer | string,
    userId: string,
    options?: CreatePdfApplicationOptions
): Promise<PdfApplicationResult> {
    const storedPdfName =
        String(options?.originalFileName || 'application.pdf').trim() || 'application.pdf';
    const isoId = options?.isoId ? String(options.isoId).trim() : null;
    let commissionPercentageFromIso = 0;
    if (isoId) {
        const isoRecord = await prisma.iso.findUnique({
            where: { id: isoId },
            select: { commissionPercentage: true },
        });
        if (isoRecord) {
            commissionPercentageFromIso = Number(isoRecord.commissionPercentage ?? 0);
        }
    }
    const agentCreationQueue = PDF_EMAIL_AUTO_CREATE_QUEUE;
    const agentCreationState = PDF_EMAIL_AUTO_CREATE_STATE;

    let parsedData: any;
    if (options?.preParsedData && typeof options.preParsedData === 'object') {
        parsedData = options.preParsedData;
    } else {
        const buf: Buffer = Buffer.isBuffer(pdfBuffer)
            ? pdfBuffer
            : await fs.readFile(String(pdfBuffer));
        const filePathFallback = Buffer.isBuffer(pdfBuffer) ? undefined : String(pdfBuffer);
        const nameFromOpts =
            String(options?.originalFileName || '').trim() ||
            (filePathFallback ? path.basename(filePathFallback) : '') ||
            'application.pdf';
        const textRaw = await extractPdfPlainTextForParsing(buf, nameFromOpts, filePathFallback);
        const text = normalizeOcrTextForParsing(textRaw);
        parsedData = parseBusinessData(text);
    }

    if (!parsedData || typeof parsedData !== 'object') {
        throw new Error('Failed to extract structured data from PDF');
    }

    logExtractedBusinessDataCsv(parsedData, {
        tag: '[pdfIngestion]',
        fileName: storedPdfName,
    });

    const business: any = parsedData.business || {};
    const owner: any = parsedData.owner || {};

    const ownerSsnRaw =
        owner.owner_ssn || owner.ownerSsn || owner.ssn || null;
    const ownerSsnNorm = normalizeSsn(ownerSsnRaw);

    // Parse requested loan amount
    const requestedAmountRaw =
        business.business_requested_amount || business.requested_amount || null;
    const loanAmountNum = parseNumericAmount(requestedAmountRaw);

    // Parse Gross Annual Sales → monthly revenue
    const grossAnnualRaw = business.business_monthly_revenue; // parsed from "Gross Annual Sales"
    const annualRevenue = parseNumericAmount(grossAnnualRaw);
    const monthlyRevenue =
        annualRevenue != null ? Math.round((annualRevenue / 12) * 100) / 100 : null;

    // 3️⃣ Try to find existing client by SSN
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

    // 4️⃣ Create client + application
    if (clientRecord) {
        await mergePdfExtractIntoExistingClient(clientRecord.id, business, owner);
        clientRecord = await prisma.client.findUnique({
            where: { id: clientRecord.id },
        });

        // Client already exists → create application only
        const createdApplication = await withAllocatedDealId((dealId, tx) =>
            tx.application.create({
                data: applicationCreateUncheckedData({
                    priority: 'High',
                    type: 'New',
                    salesRepresentativeId: userId,
                    referringAgentId: userId,
                    clientId: clientRecord.id,
                    isoId: isoId || null,
                    commissionPercentage: commissionPercentageFromIso,
                    loanAmount: loanAmountNum != null && !isNaN(loanAmountNum) ? loanAmountNum : null,
                    createdById: userId,
                    currentQueue: agentCreationQueue,
                    currentState: agentCreationState,
                    dealId,
                }),
                include: applicationWithFilesInclude,
            }),
        );

        if (Buffer.isBuffer(pdfBuffer)) {
            await attachBufferAsApplicationFile(createdApplication.id, pdfBuffer, storedPdfName);
        }
        const applicationWithFiles =
            (await refetchApplicationWithFiles(createdApplication.id)) || createdApplication;

        console.log(
            '[createClientAndApplicationFromPDFBuffer] Final DB result (existing client):',
            JSON.stringify(
                { clientId: clientRecord.id, applicationId: applicationWithFiles.id },
                null,
                2,
            ),
        );

        return {
            client: clientRecord,
            application: applicationWithFiles,
            existingClient: true,
        };
    }

    assertReadyToCreateNewClientFromPdf(parsedData, clientRecord);

    // Client does not exist → create client + application atomically
    const result = await prisma.$transaction(async (tx) => {
        const dealId = await allocateNextDealId(tx);

        const businessNameFallback =
            String(business.business_name || '').trim() ||
            String(business.dba_name || '').trim() ||
            (owner.owner_first_name || owner.owner_last_name
                ? `${String(owner.owner_first_name || '').trim()} ${String(owner.owner_last_name || '').trim()}`.trim() + ' Business'
                : 'Unknown Business');
        const newClient = await tx.client.create({
            data: {
                businessName: businessNameFallback,
                businessEmail: business.business_email || null,
                businessNumber: business.phone_number || null,
                businessWebsite: business.business_website || null,
                businessIncorporationDate: parseDateForClientFields(business.business_incorporation_date),
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
                ownerDateOfBirth: parseDateForClientFields(owner.owner_date_of_birth),
                ownerSsn: ownerSsnNorm || null,
                ownerFicoScore: owner.owner_fico_score ? Number(owner.owner_fico_score) : null,
                ownerOwnershipStartDate: null,
                ownerOwnershipPercentage: owner.owner_ownership_percentage
                    ? Number(owner.owner_ownership_percentage)
                    : null,
                ownerAddress1: owner.owner_address1 || null,
                ownerAddress2: null,
                ownerCity: owner.owner_city || null,
                ownerState: owner.owner_state || null,
                ownerZipCode: owner.owner_zip_code || null,
                createdById: userId,
            },
        });

        const newApplication = await tx.application.create({
            data: applicationCreateUncheckedData({
                priority: 'High',
                type: 'New',
                salesRepresentativeId: userId,
                referringAgentId: userId,
                clientId: newClient.id,
                isoId: isoId || null,
                commissionPercentage: commissionPercentageFromIso,
                loanAmount: loanAmountNum != null && !isNaN(loanAmountNum) ? loanAmountNum : null,
                createdById: userId,
                currentQueue: agentCreationQueue,
                currentState: agentCreationState,
                dealId,
            }),
            include: applicationWithFilesInclude,
        });

        return { newClient, newApplication };
    }, { maxWait: 20_000, timeout: 120_000 });

    if (Buffer.isBuffer(pdfBuffer)) {
        await attachBufferAsApplicationFile(result.newApplication.id, pdfBuffer, storedPdfName);
    }
    const applicationWithFiles =
        (await refetchApplicationWithFiles(result.newApplication.id)) || result.newApplication;

    console.log(
        '[createClientAndApplicationFromPDFBuffer] Final DB result (new client):',
        JSON.stringify(
            { clientId: result.newClient.id, applicationId: applicationWithFiles.id },
            null,
            2,
        ),
    );

    return {
        client: result.newClient,
        application: applicationWithFiles,
        existingClient: false,
    };
}

const applicationService = {
    mergeApplicationVisibilityWhere,
    canUserAccessApplication,
    getApplicationForUser,
    createClientAndApplicationFromPDFBuffer,
};

export default applicationService;
