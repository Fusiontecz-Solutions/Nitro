import {
  buildSignNowDocumentPrefillTexts,
  canonicalizeSignNowFieldName,
  currentSignNowUsDate,
  formatSignNowPrefillValue,
  CONTRACT_P22_REQUIRED_UNIQUE_NAMES,
  EXHIBIT_C_REQUIRED_UNIQUE_NAMES,
  TIBERIAN_ACH_DAILY_FIELD_NAMES,
  TIBERIAN_EPA_FIELD_NAMES,
  TIBERIAN_EXHIBIT_A_FIELD_NAMES,
  TIBERIAN_EXHIBIT_C_FIELD_NAMES,
  isDedicatedContractP22RequiredField,
  isDedicatedExhibitCRequiredField,
  isMerchantRequiredExhibitCField,
  isMerchantRequiredPage20AchField,
  isMerchantRequiredPage22ReferenceField,
  isMerchantRequiredSignerField,
  usesAddendumFillableFont,
  isMonthlyFeeForcedBlankField,
  isSupplementalSignNowDocumentName,
  resolveSignNowPrefillValue,
  signNowDocumentFieldCanons,
  shouldSkipSignNowPrefill,
  hasDisclosureFieldSignature,
  signNowPrefillDocumentKind,
  signNowPrefillOptionsForDocument,
} from './signnow-field-map';

