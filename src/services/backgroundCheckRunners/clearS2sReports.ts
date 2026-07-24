import { AxiosInstance } from 'axios';
import {
    ClearS2sClientConfig,
    getClearS2sClientConfig,
} from './clearS2sConfig';
import {
    assertClearSuccess,
    createClearS2sHttpClient,
    escapeXml,
    extractAll,
    extractOne,
} from './clearS2sClient';

const PERSON_REPORT_PATH = '/v2/personReport/reportResults';
const PERSON_REPORT_CANDIDATE_PATH = '/v2/personReportCandidate/reportResultsCandidate';
const BUSINESS_REPORT_PATH = '/v2/businessReport/reportResults';
const BUSINESS_REPORT_CANDIDATE_PATH = '/v2/businessReportCandidate/reportResultsCandidate';

/** Basic Person Report sections (World-Check intentionally off).
 * Do not send business-only flags (e.g. CorporateSection) — CLEAR returns HTTP 400/40002.
 * Person corporate affiliations come via WorkAffiliationSection; business reports keep CorporateSection.
 */
const PERSON_BASIC_SECTIONS = [
    'AddressSection',
    'DeathSection',
    'WorkAffiliationSection',
    'OtherSSNSection',
    'OtherNamesforSSNSection',
    'PhoneNumberSection',
    'PhoneListingSection',
    'EmailSection',
    'DriverLicenseSection',
    'InfractionSection',
    'CriminalSection',
    'ArrestSection',
    'LienJudgmentSection',
    'BankruptcySection',
    'LawsuitSection',
] as const;

/** Core Business Report sections (World-Check intentionally off). */
const BUSINESS_CORE_SECTIONS = [
    'BusinessOverviewSection',
    'PhoneNumberSection',
    'BusinessSameAddressSection',
    'PeopleSameAddressSection',
    'FEINSection',
    'FictitiousBusinessNameSection',
    'ExecutiveAffiliationSection',
    'BusinessContactRecordsSection',
    'CompanyProfileSection',
    'CorporateSection',
    'BusinessProfileSection',
    'UCCFilingsSection',
    'BankruptcySection',
    'LienJudgmentSection',
    'LawsuitSection',
    'CriminalSection',
] as const;

function reportSectionXml(names: readonly string[], worldCheck = false): string {
    const lines = names.map((name) => `        <${name}>true</${name}>`);
    lines.push(`        <WorldCheckSection>${worldCheck ? 'true' : 'false'}</WorldCheckSection>`);
    return lines.join('\n');
}

/** Poll budget for interim CLEAR report statuses (e.g. 204/70001). */
export const CLEAR_REPORT_POLL_TIMEOUT_MS = 60_000;

export type ClearReportKind = 'person' | 'business';

export type ClearReportPdfResult = {
    kind: ClearReportKind;
    groupId: string;
    reportId: string;
    fileName: string;
    pdf: Buffer;
    /** Best-effort structured report XML (for Lien/Judgment parse). */
    xml?: string;
    /** Present when PDF succeeded but XML retrieval failed. */
    xmlError?: string;
};

export type ClearReportFailure = {
    kind: ClearReportKind;
    groupId: string;
    error: string;
};

export type ClearReportsBatchResult = {
    attached: ClearReportPdfResult[];
    errors: ClearReportFailure[];
};

export type ClearSearchMetadataForReports = {
    businessSearch?: { groupIds?: string[] | null } | null;
    personSearches?: Array<{ groupIds?: string[] | null } | null> | null;
};

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function sliceGroupIdForFileName(groupId: string): string {
    const cleaned = String(groupId ?? '').replace(/[^\w-]+/g, '');
    return cleaned.slice(0, 8) || 'unknown';
}

export function clearReportFileName(kind: ClearReportKind, groupId: string): string {
    const slice = sliceGroupIdForFileName(groupId);
    return kind === 'person'
        ? `CLEAR-Person-Report-${slice}.pdf`
        : `CLEAR-Business-Report-${slice}.pdf`;
}

/**
 * Business: at most the first business groupId.
 * Person: up to 3 unique groupIds across all person searches (first-seen order).
 */
