/**
 * State disclosure PDF tab coordinates for DocuSign merged envelopes.
 *
 * `tabLabel` values match CRM prefill field ids from
 * `in-house-crm-fe/src/components/application/contractdata/Daily_*.ts` and
 * `Weekly_California.ts` (snake_case), NOT legacy third-party platform names
 * (`purchasePrice`, `amountFinanced`, `paymentTerms`, etc.).
 *
 * Config keys: `${frequency}${StateName}` — e.g. `dailyFlorida`, `weeklyCalifornia`.
 */

type StateDocumentTabParty = 'primary' | 'secondary';

export interface StateDocumentFieldConfig {
  documentId: string;
  pageNumber: string;
  signHere: {
    x: string;
    y: string;
    pageNumber?: string;
    signerParty?: StateDocumentTabParty;
  }[];
  dateTabs: {
    x: string;
    y: string;
    pageNumber?: string;
    tabLabel?: string;
    signerParty?: StateDocumentTabParty;
  }[];
  textTabs: {
    tabLabel: string;
    x: string;
    y: string;
    pageNumber?: string;
    width?: string;
    height?: string;
    /** When true, tab is not required and may be omitted when empty. */
    optional?: boolean;
    /** When true, signer cannot edit (CRM prefill only). */
    lockedForSigner?: boolean;
  }[];
  initialHereTabs?: { x: string; y: string; pageNumber?: string }[];
}

/** Shared page-1 disclosure coordinates (Florida-style PDF layout; daily + weekly). */
const FLORIDA_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'client_name', x: '245', y: '100' },
  { tabLabel: 'client_name', x: '248', y: '149' },
  { tabLabel: 'total_amount_business_fund', x: '426', y: '102' },
  { tabLabel: 'funder_name', x: '209', y: '186' },
  { tabLabel: 'total_amount_of_fund_disbursed', x: '427', y: '153' },
  { tabLabel: 'total_amount_tobe_paid_to_provider', x: '429', y: '190' },
  { tabLabel: 'total_dollar_cost', x: '429', y: '240' },
  { tabLabel: 'estimated_payment_amount', x: '430', y: '274' },
  { tabLabel: 'percent_of_business_income', x: '417', y: '326' },
  { tabLabel: 'client_name', x: '468', y: '326' },
  { tabLabel: 'client_name', x: '419', y: '356' },
  { tabLabel: 'total_dollar_cost', x: '477', y: '435' },
];

/** Missouri disclosure page-1 coordinates. */
const MISSOURI_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'client_name', x: '245', y: '100' },
  { tabLabel: 'client_name', x: '248', y: '149' },
  { tabLabel: 'total_amount_business_fund', x: '436', y: '102' },
  { tabLabel: 'funder_name', x: '209', y: '186' },
  { tabLabel: 'total_amount_of_fund_disbursed', x: '436', y: '153' },
  { tabLabel: 'total_amount_tobe_paid_to_provider', x: '436', y: '190' },
  { tabLabel: 'total_dollar_cost', x: '436', y: '240' },
  { tabLabel: 'estimated_payment_amount', x: '434', y: '288' },
  { tabLabel: 'percent_of_business_income', x: '416', y: '355' },
  { tabLabel: 'client_name', x: '473', y: '355' },
  { tabLabel: 'client_name', x: '420', y: '394' },
  { tabLabel: 'total_dollar_cost', x: '479', y: '489' },
];

const MISSOURI_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '88', y: '604' },
    { x: '426', y: '603', signerParty: 'secondary' },
  ],
  dateTabs: [
    { x: '83', y: '679', tabLabel: 'Signature_date' },
    { x: '422', y: '679', tabLabel: 'Signature_date', signerParty: 'secondary' },
  ],
};

/** Georgia disclosure page-1 coordinates. */
const GEORGIA_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'client_name', x: '245', y: '100' },
  { tabLabel: 'client_name', x: '248', y: '149' },
  { tabLabel: 'total_amount_business_fund', x: '436', y: '102' },
  { tabLabel: 'funder_name', x: '208', y: '202' },
  { tabLabel: 'total_amount_of_fund_disbursed', x: '436', y: '153' },
  { tabLabel: 'total_amount_tobe_paid_to_provider', x: '436', y: '206' },
  { tabLabel: 'total_dollar_cost', x: '437', y: '256' },
  { tabLabel: 'estimated_payment_amount', x: '434', y: '288' },
  { tabLabel: 'percent_of_business_income', x: '415', y: '340' },
  { tabLabel: 'client_name', x: '474', y: '341' },
  { tabLabel: 'client_name', x: '422', y: '384' },
  { tabLabel: 'total_dollar_cost', x: '475', y: '476' },
];

