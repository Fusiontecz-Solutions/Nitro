/**
 * State-level disclosure document field-position configs.
 * Keys are `${frequency}${StateName}`, e.g. "weeklyCalifornia", "dailyFlorida".
 *
 * Each entry defines where BoldSign should place form-fields inside the
 * disclosure PDF for that state + frequency combination.
 */

export interface DocumentFieldConfig {
  documentId: string;
  pageNumber: string;
  signHere: { x: string; y: string; pageNumber?: string }[];
  dateTabs: { x: string; y: string; pageNumber?: string }[];
  textTabs: { tabLabel: string; x: string; y: string; pageNumber?: string }[];
  initialHereTabs?: { x: string; y: string; pageNumber?: string }[];
}

export const STATE_DOCUMENT_CONFIG: Record<string, DocumentFieldConfig> = {

  weeklyCalifornia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '78', y: '487', pageNumber: '2' },
    ],
    dateTabs: [
      { x: '258', y: '507', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '186', y: '109' },
      { tabLabel: 'amountFinanced', x: '353', y: '143' },
      { tabLabel: 'estimatedAnnualPercentageRate', x: '183', y: '271' },
      { tabLabel: 'averageMonthlyRevenue', x: '361', y: '328' },
      { tabLabel: 'financeCharge', x: '184', y: '444' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '186', y: '549' },
      { tabLabel: 'estimatedMonthlyCost', x: '182', y: '575' },
      { tabLabel: 'estimatedPayment', x: '183', y: '626' },
      { tabLabel: 'estimatedPayment', x: '370', y: '651' },
      { tabLabel: 'paymentTerms', x: '242', y: '663' },
      { tabLabel: 'averageMonthlyRevenue', x: '245', y: '676' },
      { tabLabel: 'estimatedTerm', x: '186', y: '135', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '395', y: '90', pageNumber: '2' },
      { tabLabel: 'averageMonthlyRevenue', x: '422', y: '158', pageNumber: '2' },
      { tabLabel: 'financeCharge', x: '336', y: '349', pageNumber: '2' },
    ],
  },

  dailyCalifornia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '78', y: '487', pageNumber: '2' },
    ],
    dateTabs: [
      { x: '258', y: '507', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '186', y: '109' },
      { tabLabel: 'amountFinanced', x: '290', y: '144' },
      { tabLabel: 'estimatedAnnualPercentageRate', x: '183', y: '271' },
      { tabLabel: 'averageMonthlyRevenue', x: '361', y: '328' },
      { tabLabel: 'financeCharge', x: '184', y: '444' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '186', y: '549' },
      { tabLabel: 'estimatedMonthlyCost', x: '182', y: '575' },
      { tabLabel: 'estimatedPayment', x: '183', y: '626' },
      { tabLabel: 'estimatedPayment', x: '361', y: '672' },
      { tabLabel: 'paymentTerms', x: '207', y: '684' },
      { tabLabel: 'averageMonthlyRevenue', x: '201', y: '694' },
      { tabLabel: 'estimatedTerm', x: '186', y: '135', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '397', y: '90', pageNumber: '2' },
      { tabLabel: 'averageMonthlyRevenue', x: '422', y: '158', pageNumber: '2' },
      { tabLabel: 'financeCharge', x: '329', y: '352', pageNumber: '2' },
    ],
  },

  weeklyFlorida: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '110', y: '623' },
    ],
    dateTabs: [
      { x: '352', y: '644' },
      { x: '358', y: '559' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '483', y: '118' },
      { tabLabel: 'amountFinanced', x: '484', y: '186' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '486', y: '230' },
      { tabLabel: 'financeCharge', x: '500', y: '273' },
      { tabLabel: 'estimatedPayment', x: '314', y: '325' },
      { tabLabel: 'paymentTerms', x: '225', y: '385' },
      { tabLabel: 'paymentTerms', x: '449', y: '414' },
      { tabLabel: 'paymentTerms', x: '517', y: '435' },
      { tabLabel: 'paymentTerms', x: '394', y: '472' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '343', y: '549' },
    ],
  },

  dailyFlorida: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '93', y: '662' },
    ],
    dateTabs: [
      { x: '318', y: '682' },
      { x: '404', y: '556' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '483', y: '118' },
      { tabLabel: 'amountFinanced', x: '484', y: '186' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '486', y: '230' },
      { tabLabel: 'financeCharge', x: '500', y: '273' },
      { tabLabel: 'estimatedPayment', x: '313', y: '325' },
      { tabLabel: 'paymentTerms', x: '341', y: '386' },
      { tabLabel: 'paymentTerms', x: '257', y: '427' },
      { tabLabel: 'paymentTerms', x: '316', y: '447' },
      { tabLabel: 'paymentTerms', x: '258', y: '490' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '333', y: '545' },
    ],
  },

  weeklyGeorgia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '110', y: '623' },
    ],
    dateTabs: [
      { x: '352', y: '644' },
      { x: '358', y: '559' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '483', y: '118' },
      { tabLabel: 'amountFinanced', x: '484', y: '186' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '486', y: '230' },
      { tabLabel: 'financeCharge', x: '500', y: '273' },
      { tabLabel: 'estimatedPayment', x: '314', y: '325' },
      { tabLabel: 'paymentTerms', x: '225', y: '385' },
      { tabLabel: 'paymentTerms', x: '449', y: '414' },
      { tabLabel: 'paymentTerms', x: '517', y: '435' },
      { tabLabel: 'paymentTerms', x: '394', y: '472' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '343', y: '549' },
    ],
  },

  dailyGeorgia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '93', y: '662' },
    ],
    dateTabs: [
      { x: '318', y: '682' },
      { x: '404', y: '556' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '483', y: '118' },
      { tabLabel: 'amountFinanced', x: '484', y: '186' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '486', y: '230' },
      { tabLabel: 'financeCharge', x: '500', y: '273' },
      { tabLabel: 'estimatedPayment', x: '313', y: '325' },
      { tabLabel: 'paymentTerms', x: '341', y: '386' },
      { tabLabel: 'paymentTerms', x: '257', y: '427' },
      { tabLabel: 'paymentTerms', x: '316', y: '447' },
      { tabLabel: 'paymentTerms', x: '258', y: '490' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '333', y: '545' },
    ],
  },

  weeklyKansas: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '130', y: '658' },
    ],
    dateTabs: [
      { x: '328', y: '677' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '236', y: '118' },
      { tabLabel: 'amountFinanced', x: '236', y: '165' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '238', y: '212' },
      { tabLabel: 'financeCharge', x: '253', y: '258' },
      { tabLabel: 'estimatedPayment', x: '294', y: '350' },
      { tabLabel: 'paymentTerms', x: '413', y: '417' },
      { tabLabel: 'paymentTerms', x: '367', y: '463' },
      { tabLabel: 'paymentTerms', x: '421', y: '486' },
      { tabLabel: 'paymentTerms', x: '416', y: '530' },
    ],
  },

  dailyKansas: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '130', y: '658' },
    ],
    dateTabs: [
      { x: '328', y: '677' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '236', y: '118' },
      { tabLabel: 'amountFinanced', x: '236', y: '165' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '238', y: '212' },
      { tabLabel: 'financeCharge', x: '253', y: '258' },
      { tabLabel: 'estimatedPayment', x: '294', y: '350' },
      { tabLabel: 'paymentTerms', x: '319', y: '416' },
      { tabLabel: 'paymentTerms', x: '242', y: '466' },
      { tabLabel: 'paymentTerms', x: '291', y: '491' },
      { tabLabel: 'paymentTerms', x: '240', y: '538' },
    ],
  },

  weeklyUtah: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '37', y: '675' },
    ],
    dateTabs: [
      { x: '218', y: '695' },
      { x: '511', y: '399' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '485', y: '101' },
      { tabLabel: 'amountFinanced', x: '485', y: '156' },
      { tabLabel: 'recipientFunds', x: '482', y: '213' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '485', y: '254' },
      { tabLabel: 'financeCharge', x: '483', y: '296' },
      { tabLabel: 'estimatedPayment', x: '237', y: '338' },
      { tabLabel: 'amountFinanced', x: '439', y: '390' },
      { tabLabel: 'brokerFeePaidByFunder', x: '482', y: '487' },
      { tabLabel: 'paymentTerms', x: '526', y: '548' },
      { tabLabel: 'paymentTerms', x: '511', y: '570' },
    ],
  },

  dailyUtah: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '39', y: '680' },
    ],
    dateTabs: [
      { x: '219', y: '699' },
      { x: '499', y: '392' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '486', y: '101' },
      { tabLabel: 'amountFinanced', x: '483', y: '157' },
      { tabLabel: 'recipientFunds', x: '484', y: '213' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '486', y: '254' },
      { tabLabel: 'financeCharge', x: '483', y: '296' },
      { tabLabel: 'estimatedPayment', x: '235', y: '333' },
      { tabLabel: 'amountFinanced', x: '413', y: '383' },
      { tabLabel: 'brokerFeePaidByFunder', x: '485', y: '491' },
      { tabLabel: 'paymentTerms', x: '528', y: '548' },
      { tabLabel: 'paymentTerms', x: '511', y: '569' },
    ],
  },

  weeklyVirginia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '104', y: '724' },
      { x: '118', y: '726', pageNumber: '2' },
    ],
    dateTabs: [
      { x: '400', y: '739' },
      { x: '419', y: '741', pageNumber: '2' },
      { x: '468', y: '63' },
      { x: '365', y: '654', pageNumber: '1' },
      { x: '429', y: '44', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'merchantBusinessName1', x: '479', y: '88' },
      { tabLabel: 'merchantBusinessAddress1', x: '372', y: '138' },
      { tabLabel: 'revenuePurchased', x: '273', y: '76', pageNumber: '1' },
      { tabLabel: 'feesDeducted', x: '274', y: '112' },
      { tabLabel: 'recipientFunds', x: '273', y: '143' },
      { tabLabel: 'financeCharge', x: '278', y: '183' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '274', y: '211' },
      { tabLabel: 'estimatedTerm', x: '279', y: '246', pageNumber: '1' },
      { tabLabel: 'amountFinanced', x: '197', y: '644', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '391', y: '601' },
      { tabLabel: 'merchantBusinessName1', x: '152', y: '43', pageNumber: '2' },
      { tabLabel: 'merchantBusinessAddress1', x: '165', y: '70', pageNumber: '2' },
      { tabLabel: 'estimatedPayment', x: '146', y: '251', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '198', y: '331', pageNumber: '2' },
      { tabLabel: 'estimatedPayment', x: '269', y: '357', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '293', y: '436', pageNumber: '2' },
    ],
  },

  dailyVirginia: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '110', y: '726' },
      { x: '91', y: '726', pageNumber: '2' },
    ],
    dateTabs: [
      { x: '392', y: '748' },
      { x: '406', y: '743', pageNumber: '2' },
      { x: '468', y: '63' },
      { x: '364', y: '654', pageNumber: '1' },
      { x: '429', y: '44', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'merchantBusinessName1', x: '479', y: '88' },
      { tabLabel: 'merchantBusinessAddress1', x: '491', y: '126' },
      { tabLabel: 'revenuePurchased', x: '273', y: '76', pageNumber: '1' },
      { tabLabel: 'feesDeducted', x: '274', y: '112' },
      { tabLabel: 'recipientFunds', x: '273', y: '143' },
      { tabLabel: 'financeCharge', x: '276', y: '182' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '274', y: '211' },
      { tabLabel: 'estimatedTerm', x: '279', y: '246', pageNumber: '1' },
      { tabLabel: 'amountFinanced', x: '196', y: '644', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '391', y: '600' },
      { tabLabel: 'merchantBusinessName1', x: '152', y: '43', pageNumber: '2' },
      { tabLabel: 'merchantBusinessAddress1', x: '165', y: '70', pageNumber: '2' },
      { tabLabel: 'estimatedPayment', x: '141', y: '253', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '119', y: '325', pageNumber: '2' },
      { tabLabel: 'estimatedPayment', x: '156', y: '350', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '120', y: '422', pageNumber: '2' },
    ],
  },

  weeklyConnecticut: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '221', y: '595', pageNumber: '2' },
      { x: '298', y: '641', pageNumber: '2' },
    ],
    initialHereTabs: [
      { x: '215', y: '722' },
    ],
    dateTabs: [
      { x: '457', y: '720' },
      { x: '106', y: '628', pageNumber: '2' },
      { x: '107', y: '672', pageNumber: '2' },
      { x: '461', y: '72' },
      { x: '353', y: '72', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'merchantBusinessName1', x: '468', y: '96' },
      { tabLabel: 'merchantBusinessAddress1', x: '382', y: '134' },
      { tabLabel: 'amountFinanced', x: '295', y: '87' },
      { tabLabel: 'feesDeducted', x: '298', y: '111' },
      { tabLabel: 'recipientFunds', x: '295', y: '174' },
      { tabLabel: 'financeCharge', x: '299', y: '200' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '295', y: '224' },
      { tabLabel: 'estimatedTerm', x: '322', y: '244', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '465', y: '593', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '499', y: '631', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '316', y: '658', pageNumber: '1' },
      { tabLabel: 'estimatedPayment', x: '78', y: '223', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '179', y: '277', pageNumber: '2' },
      { tabLabel: 'merchantBusinessName1', x: '151', y: '71', pageNumber: '2' },
      { tabLabel: 'merchantBusinessAddress1', x: '156', y: '91', pageNumber: '2' },
    ],
  },

  dailyConnecticut: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '221', y: '595', pageNumber: '2' },
      { x: '298', y: '632', pageNumber: '2' },
    ],
    initialHereTabs: [
      { x: '215', y: '722' },
    ],
    dateTabs: [
      { x: '457', y: '720' },
      { x: '461', y: '72' },
      { x: '106', y: '628', pageNumber: '2' },
      { x: '107', y: '672', pageNumber: '2' },
      { x: '353', y: '72', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'merchantBusinessName1', x: '468', y: '96' },
      { tabLabel: 'merchantBusinessAddress1', x: '382', y: '134' },
      { tabLabel: 'amountFinanced', x: '295', y: '87' },
      { tabLabel: 'feesDeducted', x: '298', y: '111' },
      { tabLabel: 'recipientFunds', x: '295', y: '174' },
      { tabLabel: 'financeCharge', x: '301', y: '202' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '295', y: '224' },
      { tabLabel: 'estimatedTerm', x: '322', y: '244', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '463', y: '594', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '282', y: '643', pageNumber: '1' },
      { tabLabel: 'brokerFeePaidByFunder', x: '418', y: '654', pageNumber: '1' },
      { tabLabel: 'estimatedPayment', x: '70', y: '228', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '421', y: '266', pageNumber: '2' },
      { tabLabel: 'merchantBusinessName1', x: '151', y: '71', pageNumber: '2' },
      { tabLabel: 'merchantBusinessAddress1', x: '156', y: '91', pageNumber: '2' },
    ],
  },

  weeklyNewYork: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '78', y: '487', pageNumber: '2' },
    ],
    dateTabs: [
      { x: '258', y: '507', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '186', y: '109' },
      { tabLabel: 'amountFinanced', x: '300', y: '164' },
      { tabLabel: 'estimatedAnnualPercentageRate', x: '183', y: '271' },
      { tabLabel: 'estimatedMonthlyCost', x: '360', y: '327' },
      { tabLabel: 'financeCharge', x: '181', y: '447' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '183', y: '549' },
      { tabLabel: 'estimatedMonthlyCost', x: '182', y: '575' },
      { tabLabel: 'estimatedPayment', x: '184', y: '626' },
      { tabLabel: 'estimatedPayment', x: '425', y: '663' },
      { tabLabel: 'paymentTerms', x: '224', y: '677' },
      { tabLabel: 'averageMonthlyRevenue', x: '189', y: '685' },
      { tabLabel: 'estimatedTerm', x: '187', y: '137', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '175', y: '83', pageNumber: '2' },
      { tabLabel: 'averageMonthlyRevenue', x: '425', y: '155', pageNumber: '2' },
      { tabLabel: 'financeCharge', x: '335', y: '348', pageNumber: '2' },
    ],
  },

  dailyNewYork: {
    documentId: '1',
    pageNumber: '1',
    signHere: [
      { x: '78', y: '487', pageNumber: '2' },
    ],
    dateTabs: [
      { x: '258', y: '507', pageNumber: '2' },
    ],
    textTabs: [
      { tabLabel: 'purchasePrice', x: '186', y: '109' },
      { tabLabel: 'amountFinanced', x: '290', y: '143' },
      { tabLabel: 'estimatedAnnualPercentageRate', x: '183', y: '271' },
      { tabLabel: 'estimatedMonthlyCost', x: '359', y: '328' },
      { tabLabel: 'financeCharge', x: '181', y: '447' },
      { tabLabel: 'estimatedTotalPaymentAmount', x: '183', y: '549' },
      { tabLabel: 'estimatedMonthlyCost', x: '182', y: '575' },
      { tabLabel: 'estimatedPayment', x: '181', y: '626' },
      { tabLabel: 'estimatedPayment', x: '417', y: '664' },
      { tabLabel: 'paymentTerms', x: '223', y: '677' },
      { tabLabel: 'averageMonthlyRevenue', x: '183', y: '684' },
      { tabLabel: 'estimatedTerm', x: '176', y: '87', pageNumber: '2' },
      { tabLabel: 'paymentTerms', x: '175', y: '83', pageNumber: '2' },
      { tabLabel: 'averageMonthlyRevenue', x: '423', y: '155', pageNumber: '2' },
      { tabLabel: 'financeCharge', x: '262', y: '350', pageNumber: '2' },
    ],
  },
};