export function selectClearReportGroupIds(raw: ClearSearchMetadataForReports | null | undefined): {
    businessGroupId?: string;
    personGroupIds: string[];
} {
    const businessGroupId = String(raw?.businessSearch?.groupIds?.[0] ?? '').trim() || undefined;
    const personGroupIds: string[] = [];
    const seen = new Set<string>();

    for (const search of raw?.personSearches ?? []) {
        for (const rawId of search?.groupIds ?? []) {
            const groupId = String(rawId ?? '').trim();
            if (!groupId || seen.has(groupId)) continue;
            seen.add(groupId);
            personGroupIds.push(groupId);
            if (personGroupIds.length >= 3) {
                return { businessGroupId, personGroupIds };
            }
        }
    }

    return { businessGroupId, personGroupIds };
}

export function buildPersonReportXml(
    groupId: string,
    config: Pick<ClearS2sClientConfig, 'permissiblePurpose'>,
    reference: string,
): string {
    const id = String(groupId ?? '').trim();
    if (!id) throw new Error('CLEAR Person Report requires a GroupID from Person Search.');

    return `<?xml version="1.0" encoding="UTF-8"?>
<pr:PersonReportRequest xmlns:pr="http://clear.thomsonreuters.com/api/report/2.0">
  <PermissiblePurpose>
    <GLB>${escapeXml(config.permissiblePurpose.glb)}</GLB>
    <DPPA>${escapeXml(config.permissiblePurpose.dppa)}</DPPA>
    <VOTER>${escapeXml(config.permissiblePurpose.voter)}</VOTER>
  </PermissiblePurpose>
  <Reference>${escapeXml(reference.slice(0, 35))}</Reference>
  <Criteria>
    <rc:ReportCriteria xmlns:rc="com/thomsonreuters/schemas/person-report">
      <GroupID>${escapeXml(id)}</GroupID>
      <ReportChoice>Individual</ReportChoice>
      <ReportSections>
${reportSectionXml(PERSON_BASIC_SECTIONS)}
      </ReportSections>
    </rc:ReportCriteria>
  </Criteria>
</pr:PersonReportRequest>`;
}

export function buildPersonReportCandidateXml(
    baseGuid: string,
    config: Pick<ClearS2sClientConfig, 'permissiblePurpose'>,
    reference: string,
): string {
    const id = String(baseGuid ?? '').trim();
    if (!id) throw new Error('CLEAR Person Report Candidate requires a BaseGuid.');

    return `<?xml version="1.0" encoding="UTF-8"?>
<pr:PersonReportCandidateRequest xmlns:pr="http://clear.thomsonreuters.com/api/report/2.0">
  <PermissiblePurpose>
    <GLB>${escapeXml(config.permissiblePurpose.glb)}</GLB>
    <DPPA>${escapeXml(config.permissiblePurpose.dppa)}</DPPA>
    <VOTER>${escapeXml(config.permissiblePurpose.voter)}</VOTER>
  </PermissiblePurpose>
  <Reference>${escapeXml(reference.slice(0, 35))}</Reference>
  <Criteria>
    <rc:ReportCriteria xmlns:rc="com/thomsonreuters/schemas/person-report">
      <ReportCandidate>
        <BaseGuid>${escapeXml(id)}</BaseGuid>
      </ReportCandidate>
      <ReportChoice>Individual</ReportChoice>
      <ReportSections>
${reportSectionXml(PERSON_BASIC_SECTIONS)}
      </ReportSections>
    </rc:ReportCriteria>
  </Criteria>
</pr:PersonReportCandidateRequest>`;
}

export function buildBusinessReportXml(
    groupId: string,
    config: Pick<ClearS2sClientConfig, 'permissiblePurpose'>,
    reference: string,
): string {
    const id = String(groupId ?? '').trim();
    if (!id) throw new Error('CLEAR Business Report requires a GroupID from Business Search.');

    return `<?xml version="1.0" encoding="UTF-8"?>
<br:BusinessReportRequest xmlns:br="http://clear.thomsonreuters.com/api/report/2.0">
  <PermissiblePurpose>
    <GLB>${escapeXml(config.permissiblePurpose.glb)}</GLB>
    <DPPA>${escapeXml(config.permissiblePurpose.dppa)}</DPPA>
    <VOTER>${escapeXml(config.permissiblePurpose.voter)}</VOTER>
  </PermissiblePurpose>
  <Reference>${escapeXml(reference.slice(0, 35))}</Reference>
  <Criteria>
    <rc:ReportCriteria xmlns:rc="com/thomsonreuters/schemas/business-report">
      <GroupID>${escapeXml(id)}</GroupID>
      <ReportChoice>Business</ReportChoice>
      <ReportSections>
${reportSectionXml(BUSINESS_CORE_SECTIONS)}
      </ReportSections>
    </rc:ReportCriteria>
  </Criteria>
</br:BusinessReportRequest>`;
}

