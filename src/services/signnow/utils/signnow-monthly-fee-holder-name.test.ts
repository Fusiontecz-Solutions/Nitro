/**
 * Monthly Fee "Account Holder Information" block.
 *
 * The block prints "(Authorized Holder Name)" beside "(Authorized Holder
 * Business Name)". The first is Owner 1; the second is the business. Both used
 * to read the business legal name, because `ach_account_holder_name`'s alias
 * chain leads with the CRM's ACH holder field and `authorization_client_name`.
 */
import { resolveSignNowPrefillValue } from './signnow-field-map';

const PREFILL: Record<string, string> = {
  client_name: 'MARY IRVIN',
  client_legal_name: 'RE-NEW-IT RENOVATIONS, LLC',
  authorization_client_name: 'RE-NEW-IT RENOVATIONS, LLC',
  ach_authorization_account_holder_name: 'RE-NEW-IT RENOVATIONS, LLC',
  ach_authorization_account_holder_dba: 'RE-NEW-IT RENOVATIONS, LLC',
  doing_business_as: 'RE-NEW-IT RENOVATIONS, LLC',
};

describe('Monthly Fee Authorized Holder Name', () => {
  it('prints Owner 1 on the Monthly Fee addendum', () => {
    expect(
      resolveSignNowPrefillValue('ach_account_holder_name_p1', PREFILL, {
        documentKind: 'monthly_fee',
      }),
    ).toBe('MARY IRVIN');
  });

  it('prints Owner 1 on the same block at the end of the agreement', () => {
    expect(
      resolveSignNowPrefillValue('ach_account_holder_name_p1', PREFILL, {
        documentKind: 'obsidian_agreement',
      }),
    ).toBe('MARY IRVIN');
  });

  it('keeps the business on the Authorized Holder Business Name beside it', () => {
    expect(
      resolveSignNowPrefillValue('ach_account_holder_dba_p1', PREFILL, {
        documentKind: 'monthly_fee',
      }),
    ).toBe('RE-NEW-IT RENOVATIONS, LLC');
  });

  it('never repeats the business name across the two holder lines', () => {
    const options = { documentKind: 'monthly_fee' } as const;
    expect(resolveSignNowPrefillValue('ach_account_holder_name_p1', PREFILL, options)).not.toBe(
      resolveSignNowPrefillValue('ach_account_holder_dba_p1', PREFILL, options),
    );
  });

  it('falls back through Owner 1 keys, never to a business name', () => {
    const { client_name: _omitted, ...noClientName } = PREFILL;
    expect(
      resolveSignNowPrefillValue('ach_account_holder_name_p1', {
        ...noClientName,
        owner1_guarantor_name: 'MARY IRVIN',
      }),
    ).toBe('MARY IRVIN');
    expect(resolveSignNowPrefillValue('ach_account_holder_name_p1', noClientName)).toBe('');
  });

  it('leaves the bank-authorization forms alone', () => {
    // ACH Daily / Weekly: the account holder there is the business.
    expect(resolveSignNowPrefillValue('ach_account_holder_name_p1_ach', PREFILL)).toBe(
      'RE-NEW-IT RENOVATIONS, LLC',
    );
    // The agreement's own page-20 ACH block.
    expect(resolveSignNowPrefillValue('ach_account_holder_name_p19', PREFILL)).toBe(
      'RE-NEW-IT RENOVATIONS, LLC',
    );
  });

  it('prints Owner 1 on the numbered copy (Text Field 4) too', () => {
    expect(
      resolveSignNowPrefillValue('Text Field 4', PREFILL, { documentKind: 'monthly_fee' }),
    ).toBe('MARY IRVIN');
  });
});

/**
 * The bottom "Print Name" line is the merchant who signs. The CRM's Monthly Fee
 * tab saved the ACH holder name there, which falls back to the business, and
 * that saved widget value used to win over every alias.
 */
describe('Monthly Fee Print Name (merchant name)', () => {
  const SAVED_WITH_BUSINESS: Record<string, string> = {
    ...PREFILL,
    authorization_client_name_print_p1: 'RE-NEW-IT RENOVATIONS, LLC',
  };
  const options = { documentKind: 'monthly_fee' } as const;

  it('prints the merchant, not a saved business name', () => {
    expect(
      resolveSignNowPrefillValue('authorization_client_name_print_p1', SAVED_WITH_BUSINESS, options),
    ).toBe('MARY IRVIN');
  });

  it('prints the merchant on the numbered copy (Text Field 14)', () => {
    expect(resolveSignNowPrefillValue('Text Field 14', SAVED_WITH_BUSINESS, options)).toBe(
      'MARY IRVIN',
    );
  });

  it('prints the merchant on the same block at the end of the agreement', () => {
    expect(
      resolveSignNowPrefillValue('authorization_client_name_print_p1', SAVED_WITH_BUSINESS, {
        documentKind: 'obsidian_agreement',
      }),
    ).toBe('MARY IRVIN');
  });

  it('keeps the business on the Authorized Business Name line', () => {
    expect(
      resolveSignNowPrefillValue('authorization_client_name_p1', SAVED_WITH_BUSINESS, options),
    ).toBe('RE-NEW-IT RENOVATIONS, LLC');
    expect(resolveSignNowPrefillValue('Text Field 1', SAVED_WITH_BUSINESS, options)).toBe(
      'RE-NEW-IT RENOVATIONS, LLC',
    );
  });

  it('falls back through Owner 1 keys and is blank rather than the business', () => {
    const { client_name: _omitted, ...noClientName } = SAVED_WITH_BUSINESS;
    expect(
      resolveSignNowPrefillValue(
        'authorization_client_name_print_p1',
        { ...noClientName, owner1_guarantor_name: 'MARY IRVIN' },
        options,
      ),
    ).toBe('MARY IRVIN');
    expect(
      resolveSignNowPrefillValue('authorization_client_name_print_p1', noClientName, options),
    ).toBe('');
  });

  it('does not touch Exhibit C', () => {
    expect(
      resolveSignNowPrefillValue('authorization_client_name_print_p1', SAVED_WITH_BUSINESS, {
        documentKind: 'exhibit_c',
      }),
    ).toBe('RE-NEW-IT RENOVATIONS, LLC');
  });
});
