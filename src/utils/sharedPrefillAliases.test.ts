import { levelChangedSharedPrefillAliases } from './sharedPrefillAliases';

describe('levelChangedSharedPrefillAliases', () => {
  const previous = {
    authorizationClientBankAccount: '123456789',
    achAuthorizationAccountHolderBankAccountNumber: '123456789',
    authorizationClientBankRouting: '123456789',
    achAuthorizationAccountHolderBankRoutingNumber: '123456789',
  };

  it('carries a bank number edited on the funding stage onto the account-holder copy', () => {
    const out = levelChangedSharedPrefillAliases(previous, {
      ...previous,
      authorizationClientBankAccount: '12345678',
      authorizationClientBankRouting: '000113333',
    });
    expect(out?.achAuthorizationAccountHolderBankAccountNumber).toBe('12345678');
    expect(out?.achAuthorizationAccountHolderBankRoutingNumber).toBe('000113333');
  });

  it('carries an edit on the account-holder copy back to the funding copy', () => {
    const out = levelChangedSharedPrefillAliases(previous, {
      ...previous,
      achAuthorizationAccountHolderBankAccountNumber: '555',
    });
    expect(out?.authorizationClientBankAccount).toBe('555');
  });

  it('keeps two copies deliberately changed to different values', () => {
    const out = levelChangedSharedPrefillAliases(previous, {
      ...previous,
      authorizationClientBankAccount: '111',
      achAuthorizationAccountHolderBankAccountNumber: '222',
    });
    expect(out?.authorizationClientBankAccount).toBe('111');
    expect(out?.achAuthorizationAccountHolderBankAccountNumber).toBe('222');
  });

  it('leaves untouched groups and other keys alone', () => {
    const incoming = { ...previous, legalName: 'A', authorizationClientName: 'B', foo: 'x' };
    const out = levelChangedSharedPrefillAliases(
      { ...previous, legalName: 'A', authorizationClientName: 'B' },
      incoming,
    );
    expect(out).toEqual(incoming);
  });

  it('never mirrors the business address onto the ACH account-holder address', () => {
    const out = levelChangedSharedPrefillAliases({}, { businessAddress: '1 Main St' });
    expect(out?.achAuthorizationAccountHolderAddress).toBeUndefined();
  });
});