export function buildBusinessReportCandidateXml(
    baseGuid: string,
    config: Pick<ClearS2sClientConfig, 'permissiblePurpose'>,
    reference: string,
): string {
    const id = String(baseGuid ?? '').trim();
    if (!id) throw new Error('CLEAR Business Report Candidate requires a BaseGuid.');

    return `<?xml version="1.0" encoding="UTF-8"?>
<br:BusinessReportCandidateRequest xmlns:br="http://clear.thomsonreuters.com/api/report/2.0">
  <PermissiblePurpose>
    <GLB>${escapeXml(config.permissiblePurpose.glb)}</GLB>
    <DPPA>${escapeXml(config.permissiblePurpose.dppa)}</DPPA>
    <VOTER>${escapeXml(config.permissiblePurpose.voter)}</VOTER>
  </PermissiblePurpose>
  <Reference>${escapeXml(reference.slice(0, 35))}</Reference>
  <Criteria>
    <rc:ReportCriteria xmlns:rc="com/thomsonreuters/schemas/business-report">
      <ReportCandidate>
        <BaseGuid>${escapeXml(id)}</BaseGuid>
      </ReportCandidate>
      <ReportChoice>Business</ReportChoice>
      <ReportSections>
${reportSectionXml(BUSINESS_CORE_SECTIONS)}
      </ReportSections>
    </rc:ReportCriteria>
  </Criteria>
</br:BusinessReportCandidateRequest>`;
}

function reportIdFromUri(uri: string, kind: ClearReportKind): string {
    const parsed = new URL(uri);
    const pattern =
        kind === 'person'
            ? /\/v2\/personReport\/reportResults\/([^/]+)$/i
            : /\/v2\/businessReport\/reportResults\/([^/]+)$/i;
    const match = parsed.pathname.match(pattern);
    if (!match) {
        throw new Error(
            `CLEAR returned an invalid ${kind === 'person' ? 'Person' : 'Business'} Report result URI.`,
        );
    }
    return decodeURIComponent(match[1]);
}

function isPdfBuffer(buffer: Buffer): boolean {
    return buffer.length >= 4 && buffer.subarray(0, 4).toString('latin1') === '%PDF';
}

function isReportPending(xml: string): boolean {
    const statusCode = extractOne(xml, 'StatusCode');
    const subStatusCode = extractOne(xml, 'SubStatusCode');
    return statusCode === '204' || subStatusCode === '70001';
}

function describeHttpError(error: unknown, operation: string): Error {
    const anyErr = error as {
        message?: string;
        response?: { status?: number; data?: unknown };
    };
    const status = anyErr?.response?.status;
    if (status === 403) {
        return new Error(
            `CLEAR ${operation} failed with HTTP 403 (entitlement/forbidden).`,
        );
    }
    if (status) {
        const body = anyErr.response?.data;
        const snippet =
            typeof body === 'string'
                ? body.slice(0, 200)
                : Buffer.isBuffer(body)
                  ? body.toString('utf8').slice(0, 200)
                  : '';
        return new Error(
            `CLEAR ${operation} failed with HTTP ${status}${snippet ? `: ${snippet}` : ''}.`,
        );
    }
    return new Error(
        `CLEAR ${operation} failed: ${String(anyErr?.message || error).slice(0, 300)}`,
    );
}

async function postReportXml(
    client: AxiosInstance,
    path: string,
    requestXml: string,
    operation: string,
): Promise<string> {
    let postResponse;
    try {
        postResponse = await client.post(path, requestXml, {
            headers: { 'Content-Type': 'application/xml' },
        });
    } catch (error) {
        throw describeHttpError(error, operation);
    }
    return String(postResponse.data ?? '');
}

/**
 * POST report create. If CLEAR returns candidates instead of a Uri, pick the first
 * BaseGuid and continue via the Candidate endpoint (CLEAR disambiguation flow).
 */