describe('signnow-field-map', () => {
  it('prints phone and SSN values in the canonical dashed format', () => {
    const textWidget = { type: 'text', validatorId: '' };
    expect(
      formatSignNowPrefillValue('5615778267', 'merchant_contact_phone', textWidget),
    ).toBe('561-577-8267');
    expect(formatSignNowPrefillValue('(561) 577-8267', 'client_phone', textWidget)).toBe(
      '561-577-8267',
    );
    expect(
      formatSignNowPrefillValue('1-561-577-8267', 'guarantor_phone_p22', textWidget),
    ).toBe('561-577-8267');
    expect(formatSignNowPrefillValue('0006549876', 'owner2_phone', textWidget)).toBe(
      '000-654-9876',
    );
    expect(formatSignNowPrefillValue('366960737', 'guaranty_ss', textWidget)).toBe(
      '366-96-0737',
    );
    expect(formatSignNowPrefillValue('366-96-0737', 'owner1_ssn_p22', textWidget)).toBe(
      '366-96-0737',
    );
  });

  it('sends digits-only phone / SSN to validated or unknown widgets', () => {
    // The Number validator rejects dashes and takes the whole batch down.
    expect(
      formatSignNowPrefillValue('561-577-8267', 'merchant_contact_phone', {
        type: 'text',
        validatorId: 'number_validator_id',
      }),
    ).toBe('5615778267');
    expect(
      formatSignNowPrefillValue('561-577-8267', 'client_phone', { type: 'numeric' }),
    ).toBe('5615778267');
    // Unknown widget (no document field list) stays on the safe digits path.
    expect(formatSignNowPrefillValue('561-577-8267', 'client_phone')).toBe('5615778267');
    expect(formatSignNowPrefillValue('366-96-0737', 'guaranty_ss')).toBe('366960737');
    expect(formatSignNowPrefillValue('FUSIONTECZ', 'client_legal_name')).toBe('FUSIONTECZ');
    expect(formatSignNowPrefillValue('$ 1,025.00', 'origination_fee')).toBe('1,025.00');
    expect(formatSignNowPrefillValue('$49.00', 'ach_program_fee_p13')).toBe('49.00');
    expect(
      formatSignNowPrefillValue('WEEKLY', 'page1_installmentBlock_frequency'),
    ).toBe('Weekly');
    expect(formatSignNowPrefillValue('daily', 'page1_installmentBlock_frequency')).toBe(
      'Daily',
    );
    expect(formatSignNowPrefillValue('DAY', 'page1_installmentBlock_frequency')).toBe(
      'Daily',
    );
    expect(formatSignNowPrefillValue('149.90 DailyDaily', 'remittance')).toBe('149.90');
    expect(formatSignNowPrefillValue('149.90 Daily', 'remittance')).toBe('149.90');
  });

  it('strips page suffixes from SignNow unique names', () => {
    expect(canonicalizeSignNowFieldName('guaranty_guarantor1_ss_p12')).toBe(
      'guaranty_guarantor1_ss',
    );
    expect(canonicalizeSignNowFieldName('guaranty_guarantor2_name_p19')).toBe(
      'guaranty_guarantor2_name',
    );
  });

  it('maps owner 1 SSN from CRM guaranty_ss / guaranty_owner1_ss', () => {
    expect(
      resolveSignNowPrefillValue('guaranty_guarantor1_ss_p12', {
        guaranty_ss: '123-45-6789',
      }),
    ).toBe('123-45-6789');
    expect(
      resolveSignNowPrefillValue('guaranty_guarantor1_ss_p13', {
        guaranty_owner1_ss: '111-22-3333',
      }),
    ).toBe('111-22-3333');
  });

  it('does not copy signer 1 into seller 2 / guarantor 2 slots', () => {
    const oneSigner = {
      client_name: 'Test User',
      client_email: 'puneet04@fusiontecz.com',
      owner_print_title: 'OWNER',
      business_address: 'USA',
      client_phone: '08827688283',
    };
    expect(canonicalizeSignNowFieldName('client_email_p13_s2')).toBe('client_email_s2');
    expect(resolveSignNowPrefillValue('client_email_p13_s2', oneSigner)).toBe('');
    expect(resolveSignNowPrefillValue('owner_print_title_p13_s2', oneSigner)).toBe('');
    expect(resolveSignNowPrefillValue('guarantor2_address_p13', oneSigner)).toBe('');
    expect(resolveSignNowPrefillValue('owner2_email', oneSigner)).toBe('');
    expect(resolveSignNowPrefillValue('client_email_p13_s1', oneSigner)).toBe(
      'puneet04@fusiontecz.com',
    );
    expect(resolveSignNowPrefillValue('client_name_p23_g2', oneSigner)).toBe('');
    expect(resolveSignNowPrefillValue('signature_date_p23_g2', oneSigner)).toBe('');
  });

  it('maps owner 2 name from CRM owner2 / guarantor2 keys', () => {
    expect(
      resolveSignNowPrefillValue('guaranty_guarantor2_name_p12', {
        owner2_guarantor_name: 'Jane Owner',
      }),
    ).toBe('Jane Owner');
  });

  it('fills seller 2 / guarantor 2 contact slots from owner 2 CRM keys', () => {
    const twoOwners = {
      client_name: 'Alex Primary',
      client_email: 'alex@example.com',
      owner2_guarantor_name: 'Jordan Second',
      owner2_email: 'jordan@example.com',
      owner2_phone: '5551112222',
      owner2_address: '9 Oak St, Austin, TX, 78701',
      owner2_print_title: 'OWNER',
      guaranty_owner2_ss: '987-65-4321',
      guarantor2_phone: '5551112222',
      guarantor2_address: '9 Oak St, Austin, TX, 78701',
    };
    expect(resolveSignNowPrefillValue('guaranty_guarantor2_name_p12', twoOwners)).toBe(
      'Jordan Second',
    );
    expect(resolveSignNowPrefillValue('client_email_p13_s2', twoOwners)).toBe(
      'jordan@example.com',
    );
    expect(resolveSignNowPrefillValue('owner_print_title_p13_s2', twoOwners)).toBe('OWNER');
    expect(resolveSignNowPrefillValue('owner2_email', twoOwners)).toBe('jordan@example.com');
    expect(resolveSignNowPrefillValue('owner2_phone', twoOwners)).toBe('5551112222');
    expect(resolveSignNowPrefillValue('guarantor2_address_p13', twoOwners)).toBe(
      '9 Oak St, Austin, TX, 78701',
    );
    expect(resolveSignNowPrefillValue('guaranty_owner2_ss', twoOwners)).toBe('987-65-4321');
    expect(canonicalizeSignNowFieldName('client_name_p23_g2')).toBe('client_name_s2');
    expect(canonicalizeSignNowFieldName('signature_date_p23_g2')).toBe(
      'signature_date_s2',
    );
    expect(resolveSignNowPrefillValue('client_name_p23_g2', twoOwners)).toBe(
      'Jordan Second',
    );
    expect(
      resolveSignNowPrefillValue('signature_date_p23_g2', {
        ...twoOwners,
        agreement_date: '09/08/2026',
      }),
    ).toBe('09/08/2026');
  });

  it('does not copy owner 1 phone/email onto owner 2 slots when owner 2 exists', () => {
    const twoOwners = {
      client_name: 'Alex Primary',
      client_email: 'alex@example.com',
      client_phone: '5550001111',
      guarantor_phone: '5550001111',
      owner2_guarantor_name: 'Jordan Second',
      owner2_email: 'jordan@example.com',
    };
    expect(resolveSignNowPrefillValue('client_phone_s2', twoOwners)).toBe('');
    expect(resolveSignNowPrefillValue('client_phone_p13_s2', twoOwners)).toBe('');
    expect(resolveSignNowPrefillValue('client_email_p13_s2', twoOwners)).toBe(
      'jordan@example.com',
    );
    expect(resolveSignNowPrefillValue('client_name_p13_s2', twoOwners)).toBe(
      'Jordan Second',
    );
  });

  it('fills page-1 INITIAL INSTALLMENT frequency next to the amount', () => {
    expect(canonicalizeSignNowFieldName('page1_installmentBlock_frequency')).toBe(
      'page1_installmentblock_frequency',
    );
    expect(
      resolveSignNowPrefillValue('page1_installmentBlock_frequency', {
        frequency: 'Weekly',
      }),
    ).toBe('Weekly');
    expect(
      resolveSignNowPrefillValue('page1_installmentBlock_frequency', {
        frequency: 'daily',
      }),
    ).toBe('Daily');
    expect(
      buildSignNowDocumentPrefillTexts(['page1_installmentBlock_frequency'], {
        frequency: 'WEEKLY',
      }),
    ).toEqual([
      {
        field_name: 'page1_installmentBlock_frequency',
        prefilled_text: 'Weekly',
      },
    ]);
    expect(
      buildSignNowDocumentPrefillTexts(['page1_installmentBlock_frequency'], {
        paymentterms: 'DAY',
      }),
    ).toEqual([
      {
        field_name: 'page1_installmentBlock_frequency',
        prefilled_text: 'Daily',
      },
    ]);
    expect(
      resolveSignNowPrefillValue('remittance', {
        remittance: '14.99',
        frequency: 'Weekly',
      }),
    ).toBe('14.99');
    expect(
      resolveSignNowPrefillValue('remittance', {
        remittance: '14.99 Daily',
        frequency: 'daily',
      }),
    ).toBe('14.99');
    expect(
      buildSignNowDocumentPrefillTexts(['remittance'], {
        remittance: '14.99',
        frequency: 'daily',
      }),
    ).toEqual([{ field_name: 'remittance', prefilled_text: '14.99' }]);
    expect(
      buildSignNowDocumentPrefillTexts(
        ['remittance', 'page1_installmentBlock_frequency'],
        { remittance: '149.90 Daily', frequency: 'daily' },
      ),
    ).toEqual([
      { field_name: 'remittance', prefilled_text: '149.90' },
      { field_name: 'page1_installmentBlock_frequency', prefilled_text: 'Daily' },
    ]);
    expect(
      resolveSignNowPrefillValue('remittance_p21', {
        remittance: '14.99',
        frequency: 'Weekly',
      }),
    ).toBe('14.99');
  });

  it('leaves Notification of Assignment merchant lines blank', () => {
    const prefill = {
      client_legal_name: 'SUBWAY OF SHIV LLC',
      client_name: 'CRAIG LINDERR',
      doing_business_as: 'SUBWAY OF SHIV LLC',
      exhibit_a_value_1: 'SUBWAY OF SHIV LLC',
      exhibit_a_value_2: 'VANGUARD RESTAURANT GROUP LLC',
      case_id: '1b32bbde-931f-40f0-af09-f6d5114986a2',
      agreement_date: '09/09/2026',
    };
    expect(shouldSkipSignNowPrefill('assignment_merchant_line1_p24')).toBe(true);
    expect(shouldSkipSignNowPrefill('assignment_merchant_line2_p24')).toBe(true);
    expect(resolveSignNowPrefillValue('assignment_merchant_line1_p24', prefill)).toBe('');
    expect(resolveSignNowPrefillValue('assignment_merchant_line2_p24', prefill)).toBe('');
    expect(resolveSignNowPrefillValue('assignment_merchant_line13_p24', prefill)).toBe('');
    expect(resolveSignNowPrefillValue('case_id_p24', prefill)).toBe(
      '1b32bbde-931f-40f0-af09-f6d5114986a2',
    );
    expect(resolveSignNowPrefillValue('agreement_date_p24', prefill)).toBe('09/09/2026');
  });

  it('maps DBA from security_doing_business_as', () => {
    expect(
      resolveSignNowPrefillValue('doing_business_as', {
        security_doing_business_as: 'Acme DBA',
      }),
    ).toBe('Acme DBA');
  });

  it('maps guarantor name and personal/business references', () => {
    const prefill = {
      client_name: 'Test User',
      ach_authorization_reference_name1: 'Ref One',
      ach_authorization_reference_number_1: '5551112222',
      ach_authorization_reference_name2: 'Ref Two',
      ach_authorization_reference_number2: '5553334444',
      ach_authorization_reference_name3: 'Biz Contact',
      ach_authorization_reference_number3: '5556667777',
      ach_authorization_reference_relationship3: 'Acme Supplies',
      ach_authorization_reference_name4: 'Biz Two Contact',
      ach_authorization_reference_number4: '5558889999',
      ach_authorization_reference_relationship4: 'Beta Corp',
      landlord_company: 'Main Street LLC',
      landlord_contact: 'Alex Landlord',
      landlord_phone: '5550001111',
      emergency_name: 'Sam Emergency',
      emergency_relationship: 'Spouse',
      emergency_phone: '5552223333',
      emergency_email: 'sam@example.com',
    };
    expect(resolveSignNowPrefillValue('guarantor_name_p22', prefill)).toBe('Test User');
    expect(resolveSignNowPrefillValue('ref_personal1_name_p22', prefill)).toBe('Ref One');
    expect(resolveSignNowPrefillValue('ref_personal1_phone_p22', prefill)).toBe(
      '5551112222',
    );
    expect(resolveSignNowPrefillValue('ref_personal2_name_p22', prefill)).toBe('Ref Two');
    expect(resolveSignNowPrefillValue('ref_biz1_company_p22', prefill)).toBe(
      'Acme Supplies',
    );
    expect(resolveSignNowPrefillValue('ref_biz1_contact_p22', prefill)).toBe(
      'Biz Contact',
    );
    expect(resolveSignNowPrefillValue('ref_biz1_phone_p22', prefill)).toBe('5556667777');
    expect(resolveSignNowPrefillValue('ref_biz2_company_p22', prefill)).toBe('Beta Corp');
    expect(resolveSignNowPrefillValue('ref_biz2_contact_p22', prefill)).toBe(
      'Biz Two Contact',
    );
    expect(resolveSignNowPrefillValue('ref_biz2_phone_p22', prefill)).toBe('5558889999');
    expect(resolveSignNowPrefillValue('landlord_company_p22', prefill)).toBe(
      'Main Street LLC',
    );
    expect(resolveSignNowPrefillValue('landlord_contact_p22', prefill)).toBe(
      'Alex Landlord',
    );
    expect(resolveSignNowPrefillValue('landlord_phone_p22', prefill)).toBe('5550001111');
    expect(resolveSignNowPrefillValue('emergency_name_p22', prefill)).toBe(
      'Sam Emergency',
    );
    expect(resolveSignNowPrefillValue('emergency_relationship_p22', prefill)).toBe(
      'Spouse',
    );
    expect(resolveSignNowPrefillValue('emergency_phone_p22', prefill)).toBe('5552223333');
    expect(resolveSignNowPrefillValue('emergency_email_p22', prefill)).toBe(
      'sam@example.com',
    );
  });

  it('maps ACH portal username, password, and combined security Q/A', () => {
    const prefill = {
      ach_authorization_username: 'portaluser',
      ach_authorization_password: 'secret123',
      ach_authorization_security_question1: 'Pet name',
      ach_authorization_security_answer1: 'Rex',
      ach_authorization_account_holder_bank_routing_number: '021000021',
    };
    expect(resolveSignNowPrefillValue('ach_username_p20', prefill)).toBe('portaluser');
    expect(resolveSignNowPrefillValue('ach_password_p20', prefill)).toBe('secret123');
    expect(resolveSignNowPrefillValue('ach_security_q1_p20', prefill)).toBe(
      'Pet name / Rex',
    );
    expect(resolveSignNowPrefillValue('ach_bank_routing_p20', prefill)).toBe(
      '021000021',
    );
  });

  it('marks page 20 ACH bank fields as required for the merchant signer', () => {
    expect(isMerchantRequiredPage20AchField('ach_bank_name_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_bank_portal_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_bank_account_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_bank_routing_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_username_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_password_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_security_q1_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_security_q2_p20')).toBe(true);
    expect(isMerchantRequiredPage20AchField('Text Field 13', 19)).toBe(true);
    expect(isMerchantRequiredPage20AchField('Text Field 13', 20)).toBe(true);
    expect(isMerchantRequiredPage20AchField('ach_bank_name', 19)).toBe(true);
    expect(isMerchantRequiredPage20AchField('Text Field 13', 0)).toBe(false);
    expect(isMerchantRequiredPage20AchField('ach_bank_name_p1')).toBe(false);
    expect(isMerchantRequiredPage20AchField('merchant_contact_name_p1')).toBe(false);
  });

  it('marks Exhibit C orange fields as required for the merchant signer', () => {
    const exhibitC = { documentKind: 'exhibit_c' as const };
    expect(isMerchantRequiredExhibitCField('ach_account_holder_name_p1', 0, exhibitC)).toBe(
      true,
    );
    expect(isMerchantRequiredExhibitCField('ach_bank_portal_p1')).toBe(true);
    expect(isMerchantRequiredExhibitCField('ach_username_p1')).toBe(true);
    expect(isMerchantRequiredExhibitCField('ach_password_p1')).toBe(true);
    expect(isMerchantRequiredExhibitCField('ach_security_q1_p1')).toBe(true);
    expect(isMerchantRequiredExhibitCField('ach_security_q2_p1')).toBe(true);
    expect(isMerchantRequiredSignerField('ach_username_p1', 0, exhibitC)).toBe(true);
    expect(isMerchantRequiredExhibitCField('ach_account_holder_dba_p1')).toBe(false);
    expect(isMerchantRequiredExhibitCField('ach_account_holder_address_p1')).toBe(false);
    expect(isMerchantRequiredExhibitCField('ach_bank_name_p1')).toBe(false);
    expect(isMerchantRequiredExhibitCField('ach_bank_account_p1')).toBe(false);
    expect(isMerchantRequiredExhibitCField('ach_bank_routing_p1')).toBe(false);
    expect(
      isMerchantRequiredExhibitCField('ach_username_p1', 0, { documentKind: 'monthly_fee' }),
    ).toBe(false);
    expect(isMerchantRequiredExhibitCField('ach_username_p1_ach')).toBe(false);
    expect(isMerchantRequiredExhibitCField('ach_username_p20')).toBe(false);
    for (const name of EXHIBIT_C_REQUIRED_UNIQUE_NAMES) {
      expect(isDedicatedExhibitCRequiredField(name)).toBe(true);
      expect(isMerchantRequiredExhibitCField(name)).toBe(true);
      expect(isMerchantRequiredSignerField(name, 0)).toBe(true);
    }
    expect(isMerchantRequiredExhibitCField('ach_username', 0)).toBe(true);
    expect(isMerchantRequiredExhibitCField('ach_bank_portal', 0)).toBe(true);
    expect(isMerchantRequiredExhibitCField('ach_account_holder_name', 1)).toBe(true);
    expect(signNowPrefillDocumentKind('Exhibit C')).toBe('exhibit_c');
    expect(
      signNowPrefillDocumentKind('ACH Authorization', [
        'ach_account_holder_name_p1',
        'ach_bank_portal_p1',
        'ach_username_p1',
      ]),
    ).toBe('exhibit_c');
    expect(
      signNowPrefillDocumentKind(
        'PCM Agreement',
        [
          'ach_account_holder_name_p1',
          'ach_bank_portal_p1',
          'ach_username_p1',
          ...Array.from({ length: 50 }, (_, i) => `merchant_contact_name_p${i + 2}`),
        ],
      ),
    ).toBeUndefined();
  });

  it('prefills Exhibit C fields from CRM, including account-holder slots', () => {
    const opts = { documentKind: 'exhibit_c' as const };
    const prefill = {
      ach_username_p1: 'portaluser',
      ach_account_holder_name_p1: 'Jane Holder',
      doing_business_as: 'Acme DBA',
      ach_authorization_account_holder_bank_name: 'Chase',
      ach_authorization_account_holder_bank_account_number: '01714856400',
      ach_authorization_account_holder_bank_routing_number: '021000021',
    };
    expect(shouldSkipSignNowPrefill('ach_username_p1', opts)).toBe(false);
    expect(shouldSkipSignNowPrefill('ach_password_p1', opts)).toBe(false);
    expect(shouldSkipSignNowPrefill('ach_account_holder_name_p1', opts)).toBe(false);
    expect(shouldSkipSignNowPrefill('ach_bank_portal_p1', opts)).toBe(false);
    expect(shouldSkipSignNowPrefill('ach_security_q1_p1', opts)).toBe(false);
    expect(shouldSkipSignNowPrefill('ach_account_holder_dba_p1', opts)).toBe(false);
    expect(shouldSkipSignNowPrefill('ach_bank_name_p1', opts)).toBe(false);
    expect(resolveSignNowPrefillValue('ach_username_p1', prefill, opts)).toBe('portaluser');
    expect(resolveSignNowPrefillValue('ach_account_holder_name_p1', prefill, opts)).toBe(
      'Jane Holder',
    );
    expect(resolveSignNowPrefillValue('ach_account_holder_dba_p1', prefill, opts)).toBe(
      'Acme DBA',
    );
    expect(resolveSignNowPrefillValue('ach_bank_name_p1', prefill, opts)).toBe('Chase');
    expect(resolveSignNowPrefillValue('ach_bank_account_p1', prefill, opts)).toBe(
      '01714856400',
    );
    expect(resolveSignNowPrefillValue('ach_bank_routing_p1', prefill, opts)).toBe(
      '021000021',
    );
  });

  /**
   * The Obsidian INITIAL INSTALLMENT box holds two widgets: the amount
   * (`remittance`) and, beside it, `Text Field 92` for the cadence. Without a
   * mapping the cadence box printed the bare "Text" placeholder.
   */
  it('fills Obsidian Text Field 92 with the installment cadence', () => {
    const opts = { documentKind: 'obsidian_agreement' as const };
    expect(shouldSkipSignNowPrefill('Text Field 92', opts)).toBe(false);
    for (const [crmValue, printed] of [
      ['daily', 'Daily'],
      ['WEEKLY', 'Weekly'],
      ['month', 'Monthly'],
    ] as const) {
      expect(resolveSignNowPrefillValue('Text Field 92', { frequency: crmValue }, opts)).toBe(
        printed,
      );
    }
    // Same CRM keys the disclosure frequency reads.
    expect(
      resolveSignNowPrefillValue('Text Field 92', { payment_frequency: 'weekly' }, opts),
    ).toBe('Weekly');
    expect(
      resolveSignNowPrefillValue('Text Field 92', { disclosure_payment_frequency: 'DAILY' }, opts),
    ).toBe('Daily');
    // The amount beside it stays dollars-only.
    expect(
      resolveSignNowPrefillValue('remittance', { remittance: '1,499.00', frequency: 'daily' }, opts),
    ).toBe('1,499.00');
  });

  it('fills the account-holder line with the signer and the DBA line with the business', () => {
    const prefill = {
      client_name: 'MARY IRVIN',
      client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
    };
    expect(resolveSignNowPrefillValue('ach_account_holder_name_p19', prefill)).toBe(
      'MARY IRVIN',
    );
    expect(resolveSignNowPrefillValue('ach_account_holder_dba_p19', prefill)).toBe(
      'RE-NEW-IT RENOVATIONS, LLC',
    );
  });

  /**
   * Exhibit C's numbered widgets are its own ACH holder / bank lines. Reading
   * them through the shared CA-disclosure aliases stamped funding-provided,
   * finance-charge and payment amounts over the Account Holder lines on the live
   * Obsidian package — `7,175.00` on Account Holder DBA, `600.00` on Business
   * Address. Each one resolves by position instead (see
   * `EXHIBIT_C_TEXT_FIELD_CRM_IDS`), and the disclosure keeps its own meaning.
   */
  it('maps Obsidian Exhibit C Text Field N by position, never to disclosure amounts', () => {
    const opts = { documentKind: 'exhibit_c' as const };
    const prefill = {
      funding_provided: '10,000.00',
      funding_provided_direct: '7,175.00',
      net_to_merchant: '8,975.00',
      disclosure_apr: '600.00',
      disclosure_avg_monthly_revenue: '100.00',
      disclosure_finance_charge: '4,990.00',
      disclosure_total_payment: '12,000.00',
      disclosure_monthly_cost: '23,984.00',
      disclosure_payment_frequency: 'Daily',
      remittance: '1,499.00',
      ach_authorization_account_holder_name: 'RE-NEW-IT RENOVATIONS, LLC',
      ach_authorization_account_holder_dba: 'RE-NEW-IT',
      // "Account Holder Business Address" is the business's street, so Owner 1's
      // home address beside it must never reach the page.
      business_address: '3273 COVE CREEK ROAD',
      business_address_contract: '9 OAK ST',
      ach_authorization_account_holder_address: '9 OAK ST',
      ach_authorization_account_holder_bank_name: 'SBI MORGAN',
      ach_authorization_account_holder_bank_account_number: '123456789',
      ach_authorization_account_holder_bank_routing_number: '987654321',
    };
    expect(resolveSignNowPrefillValue('Text Field 1', prefill, opts)).toBe(
      'RE-NEW-IT RENOVATIONS, LLC',
    );
    expect(resolveSignNowPrefillValue('Text Field 2', prefill, opts)).toBe('RE-NEW-IT');
    expect(resolveSignNowPrefillValue('Text Field 3', prefill, opts)).toBe(
      '3273 COVE CREEK ROAD',
    );
    expect(resolveSignNowPrefillValue('Text Field 4', prefill, opts)).toBe('SBI MORGAN');
    expect(resolveSignNowPrefillValue('Text Field 6', prefill, opts)).toBe('123456789');
    expect(resolveSignNowPrefillValue('Text Field 7', prefill, opts)).toBe('987654321');
    // Bank portal, credentials and security answers are the merchant's to type,
    // and a number this layout does not use is not a disclosure slot either.
    for (const name of [
      'Text Field 5',
      'Text Field 8',
      'Text Field 9',
      'Text Field 10',
      'Text Field 11',
      'Text Field 12',
    ]) {
      expect(resolveSignNowPrefillValue(name, prefill, opts)).toBe('');
    }
    // The disclosure itself still reads its own numbered slots.
    expect(resolveSignNowPrefillValue('Text Field 1', prefill)).toBe('10,000.00');
    expect(resolveSignNowPrefillValue('Text Field 3', prefill)).toBe('600.00');
  });

  /**
   * The Obsidian template names none of its Exhibit C widgets, so the slots the
   * merchant fills arrive numbered. They must stay empty signer boxes rather
   * than be baked over or dropped.
   */
  it('treats the numbered Obsidian Exhibit C slots as merchant-required', () => {
    const opts = { documentKind: 'exhibit_c' as const };
    for (const name of [
      'Text Field 1',
      'Text Field 5',
      'Text Field 8',
      'Text Field 9',
      'Text Field 10',
      'Text Field 11',
    ]) {
      expect(isMerchantRequiredExhibitCField(name, 0, opts)).toBe(true);
      expect(isMerchantRequiredSignerField(name, 0, opts)).toBe(true);
    }
    // CRM-owned lines are filled from the contract, not left for the signer.
    for (const name of ['Text Field 2', 'Text Field 3', 'Text Field 4', 'Text Field 6', 'Text Field 7']) {
      expect(isMerchantRequiredExhibitCField(name, 0, opts)).toBe(false);
    }
    // Other documents' numbered widgets are untouched by this rule.
    expect(isMerchantRequiredExhibitCField('Text Field 5', 0)).toBe(false);
    expect(
      isMerchantRequiredExhibitCField('Text Field 5', 0, {
        documentKind: 'obsidian_agreement',
      }),
    ).toBe(false);
  });

  /**
   * Tiberian Funding's Exhibit C ships the *named* layout (the same unique names
   * as Nitro's copy), not Obsidian's numbered one, and its document is titled
   * "EXHIBIT C -" with no funder in the name. This walks the live widget
   * inventory (see `TIBERIAN_EXHIBIT_C_FIELD_NAMES`) and asserts every CRM-owned
   * line is filled from the same ids Obsidian's positional slots resolve to, so
   * the two funders' copies of the page can never drift apart.
   */
  it('fills every Tiberian Exhibit C widget from the same CRM ids as Obsidian', () => {
    const names = [...TIBERIAN_EXHIBIT_C_FIELD_NAMES];
    const opts = signNowPrefillOptionsForDocument('EXHIBIT C -', names);
    expect(opts?.documentKind).toBe('exhibit_c');
    // The title carries no funder, so the field-name signature must carry it.
    expect(signNowPrefillDocumentKind(undefined, names)).toBe('exhibit_c');

    const prefill = {
      agreement_date: '09/22/2026',
      client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
      client_name: 'MARY IRVIN',
      ach_authorization_account_holder_name: 'RE-NEW-IT RENOVATIONS, LLC',
      ach_authorization_account_holder_dba: 'RE-NEW-IT',
      // "Account Holder Business Address" is the business's street, so Owner 1's
      // home address beside it must never reach the page.
      business_address: '3273 COVE CREEK ROAD',
      business_address_contract: '9 OAK ST',
      ach_authorization_account_holder_address: '9 OAK ST',
      ach_authorization_account_holder_bank_name: 'SBI MORGAN',
      ach_authorization_account_holder_bank_account_number: '123456789',
      ach_authorization_account_holder_bank_routing_number: '987654321',
    };
    const filled = new Map(
      buildSignNowDocumentPrefillTexts(names, prefill, opts).map((row) => [
        row.field_name,
        row.prefilled_text,
      ]),
    );
    expect(Object.fromEntries(filled)).toEqual({
      agreement_date_p1: '09/22/2026',
      client_legal_name_p1: 'RE-NEW-IT RENOVATIONS, LLC',
      client_name_p1: 'MARY IRVIN',
      ach_account_holder_name_p1: 'RE-NEW-IT RENOVATIONS, LLC',
      ach_account_holder_dba_p1: 'RE-NEW-IT',
      ach_account_holder_address_p1: '3273 COVE CREEK ROAD',
      ach_bank_name_p1: 'SBI MORGAN',
      ach_bank_account_p1: '123456789',
      ach_bank_routing_p1: '987654321',
    });

    // Obsidian's numbered slots resolve to the very same values, line for line.
    const obsidian = [1, 2, 3, 4, 6, 7].map((n) =>
      resolveSignNowPrefillValue(`Text Field ${n}`, prefill, opts),
    );
    expect(obsidian).toEqual([
      filled.get('ach_account_holder_name_p1'),
      filled.get('ach_account_holder_dba_p1'),
      filled.get('ach_account_holder_address_p1'),
      filled.get('ach_bank_name_p1'),
      filled.get('ach_bank_account_p1'),
      filled.get('ach_bank_routing_p1'),
    ]);
  });

  /**
   * Tiberian left `ach_bank_portal_p1` on the Owner role where Nitro assigns it
   * to Recipient 1. The portal, credentials and security answers are still the
   * merchant's to type on every funder's copy, so the mapping must not start
   * stamping them just because the template role differs.
   */
  it('keeps the Tiberian Exhibit C credential slots merchant-filled', () => {
    const opts = { documentKind: 'exhibit_c' as const };
    for (const name of [
      'ach_bank_portal_p1',
      'ach_username_p1',
      'ach_password_p1',
      'ach_security_q1_p1',
      'ach_security_q2_p1',
      'ach_account_holder_name_p1',
    ]) {
      expect(TIBERIAN_EXHIBIT_C_FIELD_NAMES).toContain(name);
      expect(isMerchantRequiredExhibitCField(name, 0, opts)).toBe(true);
      expect(isMerchantRequiredSignerField(name, 0, opts)).toBe(true);
      expect(usesAddendumFillableFont(name, 0, opts)).toBe(true);
    }
    // The initials are the signer's own widgets, never prefill targets.
    for (const name of ['initial_g1_p1', 'initial_g2_p1']) {
      expect(buildSignNowDocumentPrefillTexts([name], {}, opts)).toEqual([]);
    }
  });

  /**
   * Tiberian Funding's Exhibit A Addendum ("EXHIBIT A TF-", template 1dd030c4…)
   * carries the same 39 widget names as the Nitro / Obsidian copy
   * ("Exhibit A - Nitro Advance", a3f75789…), so it must resolve from the same
   * CRM ids with no funder-specific mapping. This walks the live inventory (see
   * `TIBERIAN_EXHIBIT_A_FIELD_NAMES`) and asserts the two titles fill
   * identically, line for line.
   */
  describe('Tiberian Exhibit A Addendum', () => {
    const names = [...TIBERIAN_EXHIBIT_A_FIELD_NAMES];
    const prefill = {
      agreement_date: '09/22/2026',
      client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
      doing_business_as: 'RE-NEW-IT',
      exhibit_a_value_1: 'RE-NEW-IT RENOVATIONS, LLC',
      exhibit_a_value_2: 'RE-NEW-IT HOLDINGS LLC',
      exhibit_a_value_3: 'COVE CREEK SUPPLY CO',
      addendum_ein_1: '12-3456789',
      addendum_ein_2: '98-7654321',
      addendum_ein_3: '55-5555555',
      addendum_type_of_entity_1: 'Limited Liability Company',
      addendum_type_of_entity_2: 'Limited Liability Company',
      addendum_type_of_entity_3: 'Corporation',
      client_name: 'MARY IRVIN',
      guaranty_guarantor1_ss: '123-45-6789',
      owner_print_title: 'Managing Member',
    };
    const filledFor = (documentName: string) =>
      Object.fromEntries(
        buildSignNowDocumentPrefillTexts(
          names,
          prefill,
          signNowPrefillOptionsForDocument(documentName, names),
        ).map((row) => [row.field_name, row.prefilled_text]),
      );

    it('is read as a plain addendum, never as an Exhibit C or a Tiberian agreement', () => {
      for (const documentName of ['EXHIBIT A TF-', 'Exhibit A - Nitro Advance']) {
        expect(signNowPrefillDocumentKind(documentName, names)).toBeUndefined();
        expect(isSupplementalSignNowDocumentName(documentName)).toBe(true);
      }
    });

    it('fills every CRM-owned widget from the same ids as the Nitro copy', () => {
      const tiberian = filledFor('EXHIBIT A TF-');
      expect(tiberian).toEqual({
        agreement_date_p1: '09/22/2026',
        client_legal_name_p1: 'RE-NEW-IT RENOVATIONS, LLC',
        doing_business_as_p1: 'RE-NEW-IT',
        exhibit_a_value_1_p1: 'RE-NEW-IT RENOVATIONS, LLC',
        addendum_ein_1_p1: '12-3456789',
        addendum_type_of_entity_1_p1: 'Limited Liability Company',
        exhibit_a_value_2_p1: 'RE-NEW-IT HOLDINGS LLC',
        addendum_ein_2_p1: '98-7654321',
        addendum_type_of_entity_2_p1: 'Limited Liability Company',
        exhibit_a_value_3_p1: 'COVE CREEK SUPPLY CO',
        addendum_ein_3_p1: '55-5555555',
        addendum_type_of_entity_3_p1: 'Corporation',
        exhibit_owner_name_p1: 'MARY IRVIN',
        guaranty_ss_p1: '123456789',
        owner_print_title_p1: 'Managing Member',
      });
      // Same template, two funders: the Nitro / Obsidian copy must not drift.
      expect(filledFor('Exhibit A - Nitro Advance')).toEqual(tiberian);
    });

    it('leaves the signature and initials widgets untouched', () => {
      const opts = signNowPrefillOptionsForDocument('EXHIBIT A TF-', names);
      for (const name of ['signature_p1', 'Initials 1', 'Initials 2']) {
        expect(buildSignNowDocumentPrefillTexts([name], prefill, opts)).toEqual([]);
      }
    });

    /**
     * `Addendum` stores three sellers, so rows 4-11 have no CRM source on either
     * funder's copy. They must stay empty rather than pick up a stray alias.
     */
    it('leaves the seller rows the CRM has no data for empty', () => {
      const tiberian = filledFor('EXHIBIT A TF-');
      for (const name of names) {
        if (!/_(4|5|6|7|8|9|10|11)_p1$/.test(name)) continue;
        expect(tiberian[name]).toBeUndefined();
      }
    });
  });

  /**
   * Tiberian Funding's EPA Addendum ("EPA TF CT", template 6af7ebdf…) carries
   * the same 18 widget names as the Obsidian copy ("EPA- OBSIDIAN CAPITAL
   * GROUP", fbb2f217…) and the Nitro catalog copy ("EPA Nitro Advance",
   * 084719db…), so it must resolve from the same CRM ids with no
   * funder-specific mapping. This walks the live inventory (see
   * `TIBERIAN_EPA_FIELD_NAMES`) and asserts all three titles fill identically,
   * line for line.
   */
  describe('Tiberian EPA Addendum', () => {
    const names = [...TIBERIAN_EPA_FIELD_NAMES];
    const prefill = {
      agreement_date: '09/22/2026',
      client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
      client_name: 'MARY IRVIN',
      owner2_guarantor_name: 'JOHN IRVIN',
      guaranty_guarantor1_ss: '123-45-6789',
      guaranty_guarantor2_ss: '987-65-4321',
      epo_received_date_1: '10/15/2026',
      epo_amount_received_1: '5,000.00',
      epo_received_date_2: '11/15/2026',
      epo_amount_received_2: '7,500.00',
      epo_received_date_3: '12/15/2026',
      epo_amount_received_3: '10,000.00',
    };
    const filledFor = (documentName: string) =>
      Object.fromEntries(
        buildSignNowDocumentPrefillTexts(
          names,
          prefill,
          signNowPrefillOptionsForDocument(documentName, names),
        ).map((row) => [row.field_name, row.prefilled_text]),
      );

    /**
     * "EPA TF CT" carries no funder name, so it must not be read as the
     * Tiberian *agreement* — that layout would claim these widgets. It is also
     * not an Exhibit C, a disclosure or a monthly fee.
     *
     * Obsidian's copy is titled "EPA- OBSIDIAN CAPITAL GROUP", which used to be
     * read as `obsidian_agreement` purely because it carries the funder name.
     * A funder name alone no longer classifies a document as that funder's
     * agreement — the title has to say "agreement" or "contract" as well —
     * so the EPA is now correctly unclassified, like the other two copies.
     */
    it('is read as a plain addendum, never as an Exhibit C or a funder agreement', () => {
      for (const documentName of [
        'EPA TF CT',
        'EPA Nitro Advance',
        'EPA- OBSIDIAN CAPITAL GROUP',
      ]) {
        expect(signNowPrefillDocumentKind(documentName, names)).toBeUndefined();
      }
      for (const documentName of [
        'EPA TF CT',
        'EPA- OBSIDIAN CAPITAL GROUP',
        'EPA Nitro Advance',
      ]) {
        expect(isSupplementalSignNowDocumentName(documentName)).toBe(true);
        expect(signNowPrefillDocumentKind(documentName, names)).not.toBe('exhibit_c');
        expect(signNowPrefillDocumentKind(documentName, names)).not.toBe(
          'tiberian_agreement',
        );
      }
    });

    it('fills every CRM-owned widget from the same ids as the Obsidian copy', () => {
      const tiberian = filledFor('EPA TF CT');
      expect(tiberian).toEqual({
        agreement_date_p1: '09/22/2026',
        client_legal_name_p1: 'RE-NEW-IT RENOVATIONS, LLC',
        epo_received_date_1_p1: '10/15/2026',
        epo_amount_received_1_p1: '5,000.00',
        epo_received_date_2_p1: '11/15/2026',
        epo_amount_received_2_p1: '7,500.00',
        epo_received_date_3_p1: '12/15/2026',
        epo_amount_received_3_p1: '10,000.00',
        owner1_guarantor_name_p1: 'MARY IRVIN',
        owner2_guarantor_name_p1: 'JOHN IRVIN',
        guaranty_ss_p1: '123456789',
        guaranty_owner2_ss_p1: '987654321',
      });
      // Same page, three funders: Obsidian's and Nitro's copies must not drift.
      expect(filledFor('EPA- OBSIDIAN CAPITAL GROUP')).toEqual(tiberian);
      expect(filledFor('EPA Nitro Advance')).toEqual(tiberian);
    });

    it('leaves the two signature widgets untouched', () => {
      const opts = signNowPrefillOptionsForDocument('EPA TF CT', names);
      for (const name of ['signature_p1', 'Signature 2']) {
        expect(buildSignNowDocumentPrefillTexts([name], prefill, opts)).toEqual([]);
      }
    });

    /**
     * `EPO` stores three payments, so ledger rows 4 and 5 have no CRM source on
     * any funder's copy. They must stay empty rather than pick up a stray alias
     * (the disclosure money row resolves `text field N` names the same way).
     */
    it('leaves the ledger rows the CRM has no data for empty', () => {
      const tiberian = filledFor('EPA TF CT');
      for (const name of names) {
        if (!/_(4|5)_p1$/.test(name)) continue;
        expect(tiberian[name]).toBeUndefined();
      }
    });
  });

  /**
   * Tiberian Funding's ACH Daily Addendum ("ACH Daily", template d68dd23d…)
   * carries the same 14 widget names as the Nitro (5741b00c…) and Obsidian
   * (634cbdac…) copies of the same page, so it must resolve from the same CRM
   * ids with no funder-specific mapping. This walks the live inventory (see
   * `TIBERIAN_ACH_DAILY_FIELD_NAMES`) and asserts all three titles fill
   * identically, line for line.
   */
  describe('Tiberian ACH Daily Addendum', () => {
    const names = [...TIBERIAN_ACH_DAILY_FIELD_NAMES];
    const prefill = {
      client_name: 'MARY IRVIN',
      client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
      agreement_date: '09/22/2026',
      purchase_amount: '25,000.00',
      remittance: '1,250.00',
      remittance_start_date: '09/29/2026',
      business_address: '3273 COVE CREEK ROAD, ASHEVILLE, NC 28805',
      merchant_contact_phone: '5615778267',
      merchant_contact_email: 'mary@renewit.com',
      ach_authorization_account_holder_name: 'RE-NEW-IT RENOVATIONS, LLC',
      ach_authorization_account_holder_bank_name: 'CHASE',
      ach_authorization_account_holder_bank_account_number: '725307998',
      ach_authorization_account_holder_bank_routing_number: '322271627',
    };

    const filledFor = (documentName: string) =>
      Object.fromEntries(
        buildSignNowDocumentPrefillTexts(
          names,
          prefill,
          signNowPrefillOptionsForDocument(documentName, names),
        ).map((row) => [row.field_name, row.prefilled_text]),
      );

    /**
     * An ACH *Daily* title must never be read as an Exhibit C (some funders'
     * copies are titled "Extra Exhibit C …"), as an ACH Weekly, or — once the
     * row is registered under a funder-badged Settings name — as that funder's
     * agreement. All three copies are left without a documentKind so they share
     * one mapping.
     */
    it('is read as a plain addendum, never as an Exhibit C, ACH Weekly or Tiberian agreement', () => {
      for (const title of [
        'ACH Daily',
        'RECURRING BANK (ACH) PAYMENT AUTHORIZATION - Daily..',
        'ACH DAILY TIBERIAN FUNDING',
      ]) {
        expect(signNowPrefillDocumentKind(title, names)).toBeUndefined();
        expect(isSupplementalSignNowDocumentName(title)).toBe(true);
      }
      expect(signNowPrefillDocumentKind(undefined, names)).toBeUndefined();
    });

    it('fills every Tiberian ACH Daily widget from the same CRM ids as Obsidian', () => {
      const tiberian = filledFor('ACH Daily');
      expect(tiberian).toEqual({
        client_name_p1_ach: 'MARY IRVIN',
        remittance_p1_ach: '1,250.00',
        // resolveRemittanceStartDate: "Starting On" always follows the
        // agreement date, on every funder's copy of this page.
        remittance_start_date_p1_ach: '09/22/2026',
        purchase_amount_p1_ach: '25,000.00',
        business_address_p1_ach: '3273 COVE CREEK ROAD, ASHEVILLE, NC 28805',
        merchant_contact_phone_p1_ach: '5615778267',
        merchant_contact_email_p1_ach: 'mary@renewit.com',
        ach_account_holder_name_p1_ach: 'RE-NEW-IT RENOVATIONS, LLC',
        ach_bank_name_p1_ach: 'CHASE',
        ach_bank_account_p1_ach: '725307998',
        ach_bank_routing_p1_ach: '322271627',
        signature_date_p1_ach: '09/22/2026',
        authorization_client_name_print_p1_ach: 'MARY IRVIN',
      });
      expect(filledFor('RECURRING BANK (ACH) PAYMENT AUTHORIZATION - Daily..')).toEqual(
        tiberian,
      );
      expect(filledFor('ACH DAILY TIBERIAN FUNDING')).toEqual(tiberian);
    });

    /**
     * ACH Daily names its bottom Date / Printed Name pair correctly, so the
     * ACH Weekly positional remap must not reach it: the date belongs in the
     * date box and the printed name in the printed-name box.
     */
    it('keeps the bottom Date / Printed Name pair off the ACH Weekly remap', () => {
      const tiberian = filledFor('ACH Daily');
      expect(tiberian.signature_date_p1_ach).toBe('09/22/2026');
      expect(tiberian.authorization_client_name_print_p1_ach).toBe('MARY IRVIN');
      expect(tiberian.signature_date_p1_ach).not.toBe(
        tiberian.authorization_client_name_print_p1_ach,
      );
    });

    it('leaves the signature widget to the signer', () => {
      expect(filledFor('ACH Daily').signature_p1_ach).toBeUndefined();
      expect(buildSignNowDocumentPrefillTexts(['signature_p1_ach'], prefill)).toEqual([]);
    });
  });

  it('marks contract page 22 reference fields as required for the merchant signer', () => {
    for (const name of CONTRACT_P22_REQUIRED_UNIQUE_NAMES) {
      expect(isDedicatedContractP22RequiredField(name)).toBe(true);
      expect(isMerchantRequiredPage22ReferenceField(name)).toBe(true);
      expect(isMerchantRequiredSignerField(name, 21)).toBe(true);
      expect(usesAddendumFillableFont(name, 21)).toBe(false);
    }
    expect(isMerchantRequiredPage22ReferenceField('Text Field 22', 21)).toBe(true);
    expect(isMerchantRequiredPage22ReferenceField('Text Field 22', 22)).toBe(true);
    expect(isMerchantRequiredSignerField('Text Field 22', 21)).toBe(true);
    expect(usesAddendumFillableFont('Text Field 22', 21)).toBe(false);
    expect(isMerchantRequiredPage22ReferenceField('Text Field 22', 0)).toBe(false);
    expect(
      isMerchantRequiredPage22ReferenceField('Text Field 22', 21, {
        documentKind: 'obsidian_agreement',
      }),
    ).toBe(false);
    expect(
      isMerchantRequiredPage22ReferenceField('Text Field 22', 21, {
        documentKind: 'monthly_fee',
      }),
    ).toBe(false);
    expect(isMerchantRequiredPage22ReferenceField('ref_personal1_name', 21)).toBe(true);
    expect(isMerchantRequiredPage22ReferenceField('emergency_email_p22')).toBe(true);
    expect(isMerchantRequiredPage22ReferenceField('merchant_contact_name_p1')).toBe(false);
    expect(isMerchantRequiredPage22ReferenceField('ach_username_p20')).toBe(false);
    expect(usesAddendumFillableFont('ach_username_p20', 19)).toBe(true);
    expect(usesAddendumFillableFont('ach_username_p1', 0, { documentKind: 'exhibit_c' })).toBe(
      true,
    );
  });

  it('maps ACH Weekly unique names back to contract prefill ids', () => {
    const prefill = {
      client_name: 'Test User',
      remittance: '1250.00',
      remittance_start_date: '2026-08-21',
      purchase_amount: '50000.00',
      business_address: '123 Main St',
      client_email: 'puneet04@fusiontecz.com',
      ach_authorization_account_holder_bank_name: 'Chase',
      ach_authorization_account_holder_bank_routing_number: '021000021',
      owner_print_title: 'OWNER',
    };
    expect(canonicalizeSignNowFieldName('client_name_p1_ach')).toBe('client_name');
    expect(canonicalizeSignNowFieldName('remittance_p1_ach')).toBe('remittance');
    expect(resolveSignNowPrefillValue('client_name_p1_ach', prefill)).toBe('Test User');
    expect(resolveSignNowPrefillValue('remittance_p1_ach', prefill)).toBe('1250.00');
    expect(resolveSignNowPrefillValue('purchase_amount_p1_ach', prefill)).toBe('50000.00');
    expect(resolveSignNowPrefillValue('billing_email_p1_ach', prefill)).toBe(
      'puneet04@fusiontecz.com',
    );
    expect(resolveSignNowPrefillValue('billing_address_p1_ach', prefill)).toBe('123 Main St');
    expect(resolveSignNowPrefillValue('bank_name_p1_ach', prefill)).toBe('Chase');
    expect(resolveSignNowPrefillValue('routing_number_p1_ach', prefill)).toBe('021000021');
    expect(resolveSignNowPrefillValue('print_title_p1_ach', prefill)).toBe('OWNER');
    expect(resolveSignNowPrefillValue('printed_names_p1_ach', prefill)).toBe('Test User');
    expect(resolveSignNowPrefillValue('print_name_p1_ach', prefill)).toBe('Test User');
    expect(resolveSignNowPrefillValue('Date', prefill)).not.toBe('1250.00');
  });

  it('does not put amounts into name fields or names into date fields', () => {
    const prefill = {
      client_name: 'Luis Chavez',
      remittance: '875.00',
      agreement_date: '09/12/2026',
      security_tax_ein: '12-3456789',
      owner2_guarantor_name: 'Mary Irvin',
    };
    expect(resolveSignNowPrefillValue('printed_names', prefill)).toBe('Luis Chavez');
    expect(resolveSignNowPrefillValue('print_name_p1_ach', prefill)).toBe('Luis Chavez');
    expect(resolveSignNowPrefillValue('Date', prefill)).toBe('09/12/2026');
    expect(resolveSignNowPrefillValue('signature_date_p1', prefill)).toBe('09/12/2026');
    expect(resolveSignNowPrefillValue('federal_tax_id_ein_p19_s2', prefill)).toBe('12-3456789');
    expect(resolveSignNowPrefillValue('security_tax_ein_p13_s2', prefill)).toBe('12-3456789');
  });

  it('maps SignNow disclosure unique names back to calculator prefill ids', () => {
    const prefill = {
      disclosure_amount_financed: '50000.00',
      disclosure_recipient_funds: '45000.00',
      disclosure_finance_charge: '15000.00',
      disclosure_estimated_payment: '1250.00',
      disclosure_payment_terms: '12.00%',
      client_name: 'ACME LLC',
      funder_name: 'NITRO ADVANCE',
      disclosure_date: '08/24/2026',
    };
    expect(canonicalizeSignNowFieldName('disclosure_amount_financed_p1_disc')).toBe(
      'disclosure_amount_financed',
    );
    expect(resolveSignNowPrefillValue('total_amount_business_fund_p1', prefill)).toBe(
      '50000.00',
    );
    expect(resolveSignNowPrefillValue('total_amount_of_fund_disbursed_p1', prefill)).toBe(
      '45000.00',
    );
    expect(resolveSignNowPrefillValue('total_dollar_cost_p1', prefill)).toBe('15000.00');
    expect(resolveSignNowPrefillValue('estimated_payment_amount_p1', prefill)).toBe(
      '1250.00',
    );
    expect(resolveSignNowPrefillValue('percent_of_business_income_p1', prefill)).toBe(
      '12.00%',
    );
    expect(resolveSignNowPrefillValue('recipient_name_p1', prefill)).toBe('ACME LLC');
    expect(resolveSignNowPrefillValue('signature_date_p1', prefill)).toBe('08/24/2026');
    expect(resolveSignNowPrefillValue('funder_name_p1', prefill)).toBe('NITRO ADVANCE');
  });

  it('maps CA disclosure Text Field 1-9 and payoff/monthly-fee unique names', () => {
    const prefill = {
      disclosure_amount_financed: '10000.00',
      disclosure_recipient_funds: '8950.00',
      disclosure_apr: '64.46',
      disclosure_avg_monthly_revenue: '25000.00',
      disclosure_finance_charge: '4990.00',
      disclosure_total_payment: '14990.00',
      disclosure_monthly_cost: '3000.00',
      disclosure_estimated_payment: '1499.00',
      frequency: 'DAY',
      client_legal_name: 'FUSIONTECZ',
      client_name: 'TEST USER',
      client_phone: '08827688283',
      doing_business_as: 'FUSION DBA',
      refinance_amount: '900.00',
    };
    expect(shouldSkipSignNowPrefill('Text Field 1')).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 13')).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 22')).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 29')).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 34')).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 35')).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 36')).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 14')).toBe(true);
    expect(resolveSignNowPrefillValue('Text Field 1', prefill)).toBe('10000.00');
    expect(resolveSignNowPrefillValue('Text Field 2', prefill)).toBe('8950.00');
    expect(resolveSignNowPrefillValue('Text Field 3', prefill)).toBe('64.46');
    expect(resolveSignNowPrefillValue('Text Field 5', prefill)).toBe('4990.00');
    expect(resolveSignNowPrefillValue('Text Field 8', prefill)).toBe('1499.00');
    expect(resolveSignNowPrefillValue('Text Field 9', prefill)).toBe('DAY');
    expect(
      resolveSignNowPrefillValue(
        'addendum_p_funder_and_business_namefull_p1',
        prefill,
      ),
    ).toBe('FUSIONTECZ');
    expect(
      resolveSignNowPrefillValue(
        'addendum_p_funder_and_business_namehalf_p1',
        prefill,
      ),
    ).toBe('FUSION DBA');
    expect(resolveSignNowPrefillValue('addendum_p_print_name_p1 T', prefill)).toBe(
      'TEST USER',
    );
    expect(resolveSignNowPrefillValue('addendum_p_pay_up_to_amount_p1', prefill)).toBe(
      '900.00',
    );
    expect(resolveSignNowPrefillValue('authorization_client_name_p1', prefill)).toBe(
      'FUSIONTECZ',
    );
    expect(resolveSignNowPrefillValue('authorized_business_phone_p1', prefill)).toBe(
      '08827688283',
    );
  });

  it('maps Monthly Fee Text Field N slots to business/ACH values, not disclosure amounts', () => {
    const prefill = {
      funding_provided: '10000.00',
      client_legal_name: 'FUSIONTECZ',
      client_phone: '08827688283',
      business_address: '123 MAIN ST',
      ach_authorization_account_holder_name: 'TEST USER',
      doing_business_as: 'FUSION DBA',
      ach_authorization_account_holder_bank_name: 'CHASE',
    };
    const opts = { documentKind: 'monthly_fee' as const };
    expect(resolveSignNowPrefillValue('Text Field 1', prefill, opts)).toBe('FUSIONTECZ');
    expect(resolveSignNowPrefillValue('Text Field 2', prefill, opts)).toBe('08827688283');
    expect(resolveSignNowPrefillValue('Text Field 3', prefill, opts)).toBe('123 MAIN ST');
    const texts = buildSignNowDocumentPrefillTexts(
      ['Text Field 1', 'Text Field 2', 'Text Field 3', 'Text Field 7'],
      prefill,
      opts,
    );
    const byName = Object.fromEntries(
      texts.map((row) => [row.field_name, row.prefilled_text]),
    );
    expect(byName['Text Field 1']).toBe('FUSIONTECZ');
    expect(byName['Text Field 2']).toBe('08827688283');
    expect(byName['Text Field 7']).toBe('CHASE');
  });

  it('does not put a date into Monthly Fee Text Field 11 (variable amount)', () => {
    const opts = { documentKind: 'monthly_fee' as const };
    const prefill = {
      remittance_start_date: '09/08/2026',
      agreement_date: '09/08/2026',
      ach_program_fee: '499.99',
      estimated_number_of_payments: '12',
    };
    expect(isMonthlyFeeForcedBlankField('Text Field 11')).toBe(true);
    expect(resolveSignNowPrefillValue('Text Field 11', prefill, opts)).toBe('');
    expect(resolveSignNowPrefillValue('Text Field 10', prefill, opts)).toBe('499.99');
    expect(resolveSignNowPrefillValue('remittance_start_date_p1', prefill, opts)).toBe(
      '09/08/2026',
    );
    expect(resolveSignNowPrefillValue('remittance_start_date_p1_s1', prefill, opts)).toBe(
      '09/08/2026',
    );
  });

  it('fills remittance_start_date_p3 from agreement_date, not the SignNow date-widget default', () => {
    expect(
      resolveSignNowPrefillValue('remittance_start_date_p3', {
        remittance_start_date_p3: '08/19/2026',
        remittance_start_date: '08/19/2026',
        agreement_date: '09/12/2026',
      }),
    ).toBe('09/12/2026');
    expect(
      formatSignNowPrefillValue(
        resolveSignNowPrefillValue('remittance_start_date_p3', {
          remittance_start_date_p3: '08/19/2026',
        }),
        'remittance_start_date_p3',
      ),
    ).toBe(currentSignNowUsDate());
  });

  it('keeps the ACH program fee out of page-2 TOTAL FEES', () => {
    const base = { origination_fee: '1,000.00' };
    // TOTAL FEES is the underwriting fee (wire fee included upstream) alone.
    expect(resolveSignNowPrefillValue('total_fees_p2', base)).toBe('1,000.00');
    // The ACH box is a separate recurring charge — it must not move TOTAL FEES.
    expect(
      resolveSignNowPrefillValue('total_fees_p2', { ...base, ach_enabled: 'true' }),
    ).toBe('1,000.00');
    expect(
      resolveSignNowPrefillValue('total_fees_p2', { ...base, ach_program_fee: '49.00' }),
    ).toBe('1,000.00');
    // A zero grand total must not print $0.00.
    expect(
      resolveSignNowPrefillValue('total_fees_p2', { ...base, total_fees: '0.00' }),
    ).toBe('1,000.00');
  });

  it('always fills purchase_price / purchased_amount / total_fees / ach_program_fee', () => {
    const prefill = {
      purchase_price: '10000.00',
      purchased_amount: '14900.00',
      purchase_amount: '10000.00',
      net_to_merchant: '8975.00',
      monthly_fee: '49.00',
      doing_business_as: 'FUSION DBA',
    };
    expect(resolveSignNowPrefillValue('purchase_price_p1', prefill)).toBe('10000.00');
    expect(resolveSignNowPrefillValue('purchased_amount_p1', prefill)).toBe('14900.00');
    expect(resolveSignNowPrefillValue('Purchased Amount', prefill)).toBe('14900.00');
    // No explicit total_fees → derive offer − net
    expect(resolveSignNowPrefillValue('total_fees_p1', prefill)).toBe('1,025.00');
    expect(resolveSignNowPrefillValue('ach_program_fee_p13', prefill)).toBe('0.00');
    expect(resolveSignNowPrefillValue('disclosure_page3_line_1_p3', {
      appendix_underwriting_fees: '1,025.00',
      net_to_merchant: '8975.00',
    })).toBe('1,025.00');
    expect(resolveSignNowPrefillValue('disclosure_page3_line_2_p3', {
      refinance_amount: '900.00',
    })).toBe('900.00');
    expect(resolveSignNowPrefillValue('previous_lender_name_p3', {
      refinance_amount: '900.00',
      funder_name: 'NITRO ADVANCE',
    })).toBe('NITRO ADVANCE');
    expect(
      resolveSignNowPrefillValue('ach_program_fee_p13', { ach_program_fee_p1: '49.00' }),
    ).toBe('0.00');
    expect(
      resolveSignNowPrefillValue('ach_program_fee_p1', { monthly_fee: '49.00' }),
    ).toBe('49.00');
    // Agreement widgets use default SignNow names on this template.
    expect(resolveSignNowPrefillValue('Text Field 36', prefill)).toBe('10000.00');
    expect(resolveSignNowPrefillValue('Text Field 35', prefill)).toBe('14900.00');
    expect(resolveSignNowPrefillValue('Text Field 34', prefill)).toBe('1,025.00');
    expect(resolveSignNowPrefillValue('Text Field 29', {})).toBe('OWNER');
    expect(resolveSignNowPrefillValue('Text Field 29', { owner_print_title: 'CEO' })).toBe(
      'CEO',
    );
    expect(resolveSignNowPrefillValue('owner_print_title', {})).toBe('OWNER');
    expect(resolveSignNowPrefillValue('owner_print_title_p12_s1', {})).toBe('OWNER');
    expect(resolveSignNowPrefillValue('ach_account_holder_dba_p1', prefill)).toBe(
      'FUSION DBA',
    );
  });

  it('maps document unique names onto CRM values for Review prefill-texts', () => {
    const prefill = {
      funding_provided: '10000.00',
      disclosure_recipient_funds: '8950.00',
      disclosure_apr: '64.46',
      client_legal_name: 'FUSIONTECZ',
      client_name: 'TEST USER',
      client_phone: '08827688283',
      business_address: '123 MAIN ST',
      ach_authorization_account_holder_bank_name: 'CHASE',
      disclosure_page3_line_2: '900.00',
      funder_name: 'NITRO ADVANCE',
      previous_refi_balance: '900.00',
    };
    const texts = buildSignNowDocumentPrefillTexts(
      [
        'Text Field 1',
        'Text Field 2',
        'Text Field 3',
        'disclosure_page3_3a_p3',
        'disclosure_page3_third_parties_p3',
        'previous_lender_name_p3',
        'addendum_p_funder_and_business_namefull_p1',
        'addendum_p_print_name_p1 T',
        'authorization_client_name_p1',
        'business_address_p1',
        'authorization_client_bank_name_p1',
        'Text Field 13',
      ],
      prefill,
    );
    const byName = Object.fromEntries(
      texts.map((row) => [row.field_name, row.prefilled_text]),
    );
    expect(byName['Text Field 1']).toBe('10000.00');
    expect(byName['Text Field 2']).toBe('8950.00');
    expect(byName['Text Field 3']).toBe('64.46');
    expect(byName.disclosure_page3_3a_p3).toBeUndefined();
    expect(byName.disclosure_page3_third_parties_p3).toBe('0.00');
    expect(byName.previous_lender_name_p3).toBe('NITRO ADVANCE');
    expect(byName.addendum_p_funder_and_business_namefull_p1).toBe('FUSIONTECZ');
    expect(byName['addendum_p_print_name_p1 T']).toBe('TEST USER');
    expect(byName.authorization_client_name_p1).toBe('FUSIONTECZ');
    expect(byName.business_address_p1).toBe('123 MAIN ST');
    expect(byName.authorization_client_bank_name_p1).toBe('CHASE');
    expect(byName['Text Field 13']).toBeUndefined();
  });

  it('uses Verify Prefill page-3 values instead of calculator N/A and 0.00', () => {
    const prefill = {
      disclosure_page3_3a: 'Hello',
      disclosure_page3_3b: 'Hello',
      disclosure_page3_3c: 'Hello',
      disclosure_page3_third_parties: '90',
      disclosure_page3_line_2: '900',
    };
    expect(resolveSignNowPrefillValue('disclosure_page3_3a_p3', prefill)).toBe('Hello');
    expect(resolveSignNowPrefillValue('disclosure_page3_3b_p3', prefill)).toBe('Hello');
    expect(resolveSignNowPrefillValue('disclosure_page3_3c_p3', prefill)).toBe('Hello');
    expect(resolveSignNowPrefillValue('disclosure_page3_third_parties_p3', prefill)).toBe('90');
    expect(resolveSignNowPrefillValue('disclosure_page3_line_2_p3', prefill)).toBe('900');
  });

  it('prefers CRM page-3 values over calculator placeholders on the same canon', () => {
    expect(
      resolveSignNowPrefillValue('disclosure_page3_3a_p3', {
        disclosure_page3_3a: 'N/A',
        disclosure_page3_3a_p3: 'Hello',
      }),
    ).toBe('Hello');
    expect(
      resolveSignNowPrefillValue('disclosure_page3_third_parties_p3', {
        disclosure_page3_third_parties: '0.00',
        disclosure_page3_third_parties_p3: '90',
      }),
    ).toBe('90');
    expect(
      resolveSignNowPrefillValue('disclosure_page3_line_2_p3', {
        disclosure_page3_line_2: '0.00',
        refinance_amount: '900',
      }),
    ).toBe('900');
  });

  it('fills last-page s2 contact slots from owner 1 when there is no owner 2', () => {
    const oneSigner = {
      client_name: 'Test User',
      client_email: 'puneet04@fusiontecz.com',
      client_phone: '08827688283',
      agreement_date: '09/04/2026',
    };
    expect(resolveSignNowPrefillValue('client_name_p26_s2', oneSigner)).toBe(
      'Test User',
    );
    expect(resolveSignNowPrefillValue('client_email_p26_s2', oneSigner)).toBe(
      'puneet04@fusiontecz.com',
    );
    expect(resolveSignNowPrefillValue('client_phone_p26_s2', oneSigner)).toBe(
      '08827688283',
    );
    expect(resolveSignNowPrefillValue('client_phone2_p26_s2', oneSigner)).toBe(
      '08827688283',
    );
    expect(resolveSignNowPrefillValue('signature_date_p26_s2', oneSigner)).toBe(
      '09/04/2026',
    );
    expect(resolveSignNowPrefillValue('client_email_p13_s2', oneSigner)).toBe('');
  });

  it('maps duplicated SignNow unique names and ACH Weekly ach_bank_* fields', () => {
    const prefill = {
      ach_authorization_reference_name2: 'Ref Two',
      ach_authorization_reference_name3: 'Biz Contact',
      ach_authorization_account_holder_bank_name: 'Chase',
      ach_authorization_account_holder_bank_account_number: '123456789',
      ach_authorization_account_holder_bank_routing_number: '021000021',
    };
    expect(
      canonicalizeSignNowFieldName(
        'ref_personal2_name_p22ref_personal2_name_p22',
      ),
    ).toBe('ref_personal2_name');
    expect(
      resolveSignNowPrefillValue(
        'ref_personal2_name_p22ref_personal2_name_p22',
        prefill,
      ),
    ).toBe('Ref Two');
    expect(resolveSignNowPrefillValue('Text Field 22', prefill)).toBe(
      'Biz Contact',
    );
    expect(resolveSignNowPrefillValue('ach_bank_name_p1_ach', prefill)).toBe(
      'Chase',
    );
    expect(resolveSignNowPrefillValue('ach_bank_account_p1_ach', prefill)).toBe(
      '123456789',
    );
    expect(resolveSignNowPrefillValue('ach_bank_routing_p1_ach', prefill)).toBe(
      '021000021',
    );
    expect(resolveSignNowPrefillValue('ach_bank_name_p1', prefill)).toBe(
      'Chase',
    );
  });

  it('maps Obsidian Agreement leftover Text Field N slots from page-1 coordinates', () => {
    const opts = { documentKind: 'obsidian_agreement' as const };
    const prefill = {
      purchase_price: '10000.00',
      purchased_amount: '14900.00',
      specified_percentage: '12.00',
      net_to_merchant: '8975.00',
      agreement_date: '09/04/2026',
      ach_authorization_reference_name1: 'Pat Ref',
      ach_authorization_reference_number1: '5551112222',
      ach_authorization_reference_number2: '5553334444',
      ach_authorization_reference_name3: 'Biz Contact',
    };
    expect(shouldSkipSignNowPrefill('Text Field 23', opts)).toBe(false);
    expect(shouldSkipSignNowPrefill('Text Field 23')).toBe(true);
    expect(resolveSignNowPrefillValue('Text Field 15', prefill, opts)).toBe('$');
    expect(resolveSignNowPrefillValue('Text Field 17', prefill, opts)).toBe('%');
    expect(resolveSignNowPrefillValue('Text Field 23', prefill, opts)).toBe(
      '10000.00',
    );
    expect(resolveSignNowPrefillValue('Text Field 24', prefill, opts)).toBe(
      '14900.00',
    );
    expect(resolveSignNowPrefillValue('Text Field 25', prefill, opts)).toBe(
      '12.00',
    );
    expect(resolveSignNowPrefillValue('Text Field 27', prefill, opts)).toBe(
      '1,025.00',
    );
    expect(resolveSignNowPrefillValue('Text Field 22', prefill, opts)).toBe('$');
    expect(resolveSignNowPrefillValue('Text Field 22', prefill)).toBe(
      'Biz Contact',
    );
    expect(resolveSignNowPrefillValue('Text Field 88', prefill, opts)).toBe(
      'Pat Ref',
    );
    expect(resolveSignNowPrefillValue('Text Field 91', prefill, opts)).toBe(
      '5553334444',
    );
    expect(
      resolveSignNowPrefillValue('ref_personal2_phone_p22', prefill, opts),
    ).toBe('5551112222');
    expect(
      resolveSignNowPrefillValue(
        'Bussiness_Reference1_contact_nummber',
        prefill,
      ),
    ).toBe('Biz Contact');
    expect(resolveSignNowPrefillValue('Date and Time 1', prefill)).toBe(
      '09/04/2026',
    );
    expect(resolveSignNowPrefillValue('Text Field 32', {})).toBe('OWNER');
    expect(
      signNowPrefillDocumentKind('Obsidian Capital Group - Agreement 1'),
    ).toBe('obsidian_agreement');
  });

  /**
   * Tiberian Funding's contract is Nitro's agreement plus one extra page
   * (viewer page 22, "Declaration of Ordinary Course of Business"), so every
   * later page shifts by one while the widget names keep their original `_p22`
   * … `_p26` suffixes. Names and coordinates below are from the live template
   * (document group 13ab1bd4…, document adf5b131…).
   */
  describe('Tiberian Funding agreement', () => {
    const opts = { documentKind: 'tiberian_agreement' as const };
    const prefill = {
      client_legal_name: 'ACME WIDGETS LLC',
      client_name: 'JANE OWNER',
      owner2_guarantor_name: 'JOHN OWNER2',
      owner2_email: 'john@acme.com',
      agreement_date: '09/21/2026',
      purchase_price: '50000.00',
      purchased_amount: '72500.00',
      net_to_merchant: '48500.00',
      appendix_underwriting_fees: '1475.00',
      guarantor_name: 'JANE OWNER',
      guarantor_phone: '8605551234',
      guarantor_email: 'jane@acme.com',
    };

    it('recognises the template by document name and by field signature', () => {
      expect(signNowPrefillDocumentKind('CONTRACT TIBERIAN FUNDING (2)')).toBe(
        'tiberian_agreement',
      );
      expect(
        signNowPrefillDocumentKind(undefined, [
          'merchant_pg22',
          'p1_totalfee',
          'client_legal_name',
        ]),
      ).toBe('tiberian_agreement');
      // Nitro's copy of the same contract must not be caught by either check.
      expect(signNowPrefillDocumentKind('Agreement - Nitro Advance')).toBeUndefined();
    });

    it('fills the extra page-22 Declaration of Ordinary Course of Business', () => {
      expect(resolveSignNowPrefillValue('date_pg22', prefill, opts)).toBe(
        '09/21/2026',
      );
      expect(resolveSignNowPrefillValue('merchant_pg22', prefill, opts)).toBe(
        'ACME WIDGETS LLC',
      );
      expect(resolveSignNowPrefillValue('seller_pg22', prefill, opts)).toBe(
        'JANE OWNER',
      );
      expect(resolveSignNowPrefillValue('seller2_pg22', prefill, opts)).toBe(
        'JOHN OWNER2',
      );
      // The page's two signature widgets keep SignNow's default names.
      expect(shouldSkipSignNowPrefill('Signature8_pg22', opts)).toBe(true);
      expect(shouldSkipSignNowPrefill('Signature9_pg22', opts)).toBe(true);
    });

    it('leaves the seller-2 Declaration name blank when there is no second owner', () => {
      const soleOwner = { client_name: 'JANE OWNER', client_legal_name: 'ACME WIDGETS LLC' };
      expect(resolveSignNowPrefillValue('seller2_pg22', soleOwner, opts)).toBe('');
      expect(resolveSignNowPrefillValue('seller_pg22', soleOwner, opts)).toBe(
        'JANE OWNER',
      );
    });

    it('maps the unnamed reference-page contact slots, not the disclosure amounts', () => {
      expect(resolveSignNowPrefillValue('Text Field 283', prefill, opts)).toBe(
        'JANE OWNER',
      );
      // Raw here; `formatSignNowPrefillValue` dashes it for the phone widget.
      expect(resolveSignNowPrefillValue('Text Field 285', prefill, opts)).toBe(
        '8605551234',
      );
      expect(resolveSignNowPrefillValue('Text Field 287', prefill, opts)).toBe(
        'jane@acme.com',
      );
      // `Text Field 22` stays the business-reference-1 contact, as on Nitro.
      expect(isMerchantRequiredPage22ReferenceField('Text Field 22', 22, opts)).toBe(
        true,
      );
      expect(
        isDedicatedContractP22RequiredField('ref_personal1_name_p22'),
      ).toBe(true);
    });

    it('never writes over the printed $ / % glyphs on the page-2 money row', () => {
      for (const name of [
        'Text Field 438',
        'Text Field 439',
        'Text Field 440',
        'Text Field 441',
        'Text Field 442',
        'Text Field 443',
      ]) {
        expect(shouldSkipSignNowPrefill(name, opts)).toBe(true);
      }
    });

    it('names the page-2 money row that Nitro leaves on SignNow defaults', () => {
      // TOTAL FEES = underwriting fee + ACH program fee, same as Nitro's `Text Field 34`.
      expect(resolveSignNowPrefillValue('p1_totalfee', prefill, opts)).toBe(
        '1,475.00',
      );
      // These pass the CRM amount straight through; only the computed TOTAL
      // FEES above is formatted at resolve time.
      expect(resolveSignNowPrefillValue('Text Field 36', prefill, opts)).toBe(
        '50000.00',
      );
      expect(resolveSignNowPrefillValue('purchased_amount', prefill, opts)).toBe(
        '72500.00',
      );
      expect(resolveSignNowPrefillValue('net_to_merchant', prefill, opts)).toBe(
        '48500.00',
      );
    });

    it('keeps the Notification of Assignment merchant list blank', () => {
      // Tiberian transposed the last line to `assignment_merchant13_line_p24`.
      expect(
        shouldSkipSignNowPrefill('assignment_merchant13_line_p24', opts),
      ).toBe(true);
      expect(
        shouldSkipSignNowPrefill('assignment_merchant_line12_p24', opts),
      ).toBe(true);
      expect(resolveSignNowPrefillValue('case_id_p24', { case_id: 'CASE-1' }, opts)).toBe(
        'CASE-1',
      );
    });

    it('skips the default-named and typo’d signature / initials widgets', () => {
      for (const name of [
        'Initials 47',
        'Initials 48',
        'Initials 6',
        'initial_g21_p6',
        'initia2_g1_p19',
        'initial_g1_p27',
        'initial_g2_p27',
      ]) {
        expect(shouldSkipSignNowPrefill(name, opts)).toBe(true);
      }
      // `signature_date` text tabs must still be filled.
      expect(shouldSkipSignNowPrefill('signature_date_p23_g1', opts)).toBe(false);
      expect(
        resolveSignNowPrefillValue('signature_date_p23_g1', prefill, opts),
      ).toBe('09/21/2026');
    });

    it('still marks the page-20 ACH bank slots merchant-required', () => {
      for (const name of [
        'ach_bank_name_p20',
        'ach_bank_portal_p20',
        'ach_bank_account_p20',
        'ach_bank_routing_p20',
        'ach_username_p20',
        'ach_password_p20',
        'ach_security_q2_p20',
        'Text Field 13',
      ]) {
        expect(isMerchantRequiredSignerField(name, 19, opts)).toBe(true);
      }
    });
  });

  it('treats addenda and disclosures as supplemental SignNow documents', () => {
    expect(isSupplementalSignNowDocumentName('NY State Disclosure')).toBe(true);
    expect(isSupplementalSignNowDocumentName('Addendum P')).toBe(true);
    expect(isSupplementalSignNowDocumentName('ACH Authorization')).toBe(true);
    expect(isSupplementalSignNowDocumentName('Monthly Fee Addendum')).toBe(true);
    expect(isSupplementalSignNowDocumentName('Nitro Advance Agreement')).toBe(
      false,
    );
    expect(
      isSupplementalSignNowDocumentName('Obsidian Capital Group - Agreement 1'),
    ).toBe(false);
  });
});

