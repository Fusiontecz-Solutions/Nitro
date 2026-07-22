import axios, { AxiosInstance } from 'axios';
import { readFileSync } from 'fs';
import { Agent } from 'https';
import { resolve } from 'path';
import { ClearS2sClientConfig, getClearS2sClientConfig } from './clearS2sConfig';

const PERSON_SEARCH_PATH = '/v3/person/searchResults';
const BUSINESS_SEARCH_PATH = '/v2/business/searchResults';

type SearchAddress = {
    street?: string | null;
    city?: string | null;
    state?: string | null;
    zipCode?: string | null;
    country?: string | null;
};

export type ClearPersonSearchSubject = {
    firstName: string;
    middleName?: string | null;
    lastName: string;
    dateOfBirth?: Date | string | null;
    ssn?: string | null;
    phoneNumber?: string | null;
    emailAddress?: string | null;
    driverLicenseNumber?: string | null;
    address?: SearchAddress;
};

export type ClearPersonSearchResult = {
    environment: string;
    statusCode: string;
    subStatusCode?: string;
    groupCount: number;
    resultId?: string;
    groupIds: string[];
    personEntityIds: string[];
};

export type ClearBusinessSearchSubject = {
    businessName: string;
    fein?: string | null;
    phoneNumber?: string | null;
    ownerFirstName?: string | null;
    ownerMiddleName?: string | null;
    ownerLastName?: string | null;
    address?: SearchAddress;
};

export type ClearBusinessSearchResult = {
    environment: string;
    statusCode: string;
    subStatusCode?: string;
    groupCount: number;
    resultId?: string;
    groupIds: string[];
    companyEntityIds: string[];
};

