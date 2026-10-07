/**
 * `signnow.service` reaches puppeteer through the funder/PDF helpers it imports,
 * and Jest cannot parse that package's ESM build. The Exhibit C helpers under
 * test touch none of it, so the module is stubbed for the import to resolve.
 */
jest.mock('puppeteer', () => ({ __esModule: true, default: {} }));

import {
  exhibitCDocumentPrefillValues,
  exhibitCEntityRowHasData,
  resolveExhibitCEntities,
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

  it('sends a single Exhibit C with no entity blank, never with the ACH / funding bank', () => {
    const { values, entityIndex } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP',
    );
    expect(entityIndex).toBe(0);
    expect(values.client_legal_name).toBe('');
    expect(values.ach_account_holder_name).toBe('');
    expect(values.ach_bank_name).toBe('');
    expect(values.ach_bank_account).toBe('');
    expect(values.ach_bank_routing).toBe('');
    expect(values.agreement_date).toBe('09/21/2026');
  });

  it('sends an added copy with no entity of its own blank, never as the original', () => {
    const { values, entityIndex } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}, {}, { agreementDate: '09/21/2026' }],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP (3)',
    );
    expect(entityIndex).toBe(2);
    expect(values.client_legal_name).toBe('');
    expect(values.client_name).toBe('');
    expect(values.ach_account_holder_name).toBe('');
    expect(values.ach_account_holder_dba).toBe('');
    expect(values.ach_account_holder_address).toBe('');
    expect(values.ach_bank_name).toBe('');
    expect(values.ach_bank_account).toBe('');
    expect(values.ach_bank_routing).toBe('');
    // The deal's agreement date is not entity data; it stays.
    expect(values.agreement_date).toBe('09/21/2026');
  });

  it('keeps an added copy blank when the entity list is shorter than the package', () => {
    const { values } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP (2)',
    );
    expect(values.ach_bank_account).toBe('');
    expect(values.ach_bank_name).toBe('');
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

  it('names the copy own entity as merchant, never the deal merchant', () => {
    const { values } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [{}, OTHER_ENTITY],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP (2)',
    );
    expect(values.client_legal_name).toBe('IRVIN HOLDINGS LLC');
    expect(values.client_legal_name_p1).toBe('IRVIN HOLDINGS LLC');
    expect(MERCHANT_VALUES.client_legal_name).toBe('RE-NEW-IT RENOVATIONS LLC');
  });

  it('prints the first Exhibit C own entity, never the deal merchant', () => {
    const { values } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [OTHER_ENTITY],
      'EXHIBIT C OBSIDIAN CAPITAL GROUP',
    );
    expect(values.client_legal_name).toBe('IRVIN HOLDINGS LLC');
    expect(values.ach_bank_name).toBe('WELLS FARGO');
    expect(values.ach_bank_routing).toBe('');
  });
});

/**
 * `ignoreExistingFieldValues` is driven by this flag. Every Exhibit C — the
 * first one included — is an independent record that prints only its own
 * entity, on Nitro, Obsidian and Tiberian alike.
 */
