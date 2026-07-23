/**
 * Built-in letter templates with Data Personalization field metadata.
 * Kept in sync with FE PayOffLetter / ZeroBalanceLetter variable lists.
 */

export type LetterTemplateField = {
  key: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
};

export type BuiltinLetterTemplate = {
  id: string;
  name: string;
  /** When set, template is only returned for that funder filter. Null = all funders. */
  funder: string | null;
  category: 'letter';
  source: 'builtin';
  status: 'active';
  fields: LetterTemplateField[];
  variables: string[];
  /** Optional HTML body stub; branded letters render on the frontend. */
  body: string;
  description?: string;
};

const PAYOFF_LETTER_FIELDS: LetterTemplateField[] = [
  {
    key: 'letter_date',
    label: 'Letter Date',
    placeholder: 'May 20, 2024',
    defaultValue: 'May 20, 2024',
  },
  {
    key: 'account_name',
    label: 'Account Name (Business Name)',
    placeholder: 'Acme LLC',
    defaultValue: 'Acme LLC',
  },
  {
    key: 'payoff_amount',
    label: 'Payoff Amount',
    placeholder: '$5,678.90',
    defaultValue: '$5,678.90',
  },
  {
    key: 'good_through_date',
    label: 'Valid Till',
    placeholder: 'May 27, 2024',
    defaultValue: 'May 27, 2024',
  },
  {
    key: 'payment_company_name',
    label: 'Payment Company Name',
    placeholder: 'Woodmere Capital LLC',
    defaultValue: 'Woodmere Capital LLC',
  },
  {
    key: 'payment_address_line1',
    label: 'Payment Address Line 1',
    placeholder: '609 Barnard Ave',
    defaultValue: '609 Barnard Ave',
  },
  {
    key: 'payment_address_line2',
    label: 'Payment Address Line 2',
    placeholder: 'Woodmere NY 11598',
    defaultValue: 'Woodmere NY 11598',
  },
  {
    key: 'payment_routing_number',
    label: 'Routing Number',
    placeholder: '067015096',
    defaultValue: '067015096',
  },
  {
    key: 'payment_account_number',
    label: 'Payment Account Number',
    placeholder: '210062956',
    defaultValue: '210062956',
  },
  {
    key: 'sender_name',
    label: 'Sender Name',
    placeholder: 'Admin team',
    defaultValue: 'Admin team',
  },
];

const ZERO_BALANCE_LETTER_FIELDS: LetterTemplateField[] = [
  {
    key: 'letter_date',
    label: 'Letter Date',
    placeholder: '05/20/2024',
    defaultValue: '05/20/2024',
  },
  {
    key: 'account_name',
    label: 'Account Name (Business Name)',
    placeholder: 'Acme LLC',
    defaultValue: 'Acme LLC',
  },
  {
    key: 'salutation_name',
    label: 'Salutation Name',
    placeholder: 'John Doe',
    defaultValue: 'John Doe',
  },
  {
    key: 'payment_account_number',
    label: 'Account Number',
    placeholder: '0210047692',
    defaultValue: '0210047692',
  },
  {
    key: 'account_status',
    label: 'Account Status',
    placeholder: 'Zero Balance',
    defaultValue: 'Zero Balance',
  },
  {
    key: 'sender_name',
    label: 'Sender Name',
    placeholder: 'Admin team',
    defaultValue: 'Admin team',
  },
];

function withVariables(fields: LetterTemplateField[]): string[] {
  return fields.map((f) => f.key);
}

/** Application built-in letter catalog (full field metadata for Data Personalization). */
export const BUILTIN_LETTER_TEMPLATES: BuiltinLetterTemplate[] = [
  {
    id: 'builtin:payoff-letter',
    name: 'Payoff Letter',
    funder: null,
    category: 'letter',
    source: 'builtin',
    status: 'active',
    fields: PAYOFF_LETTER_FIELDS,
    variables: withVariables(PAYOFF_LETTER_FIELDS),
    body: '',
    description:
      'Payoff letter with wire instructions — branded email layout used for outbound sends.',
  },
  {
    id: 'builtin:zero-balance-letter',
    name: 'Zero Balance Letter',
    funder: null,
    category: 'letter',
    source: 'builtin',
    status: 'active',
    fields: ZERO_BALANCE_LETTER_FIELDS,
    variables: withVariables(ZERO_BALANCE_LETTER_FIELDS),
    body: '',
    description:
      'Zero balance confirmation letter — branded email layout used for outbound sends.',
  },
];

export function getBuiltinLetterTemplates(): BuiltinLetterTemplate[] {
  return BUILTIN_LETTER_TEMPLATES.map((t) => ({
    ...t,
    fields: t.fields.map((f) => ({ ...f })),
    variables: [...t.variables],
  }));
}

export function getBuiltinLetterTemplateById(
  id: string,
): BuiltinLetterTemplate | undefined {
  const normalized = String(id ?? '').trim();
  if (!normalized) return undefined;
  return getBuiltinLetterTemplates().find((t) => t.id === normalized);
}
