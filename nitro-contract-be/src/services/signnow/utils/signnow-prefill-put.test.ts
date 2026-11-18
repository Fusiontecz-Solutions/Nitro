import {
  collectOwnerReviewEdits,
  applyContractFillableFont,
  applySignNowFieldStyle,
  applySignNowSignatureFieldFont,
  hasSignNowSignatureFieldFont,
  SIGNATURE_FIELD_FONT,
  SIGNATURE_FIELD_FONT_SIZE,
  SIGNATURE_FIELD_HEIGHT,
  withoutSignNowSignatureFieldFont,
  copySignNowTemplateStyle,
  CONTRACT_FILLABLE_MIN_HEIGHT,
  FILLABLE_FONT_SIZE,
  canLockSignNowPrefill,
  clearExhibitCCopyLabels,
  nameExhibitCCopyFieldsForReview,
  normalizeExhibitCCopyFieldNames,
  stripExhibitCCopyFieldName,
  parseSignNowPrefillValidationField,
  sanitizeSignNowPutFields,
  signNowPrefillTextPayload,
  splitPrefillPutPayload,
  toSignNowCompletedText,
  toSignNowCompletedTexts,
  measureSignNowTextWidth,
  wrapSignNowText,
} from './signnow-prefill-put';
import {
  collectCommittedSignNowTexts,
  dropBakedTextsAlreadyStamped,
  dropOverlappingDuplicateTexts,
  isSameSignNowTextSpot,
  mergeCommittedSignNowTexts,
} from './signnow-prefill-put';
import { CONTRACT_P22_REQUIRED_UNIQUE_NAMES } from './signnow-field-map';

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
    expect(username?.font).toBe('Times New Roman');
    expect(username?.size).toBe(FILLABLE_FONT_SIZE);
    expect(username?.font_size).toBe(FILLABLE_FONT_SIZE);
    expect(username?.height).toBe(CONTRACT_FILLABLE_MIN_HEIGHT);
  });

  it('keeps empty Exhibit C orange fields fillable for the merchant', () => {
    const split = splitPrefillPutPayload(
      [
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_bank_name_p1',
          prefilled_text: 'Chase',
          page_number: 0,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_username_p1',
          page_number: 0,
          required: true,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_account_holder_name_p1',
          page_number: 0,
          required: true,
        },
        {
          type: 'signature',
          role: 'Recipient 1',
          name: 'signature_seller1_p1',
          page_number: 0,
        },
      ],
      true,
      { keepEmptyMerchantRequired: true, documentKind: 'exhibit_c' },
    );
    expect(split.texts).toEqual([
      expect.objectContaining({
        data: 'Chase',
        name: 'ach_bank_name_p1',
      }),
    ]);
    expect(split.fields.map((field) => field.name)).toEqual([
      'ach_username_p1',
      'ach_account_holder_name_p1',
      'signature_seller1_p1',
    ]);
    expect(split.fields.filter((field) => field.required === true)).toHaveLength(2);
  });

  it('keeps empty page-1 bank widgets fillable on the main agreement', () => {
    const split = splitPrefillPutPayload(
      [
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_bank_name_p1',
          prefilled_text: 'TEST BANK',
          page_number: 0,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_bank_portal_p1',
          page_number: 0,
          required: true,
          size: 6,
          height: 8,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_username_p1',
          page_number: 0,
          required: true,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_password_p1',
          page_number: 0,
          required: true,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_security_q1_p1',
          page_number: 0,
          required: true,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ach_account_holder_name_p1',
          page_number: 0,
          required: true,
        },
      ],
      true,
      { keepEmptyMerchantRequired: true },
    );
    expect(split.texts).toEqual([
      expect.objectContaining({
        data: 'TEST BANK',
        name: 'ach_bank_name_p1',
        font: 'Times New Roman',
        size: 10,
      }),
    ]);
    expect(split.fields.map((field) => field.name)).toEqual([
      'ach_bank_portal_p1',
      'ach_username_p1',
      'ach_password_p1',
      'ach_security_q1_p1',
      'ach_account_holder_name_p1',
    ]);
    expect(split.fields.filter((field) => field.required === true)).toHaveLength(5);
    const portal = split.fields.find((field) => field.name === 'ach_bank_portal_p1');
    expect(portal?.font).toBe('Times New Roman');
    expect(portal?.size).toBe(FILLABLE_FONT_SIZE);
    expect(portal?.height).toBe(CONTRACT_FILLABLE_MIN_HEIGHT);
  });

  it('keeps every dedicated Exhibit C unique name fillable for Signer 1', () => {
    const names = [
      'ach_account_holder_name_p1',
      'ach_bank_portal_p1',
      'ach_username_p1',
      'ach_password_p1',
      'ach_security_q1_p1',
      'ach_security_q2_p1',
    ];
    const split = splitPrefillPutPayload(
      names.map((name) => ({
        type: 'text',
        role: 'Recipient 1',
        name,
        page_number: 1,
        required: true,
      })),
      true,
      { keepEmptyMerchantRequired: true },
    );
    expect(split.texts).toEqual([]);
    expect(split.fields.map((field) => field.name)).toEqual(names);
    expect(split.fields.every((field) => field.required === true)).toBe(true);
    expect(split.fields.every((field) => field.font === 'Times New Roman')).toBe(true);
    expect(split.fields.every((field) => field.size === FILLABLE_FONT_SIZE)).toBe(true);
  });

  it('keeps empty page 22 reference fields fillable without enlarging the contract face', () => {
    const split = splitPrefillPutPayload(
      [
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'ref_personal1_name_p22',
          page_number: 21,
          required: true,
          size: 8,
          font_size: 8,
          height: 12,
          width: 180,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'Text Field 22',
          page_number: 21,
          required: true,
          size: 8,
          font_size: 8,
          height: 12,
          width: 140,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'emergency_email_p22',
          page_number: 21,
          required: true,
          size: 8,
          height: 12,
        },
        {
          type: 'text',
          role: 'Recipient 1',
          name: 'landlord_company_p22',
          prefilled_text: 'Main Street LLC',
          page_number: 21,
        },
        {
          type: 'signature',
          role: 'Recipient 1',
          name: 'signature_seller1_p22',
          page_number: 21,
        },
      ],
      true,
      { keepEmptyMerchantRequired: true },
    );
    expect(split.texts).toEqual([
      expect.objectContaining({
        data: 'Main Street LLC',
        name: 'landlord_company_p22',
      }),
    ]);
    expect(split.fields.map((field) => field.name)).toEqual([
      'ref_personal1_name_p22',
      'Text Field 22',
      'emergency_email_p22',
      'signature_seller1_p22',
    ]);
    expect(split.fields.filter((field) => field.required === true)).toHaveLength(3);
    const personal = split.fields.find((field) => field.name === 'ref_personal1_name_p22');
    expect(personal?.size).toBe(8);
    expect(personal?.font_size).toBe(8);
    expect(personal?.height).toBe(12);
    expect(personal?.width).toBe(180);
    const textField22 = split.fields.find((field) => field.name === 'Text Field 22');
    expect(textField22?.size).toBe(8);
    expect(textField22?.height).toBe(12);
  });

  it('keeps every dedicated page 22 unique name fillable and required for Signer 1', () => {
    const names = [
      ...CONTRACT_P22_REQUIRED_UNIQUE_NAMES,
      'Text Field 22',
    ];
    const split = splitPrefillPutPayload(
      names.map((name) => ({
        type: 'text',
        role: 'Recipient 1',
        name,
        page_number: 21,
        required: true,
        size: 8,
        height: 14,
        width: 160,
      })),
      true,
      { keepEmptyMerchantRequired: true },
    );
    expect(split.texts).toEqual([]);
    expect(split.fields.map((field) => field.name)).toEqual(names);
    expect(split.fields.every((field) => field.required === true)).toBe(true);
    expect(split.fields.every((field) => field.size === 8)).toBe(true);
    expect(split.fields.every((field) => field.height === 14)).toBe(true);
    expect(split.fields.every((field) => field.width === 160)).toBe(true);
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

  it('sizes merchant fillable fields to the addendum 16pt face', () => {
    const field = applyContractFillableFont({
      type: 'text',
      name: 'ach_username_p20',
      height: 8,
      size: 6,
      stretch_mode: 'fit',
      line_height: 4,
    });
    expect(field.font).toBe('Times New Roman');
    expect(field.size).toBe(FILLABLE_FONT_SIZE);
    expect(field.font_size).toBe(FILLABLE_FONT_SIZE);
    expect(field.height).toBe(CONTRACT_FILLABLE_MIN_HEIGHT);
    expect(field.valign).toBe('middle');
    expect(field.stretch_mode).toBeUndefined();
    expect(field.line_height).toBeUndefined();
    expect((field.json_attributes as { size?: number })?.size).toBe(FILLABLE_FONT_SIZE);
  });
});

