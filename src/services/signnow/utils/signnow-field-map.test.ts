import {
  buildSignNowDocumentPrefillTexts,
  canonicalizeSignNowFieldName,
  currentSignNowUsDate,
  formatSignNowPrefillValue,
  CONTRACT_P22_REQUIRED_UNIQUE_NAMES,
  EXHIBIT_C_REQUIRED_UNIQUE_NAMES,
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
  shouldSkipSignNowPrefill,
  signNowPrefillDocumentKind,
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
      business_address_contract: '123 MAIN ST',
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
      business_address_contract: '123 MAIN ST',
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
