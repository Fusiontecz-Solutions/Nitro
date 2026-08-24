import {
  canLockSignNowPrefill,
  sanitizeSignNowPutFields,
  signNowPrefillTextPayload,
  splitPrefillPutPayload,
  toSignNowCompletedText,
} from './signnow-prefill-put';

describe('signnow-prefill-put', () => {
  it('locks only text fields that already have a value', () => {
    expect(
      canLockSignNowPrefill({
        type: 'text',
        name: 'merchant_contact_name',
        prefilled_text: 'Jane Doe',
      }),
    ).toBe(true);
    expect(
      canLockSignNowPrefill({
        type: 'text',
        name: 'owner2_email',
        lock_to_sign_prefill: true,
      }),
    ).toBe(false);
    expect(
      canLockSignNowPrefill({
        type: 'signature',
        name: 'signature_1',
        prefilled_text: 'x',
      }),
    ).toBe(false);
  });

  it('strips lock_to_sign_prefill from empty Owner slots so SignNow accepts the PUT', () => {
    const out = sanitizeSignNowPutFields([
      {
        type: 'text',
        role: 'Owner',
        name: 'merchant_contact_name',
        prefilled_text: 'Jane Doe',
        lock_to_sign_prefill: true,
      },
      {
        type: 'text',
        role: 'Owner',
        name: 'owner2_email',
        lock_to_sign_prefill: true,
      },
      {
        type: 'signature',
        role: 'Recipient 1',
        name: 'signature_1',
        lock_to_sign_prefill: true,
      },
    ]);
    expect(out[0].lock_to_sign_prefill).toBe(true);
    expect(out[1].lock_to_sign_prefill).toBeUndefined();
    expect(out[1].name).toBe('owner2_email');
    expect(out[2].lock_to_sign_prefill).toBeUndefined();
  });

  it('builds a unique prefill-texts payload from filled fields', () => {
    expect(
      signNowPrefillTextPayload([
        { name: 'merchant_contact_email', prefilled_text: 'a@b.com' },
        { name: 'merchant_contact_email', prefilled_text: 'a@b.com' },
        { name: 'owner2_email' },
        { type: 'signature', name: 'signature_1', prefilled_text: 'x' },
        { type: 'checkbox', name: 'Field Checkbox 1', prefilled_text: '1' },
      ]),
    ).toEqual([{ field_name: 'merchant_contact_email', prefilled_text: 'a@b.com' }]);
  });

  it('stamps filled CRM values as completed texts so merchants see them in view-only', () => {
    const split = splitPrefillPutPayload(
      [
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'merchant_contact_name',
          prefilled_text: 'TEST USER',
          x: 72,
          y: 664,
          page_number: 0,
          height: 12,
          width: 183,
          lock_to_sign_prefill: true,
        },
        {
          type: 'signature',
          role: 'Recipient 1',
          name: 'signature_seller1_p2',
          x: 96,
          y: 445,
          page_number: 1,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'owner2_email',
          x: 10,
          y: 10,
          page_number: 0,
        },
      ],
      true,
    );
    expect(split.fields).toHaveLength(1);
    expect(split.fields[0].type).toBe('signature');
    expect(split.texts).toEqual([
      expect.objectContaining({
        data: 'TEST USER',
        name: 'merchant_contact_name',
        x: 72,
        y: 664,
        page_number: 0,
        font: 'Arial',
        color: '000000',
      }),
    ]);
    expect(toSignNowCompletedText({ type: 'signature', prefilled_text: 'x' })).toBeNull();
  });
});