describe('splitPrefillPutPayload required fields', () => {
  const merchantOpts = { keepEmptyMerchantRequired: true };

  it('keeps an empty template-required field fillable so SignNow can enforce it', () => {
    const field = {
      type: 'text',
      name: 'addendum_owner_title',
      role: 'Recipient 1',
      required: true,
      page_number: 0,
      x: 10,
      y: 10,
    };
    const out = splitPrefillPutPayload([field], true, merchantOpts);
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0].name).toBe('addendum_owner_title');
    expect(out.texts).toHaveLength(0);
  });

  it('shows an empty optional field without making it required', () => {
    // The template placed this widget for the signer, so it stays visible — but
    // the flag is carried through as-is, so it never blocks Finish.
    const field = {
      type: 'text',
      name: 'addendum_optional_note',
      role: 'Recipient 1',
      required: false,
      page_number: 0,
      x: 10,
      y: 10,
    };
    const out = splitPrefillPutPayload([field], true, merchantOpts);
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0].required).toBe(false);
    expect(out.texts).toHaveLength(0);
  });

  it('bakes a filled required field as text rather than re-asking for it', () => {
    const field = {
      type: 'text',
      name: 'addendum_owner_title',
      role: 'Recipient 1',
      required: true,
      prefilled_text: 'Managing Member',
      page_number: 0,
      x: 10,
      y: 10,
    };
    const out = splitPrefillPutPayload([field], true, merchantOpts);
    expect(out.fields).toHaveLength(0);
    expect(out.texts).toHaveLength(1);
    expect(out.texts[0].data).toBe('Managing Member');
  });
});

