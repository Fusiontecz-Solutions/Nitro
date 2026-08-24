/**
 * State disclosure PDF tab coordinates for DocuSign merged envelopes.
 *
 * `tabLabel` values match CRM prefill field ids from
 * `in-house-crm-fe/src/components/application/contractdata/Daily_*.ts` and
 * `Weekly_California.ts` (snake_case), NOT legacy third-party platform names
 * (`purchasePrice`, `amountFinanced`, `paymentTerms`, etc.).
 *
 * Config keys: `${frequency}${StateName}` — e.g. `dailyFlorida`, `weeklyCalifornia`.
 * Measured blanks live in `state-disclosure-coords.generated.ts`.
 */

import {
  CA_DAILY_NOREFI_TEXT_TABS,
  CA_DAILY_REFI_TEXT_TABS,
  CA_WEEKLY_NOREFI_TEXT_TABS,
  CA_WEEKLY_REFI_TEXT_TABS,
  CT_DAILY_NOREFI_TEXT_TABS,
  CT_DAILY_REFI_TEXT_TABS,
  CT_WEEKLY_NOREFI_TEXT_TABS,
  CT_WEEKLY_REFI_TEXT_TABS,
  FL_MULTI_DAILY_TEXT_TABS,
  FL_MULTI_WEEKLY_TEXT_TABS,
  KS_MULTI_DAILY_TEXT_TABS,
  NY_DAILY_NOREFI_TEXT_TABS,
  NY_DAILY_REFI_TEXT_TABS,
  NY_WEEKLY_NOREFI_TEXT_TABS,
  NY_WEEKLY_REFI_TEXT_TABS,
  UT_DAILY_TEXT_TABS,
  UT_WEEKLY_TEXT_TABS,
  VA_DAILY_TEXT_TABS,
  VA_WEEKLY_TEXT_TABS,
} from './state-disclosure-coords.generated';

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

type TextTabs = StateDocumentFieldConfig['textTabs'];
const asTabs = (rows: readonly object[]): TextTabs =>
  rows.map((r) => ({ ...(r as TextTabs[number]) }));

/** Florida / GA / KS / LA / MO shared ACH-style disclosure — daily. */
const FLORIDA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS: TextTabs = asTabs(FL_MULTI_DAILY_TEXT_TABS);

/** Florida / GA / KS / LA / MO shared — weekly. */
const FLORIDA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS: TextTabs =
  asTabs(FL_MULTI_WEEKLY_TEXT_TABS);

/**
 * FL/GA/KS/LA/MO share a 2-page ACH disclosure with no signature or date lines.
 * Page 1 = money blanks + reconciliation % paragraph (left column is labels / empty).
 * Page 2 = PREPAYMENT only. Placing Sign/Date on page 1 drops them in the blank
 * left margin beside the 30% paragraph.
 */
const FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [],
  dateTabs: [],
};

/** Missouri shares the FL/GA/KS/LA/MO disclosure PDF. */
const MISSOURI_DAILY_DISCLOSURE_PAGE1_TEXT_TABS = FLORIDA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS;
const MISSOURI_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS = FLORIDA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS;

/** Georgia shares the FL/GA/KS/LA/MO disclosure PDF. */
const GEORGIA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS = FLORIDA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS;
const GEORGIA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS = FLORIDA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS;

/** Utah — measured right-column blanks from UT disclosure PDFs. */
const UTAH_DISCLOSURE_PAGE2_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '92', y: '92', pageNumber: '2' },
    { x: '431', y: '91', pageNumber: '2', signerParty: 'secondary' },
  ],
  dateTabs: [
    { x: '90', y: '165', pageNumber: '2', tabLabel: 'Signature_date' },
    {
      x: '431',
      y: '165',
      pageNumber: '2',
      tabLabel: 'Signature_date',
      signerParty: 'secondary',
    },
  ],
};

const UTAH_DAILY_DISCLOSURE_PAGE1_TEXT_TABS: TextTabs = asTabs(UT_DAILY_TEXT_TABS);
const UTAH_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS: TextTabs = asTabs(UT_WEEKLY_TEXT_TABS);

