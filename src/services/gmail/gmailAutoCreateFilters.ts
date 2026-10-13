/**
 * Decide whether Gmail auto-create should skip a message before OCR / app create.
 *
 * Product rules:
 * - Skip emails with fewer than 2 PDF attachments (lone bank statement / lone certificate).
 * - Skip DocuSign / e-sign completion mail (signed deals must not become new CRM apps).
 *
 * Genuine ISO submissions are typically application + bank statement(s) (≥2 PDFs).
 */
export type GmailAutoCreateSkipDecision =
  | { skip: true; reason: 'single_attachment' | 'docusign_or_esign'; detail: string }
  | { skip: false };

const ESIGN_SENDER_RE =
  /(?:^|[@.])(?:docusign\.net|docusign\.com|adobesign\.com|echosign\.com|hellosign\.com|dropboxsign\.com)\b/i;

const ESIGN_SUBJECT_RE =
  /\b(?:docusign|adobe\s*sign|hello\s*sign|dropbox\s*sign|certificate of completion|documents?\s+have\s+been\s+signed|your\s+document\s+has\s+been|completed:\s*|fully\s+executed|voided|declined\s+to\s+sign)\b/i;

const ESIGN_FILENAME_RE =
  /(?:certificate\s*of\s*completion|certificateofcompletion|docusign|adobe\s*sign|hellosign|dropboxsign|envelope)/i;

function normalizeList(values: string[]): string[] {
  return values.map((v) => String(v || '').trim()).filter(Boolean);
}

export function evaluateGmailAutoCreateSkip(params: {
  subject?: string | null;
  fromHeader?: string | null;
  senderEmails?: string[] | null;
  pdfFilenames?: string[] | null;
  pdfCount: number;
}): GmailAutoCreateSkipDecision {
  const subject = String(params.subject || '').trim();
  const fromHeader = String(params.fromHeader || '').trim();
  const senderEmails = normalizeList(params.senderEmails || []);
  const pdfFilenames = normalizeList(params.pdfFilenames || []);
  const pdfCount = Number(params.pdfCount) || 0;

  const senderBlob = [fromHeader, ...senderEmails].join(' ');
  if (ESIGN_SENDER_RE.test(senderBlob) || ESIGN_SUBJECT_RE.test(subject)) {
    return {
      skip: true,
      reason: 'docusign_or_esign',
      detail: `from/subject matched e-sign (pdfs=${pdfCount})`,
    };
  }

  const esignFile = pdfFilenames.find((fn) => ESIGN_FILENAME_RE.test(fn));
  if (esignFile) {
    return {
      skip: true,
      reason: 'docusign_or_esign',
      detail: `filename matched e-sign ("${esignFile}")`,
    };
  }

  if (pdfCount < 2) {
    return {
      skip: true,
      reason: 'single_attachment',
      detail: `pdfCount=${pdfCount} (need ≥2 PDFs for auto-create)`,
    };
  }

  return { skip: false };
}