const GEORGIA_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '91', y: '589' },
    { x: '430', y: '589', signerParty: 'secondary' },
  ],
  dateTabs: [
    { x: '86', y: '665', tabLabel: 'Signature_date' },
    { x: '426', y: '665', tabLabel: 'Signature_date', signerParty: 'secondary' },
  ],
};

/** Utah disclosure page-2 owner signatures and agreement dates (daily + weekly). */
const UTAH_DISCLOSURE_PAGE2_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '92', y: '102', pageNumber: '2' },
    { x: '431', y: '101', pageNumber: '2', signerParty: 'secondary' },
  ],
  dateTabs: [
    { x: '90', y: '175', pageNumber: '2', tabLabel: 'Signature_date' },
    {
      x: '431',
      y: '175',
      pageNumber: '2',
      tabLabel: 'Signature_date',
      signerParty: 'secondary',
    },
  ],
};

/** Utah disclosure page-1 amount / variable-payment coordinates (daily + weekly). */
const UTAH_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'purchase_amount', x: '187', y: '109' },
  { tabLabel: 'net_to_merchant', x: '191', y: '144' },
  { tabLabel: 'purchase_price', x: '190', y: '179' },
  { tabLabel: 'finance_charge', x: '190', y: '213' },
  { tabLabel: 'remittance', x: '189', y: '344' },
  { tabLabel: 'monthly_income', x: '227', y: '529' },
  { tabLabel: 'appendix_underwriting_fees', x: '190', y: '461' },
  { tabLabel: 'frequency', x: '174', y: '514' },
  { tabLabel: 'frequency', x: '403', y: '559' },
];

/** Kansas disclosure page-1 coordinates (daily + weekly). */
const KANSAS_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'total_amount_of_fund_provided', x: '434', y: '103' },
  { tabLabel: 'total_amount_fund_disbursed', x: '435', y: '153' },
  { tabLabel: 'total_of_payments', x: '437', y: '204' },
  { tabLabel: 'total_dollar_cost_of_frinancing', x: '436', y: '243' },
  { tabLabel: 'estimated_payment', x: '437', y: '277' },
  { tabLabel: 'total_dollar_cost_of_frinancing', x: '482', y: '329' },
];

const KANSAS_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '91', y: '442' },
    { x: '429', y: '442', signerParty: 'secondary' },
  ],
  dateTabs: [
    { x: '91', y: '518', tabLabel: 'Signature_date' },
    { x: '428', y: '517', tabLabel: 'Signature_date', signerParty: 'secondary' },
  ],
};

/** Virginia disclosure page-1 coordinates (daily + weekly). */
const VIRGINIA_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'disclosure_name', x: '450', y: '69' },
  { tabLabel: 'recipient_address', x: '365', y: '108' },
  { tabLabel: 'total_amount_sales_based_financing', x: '267', y: '46' },
  { tabLabel: 'fees_deducted', x: '268', y: '89' },
  { tabLabel: 'disbursement_amount', x: '267', y: '127' },
  { tabLabel: 'finance_charge', x: '269', y: '166' },
  { tabLabel: 'total_repayment_amount', x: '269', y: '188' },
  { tabLabel: 'estimated_number_of_payement', x: '264', y: '224' },
];

const VIRGINIA_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '167', y: '719' },
    { x: '420', y: '720', signerParty: 'secondary' },
    { x: '150', y: '711', pageNumber: '2' },
    { x: '438', y: '712', pageNumber: '2', signerParty: 'secondary' },
  ],
  dateTabs: [{ x: '443', y: '45', tabLabel: 'agreement_date' }],
};

const VIRGINIA_PAGE2_HEADER_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'recipient_name2', x: '152', y: '43', pageNumber: '2' },
  { tabLabel: 'recipient_address1', x: '150', y: '63', pageNumber: '2', height: '36' },
  { tabLabel: 'disclosure_date2', x: '416', y: '44', pageNumber: '2' },
];

const VIRGINIA_DAILY_PAGE2_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  ...VIRGINIA_PAGE2_HEADER_TEXT_TABS,
  { tabLabel: 'fordailypayments', x: '141', y: '253', pageNumber: '2' },
  { tabLabel: 'fordailypayments', x: '156', y: '350', pageNumber: '2' },
];

const VIRGINIA_WEEKLY_PAGE2_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  ...VIRGINIA_PAGE2_HEADER_TEXT_TABS,
  { tabLabel: 'weekly_payments', x: '146', y: '251', pageNumber: '2' },
  { tabLabel: 'weekly_payments', x: '269', y: '357', pageNumber: '2' },
];