describe('splitPrefillPutPayload signer-assigned blank widgets', () => {
  const merchantOpts = { keepEmptyMerchantRequired: true, ownerRole: 'Owner' };

  it('keeps a generic Text widget the template assigned to Recipient 1', () => {
    // The page-22 reference slots are plain `Text Field N` widgets: they match
    // no merchant-required name and SignNow reports no `required` flag, so they
    // were deleted from the signer's copy and arrived as bare underlines.
    const field = {
      type: 'text',
      name: 'Text Field 45',
      role: 'Recipient 1',
      page_number: 22,
      x: 10,
      y: 10,
    };
    const out = splitPrefillPutPayload([field], true, merchantOpts);
    expect(out.fields).toHaveLength(1);
    expect(out.fields[0].name).toBe('Text Field 45');
    expect(out.texts).toHaveLength(0);
  });

  it('carries the template required flag through untouched', () => {
    const required = {
      type: 'text', name: 'Text Field 46', role: 'Recipient 1',
      required: true, page_number: 22, x: 10, y: 10,
    };
    const optional = {
      type: 'text', name: 'Text Field 47', role: 'Recipient 1',
      required: false, page_number: 22, x: 10, y: 10,
    };
    const out = splitPrefillPutPayload([required, optional], true, merchantOpts);
    expect(out.fields).toHaveLength(2);
    expect(out.fields[0].required).toBe(true);
    expect(out.fields[1].required).toBe(false);
  });

  it('still drops a blank widget the CRM role holds', () => {
    const field = {
      type: 'text', name: 'internal_note', role: 'Owner',
      page_number: 1, x: 10, y: 10,
    };
    const out = splitPrefillPutPayload([field], true, merchantOpts);
    expect(out.fields).toHaveLength(0);
    expect(out.texts).toHaveLength(0);
  });

  it('keeps the Notification of Assignment merchant list blank', () => {
    const field = {
      type: 'text', name: 'assignment_merchant_line1', role: 'Recipient 1',
      page_number: 1, x: 10, y: 10,
    };
    const out = splitPrefillPutPayload([field], true, merchantOpts);
    expect(out.fields).toHaveLength(0);
  });
});