/**
 * Funder disclosure copies. Verified against the live SignNow templates:
 * Nitro Advance ce1229f1… ("Disclosure - Nitro Advance"), Obsidian Capital
 * Group 445770b8… ("Disclosure Obsidian Capital Group") and Tiberian Funding
 * 46bffdc5… ("Tiberian Funding - Disclosure"). All three carry the same 31
 * widgets under the same names, so one field map fills all three.
 */
describe('funder disclosure templates', () => {
  /** The live widget names, in page order, on all three disclosure copies. */
  const DISCLOSURE_WIDGETS = [
    'Text Field 1',
    'Text Field 2',
    'Text Field 3',
    'Text Field 4',
    'Text Field 5',
    'Text Field 6',
    'Text Field 7',
    'Text Field 8',
    'disclouser_pg2_frequency',
    'payement_exceeded_percent_p2_s1',
    'estimated_term_p2',
    'finance_charge_p2',
    'signature_date_p2',
    'disclosure_recipient_funds_p3',
    'disclosure_page3_line_1_p3',
    'disclosure_page3_third_parties_p3',
    'previous_lender_name_p3',
    'disclosure_page3_line_2_p3',
    'disclosure_page3_subtotal_p3',
    'disclosure_broker_fee_p3',
    'disclosure_page3_net_p3',
  ];

  /** The disclosure prefill the CRM emits (already expanded to PDF ids). */
  const DISCLOSURE_PREFILL: Record<string, string> = {
    'Text Field 1': '50,000.00',
    'Text Field 2': '48,525.00',
    'Text Field 3': '41.23',
    'Text Field 4': '120,000.00',
    'Text Field 5': '22,500.00',
    'Text Field 6': '72,500.00',
    'Text Field 7': '9,000.00',
    'Text Field 8': '1,208.33',
    disclouser_pg2_frequency: 'DAY',
    disclosure_payment_terms: '12',
    payement_exceeded_percent_p2_s1: '12',
    disclosure_term_days: '60',
    estimated_term_p2: '60',
    disclosure_finance_charge: '22,500.00',
    finance_charge_p2: '22,500.00',
    disclosure_date: '09/21/2026',
    signature_date_p2: '09/21/2026',
    disclosure_recipient_funds: '48,525.00',
    disclosure_recipient_funds_p3: '48,525.00',
    disclosure_page3_line_1: '1,475.00',
    disclosure_page3_line_1_p3: '1,475.00',
    disclosure_page3_third_parties_p3: '0.00',
    disclosure_page3_line_2: '0.00',
    disclosure_page3_line_2_p3: '0.00',
    disclosure_page3_subtotal: '48,525.00',
    disclosure_page3_subtotal_p3: '48,525.00',
    disclosure_broker_fee: '1,475.00',
    disclosure_broker_fee_p3: '1,475.00',
    disclosure_page3_net: '47,050.00',
    disclosure_page3_net_p3: '47,050.00',
    previous_lender_name: '',
    previous_lender_name_p3: '',
  };

  function filled(documentName: string): Record<string, string> {
    const options = signNowPrefillOptionsForDocument(documentName, DISCLOSURE_WIDGETS);
    const out: Record<string, string> = {};
    for (const text of buildSignNowDocumentPrefillTexts(
      DISCLOSURE_WIDGETS,
      DISCLOSURE_PREFILL,
      options,
    )) {
      out[text.field_name] = text.prefilled_text;
    }
    return out;
  }

  it.each([
    ['Disclosure - Nitro Advance'],
    ['Disclosure Obsidian Capital Group'],
    ['Tiberian Funding - Disclosure'],
  ])('%s is a disclosure, never that funder’s agreement layout', (documentName) => {
    // `OBSIDIAN_AGREEMENT_TEXT_FIELDS` / `TIBERIAN_AGREEMENT_TEXT_FIELDS` key off
    // the funder name and would claim these numbered widgets for contract values.
    expect(signNowPrefillDocumentKind(documentName, DISCLOSURE_WIDGETS)).toBeUndefined();
  });

  it('fills every Tiberian disclosure widget the same as the Obsidian copy', () => {
    const tiberian = filled('Tiberian Funding - Disclosure');
    const obsidian = filled('Disclosure Obsidian Capital Group');
    expect(tiberian).toEqual(obsidian);
    expect(tiberian).toEqual(filled('Disclosure - Nitro Advance'));
  });

  it('puts the CA page-1 money row on the Tiberian numbered widgets', () => {
    const out = filled('Tiberian Funding - Disclosure');
    expect(out['Text Field 1']).toBe('50,000.00');
    expect(out['Text Field 2']).toBe('48,525.00');
    expect(out['Text Field 3']).toBe('41.23');
    expect(out['Text Field 4']).toBe('120,000.00');
    expect(out['Text Field 5']).toBe('22,500.00');
    expect(out['Text Field 6']).toBe('72,500.00');
    expect(out['Text Field 7']).toBe('9,000.00');
    expect(out['Text Field 8']).toBe('1,208.33');
  });

  it('fills the Tiberian page-2 and page-3 ledger widgets', () => {
    const out = filled('Tiberian Funding - Disclosure');
    expect(out.disclouser_pg2_frequency).toBe('DAY');
    expect(out.payement_exceeded_percent_p2_s1).toBe('12');
    expect(out.estimated_term_p2).toBe('60');
    expect(out.finance_charge_p2).toBe('22,500.00');
    expect(out.signature_date_p2).toBe('09/21/2026');
    expect(out.disclosure_recipient_funds_p3).toBe('48,525.00');
    expect(out.disclosure_page3_line_1_p3).toBe('1,475.00');
    expect(out.disclosure_page3_subtotal_p3).toBe('48,525.00');
    expect(out.disclosure_broker_fee_p3).toBe('1,475.00');
    expect(out.disclosure_page3_net_p3).toBe('47,050.00');
  });

  it('still reads the Tiberian agreement itself as the agreement', () => {
    expect(
      signNowPrefillDocumentKind('CONTRACT TIBERIAN FUNDING (2)', [
        'merchant_pg22',
        'p1_totalfee',
      ]),
    ).toBe('tiberian_agreement');
  });
});

