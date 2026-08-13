/**
 * Addendum PDF tab coordinates for DocuSign merged envelopes.
 *
 * Measured from Harbor View Capital + Clear Capital addendum PDFs
 * (letter 612×792, top-left origin). Guarantee pages (CA p3 / VA p2) differ by
 * funder because the printed funder name length shifts the merchant blank and
 * signature blocks — use `resolveAddendumPdfVariant` when building layouts.
 *
 * `tabLabel` values are unscoped PDF variables — CRM prefill ids are
 * `{scope}{tabLabel}` via `layout-prefill-scope.ts` (e.g. `addendum_p_addendum_dated`).
 *
 * Field → value mapping follows the disclosures/addendums setup guide:
 * - Addendum P (REFI): dated/agreement=today, merchant blank=business name,
 *   pay up to=REFI balance, agreement to=label name, print name/title=merchant/OWNER
 * - Addendum CA / NY / VA: agreement dated=today, merchant blank=business name,
 *   CA APR %=APR, print name/title=merchant/OWNER (repeat on later pages)
 */

export type AddendumDocumentTabParty = 'primary' | 'secondary';

/** PDF geometry variant — guarantee pages differ between these funders. */
export type AddendumPdfVariant = 'harbor_view' | 'clear_capital';

export interface AddendumDocumentFieldConfig {
  documentId: string;
  pageNumber: string;
  signHere: {
    x: string;
    y: string;
    pageNumber?: string;
    signerParty?: AddendumDocumentTabParty;
  }[];
  dateTabs: {
    x: string;
    y: string;
    pageNumber?: string;
    tabLabel?: string;
    signerParty?: AddendumDocumentTabParty;
  }[];
  textTabs: {
    tabLabel: string;
    x: string;
    y: string;
    pageNumber?: string;
    width?: string;
    height?: string;
    optional?: boolean;
    lockedForSigner?: boolean;
  }[];
  initialHereTabs?: { x: string; y: string; pageNumber?: string }[];
}

/** Sit-on-blank: measured underscore yTop minus 1 so text/sign sit above the line. */
const ADDENDUM_BLANK_UPLIFT_PX = 1;

const sitOnBlankY = (y: number): string =>
  String(Math.max(0, Math.round(y) - ADDENDUM_BLANK_UPLIFT_PX));

const lockedText = (
  tabLabel: string,
  x: number,
  y: number,
  opts?: { pageNumber?: string; width?: number; height?: number; optional?: boolean },
): AddendumDocumentFieldConfig['textTabs'][number] => ({
  tabLabel,
  x: String(Math.round(x)),
  y: sitOnBlankY(y),
  pageNumber: opts?.pageNumber,
  width: opts?.width != null ? String(Math.round(opts.width)) : undefined,
  height: opts?.height != null ? String(Math.round(opts.height)) : '18',
  optional: opts?.optional === true,
  lockedForSigner: true,
});

const signHereTab = (
  x: number,
  y: number,
  opts?: { pageNumber?: string; signerParty?: AddendumDocumentTabParty },
): AddendumDocumentFieldConfig['signHere'][number] => ({
  x: String(Math.round(x)),
  y: sitOnBlankY(y),
  pageNumber: opts?.pageNumber,
  signerParty: opts?.signerParty,
});

/** Addendum P (REFI) — 1 page. Identical blanks on Harbor View + Clear Capital. */
const ADDENDUM_P_CONFIG: AddendumDocumentFieldConfig = {
  documentId: '1',
  pageNumber: '1',
  textTabs: [
    lockedText('addendum_dated', 271, 129, { width: 120 }),
    lockedText('agreement_dated', 357, 157, { width: 180 }),
    // Merchant blank after printed funder name (setup guide: business name).
    lockedText('funder_and_business_name', 72, 212, { width: 340 }),
    lockedText('pay_up_to_amount', 343, 239, { width: 107 }),
    lockedText('agreement_to_label_name', 72, 295, { width: 347 }),
    lockedText('print_name', 93, 529, { width: 140 }),
    lockedText('print_title', 243, 529, { width: 140 }),
  ],
  dateTabs: [],
  signHere: [signHereTab(394, 529)],
};

/** Addendum NY — 1 page. Harbor View / Clear Capital blanks match (±1px). */
const ADDENDUM_NY_CONFIG: AddendumDocumentFieldConfig = {
  documentId: '1',
  pageNumber: '1',
  textTabs: [
    lockedText('agreement_dated', 254, 129, { width: 120 }),
    lockedText('agreement_dated_2', 308, 142, { width: 180 }),
    lockedText('funder_and_business_name', 72, 170, { width: 340 }),
    lockedText('print_name', 93, 479, { width: 140 }),
    lockedText('print_title', 243, 479, { width: 140 }),
  ],
  dateTabs: [],
  signHere: [signHereTab(394, 479)],
};