/** Kansas — same multi-state PDF; KS-specific tabLabel aliases. */
const KANSAS_DAILY_DISCLOSURE_PAGE1_TEXT_TABS: TextTabs = asTabs(KS_MULTI_DAILY_TEXT_TABS);
/** Weekly multi-state blanks with Kansas tabLabel aliases. */
const KANSAS_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS: TextTabs = [
  { tabLabel: 'total_amount_of_fund_provided', x: '233', y: '108', lockedForSigner: true },
  { tabLabel: 'total_amount_fund_disbursed', x: '233', y: '166', lockedForSigner: true },
  { tabLabel: 'total_of_payments', x: '233', y: '213', lockedForSigner: true },
  { tabLabel: 'total_dollar_cost_of_frinancing', x: '233', y: '259', lockedForSigner: true },
  { tabLabel: 'estimated_payment', x: '354', y: '361', lockedForSigner: true },
  { tabLabel: 'percent_of_business_income', x: '262', y: '441', width: '50', lockedForSigner: true },
  { tabLabel: 'percent_of_business_income', x: '283', y: '487', width: '50', lockedForSigner: true },
  { tabLabel: 'percent_of_business_income', x: '427', y: '510', width: '50', lockedForSigner: true },
  { tabLabel: 'percent_of_business_income', x: '420', y: '556', width: '50', lockedForSigner: true },
];

/**
 * Virginia — Harbor View / Clear Capital PDFs (money blanks on page 1;
 * signatures on pages 2 + 4; payment-method blanks on page 3).
 */
const VIRGINIA_PAGE1_OPEN_TEXT_TABS: TextTabs = [
  { tabLabel: 'disclosure_date', x: '480', y: '51', lockedForSigner: true },
  { tabLabel: 'disclosure_name', x: '480', y: '79', lockedForSigner: true },
  { tabLabel: 'recipient_address', x: '480', y: '106', height: '36', lockedForSigner: true },
];

const VIRGINIA_DAILY_DISCLOSURE_TEXT_TABS: TextTabs = [
  ...VIRGINIA_PAGE1_OPEN_TEXT_TABS,
  ...asTabs(VA_DAILY_TEXT_TABS),
  { tabLabel: 'recipient_name2', x: '152', y: '56', pageNumber: '3', lockedForSigner: true },
  { tabLabel: 'recipient_address1', x: '150', y: '84', pageNumber: '3', height: '36', lockedForSigner: true },
  { tabLabel: 'disclosure_date2', x: '416', y: '56', pageNumber: '3', lockedForSigner: true },
];

const VIRGINIA_WEEKLY_DISCLOSURE_TEXT_TABS: TextTabs = [
  ...VIRGINIA_PAGE1_OPEN_TEXT_TABS,
  ...asTabs(VA_WEEKLY_TEXT_TABS),
  { tabLabel: 'recipient_name2', x: '152', y: '56', pageNumber: '3', lockedForSigner: true },
  { tabLabel: 'recipient_address1', x: '150', y: '84', pageNumber: '3', height: '36', lockedForSigner: true },
  { tabLabel: 'disclosure_date2', x: '416', y: '56', pageNumber: '3', lockedForSigner: true },
];

const VIRGINIA_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '72', y: '40', pageNumber: '2' },
    { x: '72', y: '82', pageNumber: '4', signerParty: 'secondary' },
  ],
  dateTabs: [
    { x: '396', y: '40', pageNumber: '2', tabLabel: 'agreement_date' },
    {
      x: '396',
      y: '82',
      pageNumber: '4',
      tabLabel: 'agreement_date',
      signerParty: 'secondary',
    },
  ],
};

/**
 * Connecticut — measured money blanks (Harbor View PDFs). Recipient / disclosure-date
 * are open fields beside printed labels (no underscores).
 */
const CONNECTICUT_PAGE1_OPEN_TEXT_TABS: TextTabs = [
  { tabLabel: 'recipient_name', x: '480', y: '111', lockedForSigner: true },
  { tabLabel: 'recipient_address', x: '480', y: '159', height: '36', lockedForSigner: true },
  { tabLabel: 'disclosure_broker_fee', x: '400', y: '597', lockedForSigner: true },
];

