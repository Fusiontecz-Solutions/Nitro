/**
 * Syndicators dashboard for internal roles: KPIs from `GET /syndicators/admin-summary`,
 * repayment and funding aggregates from syndicator wallet transactions.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { format, isValid, parseISO } from 'date-fns';
import { motion } from 'framer-motion';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipContentProps } from 'recharts';
import { useTheme } from '@/context/ThemeContext';
import { Users, Coins, TrendingUp, Wallet, AlertTriangle, BadgeDollarSign } from 'lucide-react';

import { CornerSummaryCard } from '@/pages/commissionPortal/CornerSummaryCard';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import SyndicatorsSectionTabs from '@/components/syndicators/SyndicatorsSectionTabs';
import { axiosGet } from '@/redux/axios';
import { formatCurrency } from '@/lib/utils';
import {
  groupInflowByTimeframe,
  groupOutflowByTimeframe,
} from '@/lib/syndicatorsDashboardChartFilter';

type ChartData = {
  name: string;
  inflow: number;
  outflow: number;
};

type PieTooltipPayload = {
  name: string;
  value: number;
  color: string;
};

type WalletPoint = { date: string; amount: string };

type AdminSummaryPayload = {
  totalSyndicators: number;
  amountSyndicated: number;
  commissionAmount: number;
  paybackAmountSyndicated: number;
  managementFeeToDate: number;
  remainingAmount: number;
  collectedAmount: number;
  defaultedAmount: number;
  REPAYMENT: WalletPoint[];
  Funding: WalletPoint[];
};

/** Circular KPI badge (matches admin / commission portal stat tiles). */
function StatIconBadge({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex size-8 shrink-0 items-center justify-center rounded-full text-white ${className}`}
    >
      {children}
    </span>
  );
}

/** Platform syndicator accent (matches admin nav / CRM blue) */
const primaryColor = 'var(--primary)';
const secondaryColor = 'var(--chart-4)';
const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-5)'];

function formatAxisTick(
  raw: string,
  mode: 'daily' | 'weekly' | 'monthly',
): string {
  if (mode === 'weekly') return raw;
  const d = parseISO(raw);
  if (!isValid(d)) return raw;
  return mode === 'daily' ? format(d, 'd') : format(d, 'MMM');
}

function formatTooltipPeriod(
  label: unknown,
  mode: 'daily' | 'weekly' | 'monthly',
): string {
  if (mode === 'weekly') return String(label ?? '');
  const s = String(label ?? '');
  const d = parseISO(s);
  if (!isValid(d)) return s;
  if (mode === 'daily') return format(d, 'dd MMM');
  return format(d, 'MMM');
}

const PieCustomTooltip: React.FC<Partial<TooltipContentProps<number, string>>> = ({ active, payload }) => {
  if (active && payload?.length) {
    const entry = payload[0]!.payload as PieTooltipPayload;
    const bgColor = entry.color || primaryColor;
    return (
      <div className="flex items-center" style={{ position: 'relative', left: 120 }}>
        <div
          style={{
            position: 'relative',
            left: 5,
            width: 0,
            height: 0,
            borderTop: '12px solid transparent',
            borderBottom: '12px solid transparent',
            borderRight: `14px solid ${bgColor}`,
            marginRight: 2,
          }}
        />
        <div
          style={{
            background: bgColor,
            color: 'var(--primary-foreground)',
            borderRadius: 8,
            padding: '10px 18px',
            fontWeight: 'bold',
            fontSize: '17px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
            minWidth: 70,
            textAlign: 'center',
          }}
        >
          <div className="text-sm font-light">{entry.name}</div>
          {formatCurrency(entry.value)}
        </div>
      </div>
    );
  }
  return null;
};

const CustomTooltip: React.FC<{
  active?: boolean;
  payload?: Array<{ value: number }>;
  label?: string;
  payoutTimeframe?: 'daily' | 'weekly' | 'monthly';
}> = ({ active, payload, label, payoutTimeframe }) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-foreground shadow-md">
        <p className="m-0">{formatTooltipPeriod(label, payoutTimeframe ?? 'daily')}</p>
        <p className="text-sm" style={{ color: primaryColor }}>
          Payout: {formatCurrency(payload[0]!.value)}
        </p>
      </div>
    );
  }
  return null;
};

const CustomTooltipCashflow: React.FC<
  Partial<TooltipContentProps<number, string>> & { cashflowTimeframe?: 'daily' | 'weekly' | 'monthly' }
> = ({ active, payload, label, cashflowTimeframe }) => {
  if (active && payload?.length) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 text-foreground shadow-md">
        <p className="m-0">{formatTooltipPeriod(label, cashflowTimeframe ?? 'daily')}</p>
        {payload.map((entry, index) => (
          <p
            key={`item-${index}`}
            className="text-sm font-medium"
            style={{
              color: entry.dataKey === 'inflow' ? secondaryColor : primaryColor,
            }}
          >
            {entry.dataKey === 'inflow' ? 'Cash Inflow' : 'Cash Outflow'}:{' '}
            {formatCurrency(Number(entry.value ?? 0))}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function AdminSyndicatorsDashboard() {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<AdminSummaryPayload | null>(null);
  const [repaymentSeries, setRepaymentSeries] = useState<WalletPoint[]>([]);
  const [fundingSeries, setFundingSeries] = useState<WalletPoint[]>([]);

  const [cashflowTimeframe, setCashflowTimeframe] = useState<'daily' | 'weekly' | 'monthly'>(
    'daily',
  );
  const [payoutTimeframe, setPayoutTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [payoutChartData, setPayoutChartData] = useState<Array<{ name: string; inflow: number }>>(
    [],
  );
  const [cashflowChartData, setCashflowChartData] = useState<ChartData[]>([]);
  const [hoveredBar, setHoveredBar] = useState<number | null>(null);

  const fetchSummary = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await axiosGet('/syndicators/admin-summary');
      const payload = res?.data?.data ?? res?.data;
      if (!payload || typeof payload.totalSyndicators !== 'number') {
        setError('Unexpected response');
        return;
      }
      const d = payload as AdminSummaryPayload;
      setSummary(d);
      setRepaymentSeries(Array.isArray(d.REPAYMENT) ? d.REPAYMENT : []);
      setFundingSeries(Array.isArray(d.Funding) ? d.Funding : []);
    } catch (e: unknown) {
      const msg =
        typeof e === 'object' &&
        e !== null &&
        'response' in e &&
        typeof (e as { response?: { data?: { message?: string } } }).response?.data?.message ===
          'string'
          ? String((e as { response: { data: { message: string } } }).response.data.message)
          : 'Failed to load syndicator overview';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    const inflowGrouped = groupInflowByTimeframe(repaymentSeries, cashflowTimeframe);
    const outflowGrouped = groupOutflowByTimeframe(fundingSeries, cashflowTimeframe);
    const combinedMap: Record<string, ChartData> = {};
    inflowGrouped.forEach((item) => {
      const outdata = outflowGrouped.find((o) => o.name === item.name);
      combinedMap[item.name] = {
        name: item.name,
        inflow: item.inflow || 0,
        outflow: outdata?.outflow || 0,
      };
    });
    setCashflowChartData(Object.values(combinedMap));
  }, [repaymentSeries, fundingSeries, cashflowTimeframe]);

  useEffect(() => {
    const inflowGrouped = groupInflowByTimeframe(repaymentSeries, payoutTimeframe);
    setPayoutChartData(
      inflowGrouped.map((item) => ({
        name: item.name,
        inflow: item.inflow || 0,
      })),
    );
  }, [repaymentSeries, payoutTimeframe]);

  const maxPayoutValue = Math.max(...payoutChartData.map((d) => d.inflow || 0), 0);
  const maxPayoutLabel = formatCurrency(maxPayoutValue);
  const payoutLeftMargin = Math.min(120, maxPayoutLabel.length * 4);

  const maxCashflowValue = Math.max(
    ...cashflowChartData.map((d) => Math.max(d.inflow || 0, d.outflow || 0)),
    0,
  );
  const maxCashflowLabel = formatCurrency(maxCashflowValue);
  const cashflowLeftMargin = Math.min(120, maxCashflowLabel.length * 4);

  const totalInvestment = summary?.amountSyndicated ?? 0;
  const totalpaybackSyndicated = summary?.paybackAmountSyndicated ?? 0;
  const totalremaining = summary?.remainingAmount ?? 0;
  const totalCommission = summary?.commissionAmount ?? 0;
  const totalManagement = summary?.managementFeeToDate ?? 0;
  const totalCollected = summary?.collectedAmount ?? 0;
  const totalDefaultedAmount = summary?.defaultedAmount ?? 0;
  const totalSyndicators = summary?.totalSyndicators ?? 0;

  const datapie1 = useMemo(
    () => [
      { name: 'Syndicated', value: totalInvestment, color: primaryColor },
      { name: 'Commission', value: totalCommission, color: secondaryColor },
    ],
    [totalInvestment, totalCommission],
  );

  const datapie2 = useMemo(
    () => [
      { name: 'Syndicated RTR', value: totalpaybackSyndicated, color: primaryColor },
      { name: 'Commission', value: totalCommission, color: 'var(--chart-2)' },
      { name: 'Mgmt Fees Up To Date', value: totalManagement, color: 'var(--destructive)' },
      { name: 'Remaining', value: totalremaining, color: 'var(--chart-5)' },
    ],
    [totalpaybackSyndicated, totalCommission, totalManagement, totalremaining],
  );

  const datapie3 = useMemo(
    () => [
      { name: 'Invested', value: totalInvestment, color: primaryColor },
      { name: 'Default', value: totalDefaultedAmount, color: 'var(--destructive)' },
      { name: 'Paid', value: totalCollected, color: secondaryColor },
    ],
    [totalInvestment, totalDefaultedAmount, totalCollected],
  );

  const totalSyndicateInvested = totalInvestment + totalCommission;
  const totalSyndicateRTR =
    totalpaybackSyndicated + totalCommission + totalManagement + totalremaining;

  const filteredColorsSyndicateInvested = [COLORS[0], COLORS[COLORS.length - 1]];

  if (loading) {
    return (
      <div className="w-full space-y-4 px-4 pb-4 pt-6">
        <SyndicatorsSectionTabs />
        <p className="text-sm text-muted-foreground">Loading syndicator dashboard…</p>
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="w-full space-y-4 px-4 pb-4 pt-6">
        <SyndicatorsSectionTabs />
        <p className="text-sm text-destructive">{error ?? 'Unable to load data.'}</p>
      </div>
    );
  }

  return (
    <div className="w-full px-4 pb-4 pt-6">
      <SyndicatorsSectionTabs />

      <h2 className="mb-4 mt-5 text-xl font-semibold tracking-tight md:mt-6">
        Syndicator Dashboard
      </h2>

      {/* KPI row — same CornerSummaryCard pattern as admin dashboard & applications list */}
      <section className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <div
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              navigate('/syndicators/syndicators-list');
            }
          }}
          onClick={() => navigate('/syndicators/syndicators-list')}
          className="h-full cursor-pointer rounded-xl transform-gpu transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.01] active:scale-[0.99] hover:ring-2 hover:ring-[var(--brand)]/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]/40"
        >
          <CornerSummaryCard
            isDark={isDark}
            title="TOTAL SYNDICATORS"
            icon={
              <StatIconBadge className="bg-[var(--brand)]">
                <Users className="size-4" aria-hidden />
              </StatIconBadge>
            }
            iconSize={20}
            countValue={String(totalSyndicators)}
            countSuffix={totalSyndicators === 1 ? 'Syndicator' : 'Syndicators'}
            footLeft="Total syndicated principal"
            amountValue={formatCurrency(totalInvestment)}
          />
        </div>

        <div className="h-full rounded-xl transform-gpu transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:ring-2 hover:ring-[var(--brand)]/25">
          <CornerSummaryCard
            isDark={isDark}
            title="TOTAL INVESTMENT"
            icon={
              <StatIconBadge className="bg-emerald-600">
                <Coins className="size-4" aria-hidden />
              </StatIconBadge>
            }
            iconSize={20}
            countValue={formatCurrency(totalInvestment)}
            countSuffix="Syndicated"
            footLeft="Expected RTR"
            amountValue={formatCurrency(totalpaybackSyndicated)}
          />
        </div>

        <div className="h-full rounded-xl transform-gpu transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:ring-2 hover:ring-[var(--brand)]/25">
          <CornerSummaryCard
            isDark={isDark}
            title="EXPECTED RTR"
            icon={
              <StatIconBadge className="bg-sky-600">
                <TrendingUp className="size-4" aria-hidden />
              </StatIconBadge>
            }
            iconSize={20}
            countValue={formatCurrency(totalpaybackSyndicated)}
            countSuffix="Payback"
            footLeft="Outstanding remaining"
            amountValue={formatCurrency(totalremaining)}
          />
        </div>

        <div className="h-full rounded-xl transform-gpu transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:ring-2 hover:ring-[var(--brand)]/25">
          <CornerSummaryCard
            isDark={isDark}
            title="TOTAL REMAINING"
            icon={
              <StatIconBadge className="bg-primary">
                <Wallet className="size-4" aria-hidden />
              </StatIconBadge>
            }
            iconSize={20}
            countValue={formatCurrency(totalremaining)}
            countSuffix="Outstanding"
            footLeft="Commission to date"
            amountValue={formatCurrency(totalCommission)}
          />
        </div>

        <div className="h-full rounded-xl transform-gpu transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:ring-2 hover:ring-[var(--brand)]/25">
          <CornerSummaryCard
            isDark={isDark}
            title="DEFAULT RTR"
            icon={
              <StatIconBadge className="bg-rose-600">
                <AlertTriangle className="size-4" aria-hidden />
              </StatIconBadge>
            }
            iconSize={20}
            countValue={formatCurrency(totalDefaultedAmount)}
            countSuffix="At risk"
            footLeft="Collected recoveries"
            amountValue={formatCurrency(totalCollected)}
          />
        </div>

        <div className="h-full rounded-xl transform-gpu transition-all duration-300 ease-out hover:-translate-y-0.5 hover:scale-[1.01] hover:ring-2 hover:ring-[var(--brand)]/25">
          <CornerSummaryCard
            isDark={isDark}
            title="TOTAL COMMISSION"
            icon={
              <StatIconBadge className="bg-green-600">
                <BadgeDollarSign className="size-4" aria-hidden />
              </StatIconBadge>
            }
            iconSize={20}
            countValue={formatCurrency(totalCommission)}
            countSuffix="Earned"
            footLeft="Management fees to date"
            amountValue={formatCurrency(totalManagement)}
          />
        </div>
      </section>

      <div className="mb-8 grid grid-cols-1 items-stretch gap-6 xl:grid-cols-2">
        <motion.div
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.99 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="cyber-card flex h-auto w-full flex-col"
        >
          <div className="flex h-full w-full flex-col rounded-2xl border border-border bg-card px-6 py-6 shadow-sm transition-shadow hover:shadow-md">
            <div className="mb-4 flex w-full items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Cash Flow</h2>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded" style={{ backgroundColor: secondaryColor }} />
                  <span className="text-sm text-muted-foreground">Cash Inflow</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="h-3 w-3 rounded" style={{ backgroundColor: primaryColor }} />
                  <span className="text-sm text-muted-foreground">Cash Outflow</span>
                </div>
              </div>
              <div className="flex justify-end">
                <Select
                  value={cashflowTimeframe}
                  onValueChange={(val: 'daily' | 'weekly' | 'monthly') => setCashflowTimeframe(val)}
                >
                  <SelectTrigger
                    className="w-[160px] border border-border text-sm font-medium focus:ring-2"
                    style={{ borderColor: primaryColor }}
                  >
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="h-[360px] flex-grow">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={cashflowChartData}
                  margin={{
                    top: 0,
                    right: 0,
                    left: cashflowLeftMargin,
                    bottom: 40,
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <YAxis
                    tickFormatter={(value) => formatCurrency(Number(value))}
                    tick={{ fontSize: 13, fill: 'var(--muted-foreground)' }}
                  />
                  <XAxis
                    dataKey="name"
                    interval="preserveStartEnd"
                    tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                    tickFormatter={(value) => formatAxisTick(String(value), cashflowTimeframe)}
                    textAnchor="middle"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={10}
                    label={{
                      value:
                        cashflowTimeframe === 'daily'
                          ? 'Dates'
                          : cashflowTimeframe === 'weekly'
                            ? 'Weeks'
                            : 'Months',
                      position: 'insideBottom',
                      offset: -20,
                      style: { textAnchor: 'middle', fill: 'var(--muted-foreground)', fontSize: 14 },
                      dx: -35,
                    }}
                  />
                  <Tooltip
                    content={<CustomTooltipCashflow cashflowTimeframe={cashflowTimeframe} />}
                  />
                  <Bar
                    dataKey="outflow"
                    stackId="a"
                    fill={primaryColor}
                    radius={[6, 6, 0, 0]}
                    barSize={30}
                  />
                  <Bar
                    dataKey="inflow"
                    stackId="a"
                    fill={secondaryColor}
                    radius={[6, 6, 0, 0]}
                    barSize={30}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.99 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="cyber-card flex h-auto w-full flex-col"
        >
          <div className="flex h-full w-full flex-col rounded-2xl border border-border bg-card px-6 py-6 shadow-sm transition-shadow hover:shadow-md">
            <div className="mb-4 flex w-full items-center justify-between">
              <h2 className="text-base font-semibold text-foreground">Payouts</h2>
              <div className="flex items-center gap-1">
                <div className="h-3 w-3 rounded" style={{ backgroundColor: secondaryColor }} />
                <span className="text-sm text-muted-foreground">Payouts</span>
              </div>
              <div className="flex justify-end">
                <Select
                  value={payoutTimeframe}
                  onValueChange={(val: 'daily' | 'weekly' | 'monthly') => setPayoutTimeframe(val)}
                >
                  <SelectTrigger
                    className="w-[160px] border border-border text-sm font-medium focus:ring-2"
                    style={{ borderColor: primaryColor }}
                  >
                    <SelectValue placeholder="Select timeframe" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="h-[360px] flex-grow">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart
                  data={payoutChartData}
                  margin={{ top: 0, right: 0, left: payoutLeftMargin, bottom: 40 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                  <YAxis
                    tickFormatter={(value) => formatCurrency(Number(value))}
                    tick={{ fontSize: 13, fill: 'var(--muted-foreground)' }}
                  />
                  <XAxis
                    dataKey="name"
                    interval="preserveStartEnd"
                    tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }}
                    tickFormatter={(value) => formatAxisTick(String(value), payoutTimeframe)}
                    textAnchor="middle"
                    axisLine={false}
                    tickLine={false}
                    tickMargin={10}
                    label={{
                      value:
                        payoutTimeframe === 'daily'
                          ? 'Dates'
                          : payoutTimeframe === 'weekly'
                            ? 'Weeks'
                            : 'Months',
                      position: 'insideBottom',
                      offset: -20,
                      style: { textAnchor: 'middle', fill: 'var(--muted-foreground)', fontSize: 14 },
                      dx: -35,
                    }}
                  />
                  <Tooltip content={<CustomTooltip payoutTimeframe={payoutTimeframe} />} />
                  <Bar dataKey="inflow" barSize={30} radius={[6, 6, 0, 0]}>
                    {payoutChartData.map((entry, index) => (
                      <Cell
                        key={entry.name}
                        fill={hoveredBar === index ? primaryColor : secondaryColor}
                        onMouseEnter={() => setHoveredBar(index)}
                        onMouseLeave={() => setHoveredBar(null)}
                      />
                    ))}
                  </Bar>
                  <Line
                    type="monotone"
                    dataKey="inflow"
                    stroke={primaryColor}
                    strokeWidth={2}
                    dot={({ cx, cy, key }) => (
                      <circle
                        key={key}
                        cx={cx}
                        cy={cy}
                        r={8}
                        fill="var(--card)"
                        stroke={primaryColor}
                        strokeWidth={2}
                      />
                    )}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="grid grid-cols-1 gap-8 md:grid-cols-2 xl:grid-cols-3">
        <motion.div
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.99 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="cyber-card flex h-full w-full flex-col rounded-2xl border border-border bg-card/80 px-6 py-6 shadow-sm backdrop-blur transition-all hover:shadow-md"
        >
          <h4 className="self-start pl-[1rem] text-base font-bold text-foreground">Total Syndicate Invested</h4>
          <div className="w-full pl-[1rem] text-left">
            <p className="text-lg font-semibold text-primary">
              {formatCurrency(totalSyndicateInvested || 0)}
            </p>
          </div>
          <div className="flex flex-col items-center justify-center">
            <PieChart width={300} height={230}>
              <Pie
                data={datapie1}
                cx={150}
                cy={105}
                innerRadius={40}
                outerRadius={80}
                paddingAngle={0}
                dataKey="value"
              >
                {datapie1.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={filteredColorsSyndicateInvested[index % filteredColorsSyndicateInvested.length]}
                    stroke="var(--card)"
                    strokeWidth={1}
                  />
                ))}
              </Pie>
              <Tooltip content={<PieCustomTooltip />} />
            </PieChart>
            <div className="flex flex-col items-start justify-center">
              {datapie1.map((entry, index) => (
                <div key={entry.name} className="mb-2 flex items-center justify-start">
                  <div
                    className="mr-2 h-3 w-3 rounded"
                    style={{
                      backgroundColor:
                        filteredColorsSyndicateInvested[
                          index % filteredColorsSyndicateInvested.length
                        ],
                    }}
                  />
                  <span className="w-[50px] text-right text-sm font-bold">
                    {totalSyndicateInvested
                      ? `${Math.round((entry.value / totalSyndicateInvested) * 1000) / 10}%`
                      : '0%'}
                  </span>
                  <span className="ml-4 text-sm font-semibold">
                    {entry.name}: {formatCurrency(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.99 }}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="cyber-card flex h-full w-full flex-col rounded-2xl border border-border bg-card/80 px-6 py-6 shadow-sm backdrop-blur transition-all hover:shadow-md"
        >
          <h4 className="self-start pl-[1rem] text-base font-bold text-foreground">Total Syndicate RTR</h4>
          <div className="w-full pl-[1rem] text-left">
            <p className="text-lg font-semibold text-primary">
              {formatCurrency(totalSyndicateRTR || 0)}
            </p>
          </div>
          <div className="flex flex-col items-center justify-center">
            <PieChart width={300} height={230}>
              <Pie
                data={datapie2}
                cx={150}
                cy={105}
                innerRadius={40}
                outerRadius={80}
                paddingAngle={0}
                dataKey="value"
              >
                {datapie2.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.name === 'Mgmt Fees Up To Date' ? 'var(--destructive)' : COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip content={<PieCustomTooltip />} />
            </PieChart>
            <div className="flex flex-col items-start justify-center">
              {datapie2.map((entry, index) => (
                <div key={entry.name} className="mb-2 flex items-center justify-start">
                  <div
                    className="mr-2 h-3 w-3 rounded"
                    style={{
                      backgroundColor:
                        entry.name === 'Mgmt Fees Up To Date' ? 'var(--destructive)' : COLORS[index % COLORS.length],
                    }}
                  />
                  <span
                    className={`w-[50px] text-right text-sm font-bold ${entry.name === 'Mgmt Fees Up To Date' ? 'text-red-500' : ''}`}
                  >
                    {totalSyndicateRTR
                      ? `${Math.round((entry.value / totalSyndicateRTR) * 1000) / 10}%`
                      : '0%'}
                  </span>
                  <span
                    className="ml-4 text-sm font-semibold"
                    style={{
                      color:
                        entry.name === 'Mgmt Fees Up To Date' ? 'var(--destructive)' : COLORS[index % COLORS.length],
                    }}
                  >
                    {entry.name}: {formatCurrency(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          whileHover={{ y: -4, scale: 1.02 }}
          whileTap={{ scale: 0.99 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="cyber-card flex h-full w-full flex-col rounded-2xl border border-border bg-card/80 px-6 py-6 shadow-sm backdrop-blur transition-all hover:shadow-md"
        >
          <h4 className="mb-6 self-start pl-[1rem] text-base font-bold text-foreground">Status</h4>
          <div className="flex flex-col items-center justify-center">
            <PieChart width={300} height={225}>
              <Pie
                data={datapie3}
                cx={150}
                cy={105}
                innerRadius={40}
                outerRadius={80}
                paddingAngle={0}
                dataKey="value"
              >
                {datapie3.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.name === 'Default' ? 'var(--destructive)' : COLORS[index % COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip content={<PieCustomTooltip />} />
            </PieChart>
            <div className="flex flex-col items-start justify-center">
              {datapie3.map((entry, index) => (
                <div key={entry.name} className="mb-2 flex items-center justify-center">
                  <div
                    className="mr-2 h-3 w-3 rounded"
                    style={{
                      backgroundColor:
                        entry.name === 'Default' ? 'var(--destructive)' : COLORS[index % COLORS.length],
                    }}
                  />
                  <span
                    className="ml-4 text-sm font-bold"
                    style={{
                      color: entry.name === 'Default' ? 'var(--destructive)' : COLORS[index % COLORS.length],
                    }}
                  >
                    {entry.name}: {formatCurrency(entry.value)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
