import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  Search, RefreshCw, Filter, ShieldAlert, Users,
  Activity, Globe, Monitor, Download,
} from 'lucide-react';
import {
  AreaChart, Area, ResponsiveContainer,
} from 'recharts';
import { useTheme } from '@/context/ThemeContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { getActivityLogs, type ActivityLog } from '@/redux/actions/activityLogActions';
import type { ApplicationActivityLog } from '@/redux/actions/applicationActivityLogActions';
import type { AppDispatch, RootState } from '@/redux/store';
import { formatDateTimeUS } from '@/lib/utils';

// ─── Helper functions ───────────────────────────────────────────────

function formatDateTime(dateStr: string | undefined): string {
  if (!dateStr) return '—';
  return formatDateTimeUS(dateStr, '—');
}

function getUserName(user: ActivityLog['user']): string {
  if (!user) return '—';
  if (typeof user === 'string') return user;
  return [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email || '—';
}

function getUserEmail(user: ActivityLog['user']): string {
  if (!user) return '';
  if (typeof user === 'string') return '';
  return user.email || '';
}

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  UPDATE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
  DELETE: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  LOGIN: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
  LOGOUT: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400',
  VIEW: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
};

function getActionColor(action: string): string {
  const key = action?.toUpperCase();
  return ACTION_COLORS[key] ?? 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300';
}

// ─── Mock trend data for the mini chart ─────────────────────────────

const activityTrend = [
  { time: '00:00', events: 12 }, { time: '04:00', events: 5 },
  { time: '08:00', events: 45 }, { time: '12:00', events: 88 },
  { time: '16:00', events: 62 }, { time: '20:00', events: 30 },
];

// Type guard so we only treat system-level logs as ActivityLog
function isSystemActivityLog(
  log: ActivityLog | ApplicationActivityLog,
): log is ActivityLog {
  return '_id' in log;
}

// ─── Main Component ─────────────────────────────────────────────────

