jest.mock('./letterHtmlToPdf.service', () => ({
  renderHtmlToA4PdfBuffer: jest.fn(),
  renderLetterHtmlToPdfBuffer: jest.fn(),
}));

import { buildClearReportSectionsHtml } from './backgroundCheckReport.service';

describe('buildClearReportSectionsHtml', () => {
  it('renders CLEAR judgements, liens, and corporations', () => {
    const html = buildClearReportSectionsHtml({
      clearLienJudgments: [
        {
          kind: 'judgment',
          description: 'Civil judgment',
          caseNumber: 'CV-123',
          court: 'Supreme Court',
          amount: '$12,500',
          pdfUrl: 'https://example.com/clear-person.pdf',
        },
        {
          kind: 'lien',
          description: 'Federal tax lien',
          filingDate: '2026-07-01',
          parties: 'IRS v. Example LLC',
        },
      ],
      clearCorporateAssociations: [
        {
          name: 'Example Holdings LLC',
          section: 'CorporateSection',
          reportKind: 'person',
        },
      ],
    });

    expect(html).toContain('Judgements');
    expect(html).toContain('Civil judgment');
    expect(html).toContain('CV-123');
    expect(html).toContain('Liens');
    expect(html).toContain('Federal tax lien');
    expect(html).toContain('Corporations');
    expect(html).toContain('Example Holdings LLC');
    expect(html).toContain('https://example.com/clear-person.pdf');
  });

  it('renders empty subsections when CLEAR metadata exists without records', () => {
    const html = buildClearReportSectionsHtml({});

    expect(html).toContain('Judgements');
    expect(html).toContain('Liens');
    expect(html).toContain('Corporations');
    expect(html.match(/>None</g)).toHaveLength(3);
  });

  it('does not add CLEAR subsections before CLEAR has run', () => {
    expect(buildClearReportSectionsHtml(undefined)).toBe('');
  });
});