/** Connecticut disclosure — Virginia-aligned text tab coordinates (daily + weekly). */
const CONNECTICUT_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'recipient_name', x: '450', y: '69' },
  { tabLabel: 'recipient_address', x: '345', y: '105' },
  { tabLabel: 'total_amount_commercial_financing', x: '267', y: '46' },
  { tabLabel: 'deducted_at_disbursement', x: '268', y: '89' },
  { tabLabel: 'total_commerical_financing', x: '267', y: '127' },
  { tabLabel: 'finance_charge', x: '269', y: '166' },
  { tabLabel: 'total_repayment_amount', x: '269', y: '188' },
  { tabLabel: 'estimated_time_periodic_paymement', x: '264', y: '224' },
];

const CONNECTICUT_PAGE2_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'recipient_name2', x: '152', y: '43', pageNumber: '2' },
  { tabLabel: 'recipient_address2', x: '150', y: '63', pageNumber: '2' },
  { tabLabel: 'disclosure_date2', x: '429', y: '40', pageNumber: '2' },
  {
    tabLabel: 'connecticut_review_field_1',
    x: '284',
    y: '527',
    pageNumber: '2',
    width: '100',
    optional: true,
    lockedForSigner: true,
  },
  {
    tabLabel: 'connecticut_review_field_2',
    x: '282',
    y: '555',
    pageNumber: '2',
    width: '100',
    optional: true,
    lockedForSigner: true,
  },
  {
    tabLabel: 'connecticut_review_field_3',
    x: '280',
    y: '599',
    pageNumber: '2',
    width: '100',
    optional: true,
    lockedForSigner: true,
  },
  {
    tabLabel: 'connecticut_review_field_4',
    x: '275',
    y: '630',
    pageNumber: '2',
    width: '100',
    optional: true,
    lockedForSigner: true,
  },
];

const CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs' | 'initialHereTabs'
> = {
  initialHereTabs: [{ x: '215', y: '722' }],
  dateTabs: [
    { x: '443', y: '45', tabLabel: 'disclosure_date' },
    { x: '475', y: '746', tabLabel: 'signature_date' },
    { x: '82', y: '39', pageNumber: '3', tabLabel: 'signature1_date' },
    {
      x: '81',
      y: '71',
      pageNumber: '3',
      tabLabel: 'signature2_date',
      signerParty: 'secondary',
    },
  ],
  signHere: [
    { x: '165', y: '23', pageNumber: '3' },
    { x: '250', y: '38', pageNumber: '3', signerParty: 'secondary' },
  ],
};

