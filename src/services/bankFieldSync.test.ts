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

  it('falls back to the primary Exhibit C entity when top-level keys are blank', () => {
    expect(
      readBankFieldsFromPrefill({
        authorizationClientBankName: '',
        exhibitCEntities: JSON.stringify([
          { bankName: 'JP Morgan', bankAccount: '789846303', bankPortal: 'chase.com' },
          { bankName: 'Other Bank', bankAccount: '111111111' },
        ]),
      }),
    ).toEqual({
      bankName: 'JP Morgan',
      accountNumber: '789846303',
      bankPortal: 'chase.com',
    });
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

  it('fills only blank fields on the primary Exhibit C entity and leaves other slots alone', () => {
    const next = applyBankFieldsToPrefill(
      {
        exhibitCEntities: JSON.stringify([
          { bankName: 'Existing Bank', bankAccount: '' },
          { bankName: 'Other Bank', bankAccount: '111111111' },
        ]),
      },
      { bankName: 'JP Morgan', accountNumber: '789846303' },
    );
    expect(JSON.parse(String(next.exhibitCEntities))).toEqual([
      { bankName: 'Existing Bank', bankAccount: '789846303' },
      { bankName: 'Other Bank', bankAccount: '111111111' },
    ]);
  });
});