describe('committed page text on a re-publish', () => {
  const stamp = (data: string, y: number, id = `id-${data}`) => ({
    id,
    data,
    x: 197,
    y,
    page_number: 0,
    font: 'Times New Roman',
    size: 10,
  });

  it('reads the stamps an earlier publish left on the page', () => {
    const committed = collectCommittedSignNowTexts({
      texts: [stamp('RE-NEW-IT RENOVATIONS, LLC', 338), stamp('  ', 362), { data: 'x' }],
    });
    expect(committed.map((row) => row.data)).toEqual(['RE-NEW-IT RENOVATIONS, LLC', 'x']);
    expect(committed[0]).toMatchObject({ id: 'id-RE-NEW-IT RENOVATIONS, LLC', y: 338 });
  });

  it('treats anchors a few points apart as the same line', () => {
    expect(isSameSignNowTextSpot({ page_number: 0, x: 197, y: 338 }, { page_number: 0, x: 199, y: 340 })).toBe(true);
    expect(isSameSignNowTextSpot({ page_number: 0, x: 197, y: 338 }, { page_number: 0, x: 197, y: 362 })).toBe(false);
    expect(isSameSignNowTextSpot({ page_number: 0, x: 197, y: 338 }, { page_number: 1, x: 197, y: 338 })).toBe(false);
  });

  it('keeps one value per spot so Exhibit C (2) cannot stack over Exhibit C', () => {
    const committed = collectCommittedSignNowTexts({
      texts: [stamp('RE-NEW-IT RENOVATIONS, LLC', 338), stamp('JP MORGAN', 472)],
    });
    const merged = mergeCommittedSignNowTexts(
      [{ data: 'FUSIONTECZ', x: 197, y: 338, page_number: 0 }],
      committed,
    );
    expect(merged.map((row) => row.data)).toEqual(['FUSIONTECZ', 'JP MORGAN']);
  });

  it('drops an old stamp on a spot this send holds a widget for, even with nothing baked there', () => {
    const committed = collectCommittedSignNowTexts({ texts: [stamp('$100,000.00', 338)] });
    const merged = mergeCommittedSignNowTexts([], committed, {
      ownedSpots: [{ page_number: 0, x: 197, y: 338 }],
    });
    expect(merged).toEqual([]);
  });

  it('still accepts a bare tolerance argument', () => {
    const committed = collectCommittedSignNowTexts({ texts: [stamp('JP MORGAN', 472)] });
    expect(mergeCommittedSignNowTexts([], committed, 6)).toHaveLength(1);
  });

  it('carries an uncovered stamp forward without its id, since the clear drops every text', () => {
    const committed = collectCommittedSignNowTexts({ texts: [stamp('3273 COVE CREEK ROAD', 388)] });
    const merged = mergeCommittedSignNowTexts([], committed);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ data: '3273 COVE CREEK ROAD', y: 388 });
    expect(merged[0]).not.toHaveProperty('id');
  });

  /**
   * Live Obsidian group 1972bc76…: the page-1 money row drifted a few points
   * between sends, so the same amount sat twice on one line. The baked widget is
   * gone from `fields` by then, so `ownedSpots` cannot recognise the old anchor.
   */
  it('does not carry forward the previous copy of a value this send re-bakes', () => {
    const committed = collectCommittedSignNowTexts({
      texts: [
        { id: 't1', data: '10,000.00', x: 69, y: 381, page_number: 1 },
        { id: 't2', data: '14,990.00', x: 145, y: 383, page_number: 1 },
        { id: 't3', data: '19', x: 248, y: 382, page_number: 1 },
      ],
    });
    const merged = mergeCommittedSignNowTexts(
      [
        { data: '10,000.00', x: 63, y: 379, page_number: 1 },
        { data: '14,990.00', x: 153, y: 379, page_number: 1 },
        { data: '19', x: 233, y: 379, page_number: 1 },
      ],
      committed,
      { ownedSpots: [] },
    );
    expect(merged).toHaveLength(3);
    expect(merged.map((row) => row.x)).toEqual([63, 153, 233]);
  });

  it('keeps a repeat of one value that belongs on its own column', () => {
    const committed = collectCommittedSignNowTexts({
      texts: [{ id: 't1', data: '$', x: 137, y: 379, page_number: 1 }],
    });
    const merged = mergeCommittedSignNowTexts(
      [{ data: '$', x: 45, y: 379, page_number: 1 }],
      committed,
      { ownedSpots: [] },
    );
    expect(merged.map((row) => row.x)).toEqual([45, 137]);
  });

  it('drops values the page already carries when the clear was refused', () => {
    const committed = collectCommittedSignNowTexts({
      texts: [
        { id: 't1', data: '10,000.00', x: 69, y: 381, page_number: 1 },
        { id: 't2', data: 'PUNEET MEENA', x: 197, y: 337, page_number: 0 },
      ],
    });
    const kept = dropBakedTextsAlreadyStamped(
      [
        { data: '10,000.00', x: 63, y: 379, page_number: 1 },
        { data: 'RE-NEW-IT RENOVATIONS, LLC', x: 194, y: 362, page_number: 0 },
      ],
      committed,
    );
    expect(kept.map((row) => row.data)).toEqual(['RE-NEW-IT RENOVATIONS, LLC']);
  });
});