export const STATE_DOCUMENT_CONFIG: Record<string, StateDocumentFieldConfig> = {
  weeklyCalifornia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [{ x: '78', y: '487', pageNumber: '2' }],
    dateTabs: [{ x: '258', y: '507', pageNumber: '2' }],
    textTabs: [
      { tabLabel: 'funding_provided', x: '186', y: '109' },
      { tabLabel: 'funding_provided', x: '353', y: '143' },
      { tabLabel: 'estimated_annual_percentage_rate', x: '183', y: '271' },
      { tabLabel: 'average_monthly_income', x: '361', y: '328' },
      { tabLabel: 'finance_charge', x: '184', y: '444' },
      { tabLabel: 'funding_provided', x: '186', y: '549' },
      { tabLabel: 'average_monthly_income', x: '182', y: '575' },
      { tabLabel: 'estimated_payment', x: '183', y: '626' },
      { tabLabel: 'present_weekly_payment', x: '370', y: '651' },
      { tabLabel: 'payment_exceeded_percent', x: '242', y: '663' },
      { tabLabel: 'average_monthly_income', x: '245', y: '676' },
      { tabLabel: 'estimated_term', x: '186', y: '135', pageNumber: '2' },
      { tabLabel: 'out_estimated_percent', x: '395', y: '90', pageNumber: '2' },
      { tabLabel: 'average_monthly_income', x: '422', y: '158', pageNumber: '2' },
      { tabLabel: 'prepayment', x: '336', y: '349', pageNumber: '2' },
    ],
  },

  dailyCalifornia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [{ x: '78', y: '487', pageNumber: '2' }],
    dateTabs: [{ x: '258', y: '507', pageNumber: '2' }],
    textTabs: [
      { tabLabel: 'funding_provided', x: '186', y: '109' },
      { tabLabel: 'funding_provided', x: '290', y: '144' },
      { tabLabel: 'estimated_annual_percentage_rate', x: '183', y: '271' },
      { tabLabel: 'avarage_monthly_income', x: '361', y: '328' },
      { tabLabel: 'finance_charge', x: '184', y: '444' },
      { tabLabel: 'funding_provided', x: '186', y: '549' },
      { tabLabel: 'monthly_income', x: '182', y: '575' },
      { tabLabel: 'estimated_payment', x: '183', y: '626' },
      { tabLabel: 'daily_payment', x: '361', y: '672' },
      { tabLabel: 'payement_exceeded_percent', x: '207', y: '684' },
      { tabLabel: 'monthly_income', x: '201', y: '694' },
      { tabLabel: 'estimated_percent', x: '186', y: '135', pageNumber: '2' },
      { tabLabel: 'payement_exceeded_percent', x: '397', y: '90', pageNumber: '2' },
      { tabLabel: 'avarage_monthly_income', x: '422', y: '158', pageNumber: '2' },
      { tabLabel: 'finance_charge', x: '329', y: '352', pageNumber: '2' },
    ],
  },

  weeklyFlorida: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '110', y: '623' },
      { x: '425', y: '549', signerParty: 'secondary' },
    ],
    dateTabs: [
      { x: '352', y: '644', tabLabel: 'Signature_date' },
      { x: '420', y: '622', tabLabel: 'Signature_date', signerParty: 'secondary' },
    ],
    textTabs: FLORIDA_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyFlorida: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '89', y: '548' },
      { x: '425', y: '549', signerParty: 'secondary' },
    ],
    dateTabs: [
      { x: '78', y: '623', tabLabel: 'Signature_date' },
      { x: '420', y: '622', tabLabel: 'Signature_date', signerParty: 'secondary' },
    ],
    textTabs: FLORIDA_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyMissouri: {
    documentId: '1',
    pageNumber: '1',
    ...MISSOURI_DISCLOSURE_SIGN_AND_DATE,
    textTabs: MISSOURI_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyMissouri: {
    documentId: '1',
    pageNumber: '1',
    ...MISSOURI_DISCLOSURE_SIGN_AND_DATE,
    textTabs: MISSOURI_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyGeorgia: {
    documentId: '1',
    pageNumber: '1',
    ...GEORGIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: GEORGIA_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyGeorgia: {
    documentId: '1',
    pageNumber: '1',
    ...GEORGIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: GEORGIA_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyKansas: {
    documentId: '1',
    pageNumber: '1',
    ...KANSAS_DISCLOSURE_SIGN_AND_DATE,
    textTabs: KANSAS_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyKansas: {
    documentId: '1',
    pageNumber: '1',
    ...KANSAS_DISCLOSURE_SIGN_AND_DATE,
    textTabs: KANSAS_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  /** Utah disclosure page-1 coordinates (aligned to Utah Code 7-27-202 table). */
  dailyUtah: {
    documentId: '1',
    pageNumber: '1',
    ...UTAH_DISCLOSURE_PAGE2_SIGN_AND_DATE,
    textTabs: UTAH_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyUtah: {
    documentId: '1',
    pageNumber: '1',
    ...UTAH_DISCLOSURE_PAGE2_SIGN_AND_DATE,
    textTabs: UTAH_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyVirginia: {
    documentId: '1',
    pageNumber: '1',
    ...VIRGINIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: [
      ...VIRGINIA_DISCLOSURE_PAGE1_TEXT_TABS,
      ...VIRGINIA_WEEKLY_PAGE2_TEXT_TABS,
    ],
  },

  dailyVirginia: {
    documentId: '1',
    pageNumber: '1',
    ...VIRGINIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: [
      ...VIRGINIA_DISCLOSURE_PAGE1_TEXT_TABS,
      ...VIRGINIA_DAILY_PAGE2_TEXT_TABS,
    ],
  },

  weeklyConnecticut: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: [
      ...CONNECTICUT_DISCLOSURE_PAGE1_TEXT_TABS,
      ...CONNECTICUT_PAGE2_TEXT_TABS,
    ],
  },

  dailyConnecticut: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: [
      ...CONNECTICUT_DISCLOSURE_PAGE1_TEXT_TABS,
      ...CONNECTICUT_PAGE2_TEXT_TABS,
    ],
  },

  weeklyNewYork: {
    documentId: '1',
    pageNumber: '1',
    signHere: [{ x: '78', y: '487', pageNumber: '2' }],
    dateTabs: [{ x: '258', y: '507', pageNumber: '2' }],
    textTabs: [
      { tabLabel: 'funding_provided', x: '186', y: '109' },
      { tabLabel: 'funding_provided', x: '300', y: '164' },
      { tabLabel: 'estimated_annual_percentage_rate', x: '183', y: '271' },
      { tabLabel: 'monthly_income', x: '360', y: '327' },
      { tabLabel: 'prepayment', x: '181', y: '447' },
      { tabLabel: 'funding_provided', x: '183', y: '549' },
      { tabLabel: 'monthly_income', x: '182', y: '575' },
      { tabLabel: 'estimated_payment', x: '184', y: '626' },
      { tabLabel: 'daily_payment', x: '425', y: '663' },
      { tabLabel: 'payment_exceeded', x: '224', y: '677' },
      { tabLabel: 'etimated_average_income', x: '189', y: '685' },
      { tabLabel: 'estimated_term', x: '187', y: '137', pageNumber: '2' },
      { tabLabel: 'payment_exceeded', x: '175', y: '83', pageNumber: '2' },
      { tabLabel: 'etimated_average_income', x: '425', y: '155', pageNumber: '2' },
      { tabLabel: 'prepayment', x: '335', y: '348', pageNumber: '2' },
    ],
  },

  dailyNewYork: {
    documentId: '1',
    pageNumber: '1',
    signHere: [{ x: '78', y: '487', pageNumber: '2' }],
    dateTabs: [{ x: '258', y: '507', pageNumber: '2' }],
    textTabs: [
      { tabLabel: 'funding_provided', x: '186', y: '109' },
      { tabLabel: 'funding_provided', x: '290', y: '143' },
      { tabLabel: 'estimated_annual_percentage_rate', x: '183', y: '271' },
      { tabLabel: 'monthly_income', x: '359', y: '328' },
      { tabLabel: 'prepayment', x: '181', y: '447' },
      { tabLabel: 'funding_provided', x: '183', y: '549' },
      { tabLabel: 'monthly_income', x: '182', y: '575' },
      { tabLabel: 'estimated_payment', x: '181', y: '626' },
      { tabLabel: 'daily_payment', x: '417', y: '664' },
      { tabLabel: 'payment_exceeded', x: '223', y: '677' },
      { tabLabel: 'etimated_average_income', x: '183', y: '684' },
      { tabLabel: 'estimated_term', x: '176', y: '87', pageNumber: '2' },
      { tabLabel: 'payment_exceeded', x: '175', y: '83', pageNumber: '2' },
      { tabLabel: 'etimated_average_income', x: '423', y: '155', pageNumber: '2' },
      { tabLabel: 'prepayment', x: '262', y: '350', pageNumber: '2' },
    ],
  },
};

const STATE_NAME_ALIASES: Record<string, string> = {
  ca: 'california',
  california: 'california',
  fl: 'florida',
  florida: 'florida',
  mo: 'missouri',
  missouri: 'missouri',
  ga: 'georgia',
  georgia: 'georgia',
  ks: 'kansas',
  kansas: 'kansas',
  ut: 'utah',
  utah: 'utah',
  va: 'virginia',
  virginia: 'virginia',
  ct: 'connecticut',
  connecticut: 'connecticut',
  ny: 'newyork',
  newyork: 'newyork',
  'new york': 'newyork',
};

const STATE_DISPLAY_NAME: Record<string, string> = {
  california: 'California',
  florida: 'Florida',
  missouri: 'Missouri',
  georgia: 'Georgia',
  kansas: 'Kansas',
  utah: 'Utah',
  virginia: 'Virginia',
  connecticut: 'Connecticut',
  newyork: 'NewYork',
};

function capitalize(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Resolve config key from CRM `frequency` + `state` (e.g. daily + florida → dailyFlorida). */
export function resolveStateDocumentConfigKey(
  frequency: string | null | undefined,
  state: string | null | undefined,
): string | null {
  const freqRaw = String(frequency ?? '')
    .trim()
    .toLowerCase();
  const stateRaw = String(state ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ');
  if (!freqRaw || !stateRaw) return null;

  const stateKey = STATE_NAME_ALIASES[stateRaw] || stateRaw.replace(/\s+/g, '');
  const freqKey = freqRaw.startsWith('week') ? 'weekly' : freqRaw.startsWith('day') ? 'daily' : freqRaw;
  const stateName = STATE_DISPLAY_NAME[stateKey] || capitalize(stateKey);
  const key = `${freqKey}${stateName}`;
  return STATE_DOCUMENT_CONFIG[key] ? key : null;
}

export function getStateDocumentConfig(
  frequency: string | null | undefined,
  state: string | null | undefined,
): StateDocumentFieldConfig | null {
  const key = resolveStateDocumentConfigKey(frequency, state);
  return key ? STATE_DOCUMENT_CONFIG[key] : null;
}