async function createReport(
    client: AxiosInstance,
    kind: ClearReportKind,
    requestXml: string,
    config: Pick<ClearS2sClientConfig, 'permissiblePurpose'>,
    reference: string,
): Promise<string> {
    const path = kind === 'person' ? PERSON_REPORT_PATH : BUSINESS_REPORT_PATH;
    const operation = kind === 'person' ? 'Person Report' : 'Business Report';
    const postXml = await postReportXml(client, path, requestXml, operation);
    assertClearSuccess(postXml, operation);

    const uri = extractOne(postXml, 'Uri');
    if (uri) return reportIdFromUri(uri, kind);

    const baseGuid = extractAll(postXml, 'BaseGuid')[0];
    const candidateCount = Number(extractOne(postXml, 'NumberOfCandidates') ?? 0);
    if (!baseGuid) {
        throw new Error(
            `CLEAR ${operation} returned no result URI${candidateCount ? ` (${candidateCount} candidates without BaseGuid)` : ''}.`,
        );
    }

    const candidatePath =
        kind === 'person' ? PERSON_REPORT_CANDIDATE_PATH : BUSINESS_REPORT_CANDIDATE_PATH;
    const candidateXml =
        kind === 'person'
            ? buildPersonReportCandidateXml(baseGuid, config, reference)
            : buildBusinessReportCandidateXml(baseGuid, config, reference);
    const candidateResponseXml = await postReportXml(
        client,
        candidatePath,
        candidateXml,
        `${operation} Candidate`,
    );
    assertClearSuccess(candidateResponseXml, `${operation} Candidate`);
    const candidateUri = extractOne(candidateResponseXml, 'Uri');
    if (!candidateUri) {
        throw new Error(`CLEAR ${operation} Candidate returned no result URI.`);
    }
    return reportIdFromUri(candidateUri, kind);
}

function reportResultPath(kind: ClearReportKind, reportId: string): string {
    return kind === 'person'
        ? `${PERSON_REPORT_PATH}/${encodeURIComponent(reportId)}`
        : `${BUSINESS_REPORT_PATH}/${encodeURIComponent(reportId)}`;
}

async function pollReportPdf(
    client: AxiosInstance,
    kind: ClearReportKind,
    reportId: string,
    timeoutMs: number = CLEAR_REPORT_POLL_TIMEOUT_MS,
): Promise<Buffer> {
    const path = reportResultPath(kind, reportId);
    const operation =
        kind === 'person' ? 'Person Report PDF retrieval' : 'Business Report PDF retrieval';
    const deadline = Date.now() + timeoutMs;
    let delayMs = 1_000;

    while (Date.now() < deadline) {
        let getResponse;
        try {
            getResponse = await client.get(path, {
                params: { reportType: 'pdf' },
                responseType: 'arraybuffer',
                transformResponse: [(data) => data],
                headers: { Accept: 'application/pdf, application/xml, */*' },
            });
        } catch (error) {
            throw describeHttpError(error, operation);
        }

        const buffer = Buffer.from(getResponse.data ?? []);
        if (isPdfBuffer(buffer)) return buffer;

        const xml = buffer.toString('utf8');
        if (isReportPending(xml)) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await sleep(Math.min(delayMs, remaining));
            delayMs = Math.min(delayMs * 2, 8_000);
            continue;
        }

        const statusCode = extractOne(xml, 'StatusCode');
        if (statusCode && statusCode !== '200') {
            const subStatusCode = extractOne(xml, 'SubStatusCode');
            const message = extractOne(xml, 'Message');
            throw new Error(
                `CLEAR ${operation} failed with status ${statusCode}${subStatusCode ? `/${subStatusCode}` : ''}${message ? `: ${message}` : ''}.`,
            );
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(delayMs, remaining));
        delayMs = Math.min(delayMs * 2, 8_000);
    }

    throw new Error(`CLEAR ${operation} timed out after ${timeoutMs}ms.`);
}

function isReportXmlReady(xml: string): boolean {
    if (!xml.trim()) return false;
    if (isReportPending(xml)) return false;
    const statusCode = extractOne(xml, 'StatusCode');
    if (statusCode && statusCode !== '200') return false;
    // Ready report payloads are substantial and typically include section or entity markers.
    if (
        /LienJudgment|Judg(?:e)?ment|TaxLien|<Lien[\s>]|PersonReport|BusinessReport/i.test(xml)
    ) {
        return true;
    }
    return xml.length > 200;
}

/**
 * Poll CLEAR for structured report XML after PDF is available.
 * Uses the same interim pending codes as PDF retrieval.
 */
