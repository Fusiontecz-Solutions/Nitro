/**
 * An Exhibit C (2)/(3)/… entity's DBA belongs to that copy only.
 *
 * The CRM picked "copy #1" by list position, so when the mappings came back in
 * another order copy (2)'s DBA was saved as the contract's own DBA — contract
 * 183 (Nitro) holds `doingBusinessAs: FUSIONTECZ` while Exhibit C #1's DBA is
 * blank and FUSIONTECZ is entity 2's. Every document except that copy must drop
 * it, so the agreement's D/B/A line stays as blank as the deal's merchant is.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));
jest.mock('./utils/signnow-template-store', () => ({
  readStoredTemplateDocument: jest.fn(async () => null),
  writeStoredTemplateDocument: jest.fn(async () => undefined),
  invalidateStoredTemplateDocument: jest.fn(async () => undefined),
  signNowTemplateStoreTtlMs: () => 60_000,
}));

import { signNowDocumentPrefillValues, withoutExhibitCCopyDbas } from './signnow.service';

const ENTITIES = [
  { clientLegalName: 'RE-NEW-IT RENOVATIONS, LLC', accountHolderName: 'RE-NEW-IT RENOVATIONS, LLC', accountHolderDba: '' },
  { clientLegalName: 'FUSIONTECZ', accountHolderName: 'FUSIONTECZ', accountHolderDba: 'FUSIONTECZ' },
];

/** The package map as contract 183 sends it: the copy's DBA saved as the deal's. */
const POLLUTED: Record<string, string> = {
  client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
  doing_business_as: 'FUSIONTECZ',
  ach_authorization_account_holder_dba: 'FUSIONTECZ',
  security_doing_business_as: 'FUSIONTECZ',
  dba: 'FUSIONTECZ',
};

describe('an Exhibit C copy DBA saved as the deal DBA', () => {
  it('is dropped from the agreement', () => {
    const { values } = signNowDocumentPrefillValues(POLLUTED, ENTITIES, 'Agreement - Nitro Advance');
    for (const key of ['doing_business_as', 'ach_authorization_account_holder_dba', 'security_doing_business_as', 'dba']) {
      expect(values[key]).toBe('');
    }
    expect(values.client_legal_name).toBe('RE-NEW-IT RENOVATIONS, LLC');
  });

  it('is dropped from Exhibit C #1', () => {
    const { values } = signNowDocumentPrefillValues(POLLUTED, ENTITIES, 'Exhibit C Nitro Advance');
    expect(values.doing_business_as || '').toBe('');
    expect(values.ach_account_holder_dba_p1 || '').toBe('');
  });

  it('still prints on its own copy', () => {
    const { values } = signNowDocumentPrefillValues(POLLUTED, ENTITIES, 'Exhibit C Nitro Advance (2)');
    expect(values.ach_account_holder_dba_p1).toBe('FUSIONTECZ');
  });

  it('keeps a real deal DBA that copy #1 shares', () => {
    const entities = [{ ...ENTITIES[0], accountHolderDba: 'FUSIONTECZ' }, ENTITIES[1]];
    const values = withoutExhibitCCopyDbas(POLLUTED, entities);
    expect(values.doing_business_as).toBe('FUSIONTECZ');
  });

  it('keeps the deal DBA when it differs from every copy', () => {
    const values = withoutExhibitCCopyDbas(
      { ...POLLUTED, doing_business_as: 'RENEW HOMES' },
      ENTITIES,
    );
    expect(values.doing_business_as).toBe('RENEW HOMES');
  });

  it('never blanks the business name a Monthly Fee holder line prints', () => {
    const entities = [ENTITIES[0], { ...ENTITIES[1], accountHolderDba: 'RE-NEW-IT RENOVATIONS, LLC' }];
    const values = withoutExhibitCCopyDbas(
      { ...POLLUTED, ach_account_holder_dba_p1: 'RE-NEW-IT RENOVATIONS, LLC' },
      entities,
    );
    expect(values.ach_account_holder_dba_p1).toBe('RE-NEW-IT RENOVATIONS, LLC');
  });
});
