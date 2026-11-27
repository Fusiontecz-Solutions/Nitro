jest.mock('../../../config/prismaClient', () => ({ __esModule: true, default: {} }));

import {
  readSignNowReviewSnapshot,
  signNowReviewEdits,
  snapshotSignNowWidgetValues,
} from './signnow-review-edits';
import {
  SIGNNOW_REVIEW_EDIT_KEY_PREFIX,
  resolveSignNowPrefillValue,
} from './signnow-field-map';

/** Minimal SignNow document JSON: named widgets, optional linked text element. */
function doc(fields: Array<{ name: string; prefilled?: string; linked?: string; type?: string }>) {
  const texts: any[] = [];
  return {
    texts,
    fields: fields.map((f, i) => {
      const field: any = {
        id: `f${i}`,
        type: f.type ?? 'text',
        json_attributes: { name: f.name, ...(f.prefilled ? { prefilled_text: f.prefilled } : {}) },
      };
      if (f.linked) {
        texts.push({ id: `t${i}`, data: f.linked });
        field.element_id = `t${i}`;
      }
      return field;
    }),
  };
}

describe('snapshotSignNowWidgetValues', () => {
  it('reads prefilled text and values typed into a widget (linked text element)', () => {
    const snap = snapshotSignNowWidgetValues(
      doc([
        { name: 'client_legal_name_p1', prefilled: 'JUAN J MARTINEZ' },
        { name: 'doing_business_as_p1', prefilled: 'JJM TRANSPORATION', linked: 'JJM TRANSPORTATION' },
        { name: 'signature_p1', type: 'signature', prefilled: 'x' },
        { name: 'seller2_name_p1', prefilled: 'Enter text' },
      ]),
    );
    expect(snap).toEqual({
      client_legal_name_p1: 'JUAN J MARTINEZ',
      doing_business_as_p1: 'JJM TRANSPORTATION',
    });
  });
});

describe('signNowReviewEdits', () => {
  const atReview = { total_fees_p1: '9,025.00', client_legal_name_p1: 'JUAN J MARTINEZ' };

  it('returns only widgets changed in SignNow since Review opened', () => {
    expect(
      signNowReviewEdits(atReview, { total_fees_p1: '9,000.00', client_legal_name_p1: 'JUAN J MARTINEZ' }),
    ).toEqual({ total_fees_p1: '9,000.00' });
  });

  it('never treats an unreadable / cleared widget as an edit', () => {
    expect(signNowReviewEdits(atReview, {})).toEqual({});
  });

  it('does nothing without a Review snapshot', () => {
    expect(signNowReviewEdits(null, { total_fees_p1: '1.00' })).toEqual({});
  });
});

describe('readSignNowReviewSnapshot', () => {
  it('only applies to the group Review recorded it for', () => {
    const raw = { groupId: 'g1', documents: { d1: { a: 'b' } } };
    expect(readSignNowReviewSnapshot(raw, 'g1')?.documents.d1).toEqual({ a: 'b' });
    expect(readSignNowReviewSnapshot(raw, 'g2')).toBeNull();
  });
});

describe('a SignNow edit outranks the CRM value at Send', () => {
  it('beats the computed TOTAL FEES', () => {
    const values = { total_fees: '9,025.00', appendix_underwriting_fees: '9,025.00' };
    expect(resolveSignNowPrefillValue('total_fees_p1', values)).not.toBe('9,000.00');
    expect(
      resolveSignNowPrefillValue('total_fees_p1', {
        ...values,
        [`${SIGNNOW_REVIEW_EDIT_KEY_PREFIX}total_fees_p1`]: '9,000.00',
      }),
    ).toBe('9,000.00');
  });

  it('beats a plain CRM field', () => {
    expect(
      resolveSignNowPrefillValue('client_legal_name_p1', {
        client_legal_name: 'JUAN J MARTINEZ',
        [`${SIGNNOW_REVIEW_EDIT_KEY_PREFIX}client_legal_name_p1`]: 'JUAN JOSE MARTINEZ',
      }),
    ).toBe('JUAN JOSE MARTINEZ');
  });
});