describe('dropOverlappingDuplicateTexts', () => {
  it('collapses two stacked widgets carrying the same value (Obsidian SPECIFIED PERCENTAGE)', () => {
    const kept = dropOverlappingDuplicateTexts([
      { data: '10', x: 402, y: 381, page_number: 0 },
      { data: '10', x: 419, y: 384, page_number: 0 },
    ]);
    expect(kept.map((row) => row.x)).toEqual([402]);
  });

  it('keeps repeats of one value that sit apart on the same line', () => {
    const kept = dropOverlappingDuplicateTexts([
      { data: '$', x: 69, y: 381, page_number: 0 },
      { data: '$', x: 268, y: 381, page_number: 0 },
    ]);
    expect(kept).toHaveLength(2);
  });

  it('keeps the same value on different lines and different pages', () => {
    const kept = dropOverlappingDuplicateTexts([
      { data: '09/21/2026', x: 120, y: 700, page_number: 0 },
      { data: '09/21/2026', x: 120, y: 660, page_number: 0 },
      { data: '09/21/2026', x: 120, y: 700, page_number: 3 },
    ]);
    expect(kept).toHaveLength(3);
  });

  it('never drops a different value stamped nearby', () => {
    const kept = dropOverlappingDuplicateTexts([
      { data: '10', x: 402, y: 381, page_number: 0 },
      { data: '12', x: 419, y: 384, page_number: 0 },
    ]);
    expect(kept).toHaveLength(2);
  });

  it('bakes one text when two overlapping fields hold the same CRM value', () => {
    const split = splitPrefillPutPayload(
      [
        {
          type: 'text',
          name: 'purchase_percent',
          prefilled_text: '10',
          x: 402,
          y: 381,
          page_number: 0,
          width: 30,
          height: 12,
        },
        {
          type: 'text',
          name: 'Text Field 25',
          prefilled_text: '10',
          x: 419,
          y: 384,
          page_number: 0,
          width: 30,
          height: 12,
        },
      ],
      true,
    );
    expect(split.texts).toHaveLength(1);
  });
  it('wraps a baked address onto the lines its widget box allows', () => {
    // Owner #1 address widget on the Nitro / Obsidian / Tiberian contract page.
    const rows = toSignNowCompletedTexts({
      type: 'text',
      name: 'guarantor_address',
      prefilled_text: '3205 COVE CREEK ROAD, GWALIOR, NORTH CAROLINA 28078',
      x: 121,
      y: 659,
      page_number: 1,
      width: 203,
      height: 60,
    });
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      expect(
        measureSignNowTextWidth(String(row.data), Number(row.size)),
      ).toBeLessThanOrEqual(203);
      expect(row.x).toBe(121);
      expect(row.page_number).toBe(1);
    }
    // Nothing is dropped, and the lines run down the box in order.
    expect(rows.map((row) => row.data).join(' ')).toBe(
      '3205 COVE CREEK ROAD, GWALIOR, NORTH CAROLINA 28078',
    );
    expect(Number(rows[0].y)).toBe(659);
    expect(Number(rows[1].y)).toBeGreaterThan(659);
    expect(Number(rows[rows.length - 1].y)).toBeLessThanOrEqual(659 + 60);
  });

  it('shrinks a baked value that has to stay on one line', () => {
    const rows = toSignNowCompletedTexts({
      type: 'text',
      name: 'ach_account_holder_address_p19',
      prefilled_text:
        '12345 SOUTHWEST DELAWAKRE PARKWAY, APT 2201, KANSAS CITY, KANSAS, 66109',
      x: 249,
      y: 385,
      page_number: 18,
      width: 200,
      height: 13,
    });
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].size)).toBeLessThan(10);
  });

  it('leaves a value that already fits exactly as it was', () => {
    const field = {
      type: 'text',
      name: 'merchant_contact_name',
      prefilled_text: 'MARY IRVIN',
      x: 100,
      y: 200,
      page_number: 0,
      width: 203,
      height: 14,
    };
    expect(toSignNowCompletedTexts(field)).toEqual([
      toSignNowCompletedText(field),
    ]);
  });

  it('breaks an unbroken run of characters rather than letting it overflow', () => {
    const lines = wrapSignNowText('A'.repeat(80), 60, 10);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measureSignNowTextWidth(line, 10)).toBeLessThanOrEqual(60);
    }
    expect(lines.join('')).toBe('A'.repeat(80));
  });
});