/** Shared CA pages 1–2 (identical on both funder PDFs). */
const ADDENDUM_CA_PAGES_1_2_TEXT: AddendumDocumentFieldConfig['textTabs'] = [
  lockedText('agreement_dated', 254, 142, { width: 120 }),
  lockedText('agreement_dated_2', 308, 156, { width: 180 }),
  lockedText('funder_and_business_name', 72, 184, { width: 340 }),
  lockedText('agreement_apr_percent', 167, 584, { width: 40 }),
  lockedText('print_name', 93, 177, { pageNumber: '2', width: 140 }),
  lockedText('print_title', 243, 177, { pageNumber: '2', width: 140 }),
];

/** Harbor View CA — guarantee page: funder name wraps, merchant blank on next line. */
const ADDENDUM_CA_HARBOR_VIEW: AddendumDocumentFieldConfig = {
  documentId: '1',
  pageNumber: '1',
  textTabs: [
    ...ADDENDUM_CA_PAGES_1_2_TEXT,
    lockedText('agreement_dated_page3', 254, 142, { pageNumber: '3', width: 120 }),
    lockedText('agreement_dated_page3b', 110, 156, { pageNumber: '3', width: 120 }),
    lockedText('agreement_dated_page3', 199, 170, { pageNumber: '3', width: 180 }),
    lockedText('funder_and_business_name_page3', 72, 198, {
      pageNumber: '3',
      width: 340,
    }),
    lockedText('print_name_page3', 93, 497, { pageNumber: '3', width: 140 }),
    lockedText('print_title_page3', 243, 497, { pageNumber: '3', width: 140 }),
  ],
  dateTabs: [],
  signHere: [
    signHereTab(394, 177, { pageNumber: '2' }),
    signHereTab(394, 497, { pageNumber: '3' }),
    signHereTab(394, 607, { pageNumber: '3', signerParty: 'secondary' }),
  ],
};

/** Clear Capital CA — guarantee page: merchant blank continues on funder line. */
const ADDENDUM_CA_CLEAR_CAPITAL: AddendumDocumentFieldConfig = {
  documentId: '1',
  pageNumber: '1',
  textTabs: [
    ...ADDENDUM_CA_PAGES_1_2_TEXT,
    lockedText('agreement_dated_page3', 254, 142, { pageNumber: '3', width: 120 }),
    lockedText('agreement_dated_page3b', 110, 156, { pageNumber: '3', width: 120 }),
    lockedText('agreement_dated_page3', 196, 170, { pageNumber: '3', width: 180 }),
    lockedText('funder_and_business_name_page3', 200, 184, {
      pageNumber: '3',
      width: 340,
    }),
    lockedText('print_name_page3', 93, 483, { pageNumber: '3', width: 140 }),
    lockedText('print_title_page3', 243, 483, { pageNumber: '3', width: 140 }),
  ],
  dateTabs: [],
  signHere: [
    signHereTab(394, 177, { pageNumber: '2' }),
    signHereTab(394, 483, { pageNumber: '3' }),
    signHereTab(394, 593, { pageNumber: '3', signerParty: 'secondary' }),
  ],
};

/** Shared VA page 1 (identical on both funder PDFs). */
const ADDENDUM_VA_PAGE_1_TEXT: AddendumDocumentFieldConfig['textTabs'] = [
  lockedText('agreement_dated', 254, 129, { width: 120 }),
  lockedText('agreement_dated_2', 308, 142, { width: 180 }),
  lockedText('funder_and_business_name', 72, 170, { width: 340 }),
  lockedText('print_name', 93, 557, { width: 140 }),
  lockedText('print_title', 243, 557, { width: 140 }),
];

/** Harbor View VA — guarantee page wraps after HARBOR VIEW. */
const ADDENDUM_VA_HARBOR_VIEW: AddendumDocumentFieldConfig = {
  documentId: '1',
  pageNumber: '1',
  textTabs: [
    ...ADDENDUM_VA_PAGE_1_TEXT,
    lockedText('agreement_dated_page2', 254, 129, { pageNumber: '2', width: 120 }),
    lockedText('agreement_dated_page2b', 110, 142, { pageNumber: '2', width: 120 }),
    lockedText('agreement_dated_page2', 199, 156, { pageNumber: '2', width: 180 }),
    lockedText('funder_and_business_name_page2', 72, 184, {
      pageNumber: '2',
      width: 340,
    }),
    lockedText('print_name_page2', 93, 557, { pageNumber: '2', width: 140 }),
    lockedText('print_title_page2', 243, 557, { pageNumber: '2', width: 140 }),
  ],
  dateTabs: [],
  signHere: [
    signHereTab(394, 557),
    signHereTab(394, 557, { pageNumber: '2' }),
    signHereTab(394, 667, { pageNumber: '2', signerParty: 'secondary' }),
  ],
};

