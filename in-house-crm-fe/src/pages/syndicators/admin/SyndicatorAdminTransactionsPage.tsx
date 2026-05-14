import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOutletContext, useParams } from 'react-router';
import type { SyndicatorAdminOutletContext } from './syndicatorAdminOutletContext';
import { axiosGet } from '@/redux/axios';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { toast } from 'react-toastify';
import { formatDate as formatDateUtil } from '@/lib/utils';
import { syndicatorWalletPaymentTypeDisplay } from '@/lib/syndicatorWalletPaymentTypeDisplay';
import { CircleDollarSign } from 'lucide-react';
import SyndicatorAdminStatCard from './SyndicatorAdminStatCard';

type WalletRow = {
  id?: number;
  date: string;
  amount: unknown;
  paymentType?: string | null;
  description?: string | null;
  merchantName?: string | null;
  prevBalance?: unknown;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const money = (v: unknown) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num(v));

/** Start of calendar week bracket used for summary tiles (prior Friday → current period end). */
function getWeekWindow(): { start: Date; end: Date } {
  const today = new Date();
  const day = today.getDay();
  const lastFriday = new Date(today);
  const daysToSubtract = (day + 2) % 7;
  lastFriday.setDate(today.getDate() - daysToSubtract);
  lastFriday.setHours(0, 0, 0, 0);

  let endDate = new Date(today);
  if (day > 5) {
    endDate.setDate(today.getDate() + (6 - day));
    endDate.setHours(23, 59, 59, 999);
  } else {
    endDate.setHours(23, 59, 59, 999);
  }
  return { start: lastFriday, end: endDate };
}

function isCredit(pt: string): boolean {
  const u = pt.toUpperCase();
  return u === 'CREDIT' || u === 'WALLET_CREDIT';
}

function isDebit(pt: string): boolean {
  const u = pt.toUpperCase();
  return (
    u === 'DEBIT' ||
    u === 'WITHDRAW' ||
    u === 'SYNDICATION_COMMISSION' ||
    u === 'SYNDICATION_MANAGEMENT_FEE'
  );
}

export default function SyndicatorAdminTransactionsPage() {
  const { syndicatorId } = useParams<{ syndicatorId: string }>();
  const { walletRefreshToken = 0 } = useOutletContext<SyndicatorAdminOutletContext | null>() ?? {
    walletRefreshToken: 0,
    bumpWalletRefresh: () => {},
  };
  const [rows, setRows] = useState<WalletRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!syndicatorId) return;
    setLoading(true);
    try {
      const res = await axiosGet(`/syndicators/${syndicatorId}/wallet-transactions`);
      const data = res?.data?.data;
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not load transactions';
      toast.error(msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [syndicatorId]);

  useEffect(() => {
    void load();
  }, [load, walletRefreshToken]);

  const { start: wStart, end: wEnd } = useMemo(() => getWeekWindow(), []);

  const windowTotals = useMemo(() => {
    let collected = 0;
    let paid = 0;
    for (const r of rows) {
      const d = new Date(r.date);
      if (Number.isNaN(d.getTime()) || d < wStart || d > wEnd) continue;
      const pt = String(r.paymentType ?? '');
      const amt = num(r.amount);
      if (isCredit(pt)) collected += amt;
      if (isDebit(pt)) paid += amt;
    }
    return { collected, paid };
  }, [rows, wStart, wEnd]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return [...rows].sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }
    return rows
      .filter((item) => {
        const amt = num(item.amount);
        return (
          String(amt).includes(q) ||
          String(item.paymentType ?? '').toLowerCase().includes(q) ||
          String(item.description ?? '').toLowerCase().includes(q) ||
          String(item.merchantName ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [rows, search]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
        Loading wallet transactions…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-6 md:px-6 shadow-sm grid gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-2 flex-1 max-w-2xl">
          <SyndicatorAdminStatCard
            label="This period collected"
            value={money(windowTotals.collected)}
            icon={CircleDollarSign}
          />
          <SyndicatorAdminStatCard label="This period paid out" value={money(windowTotals.paid)} icon={CircleDollarSign} />
        </div>
        <Input
          type="search"
          placeholder="Search transactions"
          className="w-full xl:w-[240px] shrink-0"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search transactions"
        />
      </div>

      <div className="rounded-md border border-border bg-background overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60 border-b">
              <TableHead className="font-medium text-foreground">Date</TableHead>
              <TableHead className="font-medium text-foreground">Type</TableHead>
              <TableHead className="font-medium text-foreground">Amount</TableHead>
              <TableHead className="font-medium text-foreground">Prev balance</TableHead>
              <TableHead className="font-medium text-foreground">Merchant</TableHead>
              <TableHead className="font-medium text-foreground">Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? (
              filtered.map((r, i) => (
                <TableRow key={r.id ?? i} className="border-b border-border hover:bg-muted/40">
                  <TableCell>{formatDateUtil(typeof r.date === 'string' ? r.date : String(r.date), '—')}</TableCell>
                  <TableCell className="uppercase text-xs">
                    {syndicatorWalletPaymentTypeDisplay(r.paymentType)}
                  </TableCell>
                  <TableCell className="tabular-nums">{money(r.amount)}</TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">{money(r.prevBalance)}</TableCell>
                  <TableCell className="text-muted-foreground">{r.merchantName ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground max-w-[280px] truncate" title={r.description ?? ''}>
                    {r.description ?? '—'}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-left text-muted-foreground">
                  {rows.length ? 'No results match your search.' : 'No wallet transactions recorded.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
