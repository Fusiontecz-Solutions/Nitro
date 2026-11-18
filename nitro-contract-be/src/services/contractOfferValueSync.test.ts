import {
  applyOfferDerivedValuesToContractRow,
  resolveOfferDerivedContractValues,
  stripStaleOfferOverrides,
} from './contractOfferValueSync';

describe('stripStaleOfferOverrides', () => {
  it('drops offer-derived money keys so the refreshed columns win the prefill', () => {
    const { next, changed } = stripStaleOfferOverrides({
      purchaseAmount: '10000.00',
      purchasePrice: '14990.00',
      remittance: '999.33',
      disclosure_amount_financed: '8,975.00',
      legalName: 'RE-NEW-IT RENOVATIONS, LLC',
    });
    expect(changed).toBe(true);
    expect(next).toEqual({ legalName: 'RE-NEW-IT RENOVATIONS, LLC' });
  });

  it('keeps non-offer fields (bank details, names) untouched', () => {
    const overrides = {
      achBankName: 'JP Morgan',
      authorizationClientBankRouting: '20032003',
    };
    const { next, changed } = stripStaleOfferOverrides(overrides);
    expect(changed).toBe(false);
    expect(next).toEqual(overrides);
  });

  it('tolerates a missing or non-object overrides column', () => {
    expect(stripStaleOfferOverrides(null)).toEqual({ next: {}, changed: false });
    expect(stripStaleOfferOverrides(['nope'])).toEqual({ next: {}, changed: false });
  });
});

describe('resolveOfferDerivedContractValues', () => {
  it('derives every document value from the live offer', () => {
    const derived = resolveOfferDerivedContractValues({
      offer: 10000,
      totalRemit: 14990,
      term: '15',
      frequency: 'Weekly',
      repayPerPeriod: 999.33,
      fees: 1000,
    });
    expect(derived).toEqual({
      approvedAmount: 10000,
      totalAmount: 14990,
      termDays: 15,
      // A "15" weekly term is 15 weeks, so the disclosure's estimated term is
      // 105 calendar days rather than the 15 payment periods above.
      disclosureTermDays: 105,
      // Only a refi carries a previous balance; this one is a new deal.
      refinanceAmount: null,
      purchaseAmount: '10000',
      purchasePrice: '14990',
      remittance: '999.33',
      appendixUnderwritingFees: '1000',
      frequency: 'Weekly',
    });
  });

  it('falls back to payback / term when the offer carries no per-period amount', () => {
    const derived = resolveOfferDerivedContractValues({
      totalRemit: 15000,
      term: '15',
    });
    expect(derived?.remittance).toBe('1000');
  });

  it('reads a percent-style fee as a percentage of the funded amount', () => {
    const derived = resolveOfferDerivedContractValues({ offer: 10000, fees: 10 });
    expect(derived?.appendixUnderwritingFees).toBe('1000');
  });
});

describe('applyOfferDerivedValuesToContractRow', () => {
  const offer = {
    offer: 12000,
    totalRemit: 18000,
    term: '20',
    frequency: 'Daily',
    repayPerPeriod: 900,
    fees: 1200,
  };

  it('replaces the stale contract snapshot with the current offer', () => {
    const row = applyOfferDerivedValuesToContractRow({
      offer,
      approvedAmount: 10000,
      totalAmount: 14990,
      contractLenght: 15,
      purchaseAmount: '10000.00',
      purchasePrice: '14990.00',
      remittance: '999.33',
      appendixUnderwritingFees: '1000.00',
      contractPrefillOverrides: { remittance: '999.33', legalName: 'ACME LLC' },
    }) as Record<string, unknown>;

    expect(row.approvedAmount).toBe(12000);
    expect(row.totalAmount).toBe(18000);
    expect(row.contractLenght).toBe(20);
    expect(row.purchaseAmount).toBe('12000');
    expect(row.purchasePrice).toBe('18000');
    expect(row.remittance).toBe('900');
    expect(row.appendixUnderwritingFees).toBe('1200');
    expect(row.contractPrefillOverrides).toEqual({ legalName: 'ACME LLC' });
  });

  it('heals the ACH and addendum rows returned alongside the contract', () => {
    const row = applyOfferDerivedValuesToContractRow({
      offer,
      achs: [{ id: 1, paymentAmount: '10000.00', frequency: 'Weekly', bankName: 'JP Morgan' }],
      addendums: [{ id: 2, principalOwnerAmount1: '10000.00', principalOwnerAmount2: '14990.00' }],
    }) as Record<string, any>;

    expect(row.achs[0]).toMatchObject({
      paymentAmount: '12000',
      frequency: 'Daily',
      bankName: 'JP Morgan',
    });
    expect(row.addendums[0]).toMatchObject({
      principalOwnerAmount1: '12000',
      principalOwnerAmount2: '18000',
    });
  });

  it('leaves the row untouched when the contract has no offer loaded', () => {
    const row = { approvedAmount: 10000, purchaseAmount: '10000.00' };
    expect(applyOfferDerivedValuesToContractRow(row)).toBe(row);
  });
});