describe('isolation is reported per copy, not per Exhibit C', () => {
  it('isolates the first copy too', () => {
    const { isolated, entityIndex } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [],
      'EXHIBIT C TIBERIAN FUNDING',
    );
    expect(entityIndex).toBe(0);
    expect(isolated).toBe(true);
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

  it('isolates an added copy with no entity of its own, so no earlier text survives', () => {
    const { isolated, values } = exhibitCDocumentPrefillValues(
      MERCHANT_VALUES,
      [OTHER_ENTITY],
      'EXHIBIT C TIBERIAN FUNDING (2)',
    );
    expect(isolated).toBe(true);
    expect(values.ach_bank_name).toBe('');
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

  it('prints the first Exhibit C own address, never the deal business address', () => {
    const { values } = signNowDocumentPrefillValues(
      {
        ...MERCHANT_VALUES,
        business_address: '218 LAUREL WOODS',
        business_address_city: 'WARNER ROBINS',
        business_address_state: 'GA',
        business_address_zip: '31088',
      },
      [
        {
          accountHolderName: 'RE-NEW-IT RENOVATIONS LLC',
          accountHolderAddress: '3273 COVE CREEK ROAD',
          accountHolderCity: 'GWALIOR',
          accountHolderState: 'NORTH CAROLINA',
          accountHolderZip: '28785',
        },
      ],
      'Exhibit C',
      TABS,
    );
    expect(values.business_address).toBe('3273 COVE CREEK ROAD');
    expect(values.business_address_city).toBe('GWALIOR');
    expect(values.business_address_zip).toBe('28785');
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

/**
 * What the CRM saved for a copy must win over the list the browser posted: the
 * posted list is built from the contract the screen loaded and can predate the
 * copy's latest save, which sent `Exhibit C (2)` to Review with no entity.
 */
describe('resolveExhibitCEntities', () => {
  const COPY_1 = { accountHolderName: 'RE-NEW-IT RENOVATIONS, LLC', bankName: 'Test Bank', bankAccount: '123456789' };
  const COPY_2 = { accountHolderName: 'Test Usera', bankName: 'Test Usera', bankAccount: '123456788' };

  it('prefers the saved entity over a stale posted one', () => {
    const entities = resolveExhibitCEntities({
      storedEntitiesRaw: JSON.stringify([COPY_1, COPY_2]),
      payloadEntitiesRaw: JSON.stringify([COPY_1, {}]),
    });
    expect(entities[1].accountHolderName).toBe('Test Usera');
    expect(entities[1].bankAccount).toBe('123456788');
  });

  it('uses the copy own saved tab when the stored list is missing', () => {
    const entities = resolveExhibitCEntities({
      mappingEntities: [COPY_1, COPY_2],
      payloadEntitiesRaw: JSON.stringify([COPY_1]),
    });
    expect(entities).toHaveLength(2);
    expect(entities[1].bankName).toBe('Test Usera');
  });

  it('fills a slot with no saved record from the posted list', () => {
    const entities = resolveExhibitCEntities({
      storedEntitiesRaw: JSON.stringify([{}, { bankName: 'Test Usera' }]),
      payloadEntitiesRaw: JSON.stringify([COPY_1, { bankAccount: '123456788' }]),
    });
    expect(entities[0].bankName).toBe('Test Bank');
    expect(entities[1].bankName).toBe('Test Usera');
  });

  it('never backfills a saved copy from other sources', () => {
    // Saving another addendum pushed the deal DBA / bank into this copy's tab;
    // the copy's own record has those lines blank and must stay that way.
    const entities = resolveExhibitCEntities({
      storedEntitiesRaw: JSON.stringify([
        { clientLegalName: 'FUSIONTECZ', accountHolderName: 'RE-NEW-IT RENOVATIONS, LLC', bankName: 'FUSIONTECZ' },
      ]),
      mappingEntities: [
        { accountHolderDba: 'RE-NEW-IT RENOVATIONS, LLC', bankPortal: 'chase.com', agreementDate: '10/07/2026' },
      ],
      payloadEntitiesRaw: JSON.stringify([{ accountHolderDba: 'RE-NEW-IT RENOVATIONS, LLC', bankAccount: '555' }]),
    });
    expect(entities[0].accountHolderName).toBe('RE-NEW-IT RENOVATIONS, LLC');
    expect(entities[0].accountHolderDba).toBeUndefined();
    expect(entities[0].bankPortal).toBeUndefined();
    expect(entities[0].bankAccount).toBeUndefined();
    expect(entities[0].agreementDate).toBe('10/07/2026');

    const { values } = signNowDocumentPrefillValues(
      { ...MERCHANT_VALUES, doing_business_as: 'RE-NEW-IT RENOVATIONS, LLC' },
      entities,
      'Exhibit C',
    );
    expect(values.ach_account_holder_dba).toBe('');
    expect(values.doing_business_as).toBe('');
  });

  it('gives Exhibit C (2) its own values end to end', () => {
    const entities = resolveExhibitCEntities({
      storedEntitiesRaw: JSON.stringify([COPY_1, COPY_2]),
      payloadEntitiesRaw: JSON.stringify([COPY_1, {}]),
    });
    const { values, isolated } = signNowDocumentPrefillValues(
      { ...MERCHANT_VALUES, ach_account_holder_name_p1: 'MARY IRVIN', ach_bank_name_p1: 'Test Bank' },
      entities,
      'Exhibit C (2)',
    );
    expect(isolated).toBe(true);
    expect(values.ach_account_holder_name_p1).toBe('Test Usera');
    expect(values.ach_bank_name_p1).toBe('Test Usera');
    expect(values.ach_bank_account).toBe('123456788');
  });
});

/**
 * Exhibit C #1 (RE-NEW-IT, no DBA) printed FUSIONTECZ — the package-wide DBA —
 * while its CRM copy showed the line blank, and Exhibit C (2) lost its own DBA.
 */
describe('Exhibit C DBA stays with its own copy', () => {
  const PACKAGE = { ...MERCHANT_VALUES, ach_account_holder_dba: 'FUSIONTECZ', doing_business_as: 'FUSIONTECZ' };
  const FIRST = { accountHolderName: 'RE-NEW-IT RENOVATIONS, LLC', bankName: 'JP Morgan' };
  const SECOND = {
    clientLegalName: 'FUSIONTECZ',
    accountHolderName: 'FUSIONTECZ',
    accountHolderDba: 'FUSIONTECZ',
    bankName: 'JP Morgan',
  };

  it('leaves the first copy DBA blank when its entity has none', () => {
    const { values } = exhibitCDocumentPrefillValues(PACKAGE, [FIRST, SECOND], 'EXHIBIT C');
    expect(values.ach_account_holder_dba).toBe('');
    expect(values.ach_account_holder_dba_p1).toBe('');
    expect(values.doing_business_as).toBe('');
  });

  it('puts the second copy own DBA on its page', () => {
    const { values } = exhibitCDocumentPrefillValues(PACKAGE, [FIRST, SECOND], 'EXHIBIT C (2)');
    expect(values.ach_account_holder_dba).toBe('FUSIONTECZ');
    expect(values.ach_account_holder_dba_p1).toBe('FUSIONTECZ');
  });

  it('leaves an Exhibit C with no entity DBA blank, never the package DBA', () => {
    const { values } = exhibitCDocumentPrefillValues(PACKAGE, [], 'EXHIBIT C');
    expect(values.ach_account_holder_dba).toBe('');
  });
});
