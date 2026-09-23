/**
 * "Addendum to Contract — Waiver of Personal Service" (viewer page 23).
 *
 * Item 3 is the MERCHANT's service-of-process block and item 4 is the
 * GUARANTOR's. The template names the merchant widgets `client_email_p23` /
 * `business_address_contract_p23`, both of which canonicalise to Owner 1 keys,
 * so the page used to print Owner 1's email and home address on both blocks.
 */
import { resolveSignNowPrefillValue } from './signnow-field-map';

const PREFILL: Record<string, string> = {
  // Business (Application → Business section).
  business_email: 'accounts@renewitreno.com',
  business_address: '18 Commerce Way',
  business_address_city: 'Reno',
  business_address_state: 'NV',
  business_address_zip: '89501',
  // Owner 1.
  client_name: 'MARY IRVIN',
  client_email: 'puneet04@fusiontecz.com',
  business_address_contract: '3205 Cove Creek Road',
  business_address_contract_city: 'Gwalior',
  business_address_contract_state: 'North Carolina',
  business_address_contract_zip: '28785',
};

describe('waiver of personal service page (page 23)', () => {
  it('prints the business email on the MERCHANT service line', () => {
    expect(resolveSignNowPrefillValue('client_email_p23', PREFILL)).toBe(
      'accounts@renewitreno.com',
    );
  });

  it('prints the full business physical address on the MERCHANT postal line', () => {
    expect(resolveSignNowPrefillValue('business_address_contract_p23', PREFILL)).toBe(
      '18 Commerce Way, Reno, NV 89501',
    );
  });

  it('keeps Owner 1 on the GUARANTOR service lines', () => {
    expect(resolveSignNowPrefillValue('guarantor_email_p23', PREFILL)).toBe(
      'puneet04@fusiontecz.com',
    );
    expect(
      resolveSignNowPrefillValue('guarantor_address_p23', PREFILL, {
        // The page has no companion city/state/zip widgets for this block.
        documentFieldCanons: new Set(['guarantor_address', 'client_email']),
      }),
    ).toBe('3205 Cove Creek Road, Gwalior, North Carolina 28785');
  });

  it('never repeats Owner 1 across both blocks', () => {
    const merchantEmail = resolveSignNowPrefillValue('client_email_p23', PREFILL);
    const guarantorEmail = resolveSignNowPrefillValue('guarantor_email_p23', PREFILL);
    expect(merchantEmail).not.toBe(guarantorEmail);
    const merchantAddress = resolveSignNowPrefillValue(
      'business_address_contract_p23',
      PREFILL,
    );
    const guarantorAddress = resolveSignNowPrefillValue('guarantor_address_p23', PREFILL);
    expect(merchantAddress).not.toBe(guarantorAddress);
  });

  it('falls back to Owner 1 email only when the business has none', () => {
    const { business_email: _omitted, ...noBusinessEmail } = PREFILL;
    expect(resolveSignNowPrefillValue('client_email_p23', noBusinessEmail)).toBe(
      'puneet04@fusiontecz.com',
    );
  });

  it('leaves the merchant postal line blank rather than borrowing Owner 1 address', () => {
    const {
      business_address: _street,
      business_address_city: _city,
      business_address_state: _state,
      business_address_zip: _zip,
      ...noBusinessAddress
    } = PREFILL;
    expect(
      resolveSignNowPrefillValue('business_address_contract_p23', noBusinessAddress),
    ).toBe('');
  });

  it('does not change the merchant block on contract page 2', () => {
    expect(resolveSignNowPrefillValue('business_address_contract', PREFILL)).toBe(
      '3205 Cove Creek Road, Gwalior, North Carolina 28785',
    );
    expect(resolveSignNowPrefillValue('client_email', PREFILL)).toBe(
      'puneet04@fusiontecz.com',
    );
  });
});