describe('nameExhibitCCopyFieldsForReview', () => {
  it('gives a copy unique widget names, leaving signatures and values alone', () => {
    const fields: Record<string, unknown>[] = [
      { type: 'text', name: 'business_name', prefilled_text: 'Acme 2' },
      { type: 'text', name: 'Text Field 3' },
      { type: 'text', name: 'bank_name', json_attributes: { label: 'Bank' }, label: 'Bank' },
      { type: 'signature', name: 'merchant_signature', label: 'Sign' },
    ];
    expect(nameExhibitCCopyFieldsForReview(fields, 2)).toBe(3);
    expect(fields.map((f) => f.name)).toEqual([
      'business_name__copy2',
      'Text Field 3__copy2',
      'bank_name__copy2',
      'merchant_signature',
    ]);
    // Real labels are kept; nothing is appended that SignNow would show as a placeholder.
    expect(fields[2].label).toBe('Bank');
    expect(fields[0].label).toBeUndefined();
    expect(fields[0].prefilled_text).toBe('Acme 2');
  });

  it('does not stack suffixes on a reused draft', () => {
    const fields: Record<string, unknown>[] = [{ type: 'text', name: 'dba__copy3' }];
    nameExhibitCCopyFieldsForReview(fields, 3);
    expect(fields[0].name).toBe('dba__copy3');
  });

  it('removes the (copy N) placeholder label an earlier build wrote', () => {
    const fields: Record<string, unknown>[] = [
      {
        type: 'text',
        name: 'ach_bank_portal_p1',
        label: 'ach_bank_portal_p1 (copy 2)',
        json_attributes: { label: 'ach_bank_portal_p1 (copy 2)' },
      },
      { type: 'text', name: 'bank', label: 'Bank (copy 2)' },
    ];
    expect(clearExhibitCCopyLabels(fields)).toBe(2);
    expect(fields[0].label).toBeUndefined();
    expect((fields[0].json_attributes as Record<string, unknown>).label).toBeUndefined();
    expect(fields[1].label).toBe('Bank');
  });

  it('leaves the first Exhibit C alone', () => {
    const fields: Record<string, unknown>[] = [{ type: 'text', name: 'dba', label: 'dba' }];
    expect(nameExhibitCCopyFieldsForReview(fields, 1)).toBe(0);
    expect(fields[0].name).toBe('dba');
  });
});

