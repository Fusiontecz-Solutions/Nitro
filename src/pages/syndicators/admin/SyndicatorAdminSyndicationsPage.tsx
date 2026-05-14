import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
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
import { CircleDollarSign } from 'lucide-react';
import SyndicatorAdminStatCard from './SyndicatorAdminStatCard';
import { syndicatorDealIdDisplay } from '@/lib/syndicatorDealDisplay';

type DetailRow = {
  id: number;
  applicationId: string;
  merchantName?: string | null;
  fundedAmount?: unknown;
  amountSyndicated: unknown;
  paybackAmountSyndicated?: unknown;
  collectedAmount?: unknown;
  remainingAmount?: unknown;
  commissionAmount?: unknown;
  managementFeeToDate?: unknown;
  percentageSyndicated?: unknown;
  status?: string | null;
  application?: {
    dealId: string | null;
    dealDisplayName: string | null;
    applicationId: number | null;
    businessName: string | null;
  } | null;
};

const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const money = (v: unknown) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(num(v));

export default function SyndicatorAdminSyndicationsPage() {
  const { syndicatorId } = useParams<{ syndicatorId: string }>();
  const [rows, setRows] = useState<DetailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    if (!syndicatorId) return;
    setLoading(true);
    try {
      const res = await axiosGet(`/application-syndicators/by-syndicator/${syndicatorId}`);
      const data = res?.data?.data;
      setRows(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not load syndications';
      toast.error(msg);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [syndicatorId]);

  useEffect(() => {
    void load();
  }, [load]);

  const totals = useMemo(() => {
    return {
      amountSyndicated: rows.reduce((a, r) => a + num(r.amountSyndicated), 0),
      payback: rows.reduce((a, r) => a + num(r.paybackAmountSyndicated), 0),
      remaining: rows.reduce((a, r) => a + num(r.remainingAmount), 0),
      collected: rows.reduce((a, r) => a + num(r.collectedAmount), 0),
      commission: rows.reduce((a, r) => a + num(r.commissionAmount), 0),
      managementFee: rows.reduce((a, r) => a + num(r.managementFeeToDate), 0),
    };
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const idLabel = syndicatorDealIdDisplay(r.application?.dealId, r.application?.applicationId ?? null);
      const deal =
        r.application?.dealDisplayName ||
        r.application?.businessName ||
        (idLabel !== '—' ? idLabel : '') ||
        r.applicationId;
      const blob = [
        deal,
        r.merchantName,
        String(num(r.amountSyndicated)),
        String(num(r.paybackAmountSyndicated)),
        String(num(r.collectedAmount)),
        String(num(r.remainingAmount)),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return blob.includes(q);
    });
  }, [rows, search]);

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
        Loading syndications…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card px-4 py-6 md:px-6 shadow-sm grid gap-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <SyndicatorAdminStatCard label="Amount syndicated" value={money(totals.amountSyndicated)} icon={CircleDollarSign} />
        <SyndicatorAdminStatCard label="Payback amount" value={money(totals.payback)} icon={CircleDollarSign} />
        <SyndicatorAdminStatCard label="Remaining" value={money(totals.remaining)} icon={CircleDollarSign} />
        <SyndicatorAdminStatCard label="Collected" value={money(totals.collected)} icon={CircleDollarSign} />
        <SyndicatorAdminStatCard label="Commission" value={money(totals.commission)} icon={CircleDollarSign} />
        <SyndicatorAdminStatCard label="Management fee" value={money(totals.managementFee)} icon={CircleDollarSign} />
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
        <Input
          type="search"
          placeholder="Search syndications"
          className="w-full sm:max-w-[240px]"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search syndications"
        />
      </div>

      <div className="rounded-md border border-border bg-background overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/60 hover:bg-muted/60 border-b">
              <TableHead className="font-medium text-foreground">Application</TableHead>
              <TableHead className="font-medium text-foreground">Merchant</TableHead>
              <TableHead className="font-medium text-foreground">Funded</TableHead>
              <TableHead className="font-medium text-foreground">% Syndicated</TableHead>
              <TableHead className="font-medium text-foreground">Payback</TableHead>
              <TableHead className="font-medium text-foreground">Collected</TableHead>
              <TableHead className="font-medium text-foreground">Remaining</TableHead>
              <TableHead className="font-medium text-foreground">Commission</TableHead>
              <TableHead className="font-medium text-foreground">Mgmt fee</TableHead>
              <TableHead className="font-medium text-foreground">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length ? (
              filtered.map((r) => {
                const idLabel = syndicatorDealIdDisplay(r.application?.dealId, r.application?.applicationId ?? null);
                const deal =
                  r.application?.dealDisplayName ||
                  r.application?.businessName ||
                  (idLabel !== '—' ? idLabel : null) ||
                  'Application';
                const appUuid = r.applicationId;
                return (
                  <TableRow key={r.id} className="border-b border-border hover:bg-muted/40">
                    <TableCell className="font-medium">
                      <Link
                        to={`/application-details/${appUuid}`}
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {String(deal)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.merchantName ?? '—'}</TableCell>
                    <TableCell className="tabular-nums">{money(r.fundedAmount ?? r.amountSyndicated)}</TableCell>
                    <TableCell className="tabular-nums">
                      {r.percentageSyndicated != null
                        ? `${Number(r.percentageSyndicated).toFixed(2)}%`
                        : '—'}
                    </TableCell>
                    <TableCell className="tabular-nums">{money(r.paybackAmountSyndicated)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.collectedAmount)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.remainingAmount)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.commissionAmount)}</TableCell>
                    <TableCell className="tabular-nums">{money(r.managementFeeToDate)}</TableCell>
                    <TableCell className="text-muted-foreground">{r.status ?? '—'}</TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell colSpan={10} className="h-24 text-left text-muted-foreground">
                  {rows.length ? 'No results match your search.' : 'No syndicated applications for this partner.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