/**
 * Tiberian's copy of the state disclosure is titled just "TIBERIAN FUNDING", so
 * the funder-name test claimed it as that funder's agreement and the agreement's
 * numbered-widget table was free to stamp contract values into the disclosure's
 * money row.
 */
describe('a funder-named disclosure is never that funder\'s agreement', () => {
  const DISCLOSURE_FIELDS = [
    'Text Field 1',
    'Text Field 8',
    'disclouser_pg2_frequency',
    'estimated_term_p2',
    'finance_charge_p2',
    'disclosure_page3_net_p3',
  ];

  it('classifies "TIBERIAN FUNDING" by its widgets, not its title', () => {
    expect(hasDisclosureFieldSignature(DISCLOSURE_FIELDS)).toBe(true);
    expect(signNowPrefillDocumentKind('TIBERIAN FUNDING', DISCLOSURE_FIELDS)).toBeUndefined();
  });

  it('does the same for an Obsidian-titled copy', () => {
    expect(
      signNowPrefillDocumentKind('OBSIDIAN CAPITAL GROUP', DISCLOSURE_FIELDS),
    ).toBeUndefined();
  });

  it('still reads the Tiberian agreement as the Tiberian agreement', () => {
    expect(hasDisclosureFieldSignature(['merchant_pg22', 'p1_totalfee'])).toBe(false);
    expect(
      signNowPrefillDocumentKind('CONTRACT TIBERIAN FUNDING', ['merchant_pg22', 'p1_totalfee']),
    ).toBe('tiberian_agreement');
  });

  it('resolves the disclosure term from the offer override, not the payload', () => {
    const values = { estimated_term_p2: '20', estimated_term: '140', disclosure_term_days: '140' };
    const opts = signNowPrefillOptionsForDocument('TIBERIAN FUNDING', DISCLOSURE_FIELDS);
    // The override wins because `buildOfferPrefillOverrides` now writes the widget
    // name itself; the point here is that the disclosure kind no longer diverts it.
    expect(opts?.documentKind).toBeUndefined();
    expect(resolveSignNowPrefillValue('estimated_term_p2', { ...values, estimated_term_p2: '140' }, opts)).toBe('140');
  });
  describe('business vs merchant address separation', () => {
    /**
     * The business physical address (Application → Business) and the merchant
     * contact address (Owner 1's home) are two different CRM entries. They used
     * to alias each other — and the contract's contact line was explicitly
     * mirrored onto the business address — so both blocks printed whichever one
     * was populated. These cover the split on every funder's package.
     */
    const prefill = {
      business_address: '218 LAUREL WOODS',
      business_address_city: 'WARNER ROBINS',
      business_address_state: 'GA',
      business_address_zip: '31088',
      business_address_contract: '77 PINE RIDGE DR',
      business_address_contract_city: 'MACON',
      business_address_contract_state: 'GA',
      business_address_contract_zip: '31201',
    };
    const businessFull = '218 LAUREL WOODS, WARNER ROBINS, GA 31088';
    const ownerFull = '77 PINE RIDGE DR, MACON, GA 31201';

    it('composes the business block from the business address, street + city/state/zip', () => {
      expect(resolveSignNowPrefillValue('business_address', prefill)).toBe(businessFull);
      expect(resolveSignNowPrefillValue('business_address_p1', prefill)).toBe(businessFull);
      expect(resolveSignNowPrefillValue('business_address_p2', prefill)).toBe(businessFull);
      expect(resolveSignNowPrefillValue('business_address_p1_ach', prefill)).toBe(businessFull);
    });

    it('composes the merchant block from the owner address, street + city/state/zip', () => {
      expect(resolveSignNowPrefillValue('business_address_contract', prefill)).toBe(ownerFull);
      expect(resolveSignNowPrefillValue('business_address_contract_p2', prefill)).toBe(ownerFull);
      // The guarantor block has its own city/state/zip widgets on the page, so it
      // stays street-only — but the street is still the owner's, not the business's.
      expect(resolveSignNowPrefillValue('guarantor_address_p1', prefill)).toBe(
        '77 PINE RIDGE DR',
      );
      expect(resolveSignNowPrefillValue('guarantor_address_city_p1', prefill)).toBe('MACON');
    });

    it('never lets one address stand in for the other when only one is on file', () => {
      const businessOnly = {
        business_address: prefill.business_address,
        business_address_city: prefill.business_address_city,
        business_address_state: prefill.business_address_state,
        business_address_zip: prefill.business_address_zip,
      };
      expect(resolveSignNowPrefillValue('business_address_contract', businessOnly)).toBe('');
      const ownerOnly = {
        business_address_contract: prefill.business_address_contract,
        business_address_contract_city: prefill.business_address_contract_city,
        business_address_contract_state: prefill.business_address_contract_state,
        business_address_contract_zip: prefill.business_address_contract_zip,
      };
      expect(resolveSignNowPrefillValue('business_address', ownerOnly)).toBe('');
      // The ACH holder line is Owner 1's address, so a package that only carries
      // the business address leaves it blank rather than repeating that address.
      expect(resolveSignNowPrefillValue('ach_account_holder_address_p1', businessOnly)).toBe('');
    });

    it('keeps the ACH account-holder block on Owner 1 and billing on the business', () => {
      expect(resolveSignNowPrefillValue('ach_account_holder_address_p1', prefill)).toBe(
        ownerFull,
      );
      // ACH Weekly's billing block has its own city/state/zip widgets, so the
      // street stands alone there — it just has to be the business street.
      expect(resolveSignNowPrefillValue('billing_address_p1_ach', prefill)).toBe(
        '218 LAUREL WOODS',
      );
      expect(resolveSignNowPrefillValue('billing_city_p1_ach', prefill)).toBe('WARNER ROBINS');
      expect(resolveSignNowPrefillValue('billing_zip_p1_ach', prefill)).toBe('31088');
    });

    /**
     * Every funder's addendums (ACH Daily, ACH Weekly, Exhibit C, Monthly Fee)
     * carry the merchant address as one widget with no city/state/zip boxes
     * beside it, and the CRM sends that street under the holder key or under the
     * widget's own name while the city/state/zip only travel under
     * `business_address_*`. The siblings are pulled through the alias chain so
     * those pages print the whole address instead of a bare street.
     */
    describe('addendum address widgets', () => {
      const cityStateZip = {
        business_address_city: 'WARNER ROBINS',
        business_address_state: 'GA',
        business_address_zip: '31088',
      };
      const ownerCityStateZip = {
        business_address_contract_city: 'MACON',
        business_address_contract_state: 'GA',
        business_address_contract_zip: '31201',
      };

      it('composes the Monthly Fee holder address from Owner 1 city keys', () => {
        const addendum = {
          ...ownerCityStateZip,
          ach_account_holder_address: '77 PINE RIDGE DR',
        };
        expect(resolveSignNowPrefillValue('ach_account_holder_address_p1', addendum)).toBe(
          ownerFull,
        );
        expect(
          resolveSignNowPrefillValue('Text Field 6', addendum, { documentKind: 'monthly_fee' }),
        ).toBe(ownerFull);
      });

      /**
       * Exhibit C and the agreement's ACH page print "c. Account Holder Business
       * Address:" — the business's physical address on every funder's copy, never
       * the guarantor's home address that the holder keys carry.
       */
      describe('the Account Holder Business Address line', () => {
        const exhibitC = { documentKind: 'exhibit_c' as const };
        const withHolderOnOwner = {
          ...prefill,
          ach_authorization_account_holder_address: prefill.business_address_contract,
          ach_account_holder_address: ownerFull,
          ach_account_holder_address_p1: ownerFull,
        };

        it('prints the full business address on the named Exhibit C (Nitro, Tiberian)', () => {
          expect(
            resolveSignNowPrefillValue('ach_account_holder_address_p1', withHolderOnOwner, exhibitC),
          ).toBe(businessFull);
        });

        it('prints the full business address on the numbered Exhibit C (Obsidian)', () => {
          expect(resolveSignNowPrefillValue('Text Field 3', withHolderOnOwner, exhibitC)).toBe(
            businessFull,
          );
        });

        it('prints the full business address on the agreement ACH page', () => {
          for (const documentKind of [
            undefined,
            'obsidian_agreement' as const,
            'tiberian_agreement' as const,
          ]) {
            expect(
              resolveSignNowPrefillValue('ach_account_holder_address_p19', withHolderOnOwner, {
                documentKind,
              }),
            ).toBe(businessFull);
          }
        });

        it('leaves the line blank rather than printing Owner 1 when no business address is on file', () => {
          const ownerOnly = {
            business_address_contract: prefill.business_address_contract,
            business_address_contract_city: prefill.business_address_contract_city,
            business_address_contract_state: prefill.business_address_contract_state,
            business_address_contract_zip: prefill.business_address_contract_zip,
            ach_authorization_account_holder_address: prefill.business_address_contract,
          };
          expect(resolveSignNowPrefillValue('Text Field 3', ownerOnly, exhibitC)).toBe('');
          expect(resolveSignNowPrefillValue('ach_account_holder_address_p19', ownerOnly)).toBe('');
        });

        it('keeps the Monthly Fee holder block on Owner 1', () => {
          expect(
            resolveSignNowPrefillValue('ach_account_holder_address_p1', withHolderOnOwner, {
              documentKind: 'monthly_fee',
            }),
          ).toBe(ownerFull);
        });

        it('keeps the Monthly Fee on Owner 1 when the shared widget carries the business', () => {
          // Exhibit C / ACH Daily put the business under the same widget name.
          const shared = {
            ...withHolderOnOwner,
            ach_account_holder_address_p1: businessFull,
          };
          expect(
            resolveSignNowPrefillValue('ach_account_holder_address_p1', shared, {
              documentKind: 'monthly_fee',
            }),
          ).toBe(ownerFull);
        });
      });

      it('composes an ACH page whose street arrives under the widget name itself', () => {
        expect(
          resolveSignNowPrefillValue('business_address_p1_ach', {
            ...cityStateZip,
            business_address_p1_ach: '218 LAUREL WOODS',
          }),
        ).toBe(businessFull);
      });

      /**
       * The CRM screen mirrored whatever was typed into the business street onto
       * `achAuthorizationAccountHolderAddress`, so the Monthly Fee and Exhibit C
       * addendums printed the business street on the account-holder line — and
       * then composed it with Owner 1's city/state/zip, because those are the
       * only siblings the holder key has. The holder line is Owner 1's address.
       */
      describe('a holder address that is only a copy of the business address', () => {
        const mirrored = {
          ...prefill,
          ach_authorization_account_holder_address: prefill.business_address,
        };

        it('falls through to Owner 1 on the Monthly Fee addendum', () => {
          expect(resolveSignNowPrefillValue('ach_account_holder_address_p1', mirrored)).toBe(
            ownerFull,
          );
        });

        it('prints the business address on Exhibit C, whose line is the business address', () => {
          expect(
            resolveSignNowPrefillValue('Text Field 3', mirrored, {
              documentKind: 'exhibit_c',
            }),
          ).toBe(businessFull);
        });

        it('never pairs the business street with Owner 1 city/state/zip', () => {
          expect(
            resolveSignNowPrefillValue('ach_account_holder_address_p1', mirrored),
          ).not.toContain('218 LAUREL WOODS');
        });

        it('keeps a holder address that is genuinely its own', () => {
          const ownItsOwn = {
            ...prefill,
            ach_authorization_account_holder_address: '9 OAK ST',
          };
          expect(resolveSignNowPrefillValue('ach_account_holder_address_p1', ownItsOwn)).toBe(
            '9 OAK ST, MACON, GA 31201',
          );
        });

        it('keeps the mirrored value when Owner 1 has no address of his own', () => {
          const noOwner = {
            business_address: prefill.business_address,
            business_address_city: prefill.business_address_city,
            business_address_state: prefill.business_address_state,
            business_address_zip: prefill.business_address_zip,
            ach_authorization_account_holder_address: prefill.business_address,
          };
          // Street-only, as it has always been: the holder key has no city/state/zip
          // siblings of its own, and the business block's are not its to borrow.
          expect(resolveSignNowPrefillValue('ach_account_holder_address_p1', noOwner)).toBe(
            prefill.business_address,
          );
        });

        it('leaves the business line itself on the business address', () => {
          expect(resolveSignNowPrefillValue('business_address_p1', mirrored)).toBe(businessFull);
        });
      });

      it('leaves a street that already ends in a zip alone', () => {
        expect(
          resolveSignNowPrefillValue('ach_account_holder_address_p1', {
            ...ownerCityStateZip,
            ach_account_holder_address: '9 OAK ST, MACON, GA 31201',
          }),
        ).toBe('9 OAK ST, MACON, GA 31201');
      });
    });

    /**
     * The OWNER/GUARANTOR #1 block and the page-23 service-of-process line carry
     * one address widget with no city/state/zip boxes beside them, while Owner
     * 2's address arrives as a single line — so Owner 1 printed a bare street
     * next to Owner 2's full address. The document's own widget list decides:
     * companion boxes on the page means street-only, none means compose.
     */
    describe('standalone guarantor address widgets', () => {
      it('composes the guarantor address on a page with no city/state/zip boxes', () => {
        const names = ['guarantor_address_p23', 'guarantor_address_p23_g2'];
        expect(
          resolveSignNowPrefillValue('guarantor_address_p23', prefill, {
            documentFieldCanons: signNowDocumentFieldCanons(names),
          }),
        ).toBe(ownerFull);
      });

      it('leaves it street-only on a page that has its own city/state/zip boxes', () => {
        const names = [
          'guarantor_address_p1',
          'guarantor_address_city_p1',
          'guarantor_address_state_p1',
          'guarantor_address_zip_p1',
        ];
        const opts = { documentFieldCanons: signNowDocumentFieldCanons(names) };
        expect(resolveSignNowPrefillValue('guarantor_address_p1', prefill, opts)).toBe(
          '77 PINE RIDGE DR',
        );
        expect(resolveSignNowPrefillValue('guarantor_address_city_p1', prefill, opts)).toBe(
          'MACON',
        );
      });

      it('stays street-only when the document field list is unknown', () => {
        expect(resolveSignNowPrefillValue('guarantor_address_p23', prefill)).toBe(
          '77 PINE RIDGE DR',
        );
      });

      it('leaves Owner 2 alone — that address already arrives as one line', () => {
        const names = ['guarantor_address_p23_g2'];
        expect(
          resolveSignNowPrefillValue(
            'guarantor_address_p23_g2',
            {
              ...prefill,
              client_name: 'MARY IRVIN',
              owner2_guarantor_name: 'PIYUSHKUMAR V PATEL',
              owner2_address: '11000 DELAWAKRE PKWY, APT 2201, KANSAS CITY, KS, 66109',
            },
            { documentFieldCanons: signNowDocumentFieldCanons(names) },
          ),
        ).toBe('11000 DELAWAKRE PKWY, APT 2201, KANSAS CITY, KS, 66109');
      });
    });

    it('resolves the merchant address from the guarantor keys the CRM sends', () => {
      const fromGuarantor = {
        guarantor_address: '77 PINE RIDGE DR',
        guarantor_address_city: 'MACON',
        guarantor_address_state: 'GA',
        guarantor_address_zip: '31201',
      };
      expect(resolveSignNowPrefillValue('business_address_contract', fromGuarantor)).toBe(
        ownerFull,
      );
    });
  });
});

