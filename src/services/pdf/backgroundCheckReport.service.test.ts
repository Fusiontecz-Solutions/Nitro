jest.mock('./letterHtmlToPdf.service', () => ({
  renderHtmlToA4PdfBuffer: jest.fn(),
  renderLetterHtmlToPdfBuffer: jest.fn(),
}));

import {
  buildBackgroundCheckReportFilename,
  structuredNotesToPlainText,
} from './backgroundCheckReport.service';

describe('backgroundCheckReport', () => {
  it('names the PDF after the merchant', () => {
    expect(buildBackgroundCheckReportFilename('Acme Holdings LLC')).toBe(
      'Acme-Holdings-LLC-Background-Check.pdf',
    );
  });

  it('falls back to Merchant when the name is empty', () => {
    expect(buildBackgroundCheckReportFilename('')).toBe('Merchant-Background-Check.pdf');
  });

  it('converts structured OpenCorporates HTML notes into clean text', () => {
    const html = `<div data-crm-bg-notes="opencorporates" class="crm-bg-notes">
      <div class="crm-bg-notes__toolbar">
        <span class="crm-bg-notes__source">OpenCorporates</span>
        <span class="crm-bg-notes__summary">1 company · FUSIONTECZ</span>
      </div>
      <article class="crm-bg-notes__entity">
        <h3 class="crm-bg-notes__title">&quot;GOOGLE&quot; IMPORT. EXPORT.</h3>
        <div class="crm-bg-notes__chips"><span>Actualizada</span><span>bo · 00198057</span></div>
        <div class="crm-bg-notes__row"><dt>Registered address</dt><dd>AV. TAJIBOSN</dd></div>
        <a class="crm-bg-notes__link" href="https://opencorporates.com/companies/bo/00198057">View on OpenCorporates</a>
      </article>
    </div>`;

    const plain = structuredNotesToPlainText(html);
    expect(plain).toContain('OpenCorporates');
    expect(plain).toContain('"GOOGLE" IMPORT. EXPORT.');
    expect(plain).toContain('Registered address: AV. TAJIBOSN');
    expect(plain).toContain(
      'View on OpenCorporates: https://opencorporates.com/companies/bo/00198057',
    );
    expect(plain).not.toContain('<div');
    expect(plain).not.toContain('data-crm-bg-notes');
  });
});
