import {
  buildSignNowDocumentPrefillTexts,
  signNowPrefillDocumentKind,
  resolveSignNowPrefillValue,
} from './signnow-field-map';

/** Real widget names on the live "ACH weekly" template (document 136150ac…). */
const ACH_WEEKLY_FIELDS = [
  'client_name_p1_ach',
  'remittance_p1_ach',
  'remittance_start_date_p1_ach',
  'purchase_amount_p1_ach',
  'business_address_p1_ach',
  'merchant_contact_phone_p1_ach',
  'merchant_contact_email_p1_ach',
  'ach_account_holder_name_p1_ach',
  'ach_bank_name_p1_ach',
  'ach_bank_account_p1_ach',
  'ach_bank_routing_p1_ach',
  'Text Field 1',
  'signature_date_p1_ach',
];

const PREFILL: Record<string, string> = {
  client_name: 'MONIKA SARAFYAN',
  agreement_date: '09/15/2026',
  funding_provided: '8,975.00',
  disclosure_amount_financed: '8,975.00',
  purchase_amount: '25,000.00',
  remittance: '1,250.00',
  remittance_start_date: '09/22/2026',
  ach_bank_name: 'CHASE',
  ach_bank_account: '725307998',
  ach_bank_routing: '322271627',
};

function byName(fields: Array<{ field_name: string; prefilled_text: string }>) {
  const out: Record<string, string> = {};
  for (const f of fields) out[f.field_name] = f.prefilled_text;
  return out;
}

describe('ACH Weekly bottom-section field mapping', () => {
  it('detects the ACH Weekly document kind from its field names', () => {
    expect(signNowPrefillDocumentKind('ACH weekly', ACH_WEEKLY_FIELDS)).toBe('ach_weekly');
    expect(signNowPrefillDocumentKind(undefined, ACH_WEEKLY_FIELDS)).toBe('ach_weekly');
  });

  it('puts the DATE in the Date box (template widget "Text Field 1")', () => {
    const map = byName(buildSignNowDocumentPrefillTexts(ACH_WEEKLY_FIELDS, PREFILL));
    expect(map['Text Field 1']).toBe('09/15/2026');
    // The regression: the CA-disclosure alias used to put an amount here.
    expect(map['Text Field 1']).not.toBe('8,975.00');
  });

  it('puts the PRINTED NAME in the Printed Names box (widget "signature_date_p1_ach")', () => {
    const map = byName(buildSignNowDocumentPrefillTexts(ACH_WEEKLY_FIELDS, PREFILL));
    expect(map.signature_date_p1_ach).toBe('MONIKA SARAFYAN');
    // The regression: this widget's name made it receive a date.
    expect(map.signature_date_p1_ach).not.toBe('09/15/2026');
  });

  it('no bottom value is shifted into another bottom field', () => {
    const map = byName(buildSignNowDocumentPrefillTexts(ACH_WEEKLY_FIELDS, PREFILL));
    expect(map['Text Field 1']).not.toBe(map.signature_date_p1_ach);
  });

  it('leaves the rest of the ACH Weekly map intact', () => {
    const map = byName(buildSignNowDocumentPrefillTexts(ACH_WEEKLY_FIELDS, PREFILL));
    expect(map.client_name_p1_ach).toBe('MONIKA SARAFYAN');
    expect(map.remittance_p1_ach).toBe('1,250.00');
    // Pre-existing rule (resolveRemittanceStartDate): "Starting On" always
    // follows the agreement date, so it ignores the passed remittance_start_date.
    // Unchanged by this fix; asserted so the bottom-section work cannot alter it.
    expect(map.remittance_start_date_p1_ach).toBe('09/15/2026');
    expect(map.ach_bank_name_p1_ach).toBe('CHASE');
    expect(map.ach_bank_account_p1_ach).toBe('725307998');
    expect(map.ach_bank_routing_p1_ach).toBe('322271627');
  });

  it('does not change "Text Field 1" on a California disclosure', () => {
    // Same widget name, different document: the disclosure amount must survive.
    const disclosureFields = ['Text Field 1', 'Text Field 2', 'Text Field 3'];
    const map = byName(buildSignNowDocumentPrefillTexts(disclosureFields, PREFILL));
    expect(map['Text Field 1']).toBe('8,975.00');
  });

  it('does not apply ACH Weekly routing to Exhibit C or ACH Daily widgets', () => {
    expect(
      resolveSignNowPrefillValue('signature_date_p1_ach', PREFILL, {
        documentKind: 'exhibit_c',
      }),
    ).not.toBe('MONIKA SARAFYAN');
    // ACH Daily has a properly named printed-name widget and needs no remap.
    expect(
      resolveSignNowPrefillValue('authorization_client_name_print_p1_ach', PREFILL),
    ).toBe('MONIKA SARAFYAN');
  });
});