export default function ActivityLogs() {
  const dispatch = useDispatch<AppDispatch>();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const { logs, loading, pagination } = useSelector(
    (state: RootState) => state.activityLogs,
  );

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('all');
  const [page, setPage] = useState(1);
  const limit = 20;

  useEffect(() => {
    dispatch(getActivityLogs({ page, limit, action: actionFilter !== 'all' ? actionFilter : undefined, search: search || undefined }));
  }, [page, actionFilter, search]);

  const surfaceBase = isDark ? 'bg-[#1e293b] border-[#334155]' : 'bg-white border-[#e2e8f0]';
  const textMuted = isDark ? 'text-slate-400' : 'text-slate-500';

  return (
    <div className={`min-h-screen p-6 space-y-6 ${isDark ? 'bg-[#0f172a] text-slate-100' : 'bg-[#f8fafc] text-slate-900'}`}>

      {/* 1. Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">System Audit Logs</h1>
          <p className={textMuted}>Immutable record of all administrative and user operations within the CRM.</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" className="gap-2 border-inherit" onClick={() => dispatch(getActivityLogs({ page, limit }))}>
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
          <Button className="bg-[#276D9C] hover:bg-[#1e567d] text-white gap-2 shadow-lg">
            <Download size={16} /> Export Audit Trail
          </Button>
        </div>
      </div>

      {/* 2. Security Analytics Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <AuditStatCard title="Total Events" value={pagination.total || 0} icon={<Activity className="text-blue-500" />} trend="+12%" />
        <AuditStatCard title="Security Alerts" value="2" icon={<ShieldAlert className="text-red-500" />} trend="High" />
        <AuditStatCard title="Active Users" value="24" icon={<Users className="text-green-500" />} trend="Live" />

        {/* Mini Graph for spikes */}
        <div className={`p-4 rounded-xl border shadow-sm flex flex-col justify-between ${surfaceBase}`}>
          <span className="text-[10px] font-bold text-slate-500 uppercase">Traffic Distribution</span>
          <div className="h-10 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={activityTrend}>
                <Area type="monotone" dataKey="events" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 3. Filter Command Bar */}
      <div className={`p-4 rounded-xl border flex flex-wrap items-center gap-4 ${surfaceBase}`}>
        <div className="relative flex-1 min-w-[250px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Filter by user, email, IP or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 bg-transparent border-slate-200 dark:border-slate-700"
          />
        </div>

        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="w-[160px] bg-transparent">
            <Filter size={14} className="mr-2 opacity-50" />
            <SelectValue placeholder="Action Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Operations</SelectItem>
            <SelectItem value="CREATE">Creation</SelectItem>
            <SelectItem value="UPDATE">Modification</SelectItem>
            <SelectItem value="DELETE">Deletion</SelectItem>
            <SelectItem value="LOGIN">Security Access</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 4. The Professional Audit Table */}
      <div className={`rounded-xl border shadow-sm overflow-hidden ${surfaceBase}`}>
        <Table>
          <TableHeader className={isDark ? 'bg-slate-800/50' : 'bg-slate-50'}>
            <TableRow className="border-inherit hover:bg-transparent">
              <TableHead className="text-[11px] font-bold">OPERATOR</TableHead>
              <TableHead className="text-[11px] font-bold">EVENT / ACTION</TableHead>
              <TableHead className="text-[11px] font-bold">RESOURCE</TableHead>
              <TableHead className="text-[11px] font-bold">DESCRIPTION</TableHead>
              <TableHead className="text-[11px] font-bold">IP & ORIGIN</TableHead>
              <TableHead className="text-[11px] font-bold text-left">TIMESTAMP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="h-32 text-left opacity-50">Loading encrypted logs...</TableCell></TableRow>
            ) : logs.filter(isSystemActivityLog).map((log) => (
              <TableRow key={log._id} className="border-inherit">
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-bold text-sm">{getUserName(log.user)}</span>
                    <span className="text-[11px] text-slate-400">{getUserEmail(log.user)}</span>
                  </div>
                </TableCell>
                
                <TableCell>
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter ${getActionColor(log.action)}`}>
                    {log.action}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded">
                    {log.entity || 'System'}
                  </span>
                </TableCell>
                <TableCell className="max-w-[300px]">
                  <p className="text-xs leading-relaxed line-clamp-2 text-slate-600 dark:text-slate-300">
                    {log.description}
                  </p>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-mono flex items-center gap-1.5 opacity-80">
                      <Globe size={10} /> {log.ipAddress || '—'}
                    </span>
                    <span className="text-[10px] flex items-center gap-1.5 opacity-50 uppercase">
                      <Monitor size={10} /> Unknown Client
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-left whitespace-nowrap">
                  <span className="text-xs font-medium">{formatDateTime(log.createdAt)}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="p-4 border-t border-inherit flex items-center justify-between">
          <span className="text-xs text-slate-500">
            Page {page} of {pagination.totalPages}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
            <Button variant="outline" size="sm" disabled={page === pagination.totalPages} onClick={() => setPage(p => p + 1)}>Next</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-component for KPIs ─────────────────────────────────────────

function AuditStatCard({ title, value, icon, trend }: { title: string; value: string | number; icon: React.ReactNode; trend: string }) {
  const isDark = useTheme().resolvedTheme === 'dark';
  return (
    <div className={`p-5 rounded-xl border shadow-sm flex items-center justify-between ${isDark ? 'bg-[#1e293b] border-[#334155]' : 'bg-white border-[#e2e8f0]'}`}>
      <div>
        <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1">{title}</p>
        <div className="flex items-center gap-2">
          <h3 className="text-2xl font-black">{value}</h3>
          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${trend === 'High' ? 'bg-red-500/10 text-red-500' : 'bg-green-500/10 text-green-500'}`}>
            {trend}
          </span>
        </div>
      </div>
      <div className="p-3 bg-slate-100 dark:bg-slate-800 rounded-xl">{icon}</div>
    </div>
  );
}
