import {
  pickExhibitCCopySlotForVoidCheck,
  setExhibitCEntitySlotFromVoidCheckJson,
} from './contractKycPrefillMapper';

const FUNDING_ACCOUNT = '12345';

describe('pickExhibitCCopySlotForVoidCheck', () => {
  it('never routes a check when the contract has no Exhibit C', () => {
    expect(
      pickExhibitCCopySlotForVoidCheck({
        existingRaw: '',
        copyCount: 0,
        mainBankAccount: FUNDING_ACCOUNT,
        accountNumber: '98765',
      }),
    ).toBeNull();
  });

  it("keeps the deal's first check on the ACH / funding bank, even with an Exhibit C selected", () => {
    expect(
      pickExhibitCCopySlotForVoidCheck({
        existingRaw: '',
        copyCount: 1,
        mainBankAccount: '',
        accountNumber: '98765',
      }),
    ).toBeNull();
  });

  it('keeps a re-scan of the funding check on the funding bank', () => {
    expect(
      pickExhibitCCopySlotForVoidCheck({
        existingRaw: '',
        copyCount: 2,
        mainBankAccount: FUNDING_ACCOUNT,
        accountNumber: FUNDING_ACCOUNT,
      }),
    ).toBeNull();
  });

  it('fills the single Exhibit C with a check for another account', () => {
    expect(
      pickExhibitCCopySlotForVoidCheck({
        existingRaw: '',
        copyCount: 1,
        mainBankAccount: FUNDING_ACCOUNT,
        accountNumber: '98765',
      }),
    ).toBe(0);
  });

  it('fills the first blank Exhibit C when earlier ones already have an account', () => {
    expect(
      pickExhibitCCopySlotForVoidCheck({
        existingRaw: JSON.stringify([{ bankAccount: '55555' }]),
        copyCount: 3,
        mainBankAccount: FUNDING_ACCOUNT,
        accountNumber: '98765',
      }),
    ).toBe(1);
  });

  it('sends a re-scan of an Exhibit C check back to that Exhibit C', () => {
    expect(
      pickExhibitCCopySlotForVoidCheck({
        existingRaw: JSON.stringify([{ bankAccount: '55555' }, { bankAccount: '98765' }]),
        copyCount: 2,
        mainBankAccount: FUNDING_ACCOUNT,
        accountNumber: '98765',
      }),
    ).toBe(1);
  });

  it('routes nowhere once every Exhibit C is filled', () => {
    expect(
      pickExhibitCCopySlotForVoidCheck({
        existingRaw: JSON.stringify([{ bankAccount: '55555' }]),
        copyCount: 1,
        mainBankAccount: FUNDING_ACCOUNT,
        accountNumber: '98765',
      }),
    ).toBeNull();
  });
});

describe('setExhibitCEntitySlotFromVoidCheckJson', () => {
  it('fills only the target Exhibit C and leaves the others untouched', () => {
    const first = { id: 'exhibit-c-1', bankName: 'ABC BANK', bankAccount: '55555' };
    const rows = JSON.parse(
      setExhibitCEntitySlotFromVoidCheckJson(JSON.stringify([first]), 1, {
        accountHolderName: 'XYZ INC',
        bankName: 'XYZ BANK',
        accountNumber: '98765',
        routingNumber: '54321',
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject(first);
    expect(rows[1]).toMatchObject({
      accountHolderName: 'XYZ INC',
      clientLegalName: 'XYZ INC',
      bankName: 'XYZ BANK',
      bankAccount: '98765',
      bankRouting: '54321',
      bankPortal: '',
    });
  });

  it('creates the slot for a single, still-blank Exhibit C', () => {
    const rows = JSON.parse(
      setExhibitCEntitySlotFromVoidCheckJson('', 0, { bankName: 'XYZ BANK', accountNumber: '98765' }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ bankName: 'XYZ BANK', bankAccount: '98765' });
  });
});