const CONNECTICUT_PAGE2_OPEN_TEXT_TABS: TextTabs = [
  { tabLabel: 'recipient_name2', x: '160', y: '62', pageNumber: '2', lockedForSigner: true },
  { tabLabel: 'recipient_address2', x: '160', y: '82', pageNumber: '2', lockedForSigner: true },
  { tabLabel: 'disclosure_date2', x: '420', y: '62', pageNumber: '2', lockedForSigner: true },
];

const CONNECTICUT_DAILY_NOREFI_DISCLOSURE_TEXT_TABS: TextTabs = [
  ...CONNECTICUT_PAGE1_OPEN_TEXT_TABS,
  ...asTabs(CT_DAILY_NOREFI_TEXT_TABS),
  ...CONNECTICUT_PAGE2_OPEN_TEXT_TABS,
];

const CONNECTICUT_DAILY_REFI_DISCLOSURE_TEXT_TABS: TextTabs = [
  ...CONNECTICUT_PAGE1_OPEN_TEXT_TABS,
  ...asTabs(CT_DAILY_REFI_TEXT_TABS),
  ...CONNECTICUT_PAGE2_OPEN_TEXT_TABS,
];

const CONNECTICUT_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS: TextTabs = [
  ...CONNECTICUT_PAGE1_OPEN_TEXT_TABS,
  ...asTabs(CT_WEEKLY_NOREFI_TEXT_TABS),
  ...CONNECTICUT_PAGE2_OPEN_TEXT_TABS,
];

const CONNECTICUT_WEEKLY_REFI_DISCLOSURE_TEXT_TABS: TextTabs = [
  ...CONNECTICUT_PAGE1_OPEN_TEXT_TABS,
  ...asTabs(CT_WEEKLY_REFI_TEXT_TABS),
  ...CONNECTICUT_PAGE2_OPEN_TEXT_TABS,
];

const CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs' | 'initialHereTabs'
> = {
  initialHereTabs: [{ x: '180', y: '710' }],
  dateTabs: [
    { x: '480', y: '62', tabLabel: 'disclosure_date' },
    { x: '100', y: '64', pageNumber: '3', tabLabel: 'signature1_date' },
    {
      x: '100',
      y: '103',
      pageNumber: '3',
      tabLabel: 'signature2_date',
      signerParty: 'secondary',
    },
  ],
  signHere: [
    { x: '204', y: '45', pageNumber: '3' },
    { x: '269', y: '84', pageNumber: '3', signerParty: 'secondary' },
  ],
};

/**
 * California signatures — Recipient Signature + Date underscores on page 2.
 * Measured from CA daily/weekly PDFs (letter 612×792, DocuSign top-left).
 */
const CALIFORNIA_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  // Underscore top − 1 — sit-on-blank uplift for text tabs.
  signHere: [{ x: '72', y: '544', pageNumber: '2' }],
  dateTabs: [
    { x: '252', y: '544', pageNumber: '2', tabLabel: 'signature_date' },
  ],
};

const CALIFORNIA_DAILY_NOREFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(
  CA_DAILY_NOREFI_TEXT_TABS,
);
const CALIFORNIA_DAILY_REFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(CA_DAILY_REFI_TEXT_TABS);
const CALIFORNIA_DAILY_DISCLOSURE_TEXT_TABS = CALIFORNIA_DAILY_NOREFI_DISCLOSURE_TEXT_TABS;

const CALIFORNIA_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(
  CA_WEEKLY_NOREFI_TEXT_TABS,
);
const CALIFORNIA_WEEKLY_REFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(CA_WEEKLY_REFI_TEXT_TABS);
const CALIFORNIA_WEEKLY_DISCLOSURE_TEXT_TABS = CALIFORNIA_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS;

/** New York — signatures on page 3; itemization on page 4. */
const NEW_YORK_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [{ x: '72', y: '154', pageNumber: '3' }],
  dateTabs: [
    { x: '252', y: '154', pageNumber: '3', tabLabel: 'signature_date' },
  ],
};

