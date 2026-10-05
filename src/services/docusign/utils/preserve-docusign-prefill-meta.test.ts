import { mergePreservingDocuSignEnvelopeMeta } from './preserve-docusign-prefill-meta';

describe('mergePreservingDocuSignEnvelopeMeta — per-document prefill tabs', () => {
  const stored = {
    legalName: 'ACME LLC',
    documentTemplatePrefillByMappingId: {
      'map-exhibit-c-1': { ach_bank_name_p1: 'CHASE' },
      'map-exhibit-c-2': { ach_bank_name_p1: 'WELLS FARGO', client_legal_name_p1: 'SISTER CO' },
      'map-flex': { installment_day_1_p1: '15' },
    },
  };

  it('keeps tabs the save did not carry (a screen that loaded an older blob)', () => {
    const merged = mergePreservingDocuSignEnvelopeMeta(stored, {
      legalName: 'ACME LLC',
      documentTemplatePrefillByMappingId: {
        'map-exhibit-c-1': { ach_bank_name_p1: 'BANK OF AMERICA' },
      },
    });
    expect(merged?.documentTemplatePrefillByMappingId).toEqual({
      'map-exhibit-c-1': { ach_bank_name_p1: 'BANK OF AMERICA' },
      'map-exhibit-c-2': { ach_bank_name_p1: 'WELLS FARGO', client_legal_name_p1: 'SISTER CO' },
      'map-flex': { installment_day_1_p1: '15' },
    });
  });

  it('takes a tab the save names exactly as sent, so a cleared value stays cleared', () => {
    const merged = mergePreservingDocuSignEnvelopeMeta(stored, {
      documentTemplatePrefillByMappingId: {
        'map-exhibit-c-2': { ach_bank_name_p1: '' },
      },
    });
    const blob = merged?.documentTemplatePrefillByMappingId as Record<string, unknown>;
    expect(blob['map-exhibit-c-2']).toEqual({ ach_bank_name_p1: '' });
  });

  it('keeps the whole stored blob when the save omits it', () => {
    const merged = mergePreservingDocuSignEnvelopeMeta(stored, { legalName: 'ACME LLC' });
    expect(merged?.documentTemplatePrefillByMappingId).toEqual(
      stored.documentTemplatePrefillByMappingId,
    );
  });

  it('accepts a first blob when nothing is stored yet', () => {
    const merged = mergePreservingDocuSignEnvelopeMeta(
      { legalName: 'ACME LLC' },
      { documentTemplatePrefillByMappingId: { 'map-flex': { installment_day_1_p1: '1' } } },
    );
    expect(merged?.documentTemplatePrefillByMappingId).toEqual({
      'map-flex': { installment_day_1_p1: '1' },
    });
  });
});
