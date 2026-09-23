/**
 * `signnow.service` reaches puppeteer through the funder/PDF helpers it imports,
 * and Jest cannot parse that package's ESM build. The Exhibit C helpers under
 * test touch none of it, so the module is stubbed for the import to resolve.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

import {
  exhibitCDocumentPrefillValues,
  exhibitCEntityRowHasData,
  signNowDocumentPrefillValues,
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

/**
 * `ignoreExistingFieldValues` is driven by this flag. Setting it for every copy
 * is what let a thin package payload empty an Exhibit C page down to the bare
 * agreement date the overlay always stamps, on Nitro, Obsidian and Tiberian
 * alike, while every other document quietly kept its previous widget values.
 */
describe('isolation is reported per copy, not per Exhibit C', () => {
  it('never isolates the first copy, even when its slot names a business', () => {
    const { isolated, entityIndex } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [OTHER_ENTITY],
      'EXHIBIT C TIBERIAN FUNDING',
    );
    expect(entityIndex).toBe(0);
    expect(isolated).toBe(false);
  });

  it('isolates an extra copy that names its own business', () => {
    const { isolated, values } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}, OTHER_ENTITY],
      'EXHIBIT C TIBERIAN FUNDING (2)',
    );
    expect(isolated).toBe(true);
    expect(values.ach_bank_name).toBe('WELLS FARGO');
  });

  it('leaves an extra copy with no entity of its own un-isolated', () => {
    const { isolated, values } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [OTHER_ENTITY],
      'EXHIBIT C TIBERIAN FUNDING (2)',
    );
    expect(isolated).toBe(false);
    expect(values.ach_bank_name).toBe('CHASE');
  });

  it('reports no isolation for a document that is not an Exhibit C', () => {
    expect(
      exhibitCDocumentPrefillValues(MERCHANT_VALUES, [OTHER_ENTITY], 'CONTRACT TIBERIAN FUNDING')
        .isolated,
    ).toBe(false);
  });
});

describe('signNowDocumentPrefillValues', () => {
  const TABS = [
    {
      mappingId: 'm1',
      templateName: 'Flex Addendum',
      layoutKey: 'flex_addendum',
      values: { installment_day_1_p1: '1', client_name: 'TAB OVERRIDE' },
    },
  ];

  it('leaves a document with no tab of its own on the package values', () => {
    const { values } = signNowDocumentPrefillValues(
      MERCHANT_VALUES,
      [],
      'Exhibit A - Nitro Advance',
      TABS,
    );
    expect(values).toBe(MERCHANT_VALUES);
  });

  it('layers a document own tab over the package values, for that document only', () => {
    const { values } = signNowDocumentPrefillValues(
      MERCHANT_VALUES,
      [],
      'Flex addendum - Nitro Advance',
      TABS,
    );
    expect(values.installment_day_1_p1).toBe('1');
    // What was typed against the document wins over the package-wide value.
    expect(values.client_name).toBe('TAB OVERRIDE');
    // …and the rest of the deal still travels with it.
    expect(values.ach_bank_name).toBe('CHASE');
    expect(MERCHANT_VALUES.client_name).toBe('MARY IRVIN');
  });

  it('still isolates an Exhibit C copy that carries its own entity', () => {
    const { isolated, values } = signNowDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}, OTHER_ENTITY],
      'Exhibit C (2)',
      TABS,
    );
    expect(isolated).toBe(true);
    expect(values.ach_bank_name).toBe('WELLS FARGO');
  });
});