const NEW_YORK_DAILY_NOREFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(NY_DAILY_NOREFI_TEXT_TABS);
const NEW_YORK_DAILY_REFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(NY_DAILY_REFI_TEXT_TABS);
const NEW_YORK_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(
  NY_WEEKLY_NOREFI_TEXT_TABS,
);
const NEW_YORK_WEEKLY_REFI_DISCLOSURE_TEXT_TABS: TextTabs = asTabs(NY_WEEKLY_REFI_TEXT_TABS);
const NEW_YORK_NOREFI_DISCLOSURE_TEXT_TABS = NEW_YORK_DAILY_NOREFI_DISCLOSURE_TEXT_TABS;
const NEW_YORK_REFI_DISCLOSURE_TEXT_TABS = NEW_YORK_DAILY_REFI_DISCLOSURE_TEXT_TABS;
const NEW_YORK_DISCLOSURE_TEXT_TABS = NEW_YORK_DAILY_NOREFI_DISCLOSURE_TEXT_TABS;

/** Louisiana shares the FL/GA/KS/LA/MO disclosure PDF (no Sign/Date lines). */
const LOUISIANA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS = FLORIDA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS;
const LOUISIANA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS = FLORIDA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS;
const LOUISIANA_DISCLOSURE_PAGE1_TEXT_TABS = LOUISIANA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS;

/** Texas disclosure — 3-page PDF (page 2 = fees/payoff; page 3 = broker/payoff lines + signatures). */
const TEXAS_DISCLOSURE_PAGE1_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'total_amount_of_fund_disbursed', x: '430', y: '91' },
  { tabLabel: 'total_amount_business_fund', x: '431', y: '128' },
  { tabLabel: 'client_name', x: '271', y: '89' },
  { tabLabel: 'client_name', x: '191', y: '124' },
  { tabLabel: 'funder_name', x: '158', y: '162' },
  { tabLabel: 'total_dollar_cost', x: '431', y: '164' },
  { tabLabel: 'total_amount_tobe_paid_to_provider', x: '431', y: '202' },
  { tabLabel: 'estimated_term', x: '449', y: '237' },
  { tabLabel: 'funder_name', x: '240', y: '289' },
  { tabLabel: 'estimated_payment_amount', x: '401', y: '357' },
  { tabLabel: 'estimated_monthly_cost', x: '427', y: '392' },
];

const TEXAS_DISCLOSURE_PAGE2_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'deal_id_prefix', x: '511', y: '58', pageNumber: '2' },
  { tabLabel: 'deal_id_prefix', x: '350', y: '129', pageNumber: '2' },
  { tabLabel: 'deal_id_prefix', x: '456', y: '267', pageNumber: '2' },
  { tabLabel: 'deal_id_prefix', x: '251', y: '294', pageNumber: '2' },
  { tabLabel: 'deal_id_prefix', x: '274', y: '322', pageNumber: '2' },
  { tabLabel: 'deal_id_prefix', x: '494', y: '336', pageNumber: '2' },
  { tabLabel: 'deal_id_prefix', x: '290', y: '363', pageNumber: '2' },
  { tabLabel: 'client_name', x: '155', y: '397', pageNumber: '2' },
  { tabLabel: 'client_name', x: '139', y: '486', pageNumber: '2' },
  { tabLabel: 'total_dollar_cost', x: '492', y: '451', pageNumber: '2' },
];

const TEXAS_DISCLOSURE_PAGE3_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  { tabLabel: 'deal_id_prefix', x: '503', y: '187', pageNumber: '3' },
  { tabLabel: 'funder_name', x: '241', y: '247', pageNumber: '3' },
  { tabLabel: 'disclosure_broker_fee', x: '510', y: '247', pageNumber: '3' },
  {
    tabLabel: 'disclosure_page3_line_1',
    x: '323',
    y: '300',
    pageNumber: '3',
    optional: true,
    lockedForSigner: true,
  },
  {
    tabLabel: 'disclosure_page3_line_2',
    x: '289',
    y: '327',
    pageNumber: '3',
    optional: true,
    lockedForSigner: true,
  },
  {
    tabLabel: 'disclosure_page3_net',
    x: '489',
    y: '340',
    pageNumber: '3',
    optional: true,
    lockedForSigner: true,
  },
  { tabLabel: 'total_dollar_cost', x: '475', y: '388', pageNumber: '3' },
];

const TEXAS_DISCLOSURE_TEXT_TABS: StateDocumentFieldConfig['textTabs'] = [
  ...TEXAS_DISCLOSURE_PAGE1_TEXT_TABS,
  ...TEXAS_DISCLOSURE_PAGE2_TEXT_TABS,
  ...TEXAS_DISCLOSURE_PAGE3_TEXT_TABS,
];

