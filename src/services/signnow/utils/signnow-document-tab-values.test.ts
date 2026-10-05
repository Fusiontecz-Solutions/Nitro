import {
  buildSignNowDocumentTabValues,
  parseDocumentTemplatePrefillBlob,
  pickSignNowDocumentTabValues,
} from './signnow-document-tab-values';
import { resolveSignNowPrefillValue } from './signnow-field-map';

const FLEX_MAPPING_ID = '4b8f0f32-0000-4000-8000-000000000001';
const PAYOFF_MAPPING_ID = '4b8f0f32-0000-4000-8000-000000000002';
const EXHIBIT_C_MAPPING_ID = '4b8f0f32-0000-4000-8000-000000000003';

const MAPPING_ROWS = [
  { id: FLEX_MAPPING_ID, template: { layoutKey: 'flex_addendum', name: 'Flex Addendum', type: 'addendum' } },
  {
    id: PAYOFF_MAPPING_ID,
    // A funder-specific copy stores its raw SignNow id as the layout key; only
    // the Settings name says which layout it is.
    template: {
      layoutKey: 'f43506d2bed645099045b75bd9abc6f5825e7bf6',
      name: 'PayOff Addendum (Refi)',
      type: 'addendum',
    },
  },
  { id: EXHIBIT_C_MAPPING_ID, template: { layoutKey: 'exhibit_c', name: 'Exhibit C', type: 'addendum' } },
];

const OVERRIDES = {
  documentTemplatePrefillByMappingId: {
    [FLEX_MAPPING_ID]: {
      installment_day_1_p1: '1',
      daily_payment_1_p1: '425.00',
      receivable_purchase_1_p1: '1,200.00',
      installment_day_2_p1: '16',
      daily_payment_2_p1: '',
    },
    [PAYOFF_MAPPING_ID]: { addendum_p_pay_up_to_amount_p1: '3,500.00' },
    [EXHIBIT_C_MAPPING_ID]: { ach_bank_name_p1: 'CHASE' },
  },
};

describe('parseDocumentTemplatePrefillBlob', () => {
  it('returns nothing for a contract with no saved document tabs', () => {
    expect(parseDocumentTemplatePrefillBlob(null)).toEqual({});
    expect(parseDocumentTemplatePrefillBlob({ purchasePrice: '10000' })).toEqual({});
  });
});

describe('buildSignNowDocumentTabValues', () => {
  it('keeps one entry per mapping that has values, dropping blanks', () => {
    const entries = buildSignNowDocumentTabValues(MAPPING_ROWS, OVERRIDES);
    const flex = entries.find((e) => e.mappingId === FLEX_MAPPING_ID);
    expect(flex?.layoutKey).toBe('flex_addendum');
    expect(flex?.values).toEqual({
      installment_day_1_p1: '1',
      daily_payment_1_p1: '425.00',
      receivable_purchase_1_p1: '1,200.00',
      installment_day_2_p1: '16',
    });
  });

  it('resolves a funder-specific template to its real layout key by name', () => {
    const entries = buildSignNowDocumentTabValues(MAPPING_ROWS, OVERRIDES);
    expect(entries.find((e) => e.mappingId === PAYOFF_MAPPING_ID)?.layoutKey).toBe(
      'payoff_addendum',
    );
  });

  it('leaves Exhibit C to the per-copy entity path', () => {
    const entries = buildSignNowDocumentTabValues(MAPPING_ROWS, OVERRIDES);
    expect(entries.some((e) => e.mappingId === EXHIBIT_C_MAPPING_ID)).toBe(false);
  });
});

describe('pickSignNowDocumentTabValues', () => {
  const entries = buildSignNowDocumentTabValues(MAPPING_ROWS, OVERRIDES);

  it('matches the live copy SignNow titles after the funder PDF', () => {
    expect(pickSignNowDocumentTabValues(entries, 'Flex addendum - Nitro Advance')).toMatchObject({
      installment_day_1_p1: '1',
    });
    expect(
      pickSignNowDocumentTabValues(
        entries,
        'Payoff20Addendum2028refi2920-20Nitro20Advance20-20Updated',
      ),
    ).toMatchObject({ addendum_p_pay_up_to_amount_p1: '3,500.00' });
  });

  it('never hands one document another document tab', () => {
    expect(pickSignNowDocumentTabValues(entries, 'Exhibit A - Nitro Advance')).toBeNull();
    expect(pickSignNowDocumentTabValues(entries, 'PCM CONTRACT')).toBeNull();
  });
});

describe('the Flex Addendum installment table reaching SignNow', () => {
  it('resolves each widget from the tab saved against that document', () => {
    const tabs = pickSignNowDocumentTabValues(
      buildSignNowDocumentTabValues(MAPPING_ROWS, OVERRIDES),
      'Flex addendum - Nitro Advance',
    );
    const values = { client_name: 'MARY IRVIN', ...(tabs || {}) };
    expect(resolveSignNowPrefillValue('installment_day_1_p1', values)).toBe('1');
    expect(resolveSignNowPrefillValue('daily_payment_1_p1', values)).toBe('425.00');
    expect(resolveSignNowPrefillValue('receivable_purchase_1_p1', values)).toBe('1,200.00');
    expect(resolveSignNowPrefillValue('installment_day_2_p1', values)).toBe('16');
    // Row 3 was never typed, so it stays the signer's to fill.
    expect(resolveSignNowPrefillValue('installment_day_3_p1', values)).toBe('');
  });
});

describe('the Tiberian Flex Addendum tab reaching SignNow', () => {
  const TIBERIAN_FLEX_MAPPING_ID = '4b8f0f32-0000-4000-8000-000000000004';
  const rows = [
    {
      id: TIBERIAN_FLEX_MAPPING_ID,
      template: {
        layoutKey: '18be4342d4514c3b96b0d9f4852f0af1790fd04d',
        name: 'Flex Addendum',
        type: 'addendum',
      },
    },
  ];
  const overrides = {
    documentTemplatePrefillByMappingId: {
      [TIBERIAN_FLEX_MAPPING_ID]: { net_funds_provided_1: '25,000.00', payment_date_1: '10/01/2026' },
    },
  };

  it('matches the live copy titled "FLEX TIBERIAN FUNDING (1)"', () => {
    const tabs = pickSignNowDocumentTabValues(
      buildSignNowDocumentTabValues(rows, overrides),
      'FLEX TIBERIAN FUNDING (1)',
    );
    expect(tabs).toEqual({ net_funds_provided_1: '25,000.00', payment_date_1: '10/01/2026' });
    expect(resolveSignNowPrefillValue('net_funds_provided_1', tabs || {})).toBe('25,000.00');
  });
});
