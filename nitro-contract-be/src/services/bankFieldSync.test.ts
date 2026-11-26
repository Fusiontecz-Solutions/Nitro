jest.mock('../config/prismaClient', () => ({ __esModule: true, default: {} }));

import {
  applyBankFieldsToPrefill,
  readBankFieldsFromExhibitCEntity,
  readBankFieldsFromPrefill,
} from './bankFieldSync';

describe('readBankFieldsFromPrefill', () => {
  it('reads the bank block from the top-level prefill keys', () => {
    expect(
      readBankFieldsFromPrefill({
        authorizationClientBankName: 'JP Morgan',
        authorizationClientBankAccount: '789846303',
        authorizationClientBankRouting: '021000021',
        achAuthorizationBankPortalWebsite: 'chase.com',
        achAuthorizationUsername: 'merchant1',
      }),
    ).toEqual({
      bankName: 'JP Morgan',
      accountNumber: '789846303',
      routingNumber: '021000021',
      bankPortal: 'chase.com',
      bankUsername: 'merchant1',
    });
  });

  it('never reads an Exhibit C entity as the deal bank', () => {
    expect(
      readBankFieldsFromPrefill({
        authorizationClientBankName: '',
        exhibitCEntities: JSON.stringify([
          { bankName: 'JP Morgan', bankAccount: '789846303', bankPortal: 'chase.com' },
          { bankName: 'Other Bank', bankAccount: '111111111' },
        ]),
      }),
    ).toEqual({});
  });
});

describe('readBankFieldsFromExhibitCEntity', () => {
  it('maps entity field names onto the shared bank fields', () => {
    expect(
      readBankFieldsFromExhibitCEntity({
        bankName: 'JP Morgan',
        bankAccount: '789846303',
        bankRouting: '021000021',
        bankUsername: 'merchant1',
      }),
    ).toEqual({
      bankName: 'JP Morgan',
      accountNumber: '789846303',
      routingNumber: '021000021',
      bankUsername: 'merchant1',
    });
  });
});

describe('applyBankFieldsToPrefill', () => {
  it('writes every alias key for the values it is given', () => {
    const next = applyBankFieldsToPrefill(
      { legalName: 'Acme LLC' },
      { bankName: 'JP Morgan', accountNumber: '789846303', bankUsername: 'merchant1' },
    );
    expect(next).toMatchObject({
      legalName: 'Acme LLC',
      authorizationClientBankName: 'JP Morgan',
      achAuthorizationAccountHolderBankName: 'JP Morgan',
      authorizationClientBankAccount: '789846303',
      achAuthorizationAccountHolderBankAccountNumber: '789846303',
      achAuthorizationUsername: 'merchant1',
    });
  });

  it('never blanks an existing value with an empty one', () => {
    const next = applyBankFieldsToPrefill(
      { authorizationClientBankName: 'JP Morgan' },
      { bankName: '', accountNumber: '789846303' },
    );
    expect(next.authorizationClientBankName).toBe('JP Morgan');
    expect(next.authorizationClientBankAccount).toBe('789846303');
  });

  it('leaves every Exhibit C entity untouched, the first one included', () => {
    const next = applyBankFieldsToPrefill(
      {
        exhibitCEntities: JSON.stringify([
          { bankName: 'Existing Bank', bankAccount: '' },
          { bankName: 'Other Bank', bankAccount: '111111111' },
        ]),
      },
      { bankName: 'JP Morgan', accountNumber: '789846303' },
    );
    expect(next.authorizationClientBankAccount).toBe('789846303');
    expect(JSON.parse(String(next.exhibitCEntities))).toEqual([
      { bankName: 'Existing Bank', bankAccount: '' },
      { bankName: 'Other Bank', bankAccount: '111111111' },
    ]);
  });
});

describe('bankSyncContractFields (bank block written in the save itself)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { bankSyncContractFields } = require('./bankFieldSync');

  it('returns the contract columns and the levelled prefill in one go', () => {
    const out = bankSyncContractFields(
      { authorizationClientBankName: 'JP Morgan', unrelated: 'kept' },
      { bankName: 'JP Morgan', accountNumber: '789846303', routingNumber: '021000021' },
    );
    expect(out.columns).toEqual({
      authorizationClientBankName: 'JP Morgan',
      authorizationClientBankAccount: '789846303',
      authorizationClientBankRouting: '021000021',
    });
    expect(out.overrides).toMatchObject({
      unrelated: 'kept',
      achAuthorizationAccountHolderBankName: 'JP Morgan',
      achAuthorizationAccountHolderBankAccountNumber: '789846303',
      achAuthorizationAccountHolderBankRoutingNumber: '021000021',
    });
  });

  it('is null when the save carries no bank block', () => {
    expect(bankSyncContractFields({ legalName: 'ACME' }, {})).toBeNull();
  });
});