/**
 * The bank block on every funder's addendums.
 *
 * Account Holder Bank Name / Account Number / Routing Number reached SignNow
 * from the CRM screen's payload alone, so a package the screen posted without
 * them went out with "Enter text" on all three lines of the Monthly Fee page,
 * Exhibit C and the ACH authorization. `loadContractPrefillDefaults` now
 * publishes the deal's own bank block under the ids below; these are the widget
 * names those ids have to reach, taken from the live Nitro and Tiberian
 * templates.
 */
describe('the bank block reaches every addendum', () => {
  /** Exactly what the server publishes for a deal whose bank is on file. */
  const bankDefaults = {
    authorization_client_bank_name: 'SBI Morgan',
    ach_authorization_account_holder_bank_name: 'SBI Morgan',
    ach_bank_name: 'SBI Morgan',
    authorization_client_bank_account: '123456789',
    ach_authorization_account_holder_bank_account_number: '123456789',
    ach_bank_account: '123456789',
    authorization_client_bank_routing: '987654321',
    ach_authorization_account_holder_bank_routing_number: '987654321',
    ach_bank_routing: '987654321',
  };

  it('fills the Monthly Fee bank lines', () => {
    const opts = { documentKind: 'monthly_fee' as const };
    expect(
      resolveSignNowPrefillValue('authorization_client_bank_name_p1', bankDefaults, opts),
    ).toBe('SBI Morgan');
    expect(
      resolveSignNowPrefillValue('authorization_client_bank_account_p1', bankDefaults, opts),
    ).toBe('123456789');
    expect(
      resolveSignNowPrefillValue('authorization_client_bank_routing_p1', bankDefaults, opts),
    ).toBe('987654321');
  });

  it('fills the Monthly Fee bank lines on a funder using the numbered layout', () => {
    // Text Field 7 / 8 / 9 are the bank name / routing / account slots.
    const opts = { documentKind: 'monthly_fee' as const };
    expect(resolveSignNowPrefillValue('Text Field 7', bankDefaults, opts)).toBe('SBI Morgan');
    expect(resolveSignNowPrefillValue('Text Field 8', bankDefaults, opts)).toBe('987654321');
    expect(resolveSignNowPrefillValue('Text Field 9', bankDefaults, opts)).toBe('123456789');
  });

  it('fills the Exhibit C bank lines', () => {
    const opts = { documentKind: 'exhibit_c' as const };
    expect(resolveSignNowPrefillValue('ach_bank_name_p1', bankDefaults, opts)).toBe('SBI Morgan');
    expect(resolveSignNowPrefillValue('ach_bank_account_p1', bankDefaults, opts)).toBe(
      '123456789',
    );
    expect(resolveSignNowPrefillValue('ach_bank_routing_p1', bankDefaults, opts)).toBe(
      '987654321',
    );
  });

  it('fills the ACH authorization bank lines', () => {
    const opts = { documentKind: 'ach_weekly' as const };
    expect(resolveSignNowPrefillValue('ach_bank_name_p1_ach', bankDefaults, opts)).toBe(
      'SBI Morgan',
    );
    expect(resolveSignNowPrefillValue('ach_bank_account_p1_ach', bankDefaults, opts)).toBe(
      '123456789',
    );
    expect(resolveSignNowPrefillValue('ach_bank_routing_p1_ach', bankDefaults, opts)).toBe(
      '987654321',
    );
  });

  it('never prints the routing number where the account number belongs', () => {
    const opts = { documentKind: 'exhibit_c' as const };
    expect(resolveSignNowPrefillValue('ach_bank_account_p1', bankDefaults, opts)).not.toBe(
      bankDefaults.ach_bank_routing,
    );
  });

  it('leaves the lines blank when the deal has no bank on file', () => {
    const opts = { documentKind: 'exhibit_c' as const };
    expect(resolveSignNowPrefillValue('ach_bank_name_p1', {}, opts)).toBe('');
    expect(resolveSignNowPrefillValue('ach_bank_account_p1', {}, opts)).toBe('');
  });
});