describe('normalizeExhibitCCopyFieldNames', () => {
  it('strips the copy suffix from every widget of a document read', () => {
    const doc = {
      fields: [
        { type: 'text', name: 'ach_bank_name_p1__copy2', json_attributes: { name: 'ach_bank_name_p1__copy2' } },
        { type: 'text', json_attributes: JSON.stringify({ name: 'ach_username_p1__copy3' }) },
        { type: 'initials', name: 'initial_g1_p1' },
      ],
      texts: [{ field_name: 'ach_bank_account_p1__copy2', data: '1' }],
    };
    normalizeExhibitCCopyFieldNames(doc);
    expect(doc.fields[0].name).toBe('ach_bank_name_p1');
    expect((doc.fields[0].json_attributes as Record<string, unknown>).name).toBe('ach_bank_name_p1');
    expect(JSON.parse(doc.fields[1].json_attributes as string).name).toBe('ach_username_p1');
    expect(doc.fields[2].name).toBe('initial_g1_p1');
    expect(doc.texts[0].field_name).toBe('ach_bank_account_p1');
  });

  it('handles group payloads and leaves ordinary names untouched', () => {
    const group = { documents: [{ fields: [{ name: 'client_name__copy2' }, { name: 'copy_count' }] }] };
    normalizeExhibitCCopyFieldNames(group);
    expect(group.documents[0].fields.map((f) => f.name)).toEqual(['client_name', 'copy_count']);
    expect(stripExhibitCCopyFieldName('Text Field 3__copy4')).toBe('Text Field 3');
  });
});