/** Clear Capital VA — merchant blank on funder line; signature block higher. */
const ADDENDUM_VA_CLEAR_CAPITAL: AddendumDocumentFieldConfig = {
  documentId: '1',
  pageNumber: '1',
  textTabs: [
    ...ADDENDUM_VA_PAGE_1_TEXT,
    lockedText('agreement_dated_page2', 254, 129, { pageNumber: '2', width: 120 }),
    lockedText('agreement_dated_page2b', 110, 142, { pageNumber: '2', width: 120 }),
    lockedText('agreement_dated_page2', 196, 156, { pageNumber: '2', width: 180 }),
    lockedText('funder_and_business_name_page2', 200, 170, {
      pageNumber: '2',
      width: 340,
    }),
    lockedText('print_name_page2', 93, 543, { pageNumber: '2', width: 140 }),
    lockedText('print_title_page2', 243, 543, { pageNumber: '2', width: 140 }),
  ],
  dateTabs: [],
  signHere: [
    signHereTab(394, 557),
    signHereTab(394, 543, { pageNumber: '2' }),
    signHereTab(394, 653, { pageNumber: '2', signerParty: 'secondary' }),
  ],
};

export const ADDENDUM_DOCUMENT_CONFIG: Record<string, AddendumDocumentFieldConfig> = {
  addendum_p: ADDENDUM_P_CONFIG,
  addendum_ca: ADDENDUM_CA_HARBOR_VIEW,
  addendum_ny: ADDENDUM_NY_CONFIG,
  addendum_va: ADDENDUM_VA_HARBOR_VIEW,
  // Explicit variant keys (optional; preferred path is resolve via funder name).
  addendum_ca_harbor_view: ADDENDUM_CA_HARBOR_VIEW,
  addendum_ca_clear_capital: ADDENDUM_CA_CLEAR_CAPITAL,
  addendum_va_harbor_view: ADDENDUM_VA_HARBOR_VIEW,
  addendum_va_clear_capital: ADDENDUM_VA_CLEAR_CAPITAL,
  // Legacy guarantor multi-entity form (kept for BoldSign / older paths).
  guarantorAddendum: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '118', y: '297', pageNumber: '1' },
      { x: '134', y: '460', pageNumber: '1' },
      { x: '118', y: '624', pageNumber: '1' },
    ],
    dateTabs: [
      { x: '272', y: '105', pageNumber: '1' },
      { x: '188', y: '117', pageNumber: '1' },
    ],
    textTabs: [
      { tabLabel: 'merchantBusinessName1', x: '205', y: '209', pageNumber: '1' },
      { tabLabel: 'dba1', x: '115', y: '229', pageNumber: '1' },
      { tabLabel: 'typeOfEntity1', x: '156', y: '245', pageNumber: '1' },
      { tabLabel: 'merchantBusinessEmail1', x: '169', y: '264', pageNumber: '4' },
      { tabLabel: 'einNumber1', x: '433', y: '244', pageNumber: '1' },
      { tabLabel: 'state1', x: '431', y: '265', pageNumber: '1' },
      { tabLabel: 'city1', x: '322', y: '267', pageNumber: '1' },
      { tabLabel: 'zip1', x: '492', y: '265', pageNumber: '1' },
      { tabLabel: 'merchantBusinessName2', x: '209', y: '376', pageNumber: '1' },
      { tabLabel: 'dba2', x: '124', y: '394', pageNumber: '1' },
      { tabLabel: 'typeOfEntity2', x: '159', y: '414', pageNumber: '1' },
      { tabLabel: 'merchantBusinessEmail2', x: '169', y: '428', pageNumber: '4' },
      { tabLabel: 'einNumber2', x: '438', y: '411', pageNumber: '1' },
      { tabLabel: 'state2', x: '430', y: '430', pageNumber: '1' },
      { tabLabel: 'city2', x: '324', y: '431', pageNumber: '1' },
      { tabLabel: 'zip2', x: '488', y: '431', pageNumber: '1' },
      { tabLabel: 'merchantBusinessName3', x: '212', y: '541', pageNumber: '1' },
      { tabLabel: 'dba3', x: '121', y: '561', pageNumber: '1' },
      { tabLabel: 'typeOfEntity3', x: '162', y: '579', pageNumber: '1' },
      { tabLabel: 'merchantBusinessEmail3', x: '169', y: '597', pageNumber: '4' },
      { tabLabel: 'einNumber3', x: '452', y: '578', pageNumber: '1' },
      { tabLabel: 'state3', x: '432', y: '597', pageNumber: '1' },
      { tabLabel: 'city3', x: '325', y: '599', pageNumber: '1' },
      { tabLabel: 'zip3', x: '496', y: '598', pageNumber: '1' },
      { tabLabel: 'merchantBusinessName1', x: '131', y: '328', pageNumber: '1' },
      { tabLabel: 'merchantBusinessName2', x: '129', y: '496', pageNumber: '1' },
      { tabLabel: 'merchantBusinessName3', x: '126', y: '656', pageNumber: '1' },
    ],
  },
};

