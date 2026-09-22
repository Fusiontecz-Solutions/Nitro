/**
 * `signnow.service` reaches puppeteer through the funder/PDF helpers it imports,
 * and Jest cannot parse that package's ESM build. The Exhibit C helpers under
 * test touch none of it, so the module is stubbed for the import to resolve.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

import {
  exhibitCDocumentPrefillValues,
  exhibitCEntityRowHasData,
} from './signnow.service';

/** Package-wide CRM values, as every Exhibit C copy sees them before isolation. */
const MERCHANT_VALUES: Record<string, string> = {
  client_legal_name: 'RE-NEW-IT RENOVATIONS LLC',
  client_name: 'MARY IRVIN',
  ach_account_holder_name: 'RE-NEW-IT RENOVATIONS LLC',
  ach_account_holder_dba: 'RE-NEW-IT',
  ach_account_holder_address: '12 Main St, Austin TX',
  ach_bank_name: 'CHASE',
  ach_bank_account: '1234567890',
  ach_bank_routing: '111000614',
  agreement_date: '09/21/2026',
  application_id: '148',
};

const OTHER_ENTITY = {
  clientLegalName: 'IRVIN HOLDINGS LLC',
  accountHolderName: 'IRVIN HOLDINGS LLC',
  bankName: 'WELLS FARGO',
  bankAccount: '9998887776',
};

describe('exhibitCEntityRowHasData', () => {
  it('treats a slot carrying only an agreement date as having no entity', () => {
    expect(exhibitCEntityRowHasData({ agreementDate: '09/21/2026' })).toBe(false);
  });

  it('recognises a slot that names its own business', () => {
    expect(exhibitCEntityRowHasData(OTHER_ENTITY)).toBe(true);
  });

  it('handles a missing or empty slot', () => {
    expect(exhibitCEntityRowHasData(undefined)).toBe(false);
    expect(exhibitCEntityRowHasData({})).toBe(false);
  });
});

describe('exhibitCDocumentPrefillValues', () => {
  it('leaves a non-Exhibit document untouched', () => {
    const result = exhibitCDocumentPrefillValues(MERCHANT_VALUES, [], 'PCM CONTRACT');
    expect(result.entityIndex).toBeNull();
    expect(result.values).toBe(MERCHANT_VALUES);
  });

  it('fills the first copy from the package values', () => {
    const { values, entityIndex } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP',
    );
    expect(entityIndex).toBe(0);
    expect(values.ach_account_holder_name).toBe('RE-NEW-IT RENOVATIONS LLC');
    expect(values.ach_bank_account).toBe('1234567890');
  });

  it('fills an extra copy that has no entity of its own', () => {
    const { values, entityIndex } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}, {}, { agreementDate: '09/21/2026' }],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP (3)',
    );
    expect(entityIndex).toBe(2);
    expect(values.ach_account_holder_name).toBe('RE-NEW-IT RENOVATIONS LLC');
    expect(values.ach_bank_name).toBe('CHASE');
    expect(values.ach_bank_routing).toBe('111000614');
    expect(values.agreement_date).toBe('09/21/2026');
  });

  it('fills an extra copy when the entity list is shorter than the package', () => {
    const { values } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP (2)',
    );
    expect(values.ach_bank_account).toBe('1234567890');
  });

  it('keeps an extra copy that names its own business isolated from the merchant', () => {
    const { values, entityIndex } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}, OTHER_ENTITY],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP (2)',
    );
    expect(entityIndex).toBe(1);
    // The entity's own details land on its page...
    expect(values.ach_account_holder_name).toBe('IRVIN HOLDINGS LLC');
    expect(values.ach_bank_name).toBe('WELLS FARGO');
    expect(values.ach_bank_account).toBe('9998887776');
    // ...and nothing the entity did not set falls back to the merchant.
    expect(values.ach_bank_routing).toBe('');
    expect(values.ach_account_holder_dba).toBe('');
    expect(values.ach_account_holder_address).toBe('');
  });
});