describe('signature / initials face', () => {
  it('sets Times New Roman 12 on signature and initials widgets only', () => {
    const signature = applySignNowSignatureFieldFont({ type: 'signature', name: 'sig_1' });
    const initials = applySignNowSignatureFieldFont({ type: 'initials', name: 'initial_g1_p1' });
    const text = applySignNowSignatureFieldFont({ type: 'text', name: 'dba', size: 16 });
    for (const field of [signature, initials]) {
      expect(field.font).toBe(SIGNATURE_FIELD_FONT);
      expect(field.size).toBe(12);
      expect(field.font_size).toBe(12);
    }
    expect(SIGNATURE_FIELD_FONT).toBe('Times New Roman');
    expect(SIGNATURE_FIELD_FONT_SIZE).toBe(12);
    // Text widgets keep their own face.
    expect(text.font).toBeUndefined();
    expect(text.size).toBe(16);
  });

  it('sizes the box to a 12pt line, centred on the same line, and only once', () => {
    // The template's initials box (Exhibit C initial_g1_p1): 40×41 at y=727.
    const initials = applySignNowSignatureFieldFont({ type: 'initials', x: 394, y: 727, width: 40, height: 41 });
    expect(initials.height).toBe(SIGNATURE_FIELD_HEIGHT);
    expect(initials.y).toBe(Math.round(727 + (41 - SIGNATURE_FIELD_HEIGHT) / 2));
    expect(initials.x).toBe(394);
    expect(initials.width).toBe(40);
    // Re-publishing the already-sized box does not move it again.
    const again = applySignNowSignatureFieldFont({ ...initials });
    expect(again.y).toBe(initials.y);
    expect(again.height).toBe(SIGNATURE_FIELD_HEIGHT);
    // Text widgets keep their geometry.
    const text = applySignNowSignatureFieldFont({ type: 'text', y: 10, height: 41 });
    expect(text.height).toBe(41);
  });

  it('keeps signature widgets untouched by the merchant bake', () => {
    const sig = applySignNowSignatureFieldFont({
      type: 'signature',
      name: 'sig_1',
      role: 'Recipient 1',
      page_number: 0,
      x: 1,
      y: 1,
      width: 120,
      height: 20,
    });
    const { fields } = splitPrefillPutPayload([sig], true, { keepEmptyMerchantRequired: true });
    expect(fields[0].font).toBe('Times New Roman');
    expect(fields[0].size).toBe(12);
  });

  it('can strip the face for a fallback write without touching other fields', () => {
    const fields = [
      applySignNowSignatureFieldFont({ type: 'initials', name: 'i1' }),
      { type: 'text', name: 'dba', font: 'Arial', size: 14 },
    ];
    expect(hasSignNowSignatureFieldFont(fields)).toBe(true);
    const stripped = withoutSignNowSignatureFieldFont(fields);
    expect(stripped[0].font).toBeUndefined();
    expect(stripped[0].size).toBeUndefined();
    expect(stripped[1]).toEqual({ type: 'text', name: 'dba', font: 'Arial', size: 14 });
    expect(hasSignNowSignatureFieldFont(stripped)).toBe(false);
    // The original is not mutated.
    expect(fields[0].font).toBe('Times New Roman');
  });
});

describe('collectOwnerReviewEdits', () => {
  const ownerField = (name: string, prefilled: string, extra: Record<string, unknown> = {}) => ({
    type: 'text',
    role: 'Owner',
    page_number: 2,
    x: 400,
    y: 120,
    json_attributes: { name, prefilled_text: prefilled },
    ...extra,
  });

  it('returns the value the preparer typed over a prefilled Owner widget', () => {
    const edits = collectOwnerReviewEdits({
      fields: [ownerField('disclosure_recipient_funds_p3', '23,750.00', { element_id: 't1' })],
      texts: [{ id: 't1', page_number: 2, x: 400, y: 120, data: '9,125.00' }],
    });
    expect(edits.get('disclosure_recipient_funds_p3')).toBe('9,125.00');
  });

  it('matches a committed text on the widget spot when no element id links them', () => {
    const edits = collectOwnerReviewEdits({
      fields: [ownerField('disclosure_page3_line_2_p3', '0.00')],
      texts: [{ id: 't9', page_number: 2, x: 402, y: 121, data: '14,625.00' }],
    });
    expect(edits.get('disclosure_page3_line_2_p3')).toBe('14,625.00');
  });

  it('ignores a widget Review left as prefilled', () => {
    const edits = collectOwnerReviewEdits({
      fields: [ownerField('disclosure_page3_net_p3', '23,750.00', { element_id: 't1' })],
      texts: [{ id: 't1', page_number: 2, x: 400, y: 120, data: '23,750.00' }],
    });
    expect(edits.size).toBe(0);
  });

  it('ignores merchant widgets and an earlier bake stamp', () => {
    const edits = collectOwnerReviewEdits({
      fields: [ownerField('client_name_p1', 'ACME', { role: 'Recipient 1' })],
      texts: [{ id: 't1', page_number: 2, x: 400, y: 120, data: 'OLD ACME' }],
    });
    expect(edits.size).toBe(0);
  });

  it('keys an Exhibit C copy widget by its original name', () => {
    const edits = collectOwnerReviewEdits({
      fields: [ownerField('ach_bank_name_p1__copy2', 'Chase', { element_id: 't1' })],
      texts: [{ id: 't1', page_number: 2, x: 400, y: 120, data: 'Wells Fargo' }],
    });
    expect(edits.get('ach_bank_name_p1')).toBe('Wells Fargo');
  });
});
