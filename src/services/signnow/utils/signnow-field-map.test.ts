import {
  buildSignNowDocumentPrefillTexts,
  canonicalizeSignNowFieldName,
  formatSignNowPrefillValue,
  resolveSignNowPrefillValue,
  shouldSkipSignNowPrefill,
  signNowPrefillDocumentKind,
} from './signnow-field-map';

describe('signnow-field-map', () => {
  it('strips dashes from phone values for SignNow Number validators', () => {
    expect(formatSignNowPrefillValue('561-577-8267', 'merchant_contact_phone')).toBe(
      '5615778267',
    );
    expect(formatSignNowPrefillValue('(561) 577-8267', 'client_phone')).toBe('5615778267');
    expect(formatSignNowPrefillValue('1-561-577-8267', 'guarantor_phone_p22')).toBe(
      '5615778267',
    );
    expect(formatSignNowPrefillValue('FUSIONTECZ', 'client_legal_name')).toBe('FUSIONTECZ');
    expect(formatSignNowPrefillValue('$ 1,025.00', 'origination_fee')).toBe('1,025.00');
    expect(formatSignNowPrefillValue('$49.00', 'ach_program_fee_p13')).toBe('49.00');
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
  });

  it('maps owner 2 name from CRM owner2 / guarantor2 keys', () => {
    expect(
      resolveSignNowPrefillValue('guaranty_guarantor2_name_p12', {
        owner2_guarantor_name: 'Jane Owner',
      }),
    ).toBe('Jane Owner');
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
    expect(resolveSignNowPrefillValue('ach_program_fee_p13', prefill)).toBe('49.00');
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
    expect(byName.disclosure_page3_3a_p3).toBe('N/A');
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
});