function escapeXml(value: unknown): string {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function xmlElement(name: string, value: unknown): string {
    const text = String(value ?? '').trim();
    return text ? `<${name}>${escapeXml(text)}</${name}>` : '';
}

function formatDate(value: Date | string | null | undefined): string {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${month}/${day}/${date.getUTCFullYear()}`;
}

function normalizeState(value: string | null | undefined): string {
    return String(value ?? '').trim().toUpperCase();
}

function normalizeSsn(value: string | null | undefined): string {
    const digits = String(value ?? '').replace(/\D/g, '');
    if (digits.length === 9) {
        return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    }
    return digits.length === 4 ? digits : '';
}

export function buildPersonSearchXml(
    subject: ClearPersonSearchSubject,
    config: Pick<ClearS2sClientConfig, 'permissiblePurpose'>,
    reference: string,
): string {
    const firstName = String(subject.firstName ?? '').trim();
    const lastName = String(subject.lastName ?? '').trim();
    if (!firstName || !lastName) {
        throw new Error('CLEAR Person Search requires the owner first and last name.');
    }

    const address = subject.address ?? {};
    return `<?xml version="1.0" encoding="UTF-8"?>
<ps:PersonSearchRequestV3 xmlns:ps="http://clear.thomsonreuters.com/api/search/2.0">
  <PermissiblePurpose>
    <GLB>${escapeXml(config.permissiblePurpose.glb)}</GLB>
    <DPPA>${escapeXml(config.permissiblePurpose.dppa)}</DPPA>
    <VOTER>${escapeXml(config.permissiblePurpose.voter)}</VOTER>
  </PermissiblePurpose>
  <Reference>${escapeXml(reference.slice(0, 35))}</Reference>
  <Criteria>
    <p1:PersonCriteria xmlns:p1="com/thomsonreuters/schemas/search">
      <NameInfo>
        <AdvancedNameSearch>
          <LastSecondaryNameSoundSimilarOption>false</LastSecondaryNameSoundSimilarOption>
          <SecondaryLastNameOption>OR</SecondaryLastNameOption>
          <FirstNameBeginsWithOption>false</FirstNameBeginsWithOption>
          <FirstNameSoundSimilarOption>false</FirstNameSoundSimilarOption>
          <FirstNameExactMatchOption>false</FirstNameExactMatchOption>
        </AdvancedNameSearch>
        ${xmlElement('LastName', lastName)}
        ${xmlElement('FirstName', firstName)}
        ${xmlElement('MiddleInitial', String(subject.middleName ?? '').trim().slice(0, 1))}
      </NameInfo>
      <AddressInfo>
        <StreetNamesSoundSimilarOption>false</StreetNamesSoundSimilarOption>
        ${xmlElement('Street', address.street)}
        ${xmlElement('City', address.city)}
        ${xmlElement('State', normalizeState(address.state))}
        ${xmlElement('ZipCode', address.zipCode)}
        ${xmlElement('Country', address.country)}
      </AddressInfo>
      ${xmlElement('EmailAddress', subject.emailAddress)}
      ${xmlElement('SSN', normalizeSsn(subject.ssn))}
      ${xmlElement('PhoneNumber', subject.phoneNumber)}
      <AgeInfo>
        ${xmlElement('PersonBirthDate', formatDate(subject.dateOfBirth))}
      </AgeInfo>
      ${xmlElement('DriverLicenseNumber', subject.driverLicenseNumber)}
    </p1:PersonCriteria>
  </Criteria>
  <Datasources>
    <PublicRecordPeople>true</PublicRecordPeople>
    <NPIRecord>false</NPIRecord>
    <WorldCheckRiskIntelligence>false</WorldCheckRiskIntelligence>
  </Datasources>
</ps:PersonSearchRequestV3>`;
}

export function buildBusinessSearchXml(
    subject: ClearBusinessSearchSubject,
    config: Pick<ClearS2sClientConfig, 'permissiblePurpose'>,
    reference: string,
): string {
    const businessName = String(subject.businessName ?? '').trim();
    if (!businessName) throw new Error('CLEAR Business Search requires a business name.');

    const address = subject.address ?? {};
    return `<?xml version="1.0" encoding="UTF-8"?>
<bs:BusinessSearchRequest xmlns:bs="http://clear.thomsonreuters.com/api/search/2.0">
  <PermissiblePurpose>
    <GLB>${escapeXml(config.permissiblePurpose.glb)}</GLB>
    <DPPA>${escapeXml(config.permissiblePurpose.dppa)}</DPPA>
    <VOTER>${escapeXml(config.permissiblePurpose.voter)}</VOTER>
  </PermissiblePurpose>
  <Reference>${escapeXml(reference.slice(0, 35))}</Reference>
  <Criteria>
    <b1:BusinessCriteria xmlns:b1="com/thomsonreuters/schemas/search">
      ${xmlElement('BusinessName', businessName)}
      <CorporationInfo>
        ${xmlElement('FEIN', String(subject.fein ?? '').replace(/\D/g, ''))}
      </CorporationInfo>
      <NameInfo>
        <AdvancedNameSearch>
          <LastSecondaryNameSoundSimilarOption>false</LastSecondaryNameSoundSimilarOption>
          <SecondaryLastNameOption>OR</SecondaryLastNameOption>
          <FirstNameSoundSimilarOption>false</FirstNameSoundSimilarOption>
          <FirstNameVariationsOption>false</FirstNameVariationsOption>
        </AdvancedNameSearch>
        ${xmlElement('LastName', subject.ownerLastName)}
        ${xmlElement('FirstName', subject.ownerFirstName)}
        ${xmlElement('MiddleInitial', String(subject.ownerMiddleName ?? '').trim().slice(0, 1))}
      </NameInfo>
      <AddressInfo>
        <StreetNamesSoundSimilarOption>false</StreetNamesSoundSimilarOption>
        ${xmlElement('Street', address.street)}
        ${xmlElement('City', address.city)}
        ${xmlElement('State', normalizeState(address.state))}
        ${xmlElement('ZipCode', address.zipCode)}
        ${xmlElement('Country', address.country)}
      </AddressInfo>
      ${xmlElement('PhoneNumber', subject.phoneNumber)}
    </b1:BusinessCriteria>
  </Criteria>
  <Datasources>
    <PublicRecordBusiness>true</PublicRecordBusiness>
    <NPIRecord>false</NPIRecord>
    <PublicRecordUCCFilings>true</PublicRecordUCCFilings>
    <WorldCheckRiskIntelligence>false</WorldCheckRiskIntelligence>
  </Datasources>
</bs:BusinessSearchRequest>`;
}

function decodeXml(value: string): string {
    return value
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .trim();
}

function extractAll(xml: string, tag: string): string[] {
    const pattern = new RegExp(
        `<(?:[\\w.-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${tag}>`,
        'gi',
    );
    return Array.from(xml.matchAll(pattern), (match) => decodeXml(match[1]));
}

function extractOne(xml: string, tag: string): string | undefined {
    return extractAll(xml, tag)[0];
}

function resultIdFromUri(uri: string, operation: 'person' | 'business'): string {
    const parsed = new URL(uri);
    const version = operation === 'person' ? 'v3/person' : 'v2/business';
    const match = parsed.pathname.match(new RegExp(`/${version}/searchResults/([^/]+)$`, 'i'));
    if (!match) throw new Error(`CLEAR returned an invalid ${operation} search result URI.`);
    return decodeURIComponent(match[1]);
}

function createHttpClient(config: ClearS2sClientConfig): AxiosInstance {
    const certificatePath = resolve(process.cwd(), config.certificatePath);
    const httpsAgent = new Agent({
        pfx: readFileSync(certificatePath),
        passphrase: config.certificatePassword,
        minVersion: 'TLSv1.2',
        rejectUnauthorized: true,
    });

    return axios.create({
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
        httpsAgent,
        proxy: false,
        maxRedirects: 0,
        auth: { username: config.username, password: config.password },
        headers: { Accept: 'application/xml' },
        responseType: 'text',
        transformResponse: [(data) => data],
    });
}

function assertClearSuccess(xml: string, operation: string): {
    statusCode: string;
    subStatusCode?: string;
} {
    const statusCode = extractOne(xml, 'StatusCode') ?? '';
    const subStatusCode = extractOne(xml, 'SubStatusCode');
    if (statusCode !== '200') {
        throw new Error(
            `CLEAR ${operation} failed with status ${statusCode || 'unknown'}${subStatusCode ? `/${subStatusCode}` : ''}.`,
        );
    }
    return { statusCode, subStatusCode };
}

export async function searchClearPerson(
    subject: ClearPersonSearchSubject,
    reference: string,
    config: ClearS2sClientConfig = getClearS2sClientConfig(),
): Promise<ClearPersonSearchResult> {
    const client = createHttpClient(config);
    const postResponse = await client.post(
        PERSON_SEARCH_PATH,
        buildPersonSearchXml(subject, config, reference),
        { headers: { 'Content-Type': 'application/xml' } },
    );
    const postXml = String(postResponse.data ?? '');
    const status = assertClearSuccess(postXml, 'Person Search');
    const groupCount = Number(extractOne(postXml, 'GroupCount') ?? 0);
    const uri = extractOne(postXml, 'Uri');

    if (!Number.isInteger(groupCount) || groupCount < 0) {
        throw new Error('CLEAR returned an invalid Person Search group count.');
    }
    if (groupCount === 0) {
        return {
            environment: config.environment,
            ...status,
            groupCount,
            groupIds: [],
            personEntityIds: [],
        };
    }
    if (!uri) throw new Error('CLEAR Person Search returned matches without a result URI.');

    const resultId = resultIdFromUri(uri, 'person');
    const getResponse = await client.get(
        `${PERSON_SEARCH_PATH}/${encodeURIComponent(resultId)}`,
        { params: { resultType: 'xml' } },
    );
    const resultXml = String(getResponse.data ?? '');
    assertClearSuccess(resultXml, 'Person Search result retrieval');
    return {
        environment: config.environment,
        ...status,
        groupCount,
        resultId,
        groupIds: [...new Set(extractAll(resultXml, 'GroupId'))],
        personEntityIds: [...new Set(extractAll(resultXml, 'PersonEntityId'))],
    };
}

export async function searchClearBusiness(
    subject: ClearBusinessSearchSubject,
    reference: string,
    config: ClearS2sClientConfig = getClearS2sClientConfig(),
): Promise<ClearBusinessSearchResult> {
    const client = createHttpClient(config);
    const postResponse = await client.post(
        BUSINESS_SEARCH_PATH,
        buildBusinessSearchXml(subject, config, reference),
        { headers: { 'Content-Type': 'application/xml' } },
    );
    const postXml = String(postResponse.data ?? '');
    const status = assertClearSuccess(postXml, 'Business Search');
    const groupCount = Number(extractOne(postXml, 'GroupCount') ?? 0);
    const uri = extractOne(postXml, 'Uri');

    if (!Number.isInteger(groupCount) || groupCount < 0) {
        throw new Error('CLEAR returned an invalid Business Search group count.');
    }
    if (groupCount === 0) {
        return {
            environment: config.environment,
            ...status,
            groupCount,
            groupIds: [],
            companyEntityIds: [],
        };
    }
    if (!uri) throw new Error('CLEAR Business Search returned matches without a result URI.');

    const resultId = resultIdFromUri(uri, 'business');
    const getResponse = await client.get(
        `${BUSINESS_SEARCH_PATH}/${encodeURIComponent(resultId)}`,
        { params: { resultType: 'xml' } },
    );
    const resultXml = String(getResponse.data ?? '');
    assertClearSuccess(resultXml, 'Business Search result retrieval');
    return {
        environment: config.environment,
        ...status,
        groupCount,
        resultId,
        groupIds: [...new Set(extractAll(resultXml, 'GroupId'))],
        companyEntityIds: [...new Set(extractAll(resultXml, 'CompanyEntityId'))],
    };
}
