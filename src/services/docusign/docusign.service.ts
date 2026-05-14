import axios from 'axios';
import dotenv from 'dotenv';
import prisma from '../../config/prismaClient';
import { STATE_DOCUMENT_CONFIG } from './state-document-config';
import { FUNDERNAME_DOCUMENT_CONFIG } from './funderName-document-confitg';
import { PAYOFF_DOCUMENT_CONFIG } from './payoff-document-config';
import { ADDENDUM_DOCUMENT_CONFIG } from './addendum-document-config';
import { EPO_DOCUMENT_CONFIG } from './epo-document-config';
import { ACH_DOCUMENT_CONFIG } from './ach-document-config';
import { Client, Application } from '@prisma/client';

dotenv.config();

class UnauthorizedException extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedException';
    this.status = 401;
  }
}

class BadRequestException extends Error {
  status: number;
  constructor(message: string) {
    super(message);
    this.name = 'BadRequestException';
    this.status = 400;
  }
}

export class DocusignService {
  // Production DocuSign endpoints
  private readonly docusignAuthUrl = 'https://account.boldsign.com';
  private readonly docusignTokenUrl = 'https://account.boldsign.com/oauth/token';
  // Prisma and config accessors adapted for non-NestJS environment
  private prisma = prisma;
  private configService = {
    get<T = string>(key: string): T | undefined {
      return process.env[key] as unknown as T | undefined;
    },
  };

  getAuthUrl(state: string): string {
    const clientId = this.configService.get<string>('BOLDSIGN_CLIENT_ID');
    const redirectUri = this.configService.get<string>('BOLDSIGN_REDIRECT_URI');
    const scopes = 'signature';
    console.log("clientId", clientId);
    console.log("redirectUri", redirectUri);
    console.log("scopes", scopes);
    console.log("state", state);

    return `${this.docusignAuthUrl}/oauth/auth?response_type=code&scope=${scopes}&client_id=${clientId}&state=${state}&redirect_uri=${redirectUri}`;
  }