const TEXAS_DISCLOSURE_SIGN_AND_DATE: Pick<
  StateDocumentFieldConfig,
  'signHere' | 'dateTabs'
> = {
  signHere: [
    { x: '95', y: '505', pageNumber: '3' },
    { x: '431', y: '504', pageNumber: '3', signerParty: 'secondary' },
  ],
  dateTabs: [
    { x: '92', y: '582', pageNumber: '3', tabLabel: 'Signature_date' },
    { x: '429', y: '580', pageNumber: '3', tabLabel: 'Signature_date', signerParty: 'secondary' },
  ],
};

export const STATE_DOCUMENT_CONFIG: Record<string, StateDocumentFieldConfig> = {
  weeklyCalifornia: {
    documentId: '1',
    pageNumber: '1',
    ...CALIFORNIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: CALIFORNIA_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  weeklyCaliforniaNorefi: {
    documentId: '1',
    pageNumber: '1',
    ...CALIFORNIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: CALIFORNIA_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  weeklyCaliforniaRefi: {
    documentId: '1',
    pageNumber: '1',
    ...CALIFORNIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: CALIFORNIA_WEEKLY_REFI_DISCLOSURE_TEXT_TABS,
  },

  dailyCalifornia: {
    documentId: '1',
    pageNumber: '1',
    ...CALIFORNIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: CALIFORNIA_DAILY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  dailyCaliforniaNorefi: {
    documentId: '1',
    pageNumber: '1',
    ...CALIFORNIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: CALIFORNIA_DAILY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  dailyCaliforniaRefi: {
    documentId: '1',
    pageNumber: '1',
    ...CALIFORNIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: CALIFORNIA_DAILY_REFI_DISCLOSURE_TEXT_TABS,
  },

  weeklyFlorida: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: FLORIDA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyFlorida: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: FLORIDA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyMissouri: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: MISSOURI_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyMissouri: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: MISSOURI_DAILY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyGeorgia: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: GEORGIA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyGeorgia: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: GEORGIA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyKansas: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: KANSAS_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyKansas: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: KANSAS_DAILY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyUtah: {
    documentId: '1',
    pageNumber: '1',
    ...UTAH_DISCLOSURE_PAGE2_SIGN_AND_DATE,
    textTabs: UTAH_DAILY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyUtah: {
    documentId: '1',
    pageNumber: '1',
    ...UTAH_DISCLOSURE_PAGE2_SIGN_AND_DATE,
    textTabs: UTAH_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyVirginia: {
    documentId: '1',
    pageNumber: '1',
    ...VIRGINIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: VIRGINIA_WEEKLY_DISCLOSURE_TEXT_TABS,
  },

  dailyVirginia: {
    documentId: '1',
    pageNumber: '1',
    ...VIRGINIA_DISCLOSURE_SIGN_AND_DATE,
    textTabs: VIRGINIA_DAILY_DISCLOSURE_TEXT_TABS,
  },

  weeklyConnecticut: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: CONNECTICUT_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  weeklyConnecticutNorefi: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: CONNECTICUT_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  weeklyConnecticutRefi: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: CONNECTICUT_WEEKLY_REFI_DISCLOSURE_TEXT_TABS,
  },

  dailyConnecticut: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: CONNECTICUT_DAILY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  dailyConnecticutNorefi: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: CONNECTICUT_DAILY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  dailyConnecticutRefi: {
    documentId: '1',
    pageNumber: '1',
    ...CONNECTICUT_DISCLOSURE_SIGN_INITIAL_AND_DATES,
    textTabs: CONNECTICUT_DAILY_REFI_DISCLOSURE_TEXT_TABS,
  },

  weeklyNewYork: {
    documentId: '1',
    pageNumber: '1',
    ...NEW_YORK_DISCLOSURE_SIGN_AND_DATE,
    textTabs: NEW_YORK_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  weeklyNewYorkNorefi: {
    documentId: '1',
    pageNumber: '1',
    ...NEW_YORK_DISCLOSURE_SIGN_AND_DATE,
    textTabs: NEW_YORK_WEEKLY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  weeklyNewYorkRefi: {
    documentId: '1',
    pageNumber: '1',
    ...NEW_YORK_DISCLOSURE_SIGN_AND_DATE,
    textTabs: NEW_YORK_WEEKLY_REFI_DISCLOSURE_TEXT_TABS,
  },

  dailyNewYork: {
    documentId: '1',
    pageNumber: '1',
    ...NEW_YORK_DISCLOSURE_SIGN_AND_DATE,
    textTabs: NEW_YORK_DAILY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  dailyNewYorkNorefi: {
    documentId: '1',
    pageNumber: '1',
    ...NEW_YORK_DISCLOSURE_SIGN_AND_DATE,
    textTabs: NEW_YORK_DAILY_NOREFI_DISCLOSURE_TEXT_TABS,
  },
  dailyNewYorkRefi: {
    documentId: '1',
    pageNumber: '1',
    ...NEW_YORK_DISCLOSURE_SIGN_AND_DATE,
    textTabs: NEW_YORK_DAILY_REFI_DISCLOSURE_TEXT_TABS,
  },

  /** Louisiana (La. R.S. 3138.4) — daily + weekly. */
  weeklyLouisiana: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: LOUISIANA_WEEKLY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  dailyLouisiana: {
    documentId: '1',
    pageNumber: '1',
    ...FL_MULTI_DISCLOSURE_NO_SIGN_OR_DATE,
    textTabs: LOUISIANA_DAILY_DISCLOSURE_PAGE1_TEXT_TABS,
  },

  weeklyTexas: {
    documentId: '1',
    pageNumber: '1',
    ...TEXAS_DISCLOSURE_SIGN_AND_DATE,
    textTabs: TEXAS_DISCLOSURE_TEXT_TABS,
  },

  dailyTexas: {
    documentId: '1',
    pageNumber: '1',
    ...TEXAS_DISCLOSURE_SIGN_AND_DATE,
    textTabs: TEXAS_DISCLOSURE_TEXT_TABS,
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
  la: 'louisiana',
  louisiana: 'louisiana',
  tx: 'texas',
  texas: 'texas',
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
  louisiana: 'Louisiana',
  texas: 'Texas',
};

function capitalize(word: string): string {
  if (!word) return '';
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/** Resolve config key from CRM `frequency` + `state` (+ optional refi/norefi). */
export function resolveStateDocumentConfigKey(
  frequency: string | null | undefined,
  state: string | null | undefined,
  dealType?: 'refi' | 'norefi' | null,
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
  const freqKey = freqRaw.startsWith('week')
    ? 'weekly'
    : freqRaw.startsWith('day')
      ? 'daily'
      : freqRaw;
  const stateName = STATE_DISPLAY_NAME[stateKey] || capitalize(stateKey);
  const base = `${freqKey}${stateName}`;
  const kind = String(dealType ?? '')
    .trim()
    .toLowerCase();
  if (kind === 'refi') {
    const refiKey = `${base}Refi`;
    if (STATE_DOCUMENT_CONFIG[refiKey]) return refiKey;
  }
  if (kind === 'norefi' || kind === 'no_refi' || kind === 'no-refi') {
    const norefiKey = `${base}Norefi`;
    if (STATE_DOCUMENT_CONFIG[norefiKey]) return norefiKey;
  }
  return STATE_DOCUMENT_CONFIG[base] ? base : null;
}

export function inferDisclosureDealTypeFromTemplate(row: {
  layoutKey?: string | null;
  name?: string | null;
}): 'refi' | 'norefi' | null {
  const key = String(row.layoutKey || '').toLowerCase();
  const name = String(row.name || '').toLowerCase();
  if (
    key.endsWith('_norefi') ||
    name.includes('no refi') ||
    name.includes('norefi') ||
    name.includes('no_refi')
  ) {
    return 'norefi';
  }
  if (key.endsWith('_refi') || /\brefi\b/.test(name)) {
    return 'refi';
  }
  return null;
}

export function getStateDocumentConfig(
  frequency: string | null | undefined,
  state: string | null | undefined,
  dealType?: 'refi' | 'norefi' | null,
): StateDocumentFieldConfig | null {
  const key = resolveStateDocumentConfigKey(frequency, state, dealType);
  return key ? STATE_DOCUMENT_CONFIG[key] : null;
}
