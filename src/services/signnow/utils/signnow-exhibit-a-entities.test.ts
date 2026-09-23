import {
  EXHIBIT_A_ENTITY_ROWS,
  TIBERIAN_EXHIBIT_A_FIELD_NAMES,
  resolveSignNowPrefillValue,
} from './signnow-field-map';

/**
 * The deal behind the screenshots: one merchant, no additional sellers saved
 * against the contract's Addendum record.
 */
const SINGLE_SELLER: Record<string, string> = {
  client_legal_name: 'Re-New-It Renovations, LLC',
  legal_name: 'Re-New-It Renovations, LLC',
  federal_tax_id_ein: '88-4004575',
  exhibit_a_value_1: 'Re-New-It Renovations, LLC',
  addendum_ein_1: '88-4004575',
  addendum_type_of_entity_1: 'LLC',
};

describe('Exhibit A seller table', () => {
  it('pairs every printed row with the widgets that actually sit on it', () => {
    const named = TIBERIAN_EXHIBIT_A_FIELD_NAMES.map((n) => n.replace(/_p1$/, ''));
    for (const row of EXHIBIT_A_ENTITY_ROWS) {
      expect(named).toContain(row.legalNameKey);
      expect(named).toContain(row.einKey);
      expect(named).toContain(row.entityTypeKey);
    }
    // The legal-name column skips `exhibit_a_value_6`, so from row 6 down it
    // runs one ahead of the EIN column.
    expect(EXHIBIT_A_ENTITY_ROWS[5]).toEqual({
      legalNameKey: 'exhibit_a_value_7',
      einKey: 'addendum_ein_6',
      entityTypeKey: 'addendum_type_of_entity_7',
    });
  });

  it('fills row 1 from the merchant on the deal', () => {
    expect(resolveSignNowPrefillValue('exhibit_a_value_1_p1', SINGLE_SELLER)).toBe(
      'Re-New-It Renovations, LLC',
    );
    expect(resolveSignNowPrefillValue('addendum_ein_1_p1', SINGLE_SELLER)).toBe('88-4004575');
    expect(resolveSignNowPrefillValue('addendum_type_of_entity_1_p1', SINGLE_SELLER)).toBe('LLC');
  });

  it('falls back to the contract legal name and EIN when row 1 was never typed', () => {
    const values = { client_legal_name: 'ACME LLC', federal_tax_id_ein: '11-2223334' };
    expect(resolveSignNowPrefillValue('exhibit_a_value_1_p1', values)).toBe('ACME LLC');
    expect(resolveSignNowPrefillValue('addendum_ein_1_p1', values)).toBe('11-2223334');
  });

  it('leaves every row without a seller of its own completely blank', () => {
    for (const row of EXHIBIT_A_ENTITY_ROWS.slice(1)) {
      expect(resolveSignNowPrefillValue(`${row.legalNameKey}_p1`, SINGLE_SELLER)).toBe('');
      // Regression: these printed the merchant's EIN on all ten rows because
      // `addendum_ein_{n}` matched the generic `ein` / `tax_id` fallback chain.
      expect(resolveSignNowPrefillValue(`${row.einKey}_p1`, SINGLE_SELLER)).toBe('');
      expect(resolveSignNowPrefillValue(`${row.entityTypeKey}_p1`, SINGLE_SELLER)).toBe('');
    }
  });

  it('prints an additional seller with its own EIN, never the merchant fallback', () => {
    const values = {
      ...SINGLE_SELLER,
      exhibit_a_value_2: 'Irvin Holdings LLC',
      addendum_type_of_entity_2: 'LLC',
    };
    expect(resolveSignNowPrefillValue('exhibit_a_value_2_p1', values)).toBe('Irvin Holdings LLC');
    expect(resolveSignNowPrefillValue('addendum_type_of_entity_2_p1', values)).toBe('LLC');
    expect(resolveSignNowPrefillValue('addendum_ein_2_p1', values)).toBe('');

    const withEin = { ...values, addendum_ein_2: '99-1112223' };
    expect(resolveSignNowPrefillValue('addendum_ein_2_p1', withEin)).toBe('99-1112223');
  });

  it('still fills the page header and signature block through the normal chain', () => {
    expect(resolveSignNowPrefillValue('client_legal_name_p1', SINGLE_SELLER)).toBe(
      'Re-New-It Renovations, LLC',
    );
  });
});
