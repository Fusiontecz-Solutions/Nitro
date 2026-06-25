export type ReverseDisbursementScheduleRow = {
  period: string;
  netDailysCredit: string;
  dailysCreditInclFees: string;
  totalPeriodCredits: string;
  receivablesPurchased: string;
};

export type ReverseDisbursementScheduleData = {
  fixedDailyDebit?: string;
  rows: ReverseDisbursementScheduleRow[];
};

export const REVERSE_DISBURSEMENT_COLUMNS = [
  { key: 'period' as const, label: 'Deposit Disbursement Schedule:' },
  { key: 'netDailysCredit' as const, label: 'Net Dailys Credit' },
  { key: 'dailysCreditInclFees' as const, label: 'Dailys Credit (Incl Fees)' },
  { key: 'totalPeriodCredits' as const, label: 'Total Period Credits' },
  { key: 'receivablesPurchased' as const, label: 'Receivables Purchased' },
];
