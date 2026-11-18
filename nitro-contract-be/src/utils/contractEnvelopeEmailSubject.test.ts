jest.mock('../services/pdf/letterHtmlToPdf.service', () => ({
  sanitizeLetterPdfFilename: (value: string) => `${String(value || 'file').trim()}.pdf`,
}));

import {
  buildContractEnvelopeEmailSubject,
  CONTRACT_ENVELOPE_LENDER_NAME,
  ensureSubjectAmountHasDollarSign,
  extractContractEmailContextFromPrefill,
  formatContractOfferAmountForSubject,
} from './contractEnvelopeEmailSubject';

describe('contract envelope email subject', () => {
  it('formats Selected Funder Business name $Amount without commas', () => {
    expect(
      buildContractEnvelopeEmailSubject('Acme LLC', 25000, 'Obsidian Capital Group'),
    ).toBe('Obsidian Capital Group Acme LLC $25,000.00');
  });

  it('reuses the brand when no selected funder is provided', () => {
    expect(buildContractEnvelopeEmailSubject('Joe Pizza', '10000.5')).toBe(
      `${CONTRACT_ENVELOPE_LENDER_NAME} Joe Pizza $10,000.50`,
    );
  });

  it('falls back to $0.00 when amount is missing', () => {
    expect(formatContractOfferAmountForSubject(null)).toBe('$0.00');
    expect(buildContractEnvelopeEmailSubject('', null, 'Nitro Advance')).toBe(
      'Nitro Advance Business $0.00',
    );
  });

  it('reads approved amount from prefill and ignores purchase amount', () => {
    expect(
      extractContractEmailContextFromPrefill([
        { id: 'client_legal_name', value: 'FUSIONTECZ' },
        { id: 'purchase_amount', value: '50000.00' },
        { id: 'approved_amount', value: '25000.00' },
        { id: 'funder_name', value: 'NITRO ADVANCE' },
      ]),
    ).toEqual({
      businessName: 'FUSIONTECZ',
      offerAmount: '25000.00',
      funderName: 'NITRO ADVANCE',
    });
  });

  it('never reads the owner name as the business name', () => {
    expect(
      extractContractEmailContextFromPrefill([
        { id: 'client_name', value: 'MARY IRVIN' },
        { id: 'approved_amount', value: '20000.00' },
      ]).businessName,
    ).toBeNull();
    expect(
      extractContractEmailContextFromPrefill([
        { id: 'client_name', value: 'MARY IRVIN' },
        { id: 'client_legal_name', value: 'RE-NEW-IT RENOVATIONS, LLC' },
      ]).businessName,
    ).toBe('RE-NEW-IT RENOVATIONS, LLC');
  });

  it('adds a $ sign to a raw caller-supplied subject missing one', () => {
    expect(ensureSubjectAmountHasDollarSign('Nitro Advance Happy nails LLC 12000.00')).toBe(
      'Nitro Advance Happy nails LLC $12000.00',
    );
    expect(ensureSubjectAmountHasDollarSign('Nitro Advance Happy nails LLC $12000.00')).toBe(
      'Nitro Advance Happy nails LLC $12000.00',
    );
    expect(ensureSubjectAmountHasDollarSign('Contract for review')).toBe('Contract for review');
  });
});