export async function pollReportXml(
    client: AxiosInstance,
    kind: ClearReportKind,
    reportId: string,
    timeoutMs: number = CLEAR_REPORT_POLL_TIMEOUT_MS,
): Promise<string> {
    const path = reportResultPath(kind, reportId);
    const operation =
        kind === 'person' ? 'Person Report XML retrieval' : 'Business Report XML retrieval';
    const deadline = Date.now() + timeoutMs;
    let delayMs = 1_000;

    while (Date.now() < deadline) {
        let getResponse;
        try {
            getResponse = await client.get(path, {
                params: { reportType: 'xml' },
                responseType: 'arraybuffer',
                transformResponse: [(data) => data],
                headers: { Accept: 'application/xml, text/xml, */*' },
            });
        } catch (error) {
            throw describeHttpError(error, operation);
        }

        const buffer = Buffer.from(getResponse.data ?? []);
        if (isPdfBuffer(buffer)) {
            throw new Error(`CLEAR ${operation} returned PDF instead of XML.`);
        }

        const xml = buffer.toString('utf8');
        if (isReportPending(xml)) {
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            await sleep(Math.min(delayMs, remaining));
            delayMs = Math.min(delayMs * 2, 8_000);
            continue;
        }

        const statusCode = extractOne(xml, 'StatusCode');
        if (statusCode && statusCode !== '200' && !isReportXmlReady(xml)) {
            const subStatusCode = extractOne(xml, 'SubStatusCode');
            const message = extractOne(xml, 'Message');
            throw new Error(
                `CLEAR ${operation} failed with status ${statusCode}${subStatusCode ? `/${subStatusCode}` : ''}${message ? `: ${message}` : ''}.`,
            );
        }

        if (isReportXmlReady(xml)) return xml;

        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(delayMs, remaining));
        delayMs = Math.min(delayMs * 2, 8_000);
    }

    throw new Error(`CLEAR ${operation} timed out after ${timeoutMs}ms.`);
}

async function fetchReportPdfAndXml(
    client: AxiosInstance,
    kind: ClearReportKind,
    groupId: string,
    reportId: string,
): Promise<ClearReportPdfResult> {
    const pdf = await pollReportPdf(client, kind, reportId);
    const result: ClearReportPdfResult = {
        kind,
        groupId,
        reportId,
        fileName: clearReportFileName(kind, groupId),
        pdf,
    };
    try {
        result.xml = await pollReportXml(client, kind, reportId);
    } catch (error: any) {
        result.xmlError = String(error?.message || error).slice(0, 500);
    }
    return result;
}

export async function createAndFetchPersonReportPdf(
    groupId: string,
    reference: string,
    config: ClearS2sClientConfig = getClearS2sClientConfig(),
): Promise<ClearReportPdfResult> {
    const client = createClearS2sHttpClient(config);
    const requestXml = buildPersonReportXml(groupId, config, reference);
    const reportId = await createReport(client, 'person', requestXml, config, reference);
    return fetchReportPdfAndXml(client, 'person', groupId, reportId);
}

export async function createAndFetchBusinessReportPdf(
    groupId: string,
    reference: string,
    config: ClearS2sClientConfig = getClearS2sClientConfig(),
): Promise<ClearReportPdfResult> {
    const client = createClearS2sHttpClient(config);
    const requestXml = buildBusinessReportXml(groupId, config, reference);
    const reportId = await createReport(client, 'business', requestXml, config, reference);
    return fetchReportPdfAndXml(client, 'business', groupId, reportId);
}

/**
 * Best-effort PDF generation for CLEAR search group IDs.
 * Individual report failures are collected; callers must not fail the search run.
 */
export async function fetchClearReportPdfsForSearch(
    raw: ClearSearchMetadataForReports | null | undefined,
    applicationId: string,
    config: ClearS2sClientConfig = getClearS2sClientConfig(),
): Promise<ClearReportsBatchResult> {
    const { businessGroupId, personGroupIds } = selectClearReportGroupIds(raw);
    const attached: ClearReportPdfResult[] = [];
    const errors: ClearReportFailure[] = [];

    if (businessGroupId) {
        try {
            attached.push(
                await createAndFetchBusinessReportPdf(
                    businessGroupId,
                    `Ocean ${applicationId} BizRpt`,
                    config,
                ),
            );
        } catch (error: any) {
            errors.push({
                kind: 'business',
                groupId: businessGroupId,
                error: String(error?.message || error).slice(0, 500),
            });
        }
    }

    for (const [index, groupId] of personGroupIds.entries()) {
        try {
            attached.push(
                await createAndFetchPersonReportPdf(
                    groupId,
                    `Ocean ${applicationId} PersRpt${index + 1}`,
                    config,
                ),
            );
        } catch (error: any) {
            errors.push({
                kind: 'person',
                groupId,
                error: String(error?.message || error).slice(0, 500),
            });
        }
    }

    return { attached, errors };
}
