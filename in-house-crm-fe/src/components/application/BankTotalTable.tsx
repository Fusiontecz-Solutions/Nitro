export type BankTotalTableRow = {
  month: string;
  totalCredit: string;
  loanTransfer: string;
  deposit: string;
  other: string;
  netCredit: string;
  avgDailyBal: string;
  nsfNegDays: string;
  lowBalDays: string;
};

export type BankTotalTableAverageCells = Omit<BankTotalTableRow, "month">;

const monthCellClass =
  "min-w-[140px] whitespace-nowrap px-4 py-2 text-[12px] font-medium text-slate-700 dark:text-slate-200";

const valueCellClass =
  "min-w-[140px] px-4 py-3 text-left text-[13px] tabular-nums text-slate-800 dark:text-slate-200";

export type BankTotalTableProps = {
  rows: BankTotalTableRow[];
  /** Pre-formatted cells; use "-" when averages do not apply (e.g. no divisor months). */
  average: BankTotalTableAverageCells;
};

export default function BankTotalTable({ rows, average }: BankTotalTableProps) {
  return (
    <div className="w-full overflow-hidden rounded-xl border border-[#E2E8F0] bg-white shadow-sm dark:border-slate-700 dark:bg-[#141517]">
      <div className="border-b border-[#E2E8F0] bg-[#D9E9F6] px-5 py-3 dark:border-slate-700 dark:bg-[#2A2B2F]">
        <h2 className="text-lg font-bold uppercase tracking-wide text-[#334155] dark:text-slate-100">
          Bank Total
        </h2>
      </div>
      <div className="overflow-x-auto rounded-b-xl">
        <table className="w-full min-w-[920px] border-separate border-spacing-0 text-left text-[11px]">
          <thead>
            <tr className="border-b border-[#E2E8F0] bg-slate-50 text-[12px] font-semibold uppercase tracking-wide text-[#475569] dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
              <th className="min-w-[140px] px-4 py-3">Month</th>
              <th className="min-w-[140px] px-4 py-3 text-left">Total Credit</th>
              <th className="min-w-[140px] px-4 py-3 text-left">Loan/Transfers</th>
              <th className="min-w-[140px] px-4 py-3 text-left">Unverified Deposit</th>
              <th className="min-w-[140px] px-4 py-3 text-left">Other</th>
              <th className="min-w-[140px] px-4 py-3 text-left">Net Credit</th>
              <th className="min-w-[140px] px-4 py-3 text-left">Avg Daily Bal.</th>
              <th className="min-w-[140px] px-4 py-3 text-left">NSF/Neg Days</th>
              <th className="min-w-[140px] px-4 py-3 text-left">Low Bal. Days</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((row, rowIdx) => (
              <tr
                key={row.month}
                className={
                  rowIdx % 2 === 0 ? "bg-white dark:bg-[#141517]" : "bg-slate-50/40 dark:bg-slate-900/35"
                }
              >
                <td className={monthCellClass}>{row.month}</td>
                <td className={valueCellClass}>{row.totalCredit}</td>
                <td className={valueCellClass}>{row.loanTransfer}</td>
                <td className={valueCellClass}>{row.deposit}</td>
                <td className={valueCellClass}>{row.other}</td>
                <td className={valueCellClass}>{row.netCredit}</td>
                <td className={valueCellClass}>{row.avgDailyBal}</td>
                <td className={valueCellClass}>{row.nsfNegDays}</td>
                <td className={valueCellClass}>{row.lowBalDays}</td>
              </tr>
            ))}
            <tr className="bg-slate-100/80 text-sm font-semibold text-slate-800 dark:bg-slate-800/80 dark:text-slate-100">
              <td className="px-4 py-3 align-middle bg-inherit">
                <div className="flex flex-col leading-snug">
                  <span className="text-xs font-bold uppercase tracking-wide text-slate-900 dark:text-slate-100">
                    Average
                  </span>
                  <span className="mt-0.5 text-[11px] font-medium text-[#1d5f8a] dark:text-sky-300">
                    (MTD not counted)
                  </span>
                </div>
              </td>
              <td className="px-4 py-3 text-left tabular-nums">{average.totalCredit}</td>
              <td className="px-4 py-3 text-left tabular-nums">{average.loanTransfer}</td>
              <td className="px-4 py-3 text-left tabular-nums">{average.deposit}</td>
              <td className="px-4 py-3 text-left tabular-nums">{average.other}</td>
              <td className="px-4 py-3 text-left tabular-nums">{average.netCredit}</td>
              <td className="px-4 py-3 text-left tabular-nums">{average.avgDailyBal}</td>
              <td className="px-4 py-3 text-left tabular-nums">{average.nsfNegDays}</td>
              <td className="px-4 py-3 text-left tabular-nums">{average.lowBalDays}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
