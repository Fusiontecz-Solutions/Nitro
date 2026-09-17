import {
  digitsOnlyPhone,
  formatUsPhone,
  isPhoneFieldName,
  isSsnFieldName,
} from './contactFormat';

describe('formatUsPhone', () => {
  it('dashes a standard 10-digit number', () => {
    expect(formatUsPhone('7566899020')).toBe('756-689-9020');
    expect(formatUsPhone('(756) 689 9020')).toBe('756-689-9020');
  });

  it('drops a leading US country code', () => {
    expect(formatUsPhone('17566899020')).toBe('756-689-9020');
    expect(formatUsPhone('+1 756 689 9020')).toBe('756-689-9020');
  });

  it('dashes short entries 3-3-rest instead of printing them bare', () => {
    // Regression: these printed as 756689902 / 882768828 on the agreement.
    expect(formatUsPhone('756689902')).toBe('756-689-902');
    expect(formatUsPhone('882768828')).toBe('882-768-828');
    expect(formatUsPhone('5551234')).toBe('555-123-4');
    expect(formatUsPhone('88276882')).toBe('882-768-82');
  });

  it('leaves values it cannot group safely untouched', () => {
    expect(formatUsPhone('55512')).toBe('55512');
    expect(formatUsPhone('555-123-4567 x89')).toBe('555-123-4567 x89');
    expect(formatUsPhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(formatUsPhone('')).toBe('');
    expect(formatUsPhone(null)).toBe('');
  });

  it('is idempotent', () => {
    expect(formatUsPhone(formatUsPhone('7566899020'))).toBe('756-689-9020');
    expect(formatUsPhone(formatUsPhone('756689902'))).toBe('756-689-902');
  });
});

describe('isPhoneFieldName', () => {
  it('matches the phone widgets used across the contract templates', () => {
    for (const name of [
      'phone',
      'client_phone',
      'client_phone2',
      'owner2_phone',
      'guarantor_phone_p22',
      'authorized_business_phone',
      'authorized_business_phone_p1',
      'merchant_contact_phone_p1_ach',
      'business_phone',
      'billing_phone',
      'landlord_phone',
      'emergency_phone',
      'ref_personal1_phone',
      'preferred_phone_number',
      'phone_number',
      'phone_mobile',
      'mobile_phone',
      'owner_mobile_number',
      'cell_phone',
      'cell',
      'telephone',
      'fax',
      'applicant_phone',
      'principal_phone',
      // run-together names once lowercased
      'authorizedBusinessPhone',
      'ownerMobileNumber',
      'mobileNumber',
      'clientPhone',
    ]) {
      expect([name, isPhoneFieldName(name)]).toEqual([name, true]);
    }
  });

  it('does not claim other numeric fields', () => {
    for (const name of [
      'routing_number',
      'account_number',
      'checking_account_number',
      'ein_number',
      'business_ein_number',
      'aba_routing_number',
      'driver_license_number',
      'ach_authorization_reference_number1',
      'estimated_number_of_payments',
      'social_security_number',
      'ssn',
      'check_number',
      'merchantAccountNumber',
      'number_validator_id',
      'client_name',
    ]) {
      expect([name, isPhoneFieldName(name)]).toEqual([name, false]);
    }
  });

  it('keeps SSN detection disjoint from phone detection', () => {
    expect(isSsnFieldName('guaranty_ss')).toBe(true);
    expect(isPhoneFieldName('guaranty_ss')).toBe(false);
  });
});

describe('digitsOnlyPhone', () => {
  it('strips the dashes the formatter adds, for validated widgets', () => {
    expect(digitsOnlyPhone(formatUsPhone('756689902'))).toBe('756689902');
    expect(digitsOnlyPhone(formatUsPhone('17566899020'))).toBe('7566899020');
  });
});
