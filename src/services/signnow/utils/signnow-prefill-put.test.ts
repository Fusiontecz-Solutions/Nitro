import {
  applyContractFillableFont,
  applySignNowFieldStyle,
  copySignNowTemplateStyle,
  CONTRACT_FILLABLE_MIN_HEIGHT,
  canLockSignNowPrefill,
  parseSignNowPrefillValidationField,
  sanitizeSignNowPutFields,
  signNowPrefillTextPayload,
  splitPrefillPutPayload,
  toSignNowCompletedText,
} from './signnow-prefill-put';

describe('signnow-prefill-put', () => {
  it('parses the field name from SignNow prefill validation errors', () => {
    expect(
      parseSignNowPrefillValidationField(
        'Field merchant_contact_phone validation failed.',
      ),
    ).toBe('merchant_contact_phone');
    expect(parseSignNowPrefillValidationField('unrelated error')).toBe('');
  });

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
        font: 'Times New Roman',
        color: '000000',
      }),
    ]);
    expect(toSignNowCompletedText({ type: 'signature', prefilled_text: 'x' })).toBeNull();
  });

  it('bakes filled page 20 ACH values and keeps empty ones fillable for the merchant', () => {
    const split = splitPrefillPutPayload(
      [
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_bank_account_p20',
          prefilled_text: '01714856400',
          page_number: 19,
          required: true,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_username_p20',
          page_number: 19,
          required: true,
          size: 16,
          font_size: 16,
          height: 22,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'Text Field 13',
          page_number: 19,
          required: true,
        },
        {
          type: 'signature',
          role: 'Recipient 1',
          name: 'signature_seller1_p2',
          page_number: 1,
        },
      ],
      true,
      { keepEmptyMerchantRequired: true },
    );
    expect(split.texts).toEqual([
      expect.objectContaining({
        data: '01714856400',
        name: 'ach_bank_account_p20',
        font: 'Times New Roman',
        size: 10,
      }),
    ]);
    expect(split.fields.map((field) => field.name)).toEqual([
      'ach_username_p20',
      'Text Field 13',
      'signature_seller1_p2',
    ]);
    expect(split.fields.filter((field) => field.required === true)).toHaveLength(2);
    const username = split.fields.find((field) => field.name === 'ach_username_p20');
    expect(username?.size).toBe(16);
    expect(username?.font_size).toBe(16);
    expect(username?.height).toBe(22);
  });

  it('uses Times New Roman 10pt for contract prefill fonts', () => {
    expect(applySignNowFieldStyle({ height: 16 }).size).toBe(10);
    expect(applySignNowFieldStyle({ height: 12 }).size).toBe(10);
    expect(applySignNowFieldStyle({ size: 12, height: 20 }).size).toBe(10);
    expect(applySignNowFieldStyle({ size: 14, height: 20 }).size).toBe(10);
    expect(applySignNowFieldStyle({ font: 'Arial', size: 14 }).font).toBe(
      'Times New Roman',
    );
    expect(applySignNowFieldStyle({ size: 12, height: 20 }, {}, { maxSize: 9 }).size).toBe(9);
  });

  it('preserves SignNow template font size instead of forcing 10pt', () => {
    const field = copySignNowTemplateStyle(
      { type: 'text', name: 'purchase_price' },
      { font: 'Times New Roman', size: 16, font_size: 16, height: 22 },
    );
    expect(field.font).toBe('Times New Roman');
    expect(field.size).toBe(16);
    expect(field.font_size).toBe(16);
  });

  it('sizes merchant fillable fields to contract 10pt so typed text is not tiny', () => {
    const field = applyContractFillableFont({
      type: 'text',
      name: 'ach_username_p20',
      height: 8,
      size: 6,
      stretch_mode: 'fit',
      line_height: 4,
    });
    expect(field.font).toBe('Times New Roman');
    expect(field.size).toBe(10);
    expect(field.font_size).toBe(10);
    expect(field.height).toBe(CONTRACT_FILLABLE_MIN_HEIGHT);
    expect(field.stretch_mode).toBeUndefined();
    expect(field.line_height).toBeUndefined();
  });
});