  async handleCallback(code: string, userId: string) {
    const clientId = this.configService.get<string>('BOLDSIGN_CLIENT_ID');
    const clientSecret = this.configService.get<string>('BOLDSIGN_CLIENT_SECRET');
    const redirectUri = this.configService.get<string>('BOLDSIGN_REDIRECT_URI');

    console.log("docusignTokenUrl", this.docusignTokenUrl);
    console.log("code", code);

    try {
      const params = new URLSearchParams();

      params.append('grant_type', 'authorization_code');
      params.append('code', code);
      params.append('client_id', clientId!);
      params.append('client_secret', clientSecret!);
      params.append('redirect_uri', redirectUri!);

      const response = await axios.post(
        this.docusignTokenUrl,
        params,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );
      // const response = await axios.post(
      //   this.docusignTokenUrl,
      //   {
      //     grant_type: 'authorization_code',
      //     code,
      //     client_id: clientId,
      //     client_secret: clientSecret,
      //     redirect_uri: redirectUri,
      //   },
      //   {
      //     headers: {
      //       'Content-Type': 'application/x-www-form-urlencoded',
      //     },
      //   },
      // );

      console.log("response", response.data);
      if (!response.data || !response.data.access_token) {
        throw new Error('Invalid response from DocuSign: Missing access token');
      }

      const { access_token, refresh_token, expires_in } = response.data;
      console.log("access_token", access_token);
      console.log("refresh_token", refresh_token);
      console.log("expires_in", expires_in);

      if (!access_token) {
        throw new Error('Invalid response from DocuSign: Access token is undefined');
      }

      // Fetch user info from DocuSign
      const userInfoRes = await axios.get(`${this.docusignAuthUrl}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const defaultAccount = userInfoRes.data.accounts.find((acc: any) => acc.is_default);
      if (!defaultAccount) {
        throw new Error('No default DocuSign account found for user');
      }

      const tokenExpiry = expires_in
        ? new Date(Date.now() + expires_in * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          docusignAccessToken: access_token,
          docusignRefreshToken: refresh_token || null,
          docusignTokenExpiry: tokenExpiry,
          docusignAccountId: defaultAccount.account_id,
          docusignBaseUri: defaultAccount.base_uri,
        } as any,
      });

      return { success: true };
    } catch (error: any) {
      throw new UnauthorizedException('Failed to get DocuSign tokens: ' + (error?.message || error));
    }
  }

  private validateAndCleanBase64(base64String: string): string {
    // Remove any data URI prefix if present
    const base64Data = base64String.replace(/^data:application\/pdf;base64,/, '');

    // Check if the string is valid base64
    if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
      throw new BadRequestException('Invalid base64 string format');
    }

    // Check if the decoded length is reasonable for a PDF (at least 100 bytes)
    const decodedLength = Math.ceil((base64Data.length * 3) / 4);
    if (decodedLength < 100) {
      throw new BadRequestException('Document appears to be too small to be a valid PDF');
    }

    return base64Data;
  }

  /**
   * Get PDF page count from base64 string by parsing PDF structure
   * This is a simple parser that looks for /Count in the PDF structure
   */
  private getPdfPageCount(base64String: string): number {
    try {
      const buffer = Buffer.from(base64String, 'base64');
      const pdfText = buffer.toString('binary');

      // Look for /Count pattern in the PDF (common in page tree)
      // This is a simple heuristic - may not work for all PDFs
      const countMatches = pdfText.match(/\/Count\s+(\d+)/g);
      if (countMatches && countMatches.length > 0) {
        // Get the last /Count value (usually the total page count)
        const lastMatch = countMatches[countMatches.length - 1];
        const pageCount = parseInt(lastMatch.match(/\d+/)?.[0] || '0');
        if (pageCount > 0) {
          return pageCount;
        }
      }

      // Fallback: count /Page objects (less reliable)
      const pageMatches = pdfText.match(/\/Type\s*\/Page[^s]/g);
      if (pageMatches) {
        return pageMatches.length;
      }

      // If we can't determine, return 0 (will use calculated max)
      return 0;
    } catch (error) {
      console.warn('Failed to parse PDF page count:', error);
      return 0; // Return 0 to use calculated max instead
    }
  }

  /**
   * Filter tabs to only include those within document page bounds
   */
  private filterTabsByPageCount(tabs: any[], maxPageCount: number): any[] {
    return tabs.filter(tab => {
      const pageNum = parseInt(tab.pageNumber || '1');
      if (pageNum > maxPageCount) {
        console.warn(`Filtering out tab ${tab.tabLabel || 'unknown'} on page ${pageNum} (document has ${maxPageCount} pages)`);
        return false;
      }
      return true;
    });
  }

  async sendEnvelope(userId: string, envelopeId: string) {
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.docusignAccessToken) {
      throw new UnauthorizedException('DocuSign not connected');
    }

    const isTokenExpired = user.docusignTokenExpiry &&
      new Date(user.docusignTokenExpiry).getTime() - 5 * 60 * 1000 < Date.now();

    if (isTokenExpired && user.docusignRefreshToken) {
      try {
        await this.refreshToken(userId);
        const updatedUser: any = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        if (!updatedUser?.docusignAccessToken) {
          throw new Error('Failed to refresh token');
        }
        user.docusignAccessToken = updatedUser.docusignAccessToken;
        user.docusignAccountId = updatedUser.docusignAccountId;
        user.docusignBaseUri = updatedUser.docusignBaseUri;
      } catch (error) {
        throw new UnauthorizedException('DocuSign token expired and refresh failed');
      }
    }

    try {
      if (!envelopeId) {
        throw new BadRequestException('Invalid envelopeId: must be provided');
      }
      if (!user.docusignAccountId || !user.docusignBaseUri) {
        throw new UnauthorizedException('DocuSign account information missing. Please reconnect your DocuSign account.');
      }
      // Ensure /restapi is present in base_uri
      // console.log("user.docusignBaseUri", user.docusignBaseUri, user.docusignAccountId)
      let baseUri = user.docusignBaseUri;
      if (!baseUri.endsWith('/restapi')) {
        baseUri = baseUri.replace(/\/+$/, '') + '/restapi';
      }
      // Update the envelope status to "sent"
      const response = await axios.put(
        `${baseUri}/v2.1/accounts/${user.docusignAccountId}/envelopes/${envelopeId}`,
        {
          status: 'sent'
        },
        {
          headers: {
            Authorization: `Bearer ${user.docusignAccessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error?.response) {
        if (error.response.status === 401) {
          throw new UnauthorizedException('DocuSign authentication failed. Please reconnect your DocuSign account.');
        }

        if (error.response.status === 400) {
          throw new BadRequestException(`DocuSign validation error: ${JSON.stringify(error.response.data)}`);
        }
      }

      throw new BadRequestException('Failed to send envelope: ' + (error?.message || error));
    }
  }

  async refreshToken(userId: string) {
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.docusignRefreshToken) {
      throw new UnauthorizedException('No refresh token available');
    }

    try {
      const response = await axios.post(
        this.docusignTokenUrl,
        {
          grant_type: 'refresh_token',
          refresh_token: user.docusignRefreshToken,
          client_id: this.configService.get('DOCUSIGN_CLIENT_ID'),
          client_secret: this.configService.get('DOCUSIGN_CLIENT_SECRET'),
        },
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        },
      );

      const { access_token, refresh_token, expires_in } = response.data;

      await this.prisma.user.update({
        where: { id: userId },
        data: {
          docusignAccessToken: access_token,
          docusignRefreshToken: refresh_token,
          docusignTokenExpiry: new Date(Date.now() + expires_in * 1000),
        } as any,
      });

      return { success: true };
    } catch (error: any) {
      throw new UnauthorizedException('Failed to refresh DocuSign token: ' + (error?.message || error));
    }
  }

  async createDraftEnvelope(
    userId: string,
    documentBase64: string,
    recipientEmail: string,
    state: string,
    application: any,
    termsOffer: any,
    ccEmails: string[] = [],
    isResend: boolean = false
  ) {
    // Validate required parameters
    if (!application) {
      throw new BadRequestException('Application is required');
    }
    console.log("application", application);

    // Fix 8: Prevent crash if termsOffer missing
    if (!termsOffer) {
      throw new BadRequestException("Terms offer not found");
    }
    console.log("termsOffer", termsOffer);

    const clientFromApp = application?.client;
    const stateForDoc =
      (typeof state === "string" && state.trim()) ||
      clientFromApp?.businessState ||
      clientFromApp?.ownerState ||
      "";

    const embeddedBusinessInfo = Array.isArray(application?.businessInfo)
      ? application.businessInfo[0]
      : application?.businessInfo;

    const funderNameFromApp =
      (termsOffer?.position && String(termsOffer.position).trim()) ||
      (application?.OfferDecision?.position &&
        String(application.OfferDecision.position).trim()) ||
      "";

    const businessInfo =
      embeddedBusinessInfo ||
      ({
        funderName: funderNameFromApp,
        frequency:
          termsOffer.frequency || application?.OfferDecision?.frequency || "",
        state: stateForDoc,
        payoff: "",
        epo: false,
        ach: false,
        addendum: false,
        addendums: [],
        epos: [],
        achs: [],
        client: clientFromApp ? [clientFromApp] : [],
      } as any);

    if (!businessInfo.funderName) {
      throw new BadRequestException(
        "funderName is required (set termsOffer.position or OfferDecision.position)"
      );
    }
    console.log("businessInfo.funderName", businessInfo.funderName);

    // Fix 5: Fix frequency fallback
    if (!termsOffer.frequency && businessInfo?.frequency) {
      termsOffer.frequency = businessInfo.frequency;
    }
    console.log("termsOffer.frequency", termsOffer.frequency);
    if (!termsOffer.frequency) {
      throw new BadRequestException('termsOffer.frequency is required (can be in termsOffer or businessInfo.frequency)');
    }

    // Fix 6: Prevent missing recipient email error
    if (!recipientEmail) {
      throw new BadRequestException("Recipient email is required");
    }
    console.log("isResend", isResend);
    // Get user first to access userId (numeric)
    const user: any = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user?.docusignAccessToken) {
      throw new UnauthorizedException('DocuSign not connected');
    }

    if (isResend) {
      // Expire old envelopes related to this application
      await (this.prisma as any).document.updateMany({
        where: { applicationId: application.id },
        data: { status: 'expired' },
      });

      // Remove old envelope reference from DB 
      await (this.prisma as any).document.deleteMany({
        where: { applicationId: application.id },
      });

      console.log('Old envelopes removed. Creating a fresh new one...');
    }

    const existingDoc: any = await (this.prisma as any).document.findFirst({
      where: { applicationId: application.id, status: 'created' },
    });
    console.log("existingDoc", existingDoc);
    if (existingDoc && !isResend) {
      throw new BadRequestException('Envelope already created. Use resend to generate a new one.');
    }
    console.log("termsOffer.frequency", termsOffer.frequency);
    // Fix 5: Fix frequency fallback
    const freq = (termsOffer.frequency?.toLowerCase() || businessInfo.frequency?.toLowerCase()) || '';
    const STATE_PAGE_COUNTS: Record<string, number> = {
      "dailyCalifornia": 2,
      "weeklyCalifornia": 2,
      "dailyFlorida": 1,
      "weeklyFlorida": 1,
      "dailyGeorgia": 1,
      "weeklyGeorgia": 1,
      "dailyKansas": 1,
      "weeklyKansas": 1,
      "dailyUtah": 1,
      "weeklyUtah": 1,
      "dailyVirginia": 2,
      "weeklyVirginia": 2,
      "dailyConnecticut": 2,
      "weeklyConnecticut": 2,
      "dailyNewYork": 2,
      "weeklyNewYork": 2,
    };
    const FUNDER_PAGE_COUNTS: Record<string, number> = {
      "DAILYCOREFUNDING": 24,
      "WEEKLYCOREFUNDING": 21,
      // "DAILYBARCLAYS":18,
    };
    const PAYOFF_PAGE_COUNTS: Record<string, number> = {
      "Payoff1": 1,
      "Payoff2": 1,
      "Payoff3": 1
    };
    console.log("STATE_PAGE_COUNTS", STATE_PAGE_COUNTS);
    console.log("user", user);
    const isTokenExpired = user.docusignTokenExpiry &&
      new Date(user?.docusignTokenExpiry).getTime() - 5 * 60 * 1000 < Date.now();
    console.log("isTokenExpired", isTokenExpired);
    if (isTokenExpired && user.docusignRefreshToken) {
      try {
        await this.refreshToken(userId);
        const updatedUser: any = await this.prisma.user.findUnique({
          where: { id: userId },
        });
        if (!updatedUser?.docusignAccessToken) {
          throw new Error('Failed to refresh token');
        }
        user.docusignAccessToken = updatedUser.docusignAccessToken;
        user.docusignAccountId = updatedUser.docusignAccountId;
        user.docusignBaseUri = updatedUser.docusignBaseUri;
      } catch (error) {
        throw new UnauthorizedException('DocuSign token expired and refresh failed');
      }
    }
    console.log("user", user);

    let client: Client | null = null;
    const clientId = application?.clientId;
    if (clientId) {
      client = await this.prisma.client.findUnique({ where: { id: clientId } });
    }

    try {
      if (!documentBase64 || typeof documentBase64 !== 'string') {
        throw new BadRequestException('Invalid documentBase64: must be a non-empty string');
      }
      if (!user.docusignAccountId || !user.docusignBaseUri) {
        throw new UnauthorizedException('DocuSign account information missing. Please reconnect your DocuSign account.');
      }
      let baseUri = user.docusignBaseUri;
      if (!baseUri.endsWith('/restapi')) {
        baseUri = baseUri.replace(/\/+$/, '') + '/restapi';
      }
      const cleanedBase64 = this.validateAndCleanBase64(documentBase64);

      if (!recipientEmail || !recipientEmail.includes('@')) {
        throw new BadRequestException('Invalid recipientEmail: must be a valid email address');
      }

      const mergeFreqWithState = freq + state;
      // Fix 3: Safe merge key - normalize funder name to match config keys
      // Normalize funder name: remove spaces, special chars, convert to uppercase
      const normalizedFunderName = businessInfo.funderName
        ?.replace(/\s+/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase() || '';

      const mergeFreqWithFunderName = (termsOffer.frequency)?.toUpperCase() + normalizedFunderName;
      const stateKey = mergeFreqWithState.replace(/\s/g, '');
      const funderKey = mergeFreqWithFunderName?.replace(/\s/g, '') || '';

      // Fix 4: Safe payoff check
      const payoffKey = businessInfo.payoff !== "" ? businessInfo.payoff.replace(/\s/g, '') : "";
      const epoKey = businessInfo?.epo ? 'epo' : '';
      const achKey = businessInfo?.ach ? `${freq}Ach` : '';

      // Check if state has disclosure document (exists in STATE_PAGE_COUNTS)
      const hasStateDisclosure = stateKey in STATE_PAGE_COUNTS;
      const statePageCount = hasStateDisclosure ? (STATE_PAGE_COUNTS[stateKey] || 0) : 0;

      // Try to find funder config - first exact match, then fallback to COREFUNDING if funder name contains "fund", "core", or "funding"
      let funderConfig = FUNDERNAME_DOCUMENT_CONFIG[funderKey];
      let effectiveFunderKey = funderKey;

      // Fallback: if exact match not found, try to match based on funder name content
      if (!funderConfig) {
        const funderNameUpper = normalizedFunderName;
        const funderNameOriginal = businessInfo.funderName?.toUpperCase() || '';
        // Check if funder name contains "fund", "core", or "funding" (case insensitive)
        if (funderNameUpper.includes('FUND') || funderNameUpper.includes('CORE') ||
          funderNameOriginal.includes('FUND') || funderNameOriginal.includes('CORE')) {
          const fallbackKey = `${freq.toUpperCase()}COREFUNDING`;
          funderConfig = FUNDERNAME_DOCUMENT_CONFIG[fallbackKey];
          if (funderConfig) {
            effectiveFunderKey = fallbackKey;
            console.log(`Using fallback funder config: ${fallbackKey} for funder: ${businessInfo.funderName}`);
          }
        }
      }

      // Use effectiveFunderKey for page count (fallback to original if not found)
      const funderPageCount = FUNDER_PAGE_COUNTS[effectiveFunderKey] || FUNDER_PAGE_COUNTS[funderKey] || 1;
      const payoffPageCount = PAYOFF_PAGE_COUNTS[payoffKey]
      const epoPageCount = epoKey ? 1 : 0;

      const addendums = businessInfo?.addendums || [];
      const epos = businessInfo?.epos || [];
      const achs = businessInfo?.achs || [];
      const hasEpo = businessInfo?.epo;
      const hasAch = businessInfo?.ach;

      const hasAddendums = businessInfo?.addendum;
      const addendumKey = hasAddendums ? 'guarantorAddendum' : '';
      const effectiveAddendumConfig = addendumKey ? ADDENDUM_DOCUMENT_CONFIG[addendumKey] : null;
      const effectiveEpoConfig = hasEpo ? EPO_DOCUMENT_CONFIG['epo'] : null;
      const effectiveAchConfig = hasAch ? ACH_DOCUMENT_CONFIG[achKey] : null;

      // Only get stateConfig if state has disclosure document
      const stateConfig = hasStateDisclosure ? STATE_DOCUMENT_CONFIG[stateKey] : null;

      const payoffConfig = PAYOFF_DOCUMENT_CONFIG[payoffKey];
      const addendumConfig = ADDENDUM_DOCUMENT_CONFIG[addendumKey];
      const epoConfig = EPO_DOCUMENT_CONFIG[epoKey];
      const achConfig = ACH_DOCUMENT_CONFIG[achKey];

      // Log for debugging
      console.log("funderKey:", funderKey);
      console.log("effectiveFunderKey:", effectiveFunderKey);
      console.log("normalizedFunderName:", normalizedFunderName);
      console.log("funderConfig:", funderConfig ? "found" : "not found");


      let currentPage = 1;
      // Only set stateStartPage if state has disclosure document
      const stateStartPage = hasStateDisclosure ? currentPage : 0;
      if (hasStateDisclosure) {
        currentPage += statePageCount;
      }
      let addendumPageCount = 0;

      const funderStartPage = currentPage;
      currentPage += funderPageCount;

      const payoffStartPage = payoffKey !== "" ? currentPage : 0;
      if (payoffKey !== "") currentPage += payoffPageCount;

      const addendumStartPage = hasAddendums ? currentPage : null;
      if (hasAddendums) currentPage += addendums.length;

      const epoStartPage = hasEpo ? currentPage : null;
      if (hasEpo) currentPage += epos.length;

      const achStartPage = hasAch ? currentPage : null;
      if (hasAch) currentPage += achs.length;

      // Get actual PDF page count and calculate max page count
      const actualPdfPageCount = this.getPdfPageCount(cleanedBase64);
      console.log("Actual PDF page count:", actualPdfPageCount);

      // Calculate expected maximum page count from structure
      // currentPage is already incremented beyond last page, so subtract 1
      const expectedMaxPage = currentPage - 1;
      const maxPageCount = actualPdfPageCount > 0 ? actualPdfPageCount : expectedMaxPage;
      console.log("Using max page count:", maxPageCount, "(actual:", actualPdfPageCount, "expected:", expectedMaxPage, ")");

      // Only require stateConfig if state should have disclosure document
      if (hasStateDisclosure && !stateConfig) {
        throw new BadRequestException(`State configuration missing for state: ${stateKey}`);
      }
      if (!funderConfig) {
        console.log("---------------funder config-----------", funderConfig);
        console.log("funderKey searched:", funderKey);
        console.log("available funder keys:", Object.keys(FUNDERNAME_DOCUMENT_CONFIG));
        console.log("businessInfo.funderName:", businessInfo.funderName);
        console.log("normalizedFunderName:", normalizedFunderName);
        throw new BadRequestException(`Unsupported funderName: "${businessInfo.funderName}". Available funders: ${Object.keys(FUNDERNAME_DOCUMENT_CONFIG).join(', ')}`);
      }

      if (businessInfo.payoff && !payoffConfig) {
        throw new BadRequestException('Unsupported payoff');
      }

      const fundingInfoRaw = application?.FundingInfo;
      const fundingInfo =
        fundingInfoRaw && !Array.isArray(fundingInfoRaw)
          ? fundingInfoRaw
          : Array.isArray(fundingInfoRaw) && fundingInfoRaw.length > 0
            ? fundingInfoRaw[0]
            : {};

      // Calculate finalCalculations from termsOffer and fundingInfo
      const finalCalculations = {
        amountFinanced: termsOffer?.approvedAmount?.toString() || '',
        financeCharge: termsOffer?.paybackAmount && termsOffer?.approvedAmount
          ? (termsOffer.paybackAmount - termsOffer.approvedAmount).toString()
          : '',
        recipientFunds: termsOffer?.approvedAmount?.toString() || '',
        estimatedTotalPaymentAmount: termsOffer?.paybackAmount?.toString() || '',
        estimatedMonthlyCost: termsOffer?.paymentAmount?.toString() || '',
        estimatedPayment: termsOffer?.paymentAmount?.toString() || '',
        estimatedTerm: termsOffer?.termLength?.toString() || '',
        estimatedAnnualPercentageRate: termsOffer?.buyRate ? (termsOffer.buyRate * 100).toString() : '',
        specifiedPercentage: termsOffer?.percentOfGross ? (termsOffer.percentOfGross * 100).toString() : '',
        paymentTerms: termsOffer?.factorRate ? (termsOffer.factorRate * 100).toString() : '',
      };

      // Helper to format numbers with US formatting (commas for thousands separator)
      function formatNumberUS(value: string | number, minDecimals: number = 2, maxDecimals: number = 20): string {
        if (!value || value.toString().trim() === '') return '';

        // Remove existing commas if present
        let cleanValue = value.toString().replace(/,/g, '');

        // Parse as number
        const num = parseFloat(cleanValue);

        // If not a valid number, return empty string
        if (isNaN(num)) {
          return '';
        }

        // Format with US locale (commas for thousands separator)
        return num.toLocaleString('en-US', {
          minimumFractionDigits: minDecimals,
          maximumFractionDigits: maxDecimals
        });
      }

      // Helper to format monetary values with US formatting (commas) and add $ prefix
      function withDollar(value: string): string {
        if (!value || value.trim() === '') return value || '';

        const formatted = formatNumberUS(value);

        // If formatting failed, return original value with $ prefix
        if (!formatted) {
          return value.startsWith('$') ? value : `$${value}`;
        }

        return `$${formatted}`;
      }

      // Helper to format percentage values with US formatting (without % sign)
      function formatPercentage(value: string): string {
        if (!value || value.toString().trim() === '') return '';
        const formatted = formatNumberUS(value);
        return formatted || '';
      }

      // Helper to convert full state name to abbreviation
      // Only includes states that are available in this platform
      function getStateAbbreviation(stateName: string): string {
        if (!stateName) return '';

        const stateNameUpper = stateName.toUpperCase().trim();

        // Full state name to abbreviation mapping - only for states available in the platform
        const stateMap: Record<string, string> = {
          'CALIFORNIA': 'CA',
          'FLORIDA': 'FL',
          'GEORGIA': 'GA',
          'KANSAS': 'KS',
          'CONNECTICUT': 'CT',
          'NEW YORK': 'NY',
          'UTAH': 'UT',
          'VIRGINIA': 'VA'
        };

        // If it's already an abbreviation (2 chars), return it uppercase
        if (stateNameUpper.length === 2) {
          return stateNameUpper;
        }

        // Convert full name to abbreviation (only for platform states)
        return stateMap[stateNameUpper] || stateNameUpper;
      }

      function formatEinNumber(ein: string): string {
        // Remove any non-digit characters
        const cleanedEin = ein.replace(/\D/g, '');

        // Format as XX-XXXXXXX if it has 9 digits
        if (cleanedEin.length === 9) {
          return cleanedEin.replace(/^(\d{2})(\d{7})$/, '$1-$2');
        }

        // Return the raw number if it's not exactly 9 digits
        return ein;
      }

      function formatSsnNumber(ssn: string): string {
        // Remove any non-digit characters
        const cleanedSsn = ssn.replace(/\D/g, '');

        // Format as XXX-XX-XXXX if it has 9 digits
        if (cleanedSsn.length === 9) {
          return cleanedSsn.replace(/^(\d{3})(\d{2})(\d{4})$/, '$1-$2-$3');
        }

        // Return the raw number if it's not exactly 9 digits
        return ssn;
      }


      const TotalBrokerFee = parseFloat(fundingInfo.brokerFeePaidByClient || '0') + parseFloat(fundingInfo.brokerFeePaidByFunder || '0');
      const feesDeducted =
        parseFloat(fundingInfo.originationFee || '0') +
        parseFloat(fundingInfo.brokerFeePaidByClient || '0') +
        parseFloat(fundingInfo.amountPaidToPriorMcaFundingReFi || '0') +
        parseFloat(fundingInfo.thirdPartyPayment || '0');

      // Calculate average monthly revenue from client
      const averageMonthlyRevenue = client?.businessMonthlyRevenue
        ? client.businessMonthlyRevenue.toFixed(2)
        : '0';

      // Calculate payment dates from termsOffer
      const now = new Date();
      const currentMonth = now.getMonth() + 1;
      const currentYear = now.getFullYear();
      // Use offerExpiryDate or calculate from current date
      const paymentDate = termsOffer?.offerExpiryDate ? new Date(termsOffer.offerExpiryDate) : now;
      const paymentMonth = paymentDate.getMonth() + 1;
      const paymentDay = paymentDate.getDate();
      const paymentYear = paymentMonth < currentMonth ? currentYear + 1 : currentYear;

      function formatDate(date: Date | string | null | undefined) {
        if (!date) return '';
        const dateObj = date instanceof Date ? date : new Date(date);
        // Check if date is valid
        if (isNaN(dateObj.getTime())) return '';
        return dateObj.toLocaleDateString("en-US");
      }


      const NetFundProvided = (parseFloat(fundingInfo.revenuePurchased || '0') - feesDeducted).toFixed(2);

      // Get client from businessInfo relation or application.client
      const businessInfoClients = Array.isArray(businessInfo?.client) ? businessInfo.client : [];
      const primaryClient = businessInfoClients[0] || client;

      const tabValueMap: Record<string, string> = {
        amountFinanced: withDollar(finalCalculations.amountFinanced || ''),
        financeCharge: withDollar(finalCalculations.financeCharge || ''),
        recipientFunds: withDollar(finalCalculations.recipientFunds || ''),
        purchasePrice: withDollar(fundingInfo.purchasePrice || ''),
        revenuePurchased: withDollar(fundingInfo.revenuePurchased || ''),
        NetFundProvided: withDollar(NetFundProvided) || '',
        brokerFeePaidByClient: withDollar(fundingInfo.brokerFeePaidByClient || ''),
        brokerFeePaidByFunder: withDollar(fundingInfo.brokerFeePaidByFunder || ''),
        totalBrokerFee: withDollar(TotalBrokerFee.toString() || ''),
        feesDeducted: withDollar(feesDeducted.toString() || ''),
        frequency: (businessInfo.frequency)?.toUpperCase() || '',
        state: getStateAbbreviation(businessInfo.state || ''),
        clientstate: getStateAbbreviation(primaryClient?.businessState || ''),
        city: (primaryClient?.businessCity)?.toUpperCase() || '',
        zip: (primaryClient?.businessZipCode) || '',

        estimatedDailyPayment: withDollar(
          termsOffer?.numberOfPayments && termsOffer.numberOfPayments > 0
            ? (parseFloat(fundingInfo.revenuePurchased || '0') / termsOffer.numberOfPayments).toFixed(2)
            : ''
        ),
        estimatedWeeklyPayment: withDollar(
          termsOffer?.numberOfPayments && termsOffer.numberOfPayments > 0
            ? (parseFloat(fundingInfo.revenuePurchased || '0') / termsOffer.numberOfPayments).toFixed(2)
            : ''
        ),

        contactstate: getStateAbbreviation(primaryClient?.ownerState || primaryClient?.businessState || ''),
        contactcity: (primaryClient?.ownerCity || primaryClient?.businessCity)?.toUpperCase() || '',
        contactzip: (primaryClient?.ownerZipCode || primaryClient?.businessZipCode) || '',
        funderName: (businessInfo.funderName)?.toUpperCase() || '',
        estimatedTotalPaymentAmount: withDollar(finalCalculations.estimatedTotalPaymentAmount || ''),
        estimatedMonthlyCost: withDollar(finalCalculations.estimatedMonthlyCost || ''),
        estimatedPayment: withDollar(finalCalculations.estimatedPayment || ''),

        estimatedTerm: ` ${(String(businessInfo.frequency || '').toLowerCase() === 'daily' ? `${(parseFloat(finalCalculations.estimatedTerm) * 5) || ''} Days` :
          `${finalCalculations.estimatedTerm || ''} Weeks`)?.toUpperCase() || ''}`,
        estimatedAnnualPercentageRate: formatPercentage(finalCalculations.estimatedAnnualPercentageRate || ''),
        specifiedPercentage: formatPercentage(finalCalculations.specifiedPercentage || ''),
        clientName1: (primaryClient?.ownerFirstName)?.toUpperCase() || '',
        clientBusinessName1: (primaryClient?.businessName)?.toUpperCase() || '',
        clientBusinessAddress1: (primaryClient?.businessAddress1)?.toUpperCase() || '',
        clientContactAddress1: (primaryClient?.businessAddress2)?.toUpperCase() || '',
        driverLicenceNumber1: primaryClient?.ownerSsn || '',

        clientName2: (businessInfoClients[1]?.ownerFirstName || '').toUpperCase(),
        clientBusinessName2: (businessInfoClients[1]?.businessName || '').toUpperCase(),
        clientBusinessAddress2: (businessInfoClients[1]?.businessAddress1 || '').toUpperCase(),
        clientContactAddress2: (businessInfoClients[1]?.businessAddress2 || '').toUpperCase(),
        driverLicenceNumber2: businessInfoClients[1]?.ownerSsn || '',

        // Use client directly from Client model
        clientBusinessEmail1: (primaryClient?.businessEmail || ''),
        clientBusinessEmail2: (businessInfoClients[1]?.businessEmail || ''),

        // Bank details from BankDetail relation on Application (if included)
        clientBankName1: '',
        clientAccountHolderName1: '',
        clientAccountNumber1: '',
        clientRoutingNumber1: '',

        clientBankName2: '',
        clientAccountHolderName2: '',
        clientAccountNumber2: '',
        clientRoutingNumber2: '',

        einNumber1: formatEinNumber(primaryClient?.businessEinNumber || ''),
        ssnNumber1: formatSsnNumber(primaryClient?.ownerSsn || ''),
        typeOfEntity1: (primaryClient?.businessEntityType || ''),
        dba1: '',

        einNumber2: formatEinNumber(businessInfoClients[1]?.businessEinNumber || ''),
        ssnNumber2: formatSsnNumber(businessInfoClients[1]?.ownerSsn || ''),
        typeOfEntity2: (businessInfoClients[1]?.businessEntityType || ''),
        dba2: '',

        paymentTerms: formatPercentage(finalCalculations.paymentTerms || ''),
        //  averageMonthlyRevenue: withDollar(application.paymentDays.merchantMonthlyRevenue),
        averageMonthlyRevenue: withDollar(averageMonthlyRevenue),
        firstPaymentDate: paymentDay != null && paymentMonth != null && paymentYear != null
          ? `${String(paymentDay).padStart(2, '0')}/${String(paymentMonth).padStart(2, '0')}/${paymentYear}`
          : '',

        payoff: (businessInfo.payoff)?.toUpperCase() || '',
        addendum: businessInfo.addendum || false,
        epo: businessInfo.epo || false,
        ach: businessInfo.ach || false,
        increasedPercentage: formatPercentage((parseFloat(finalCalculations.paymentTerms || '0') * 2).toString()),
        originationFee: withDollar(fundingInfo.originationFee || ''),
        paidToPriorMca: withDollar(fundingInfo.amountPaidToPriorMcaFundingReFi || '0'),
        paidToThirdParty: withDollar(fundingInfo.thirdPartyPayment || '0'),
      };

      const addendumTabValuesList = addendums.map((addendum: any) => {
        return {
          clientBusinessName1: (addendum?.legalName1 || '').toUpperCase(),

          clientBusinessAddress1: (primaryClient?.businessAddress1)?.toUpperCase() || '',

          clientContactAddress1: (primaryClient?.businessAddress2 || '').toUpperCase(),

          clientBusinessEmail1: addendum?.businessEmail1 || primaryClient?.businessEmail || '',

          // Bank details would come from BankDetail relation if needed
          clientBankName1: '',
          clientAccountHolderName1: '',
          clientAccountNumber1: '',
          clientRoutingNumber1: '',

          state1: getStateAbbreviation(primaryClient?.businessState || ''),
          city1: (primaryClient?.businessCity)?.toUpperCase() || '',
          zip1: (primaryClient?.businessZipCode) || '',
          einNumber1: formatEinNumber(addendum?.ein1 || primaryClient?.businessEinNumber || ''),
          ssnNumber1: formatSsnNumber(primaryClient?.ownerSsn || ''),
          dba1: addendum?.dba1 || '',
          typeOfEntity1: addendum?.typeOfEntity1 || primaryClient?.businessEntityType || '',

        };
      });

      const achTabValuesList = achs.map((ach: any) => {
        return {
          clientBankName: ach?.bankName || '',
          clientAccountHolderName: ach?.accountHolderName || '',
          clientAccountNumber: ach?.accountNumber || '',
          clientRoutingNumber: ach?.routingNumber || '',
          paymentAmount: withDollar(ach?.paymentAmount || ''),
          frequency: (ach?.frequency || '').toUpperCase(),
          purchasePrice: withDollar(fundingInfo.purchasePrice || ''),
          clientBusinessName: (primaryClient?.ownerFirstName)?.toUpperCase() || '',
        };
      });
      const epoTabValuesList = epos.map((epo: any) => {
        return {
          clientBusinessName1: (primaryClient?.businessName)?.toUpperCase() || '',
          clientName1: (primaryClient?.ownerFirstName)?.toUpperCase() || '',
          clientBusinessName2: (businessInfoClients[1]?.businessName || '').toUpperCase(),
          earlyPayoffAmount1: withDollar(epo.amountReceived1 || "0"),
          earlyPayoffAmount2: withDollar(epo.amountReceived2 || "0"),
          earlyPayoffAmount3: withDollar(epo.amountReceived3 || "0"),

          earlyPayoffDate1: formatDate(epo.receivedDate1),
          earlyPayoffDate2: formatDate(epo.receivedDate2),
          earlyPayoffDate3: formatDate(epo.receivedDate3),
          purchasePrice: withDollar(fundingInfo.purchasePrice || ''),
        };
      });

      const funderTextTabs = (funderConfig?.textTabs || []).map((tab: any) => {
        const calculatedPage = tab.pageNumber ? (parseInt(tab.pageNumber) + (funderStartPage - 1)) : funderStartPage;
        return {
          tabLabel: tab.tabLabel,
          value: tabValueMap[tab.tabLabel] || '',
          documentId: funderConfig.documentId,
          pageNumber: calculatedPage.toString(),
          xPosition: tab.x,
          yPosition: tab.y,
          fontSize: 'Size7',
          bold: "true"
        };
      }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount);

      const payoffTextTabs = (payoffConfig?.textTabs || []).map(tab => {
        const calculatedPage = tab.pageNumber ? (parseInt(tab.pageNumber) + payoffStartPage - 1) : payoffStartPage;
        return {
          tabLabel: tab.tabLabel,
          value: tabValueMap[tab.tabLabel] || '',
          documentId: payoffConfig.documentId,
          pageNumber: calculatedPage.toString(),
          xPosition: tab.x,
          yPosition: tab.y,
          fontSize: 'Size7',
          bold: "true"
        };
      }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount);

      const addendumTextTabs = hasAddendums
        ? addendums.flatMap((addendum: any, index: number) => {
          const tabValues = addendumTabValuesList[index];
          return (addendumConfig?.textTabs || []).map(tab => ({
            tabLabel: `${tab.tabLabel}_${index + 1}`,
            value: tabValues[tab.tabLabel] || '',
            documentId: addendumConfig.documentId,
            pageNumber: (addendumStartPage! + index).toString(),
            xPosition: tab.x,
            yPosition: tab.y,
            fontSize: 'Size7',
            bold: "true"
          }));
        })
        : [];

      const epoTextTabs = hasEpo
        ? epos.flatMap((epo: any, index: number) => {
          const tabValues = epoTabValuesList[index];
          return (epoConfig?.textTabs || []).map(tab => ({
            tabLabel: `${tab.tabLabel}_${index + 1}`,
            value: tabValues[tab.tabLabel] || '',
            documentId: epoConfig.documentId,
            pageNumber: (epoStartPage! + index).toString(),
            xPosition: tab.x,
            yPosition: tab.y,
            fontSize: 'Size7',
            bold: "true"
          }));
        })
        : [];
      const achTextTabs = hasAch
        ? achs.flatMap((ach: any, index: number) => {
          const tabValues = achTabValuesList[index];
          return (achConfig?.textTabs || []).map(tab => ({
            tabLabel: `${tab.tabLabel}_${index + 1}`,
            value: tabValues[tab.tabLabel] || '',
            documentId: achConfig.documentId,
            pageNumber: (achStartPage! + index).toString(),
            xPosition: tab.x,
            yPosition: tab.y,
            fontSize: 'Size7',
            bold: "true"
          }));
        })
        : [];


      const textTabs = [
        ...(stateConfig?.textTabs || []).map(tab => {
          const pageNum = parseInt(tab.pageNumber || stateConfig!.pageNumber || '1');
          return {
            tabLabel: tab.tabLabel,
            value: tabValueMap[tab.tabLabel] || '',
            documentId: stateConfig!.documentId,
            pageNumber: pageNum.toString(),
            xPosition: tab.x,
            yPosition: tab.y,
            fontSize: 'Size7',
            bold: "true"
          };
        }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
        ...funderTextTabs,
        ...payoffTextTabs,
        ...addendumTextTabs.filter((tab: any) => parseInt(tab.pageNumber) <= maxPageCount),
        ...epoTextTabs.filter((tab: any) => parseInt(tab.pageNumber) <= maxPageCount),
        ...achTextTabs.filter((tab: any) => parseInt(tab.pageNumber) <= maxPageCount),
      ];

      const ccRecipients = (ccEmails || []).map((email, index) => {
        return ({
          email,
          name: email.split('@')[0],
          recipientId: `${index + 2}`,
          routingOrder: '1',
        })
      });

      // console.log("----------ccRecipients-------", ccRecipients)

      let currentAddendumPage = addendumStartPage!;

      const mapTabsForDuplicates = (items: any[], config: any, startPage: number, tabKey: string) => {
        if (!items || items.length === 0 || !config?.[tabKey]) return [];
        return items.flatMap((item, index) =>
          config[tabKey].map((tab: any) => ({
            documentId: config.documentId,
            pageNumber: (startPage + index).toString(),
            xPosition: tab.x,
            yPosition: tab.y,
          }))
        );
      };

      const envelopeDefinition = {
        emailSubject: 'Please sign this document',
        documents: [
          {
            documentBase64: cleanedBase64,
            name: 'Document',
            fileExtension: 'pdf',
            documentId: stateConfig?.documentId || funderConfig.documentId,
          },
        ],


        recipients: {
          signers: [
            {
              // Fix 7: Ensure client email fallback
              email: recipientEmail || client?.businessEmail || '',
              name: (recipientEmail || client?.businessEmail || '').split('@')[0],
              recipientId: '1',
              routingOrder: '1',

              tabs: {
                signHereTabs: [
                  ...(stateConfig?.signHere || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (stateStartPage - 1))
                      : stateStartPage;
                    return {
                      documentId: stateConfig!.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...(funderConfig.signHere || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (funderStartPage - 1))
                      : funderStartPage;
                    return {
                      documentId: funderConfig.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...(payoffConfig?.signHere || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (payoffStartPage - 1))
                      : payoffStartPage;
                    return {
                      documentId: payoffConfig.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),

                  ...mapTabsForDuplicates(addendums, effectiveAddendumConfig, addendumStartPage!, 'signHere')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...mapTabsForDuplicates(epos, effectiveEpoConfig, epoStartPage!, 'signHere')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...mapTabsForDuplicates(achs, effectiveAchConfig, achStartPage!, 'signHere')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                ],

                dateSignedTabs: [
                  ...(stateConfig?.dateTabs || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (stateStartPage - 1))
                      : stateStartPage;
                    return {
                      documentId: stateConfig!.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...(funderConfig.dateTabs || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (funderStartPage - 1))
                      : funderStartPage;
                    return {
                      documentId: funderConfig.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...(payoffConfig?.dateTabs || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (payoffStartPage - 1))
                      : payoffStartPage;
                    return {
                      documentId: payoffConfig.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),

                  ...mapTabsForDuplicates(addendums, effectiveAddendumConfig, addendumStartPage!, 'dateTabs')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...mapTabsForDuplicates(epos, effectiveEpoConfig, epoStartPage!, 'dateTabs')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...mapTabsForDuplicates(achs, effectiveAchConfig, achStartPage!, 'dateTabs')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                ],

                initialHereTabs: [
                  ...(stateConfig?.initialHereTabs || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (stateStartPage - 1))
                      : stateStartPage;
                    return {
                      documentId: stateConfig!.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...(funderConfig.initialHereTabs || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (funderStartPage - 1))
                      : funderStartPage;
                    return {
                      documentId: funderConfig.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...(payoffConfig?.initialHereTabs || []).map(tab => {
                    const pageNum = tab.pageNumber
                      ? (parseInt(tab.pageNumber) + (payoffStartPage - 1))
                      : payoffStartPage;
                    return {
                      documentId: payoffConfig.documentId,
                      pageNumber: pageNum.toString(),
                      xPosition: tab.x,
                      yPosition: tab.y,
                    };
                  }).filter(tab => parseInt(tab.pageNumber) <= maxPageCount),

                  ...mapTabsForDuplicates(addendums, effectiveAddendumConfig, addendumStartPage!, 'initialHereTabs')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...mapTabsForDuplicates(epos, effectiveEpoConfig, epoStartPage!, 'initialHereTabs')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                  ...mapTabsForDuplicates(achs, effectiveAchConfig, achStartPage!, 'initialHereTabs')
                    .filter(tab => parseInt(tab.pageNumber) <= maxPageCount),
                ],

                textTabs,
              },
            },
          ],
          carbonCopies: ccRecipients,
        },
        status: 'created', // This creates a draft envelope
        eventNotification: {
          url: 'https://www.management.fusiontecz.com/mca/docusign/webhook',
          loggingEnabled: true,
          requireAcknowledgment: true,
          useSoapInterface: false,
          includeCertificateWithSoap: false,
          signMessageWithX509Cert: false,
          includeDocuments: false,
          includeEnvelopeVoidReason: true,
          includeTimeZone: true,
          envelopeEvents: [
            { envelopeEventStatusCode: 'sent' },
            { envelopeEventStatusCode: 'delivered' },
            { envelopeEventStatusCode: 'completed' },
            { envelopeEventStatusCode: 'declined' },
            { envelopeEventStatusCode: 'voided' },
          ],
        },
        customFields: {
          textCustomFields: [
            { name: 'amountFinanced', value: withDollar(finalCalculations.amountFinanced || '') },
            { name: 'financeCharge', value: withDollar(finalCalculations.financeCharge || '') },
            { name: 'estimatedTotalPaymentAmount', value: withDollar(finalCalculations.estimatedTotalPaymentAmount || '') },
            { name: 'estimatedMonthlyCost', value: withDollar(finalCalculations.estimatedMonthlyCost || '') },
            { name: 'estimatedPayment', value: withDollar(finalCalculations.estimatedPayment || '') },
            {
              name: 'estimatedTerm', value: ` ${(String(businessInfo.frequency || '').toLowerCase() === 'daily' ? `${finalCalculations.estimatedTerm * 5 || ''} Days` :
                `${finalCalculations.estimatedTerm || ''} Weeks`)?.toUpperCase() || ''}`
            },
            { name: 'estimatedAnnualPercentageRate', value: formatPercentage(finalCalculations.estimatedAnnualPercentageRate || '') },
            { name: 'clientBusinessName', value: client?.businessName || '' },
            { name: 'clientBusinessAddress', value: client?.businessAddress1 || '' },
            { name: 'clientContactAddress', value: client?.businessAddress2 || '' },
            { name: 'clientBusinessEmail', value: client?.businessEmail || '' },
            { name: 'einNumber', value: client?.businessEinNumber || '' },
          ],
        },
      };

      const response = await axios.post(
        `${baseUri}/v2.1/accounts/${user.docusignAccountId}/envelopes`,
        envelopeDefinition,
        {
          headers: {
            Authorization: `Bearer ${user.docusignAccessToken}`,
            'Content-Type': 'application/json',
          },
        },

      );

      if (application?.id && response.data?.envelopeId) {
        // Before creating new document, expire any previous ones
        await (this.prisma as any).document.updateMany({
          where: { applicationId: application.id },
          data: { status: 'expired' },
        });

        // Now create a fresh document record
        // Note: Document.userId is Int, so use user.userId (numeric) instead of userId (UUID string)
        await (this.prisma as any).document.createMany({
          data: {
            applicationId: application.id,
            envelopeId: response.data.envelopeId,
            status: response.data.status || 'created',
            userId: user.userId, // Use numeric userId from User model
          },
        });
      }

      // console.log("enevelop defination ---------------", envelopeDefinition)

      return response.data;
    } catch (error: any) {
      if (error.response) {
        if (error.response.status === 401) {
          throw new UnauthorizedException('DocuSign authentication failed. Please reconnect your DocuSign account.');
        }

        if (error.response.status === 400) {
          throw new BadRequestException(`DocuSign validation error: ${JSON.stringify(error.response.data)}`);
        }
      }

      throw new BadRequestException('Failed to create draft envelope: ' + error.message);
    }
  }

  async getSenderViewUrl(userId: string, envelopeId: string, returnUrl: string) {
    const userResult = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    let user: any = userResult;

    if (!user?.docusignAccessToken) {
      throw new UnauthorizedException('DocuSign not connected');
    }

    const isTokenExpired = user.docusignTokenExpiry &&
      new Date(user.docusignTokenExpiry).getTime() - 5 * 60 * 1000 < Date.now();

    if (isTokenExpired && user.docusignRefreshToken) {
      try {
        await this.refreshToken(userId);
        const updatedUser = await this.prisma.user.findUnique({
          where: { id: userId },
        }) as any;
        if (!updatedUser?.docusignAccessToken) {
          throw new Error('Failed to refresh token');
        }
        user = updatedUser;
      } catch (error) {
        throw new UnauthorizedException('DocuSign token expired and refresh failed');
      }
    }

    try {
      if (!user.docusignAccountId || !user.docusignBaseUri) {
        throw new UnauthorizedException('DocuSign account information missing. Please reconnect your DocuSign account.');
      }
      let baseUri = user.docusignBaseUri;
      if (!baseUri.endsWith('/restapi')) {
        baseUri = baseUri.replace(/\/+$/, '') + '/restapi';
      }
      const response = await axios.post(
        `${baseUri}/v2.1/accounts/${user.docusignAccountId}/envelopes/${envelopeId}/views/sender`,
        { returnUrl },
        {
          headers: {
            Authorization: `Bearer ${user.docusignAccessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );

      return response.data;
    } catch (error: any) {
      if (error?.response) {
        if (error.response.status === 401) {
          throw new UnauthorizedException('DocuSign authentication failed. Please reconnect your DocuSign account.');
        }

        if (error.response.status === 400) {
          throw new BadRequestException(`DocuSign validation error: ${JSON.stringify(error.response.data)}`);
        }
      }

      throw new BadRequestException('Failed to get sender view URL: ' + (error?.message || error));
    }
  }

  async updateDocumentStatusFromWebhook(body: any) {
    // Support both old and new webhook formats
    let envelopeId: string | undefined;
    let status: string | undefined;

    if (body?.envelopeStatus) {
      // Old format
      envelopeId = body.envelopeStatus.envelopeId;
      status = body.envelopeStatus.status;
    } else if (body?.data && body?.event) {
      // New format
      envelopeId = body.data.envelopeId;
      status = body.event;
      // Trim 'envelope-' prefix if present
      if (status && status.startsWith('envelope-')) {
        status = status.replace('envelope-', '');
      }
    }

    if (!envelopeId || !status) return;

    // If event is 'sent', update sentAt to now and set application's isDocument to true
    if (status === 'sent') {
      // Update sentAt to now
      await (this.prisma as any).document.updateMany({
        where: { envelopeId },
        data: {
          status,
          sentAt: new Date(),
        },
      });
      // Get the document to find applicationId
      const document: any = await (this.prisma as any).document.findUnique({ where: { envelopeId } });
      // if (document?.applicationId) {
      //   await this.prisma.application.update({
      //     where: { id: document.applicationId },
      //     data: { isDocument: true },
      //   });
      // }
      return;
    }

    // If event is 'completed', update completedAt to now
    if (status === 'completed') {
      await (this.prisma as any).document.updateMany({
        where: { envelopeId },
        data: {
          status,
          completedAt: new Date(),
        },
      });
      return;
    }

    await (this.prisma as any).document.updateMany({
      where: { envelopeId },
      data: {
        status
      },
    });
  }

  async fetchSignedDocumentPdf(userId: string, envelopeId: string): Promise<Buffer> {
    // Get user and check/refresh token
    let user: any = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.docusignAccessToken) {
      throw new UnauthorizedException('DocuSign not connected');
    }
    const isTokenExpired = user.docusignTokenExpiry &&
      new Date(user.docusignTokenExpiry).getTime() - 5 * 60 * 1000 < Date.now();
    let accessToken = user.docusignAccessToken;
    if (isTokenExpired && user.docusignRefreshToken) {
      try {
        await this.refreshToken(userId);
        // Only fetch user again if refresh succeeded
        user = await this.prisma.user.findUnique({ where: { id: userId } }) as any;
        if (!user?.docusignAccessToken) {
          throw new UnauthorizedException('DocuSign token refresh failed');
        }
        accessToken = user.docusignAccessToken;
      } catch (err: any) {
        throw new UnauthorizedException('DocuSign token refresh failed: ' + (err?.message || err));
      }
    }
    if (!user.docusignAccountId || !user.docusignBaseUri) {
      throw new UnauthorizedException('DocuSign account information missing. Please reconnect your DocuSign account.');
    }
    // Ensure /restapi is present in base_uri
    let baseUri = user.docusignBaseUri;


    if (!baseUri.endsWith('/restapi')) {
      baseUri = baseUri.replace(/\/+$/, '') + '/restapi';
    }
    // Fetch PDF from DocuSign
    const response = await axios.get(
      `${baseUri}/v2.1/accounts/${user.docusignAccountId}/envelopes/${envelopeId}/documents/combined`,
      {
        responseType: 'arraybuffer',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      },
    );
    // Ensure the result is a Buffer
    return Buffer.isBuffer(response.data) ? response.data : Buffer.from(response.data);
  }
} 