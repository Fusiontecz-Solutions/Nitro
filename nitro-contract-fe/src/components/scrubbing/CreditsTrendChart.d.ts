import type { ComponentType } from "react";

export type CreditsTrendChartProps = {
  bankTables?: unknown[];
  loanTransferAllocatedByBankAndMonth?: Record<number, Record<string, number | number[]>> | null;
  privateRoleFundingLoanRule?: boolean;
};

declare const CreditsTrendChart: ComponentType<CreditsTrendChartProps>;
export default CreditsTrendChart;
