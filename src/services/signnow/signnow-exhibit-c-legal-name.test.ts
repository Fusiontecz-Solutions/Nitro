/**
 * An Exhibit C's Merchant Legal Name is its own entity's — never the deal's.
 *
 * An older CRM build seeded Exhibit C with the application's legal name and
 * saved it onto the entity slot, so that echo must still print blank.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { exhibitCDocumentPrefillValues } from './signnow.service';

const values = {
  client_legal_name: 'Re-New-It Renovations, LLC',
  client_legal_name_p1: 'Re-New-It Renovations, LLC',
  agreement_date: '10/07/2026',
};

describe('Exhibit C merchant legal name', () => {
  it('drops an entity legal name that only echoes the deal merchant', () => {
    const { values: out } = exhibitCDocumentPrefillValues(
      values,
      [{ clientLegalName: 'RE-NEW-IT RENOVATIONS, LLC', bankAccount: '123456789' }],
      'Exhibit C',
    );
    expect(out.client_legal_name_p1).toBe('');
    expect(out.agreement_date_p1).toBe('10/07/2026');
  });

  it('keeps an entity legal name of its own', () => {
    const { values: out } = exhibitCDocumentPrefillValues(
      values,
      [{}, { clientLegalName: 'Fusiontecz LLC' }],
      'Exhibit C (2)',
    );
    expect(out.client_legal_name_p1).toBe('Fusiontecz LLC');
  });
});
