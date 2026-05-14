import { useCallback, useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { UserPlus, Trash2, Pencil } from 'lucide-react';
import { axiosDelete, axiosGet, axiosPut } from '@/redux/axios';
import SyndicatorsSectionTabs from '@/components/syndicators/SyndicatorsSectionTabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'react-toastify';
import { formatDate as formatDateUtil } from '@/lib/utils';
import AddUserModal from '@/pages/settings/AddUserModal';
import { fetchUsersByRole } from '@/redux/actions/settingsUserActions';
import { invalidateRoleCache } from '@/redux/slices/settingsUsersSlice';
import type { AppDispatch } from '@/redux/store';
import { formatUSPhoneNumber, handleUSPhoneInputChange } from '@/utils/formatPhoneNumber';

const SETTINGS_SYNDICATORS_TAB_ID = 'SYNDICATORS';

export type SyndicatorRecord = {
  id: number;
  firstName: string;
  lastName?: string | null;
  email: string;
  phone?: string | null;
  companyName?: string | null;
  role?: string | null;
  status?: string | null;
  currentBalance?: unknown;
  createdAt?: string;
};

function formatDate(dateStr: string | undefined): string {
  return formatDateUtil(dateStr ?? '', '—');
}

const toCurrency = (value: unknown) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

export default function SyndicatorsListPage() {
  const dispatch = useDispatch<AppDispatch>();
  const [list, setList] = useState<SyndicatorRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<SyndicatorRecord | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCompany, setEditCompany] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axiosGet('/syndicators');
      const data = res?.data?.data;
      setList(Array.isArray(data) ? data : []);
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Failed to load syndicators';
      toast.error(msg);
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openEdit = (row: SyndicatorRecord) => {
    setEditRow(row);
    setEditFirstName(row.firstName ?? '');
    setEditLastName(row.lastName ?? '');
    setEditEmail(row.email ?? '');
    setEditPhone(row.phone ?? '');
    setEditCompany(row.companyName ?? '');
  };

  const closeEdit = () => {
    setEditRow(null);
    setEditSaving(false);
  };

  const handleSaveEdit = async () => {
    if (!editRow) return;
    const fn = editFirstName.trim();
    const ln = editLastName.trim();
    const em = editEmail.trim().toLowerCase();
    if (!fn || !em) {
      toast.error('First name and email are required');
      return;
    }
    setEditSaving(true);
    try {
      await axiosPut(`/syndicators/${editRow.id}`, {
        firstName: fn,
        lastName: ln || undefined,
        email: em,
        phone: editPhone.trim() || undefined,
        companyName: editCompany.trim() || undefined,
      });
      toast.success('Syndicator updated');
      closeEdit();
      void loadList();
      dispatch(invalidateRoleCache(SETTINGS_SYNDICATORS_TAB_ID));
      void dispatch(fetchUsersByRole(SETTINGS_SYNDICATORS_TAB_ID));
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not update syndicator';
      toast.error(msg);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (row: SyndicatorRecord) => {
    if (
      !window.confirm(
        `Delete syndicator "${[row.firstName, row.lastName].filter(Boolean).join(' ')}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await axiosDelete(`/syndicators/${row.id}`);
      toast.success('Syndicator removed');
      void loadList();
      dispatch(invalidateRoleCache(SETTINGS_SYNDICATORS_TAB_ID));
      void dispatch(fetchUsersByRole(SETTINGS_SYNDICATORS_TAB_ID));
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Could not delete syndicator';
      toast.error(msg);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6 lg:p-8">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <SyndicatorsSectionTabs />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-lg font-semibold text-foreground">Syndicators list</h1>
          <Button className="gap-2 shrink-0" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add syndicator
          </Button>
        </div>

        {loading ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
            Loading syndicators…
          </div>
        ) : !list.length ? (
          <div className="rounded-lg border border-border bg-card p-6 text-center text-muted-foreground">
            No syndicators yet.
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <Table>
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Id</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Representative</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Company</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Email</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Phone</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Role</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Status</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Balance</TableHead>
                  <TableHead className="text-[10px] font-bold text-muted-foreground">Created</TableHead>
                  <TableHead className="text-left text-[10px] font-bold text-muted-foreground">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map((row) => {
                  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || '—';
                  return (
                    <TableRow key={row.id} className="border-b border-border">
                      <TableCell>
                        <Link
                          to={`/syndicators/syndicators-list/${row.id}/syndications`}
                          className="text-primary font-medium hover:underline underline-offset-2"
                        >
                          {row.id}
                        </Link>
                      </TableCell>
                      <TableCell className="font-medium text-foreground">{name}</TableCell>
                      <TableCell className="text-muted-foreground">{row.companyName ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{row.email}</TableCell>
                      <TableCell className="text-muted-foreground">{row.phone ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{row.role ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{row.status ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {toCurrency(row.currentBalance)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(row.createdAt)}
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors"
                            onClick={() => openEdit(row)}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </button>
                          <button
                            type="button"
                            className="inline-flex items-center justify-center rounded-md border border-destructive/40 px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/5 transition-colors"
                            onClick={() => handleDelete(row)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Delete
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <AddUserModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        role={SETTINGS_SYNDICATORS_TAB_ID}
        roleName="Syndicator"
        createSyndicatorProfile
        onSuccess={() => void loadList()}
      />

      <Dialog open={!!editRow} onOpenChange={(open: boolean) => !open && closeEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit syndicator</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="edit-first">First name</Label>
              <Input
                id="edit-first"
                value={editFirstName}
                onChange={(e) => setEditFirstName(e.target.value)}
                disabled={editSaving}
                autoComplete="given-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-last">Last name</Label>
              <Input
                id="edit-last"
                value={editLastName}
                onChange={(e) => setEditLastName(e.target.value)}
                disabled={editSaving}
                autoComplete="family-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                disabled={editSaving}
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                type="tel"
                placeholder="(XXX) XXX-XXXX"
                value={formatUSPhoneNumber(editPhone)}
                onChange={(e) => handleUSPhoneInputChange(e, setEditPhone)}
                disabled={editSaving}
                inputMode="numeric"
                autoComplete="tel"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-company">Company</Label>
              <Input
                id="edit-company"
                value={editCompany}
                onChange={(e) => setEditCompany(e.target.value)}
                disabled={editSaving}
                autoComplete="organization"
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={closeEdit} disabled={editSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSaveEdit()} disabled={editSaving}>
              {editSaving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