export const ADDENDUM_LAYOUT_DISPLAY_NAMES: Record<string, string> = {
  addendum_p: 'Addendum P (REFI)',
  addendum_ca: 'Addendum CA',
  addendum_ny: 'Addendum NY',
  addendum_va: 'Addendum VA',
};

/**
 * Detect which addendum PDF geometry to use.
 * Clear Capital guarantee pages shift blanks ~14–28px vs Harbor View.
 */
export function resolveAddendumPdfVariant(hints?: {
  name?: string | null;
  pdfUrl?: string | null;
  funderName?: string | null;
  fileName?: string | null;
}): AddendumPdfVariant {
  const haystack = [
    hints?.funderName,
    hints?.name,
    hints?.fileName,
    hints?.pdfUrl,
  ]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');

  if (
    haystack.includes('clear capital') ||
    haystack.includes('clear_capital') ||
    haystack.includes('clear-capital') ||
    /addendum[^a-z0-9]+(?:ca|va|ny|p)[^a-z0-9]+clear/.test(haystack)
  ) {
    return 'clear_capital';
  }

  // Platform default PDFs / Harbor View / unspecified funders.
  return 'harbor_view';
}

export function resolveAddendumDocumentConfigKey(
  layoutKeyOrType?: string | null,
): string | null {
  const raw = String(layoutKeyOrType || '')
    .trim()
    .toLowerCase();
  if (!raw) return null;

  if (raw === 'addendum_ca_clear_capital' || raw === 'addendum_ca_harbor_view') {
    return raw;
  }
  if (raw === 'addendum_va_clear_capital' || raw === 'addendum_va_harbor_view') {
    return raw;
  }

  if (ADDENDUM_DOCUMENT_CONFIG[raw] && raw !== 'guarantoraddendum') {
    return raw;
  }

  if (raw.endsWith('_addendum_p') || raw.endsWith('_addendum_p_refi') || raw === 'addendum_p') {
    return 'addendum_p';
  }
  if (raw.endsWith('_addendum_ca') || raw === 'addendum_ca') return 'addendum_ca';
  if (raw.endsWith('_addendum_ny') || raw === 'addendum_ny') return 'addendum_ny';
  if (raw.endsWith('_addendum_va') || raw === 'addendum_va') return 'addendum_va';

  return null;
}

function configForKeyAndVariant(
  key: string,
  variant: AddendumPdfVariant,
): AddendumDocumentFieldConfig | null {
  if (key === 'addendum_ca' || key === 'addendum_ca_harbor_view' || key === 'addendum_ca_clear_capital') {
    return variant === 'clear_capital'
      ? ADDENDUM_CA_CLEAR_CAPITAL
      : ADDENDUM_CA_HARBOR_VIEW;
  }
  if (key === 'addendum_va' || key === 'addendum_va_harbor_view' || key === 'addendum_va_clear_capital') {
    return variant === 'clear_capital'
      ? ADDENDUM_VA_CLEAR_CAPITAL
      : ADDENDUM_VA_HARBOR_VIEW;
  }
  return ADDENDUM_DOCUMENT_CONFIG[key] || null;
}

export function getAddendumDocumentConfig(
  layoutKeyOrType?: string | null,
  variant: AddendumPdfVariant = 'harbor_view',
): AddendumDocumentFieldConfig | null {
  const key = resolveAddendumDocumentConfigKey(layoutKeyOrType);
  if (!key) return null;
  return configForKeyAndVariant(key, variant);
}
