import React, { useState, useRef, useEffect, useMemo } from 'react';
import MyNotes from '@/components/application/MyNotes';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@/redux/store';
import { createFundingCall, getFundingCalls } from '@/redux/actions/fundingCallActions';
import { resetCreateFundingCall } from '@/redux/slices/fundingCallSlice';
import { notifyOperationsForDisbursement } from '@/redux/actions/notificationActions';
import { resetNotifyOperationsDisbursement } from '@/redux/slices/notificationSlice';
import { toast } from 'react-toastify';
import { cn } from '@/lib/utils';
import { isFundingCallStatusCallDone } from '@/constants/operationsDashboardApplications';

type FundingCallProps = {
  applicationId?: string;
  onSaved?: () => void;
};

interface CallFormState {
  callStatus: string;
  applicationStatus: string;
  remarks: string;
  followUpDate: string;
}


export const FundingCall = ({ applicationId, onSaved }: FundingCallProps) => {
  const dispatch = useDispatch<AppDispatch>();
  const { loading: saving, success, error } = useSelector(
    (state: RootState) => state.createFundingCall,
  );
  const { data: existingCalls, loading: fetchingExistingCalls } = useSelector(
    (state: RootState) => state.fundingCalls,
  );
  const {
    loading: notifyingOps,
    success: notifyOpsSuccess,
    error: notifyOpsError,
    data: notifyOpsData,
  } = useSelector((state: RootState) => state.notifyOperationsDisbursement);
  const loginUser = useSelector((state: RootState) => state.login.data?.user);

  // Super Admin (and Admin as a safety hatch) are allowed to push the
  // "Notify Operations" signal. Mirrors backend role enforcement.
  const isSuperAdmin = useMemo(() => {
    const role = String(loginUser?.role || localStorage.getItem('role') || '')
      .toUpperCase()
      .replace(/[\s_-]+/g, '');
    return role === 'SUPERADMIN' || role === 'ADMIN';
  }, [loginUser?.role]);

  const [form, setForm] = useState<CallFormState>({
    callStatus: '',
    applicationStatus: '',
    remarks: '',
    followUpDate: '',
  });

  // UI States
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [errors, setErrors] = useState({ callStatus: false });
  const [showSuccess, setShowSuccess] = useState(false);
  // `canNotifyOps` is enabled only after a successful save in this session OR
  // when the latest persisted funding call already exists (re-visiting page).
  const [canNotifyOps, setCanNotifyOps] = useState(false);
  const [opsNotified, setOpsNotified] = useState(false);
  const [showNotifyTooltip, setShowNotifyTooltip] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Calendar state
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => new Date());
  const calendarRef = useRef<HTMLDivElement | null>(null);

  const options = ["Call Done", "Not Reachable", "Call Back Later", "Rejected", "Interested"];

  const isBusy = saving || fetchingExistingCalls || notifyingOps;

  useEffect(() => {
    if (isBusy) setShowSuccess(false);
  }, [isBusy]);

  // Close dropdown / calendar when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setIsDropdownOpen(false);
      }
      if (calendarRef.current && !calendarRef.current.contains(target)) {
        setIsCalendarOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Auto-fetch existing funding calls on page load / applicationId change
  useEffect(() => {
    if (applicationId) {
      dispatch(getFundingCalls({ application: applicationId }));
    }
  }, [applicationId, dispatch]);

  // When existing calls load, populate form from latest entry. A persisted
  // funding call also means Super Admin can immediately notify Operations
  // (e.g. when the page is re-opened after an earlier save).
  useEffect(() => {
    if (!existingCalls || existingCalls.length === 0) return;
    const latest = existingCalls[0];
    setForm((prev) => ({
      ...prev,
      callStatus: latest.callStatus || '',
      applicationStatus: latest.applicationStatus || '',
      remarks: latest.remarks || '',
      followUpDate: latest.followUpDate
        ? new Date(latest.followUpDate).toLocaleDateString('en-US')
        : '',
    }));
    setCanNotifyOps(true);
    if (isFundingCallStatusCallDone(latest.callStatus)) {
      setOpsNotified(true);
    }
  }, [existingCalls]);

  const handleSelect = (status: string) => {
    if (isBusy) return;
    setForm((prev) => ({ ...prev, callStatus: status }));
    setErrors({ callStatus: false });
    setIsDropdownOpen(false);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  // React to Redux createFundingCall result
  useEffect(() => {
    if (success) {
      setShowSuccess(true);
      setCanNotifyOps(true);
      const callDone = isFundingCallStatusCallDone(form.callStatus);
      if (callDone) {
        setOpsNotified(true);
        toast.success(
          'Funding call saved. Operations has been notified to proceed with disbursement.',
        );
      } else {
        setOpsNotified(false);
        toast.success('Funding call saved successfully.');
      }
      if (applicationId) {
        dispatch(getFundingCalls({ application: applicationId }));
      }
      onSaved?.();
      dispatch(resetCreateFundingCall());
    }
  }, [success, dispatch, onSaved, form.callStatus, applicationId]);

  useEffect(() => {
    if (error) {
      toast.error(error);
    }
  }, [error]);

  // React to notify-operations result (DB + socket push + email fan-out).
  useEffect(() => {
    if (!notifyOpsSuccess) return;
    setOpsNotified(true);
    const notified = notifyOpsData?.notified ?? 0;
    const emails = notifyOpsData?.emailsSent ?? 0;
    if (notified > 0) {
      toast.success(
        `Operations notified${emails > 0 ? ` (email sent to ${emails})` : ''}. You can now proceed with disbursement.`,
      );
    } else {
      toast.info('No active Operations users available to notify.');
    }
    dispatch(resetNotifyOperationsDisbursement());
  }, [notifyOpsSuccess, notifyOpsData, dispatch]);

  useEffect(() => {
    if (notifyOpsError) {
      toast.error(notifyOpsError);
      dispatch(resetNotifyOperationsDisbursement());
    }
  }, [notifyOpsError, dispatch]);

  const handleNotifyOperations = () => {
    if (!applicationId) {
      toast.error('Application ID is missing — cannot notify Operations.');
      return;
    }
    if (notifyingOps || opsNotified || !canNotifyOps) return;
    dispatch(notifyOperationsForDisbursement({ applicationId }));
  };

  const handleSave = () => {
    if (!form.callStatus) {
      setErrors({ callStatus: true });
      return;
    }

    if (!applicationId) {
      toast.error('Application ID is missing for this funding call.');
      return;
    }

    dispatch(
      createFundingCall({
        application: applicationId,
        callStatus: form.callStatus,
        applicationStatus: form.applicationStatus || null,
        remarks: form.remarks || null,
        followUpDate: form.followUpDate || null,
      }),
    );
  };

  return (
    <div
      className={cn(
        'relative mx-auto rounded-[18px] border border-slate-200/80 bg-gradient-to-br from-white to-[#f4f7fb] p-6 pb-5 font-sans shadow-[0_18px_35px_rgba(15,23,42,0.1),0_2px_6px_rgba(15,23,42,0.06)]',
        'dark:border-slate-700 dark:from-[#1c1d21] dark:to-[#141517] dark:shadow-[0_18px_35px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.25)]',
      )}
    >
      {(fetchingExistingCalls || saving || notifyingOps) && (
        <div
          className={cn(
            'mb-4 flex items-center gap-2.5 rounded-xl border px-3 py-3 text-[13px]',
            fetchingExistingCalls
              ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/45 dark:text-blue-200'
              : notifyingOps
                ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200',
          )}
        >
          <span>⏳</span>
          {fetchingExistingCalls
            ? 'Loading existing call details...'
            : notifyingOps
              ? 'Sending notification to Operations...'
              : 'Saving... please wait'}
        </div>
      )}

      {opsNotified && (
        <div
          className={cn(
            'mb-4 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-[13px] text-emerald-800',
            'dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200',
          )}
        >
          <span aria-hidden="true">✓</span>
          <span>
            Operations team has been notified. They will receive an in-app notification
            {(notifyOpsData?.emailsSent ?? 0) > 0 ? ' and an email' : ''} to proceed with the
            disbursement.
          </span>
        </div>
      )}

      {/* Header Section */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h2 className="m-0 text-[22px] font-bold text-slate-900 dark:text-slate-100">Funding Call</h2>
          <p className="mt-1 text-[13px] text-slate-500 dark:text-slate-400">
            Capture the latest call outcome.
          </p>
        </div>
        {applicationId && (
          <div
            className={cn(
              'rounded-full border border-blue-200/80 bg-blue-500/10 px-2.5 py-1 text-[11px] font-semibold text-blue-700',
              'dark:border-blue-800/60 dark:bg-blue-500/15 dark:text-blue-300',
            )}
          >
            ID: {applicationId}
          </div>
        )}
      </div>

      {showSuccess && (
        <div
          className={cn(
            'mb-4 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3 text-[13px] text-emerald-800',
            'dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200',
          )}
        >
          <span>✓</span> Application status updated successfully.
        </div>
      )}

      <div className="mb-4 grid grid-cols-1 gap-[18px] md:grid-cols-2">
        {/* CUSTOM DROPDOWN */}
        <div className="flex flex-col gap-1.5" ref={dropdownRef}>
          <label className="text-[13px] font-medium text-slate-900 dark:text-slate-100">
            Call Status <span className="text-red-500">*</span>
          </label>

          <div className="relative">
            <button
              type="button"
              onClick={() => {
                if (isBusy) return;
                setIsDropdownOpen(!isDropdownOpen);
              }}
              disabled={isBusy}
              className={cn(
                'flex w-full cursor-pointer items-center justify-between rounded-xl border bg-white px-4 py-2.5 text-left text-sm shadow-sm',
                'dark:bg-slate-900 dark:text-slate-100 dark:shadow-black/20',
                errors.callStatus
                  ? 'border-red-500 dark:border-red-500'
                  : 'border-slate-300 dark:border-slate-600',
                form.callStatus ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500',
                isBusy && 'cursor-not-allowed opacity-60',
              )}
            >
              {form.callStatus || "Select call status"}
              <span
                className="text-[10px] transition-transform duration-200"
                style={{ transform: isDropdownOpen ? 'rotate(180deg)' : 'rotate(0)' }}
              >
                ▼
              </span>
            </button>

            {isDropdownOpen && (
              <div
                className={cn(
                  'absolute left-0 right-0 top-[110%] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-lg',
                  'dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/40',
                )}
              >
                {options.map((opt) => (
                  <div
                    key={opt}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleSelect(opt)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handleSelect(opt);
                      }
                    }}
                    className={cn(
                      'cursor-pointer rounded-lg px-3 py-2.5 text-[13px] transition-colors',
                      form.callStatus === opt
                        ? 'bg-blue-50 font-semibold text-blue-900 dark:bg-blue-950/50 dark:text-blue-200'
                        : 'font-normal text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
                    )}
                  >
                    {opt}
                  </div>
                ))}
              </div>
            )}
          </div>
          {errors.callStatus && (
            <span className="text-xs text-red-700 dark:text-red-400">Call status is required</span>
          )}
        </div>
      </div>

      {/* Follow-up Date */}
      {form.callStatus === 'Call Back Later' && (
        <div className="relative mb-4 max-w-[260px]" ref={calendarRef}>
          <label
            className="mb-1.5 block text-[13px] font-medium text-slate-900 dark:text-slate-100"
          >
            Next Follow-up Date
          </label>
          <div className="relative">
            <input
              type="text"
              name="followUpDate"
              placeholder="MM/DD/YYYY"
              value={form.followUpDate}
              onChange={handleChange}
              onFocus={() => {
                if (isBusy) return;
                setIsCalendarOpen(true);
              }}
              disabled={isBusy}
              className={cn(
                'w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-3 pr-9 text-[13px] text-slate-900 placeholder:text-slate-400',
                'dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500',
                isBusy && 'cursor-not-allowed opacity-60',
              )}
            />
            <button
              type="button"
              onClick={() => {
                if (isBusy) return;
                setIsCalendarOpen((prev) => !prev);
              }}
              disabled={isBusy}
              className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer border-none bg-transparent text-sm text-slate-400 dark:text-slate-500"
            >
              📅
            </button>
          </div>

          {isCalendarOpen && (
            <div
              className={cn(
                'absolute left-0 top-full z-40 mt-1.5 w-[260px] rounded-xl border border-slate-200 bg-white p-2.5 shadow-xl',
                'dark:border-slate-600 dark:bg-slate-900 dark:shadow-black/50',
              )}
            >
              <div className="mb-2 flex items-center justify-between text-[13px] font-semibold text-slate-900 dark:text-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    if (isBusy) return;
                    setCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1),
                    );
                  }}
                  disabled={isBusy}
                  className="cursor-pointer border-none bg-transparent p-1 text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
                >
                  ‹
                </button>
                <span>
                  {calendarMonth.toLocaleDateString('en-US', {
                    month: 'long',
                    year: 'numeric',
                  })}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (isBusy) return;
                    setCalendarMonth(
                      (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1),
                    );
                  }}
                  disabled={isBusy}
                  className="cursor-pointer border-none bg-transparent p-1 text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
                >
                  ›
                </button>
              </div>

              <div className="mb-1 grid grid-cols-7 gap-1 text-[11px] text-slate-400 dark:text-slate-500">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
                  <div key={d} className="text-center">
                    {d}
                  </div>
                ))}
              </div>

              {(() => {
                const start = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
                const end = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0);
                const daysInMonth = end.getDate();
                const startDay = start.getDay();
                const cells: (number | null)[] = [];
                for (let i = 0; i < startDay; i += 1) cells.push(null);
                for (let d = 1; d <= daysInMonth; d += 1) cells.push(d);

                return (
                  <div className="grid grid-cols-7 gap-1 text-xs">
                    {cells.map((day, idx) =>
                      day === null ? (
                        <div key={idx} />
                      ) : (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if (isBusy) return;
                            const month = calendarMonth.getMonth() + 1;
                            const mm = month.toString().padStart(2, '0');
                            const dd = day.toString().padStart(2, '0');
                            const yyyy = calendarMonth.getFullYear();
                            const formatted = `${mm}/${dd}/${yyyy}`;
                            setForm((prev) => ({ ...prev, followUpDate: formatted }));
                            setIsCalendarOpen(false);
                          }}
                          disabled={isBusy}
                          className={cn(
                            'w-full cursor-pointer rounded-full border-none bg-slate-50 py-1.5 text-slate-900',
                            'hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
                            isBusy && 'cursor-not-allowed opacity-60',
                          )}
                        >
                          {day}
                        </button>
                      ),
                    )}
                  </div>
                );
              })()}
            </div>
          )}
        </div>
      )}

      <div
        className={cn(
          'mb-4 mt-1 rounded-[14px] border border-dashed border-slate-300/80 bg-slate-900/[0.02] p-3',
          'dark:border-slate-600 dark:bg-slate-950/40',
        )}
      >
        <MyNotes applicationId={applicationId} />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {isSuperAdmin && (
          <div
            className="relative"
            onMouseEnter={() => setShowNotifyTooltip(true)}
            onMouseLeave={() => setShowNotifyTooltip(false)}
            onFocus={() => setShowNotifyTooltip(true)}
            onBlur={() => setShowNotifyTooltip(false)}
          >
            <button
              type="button"
              onClick={handleNotifyOperations}
              disabled={
                !canNotifyOps ||
                notifyingOps ||
                isBusy ||
                !isFundingCallStatusCallDone(form.callStatus)
              }
              aria-disabled={
                !canNotifyOps ||
                notifyingOps ||
                isBusy ||
                !isFundingCallStatusCallDone(form.callStatus)
              }
              aria-describedby="notify-ops-tooltip"
              className={cn(
                'group inline-flex items-center gap-2 rounded-full px-6 py-3 font-[550] text-sm transition',
                opsNotified
                  ? 'cursor-default border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : canNotifyOps && !isBusy
                    ? 'cursor-pointer border border-amber-300 bg-amber-50 text-amber-800 shadow-[0_8px_18px_rgba(245,158,11,0.25)] hover:bg-amber-100 dark:border-amber-700/60 dark:bg-amber-950/40 dark:text-amber-200 dark:hover:bg-amber-900/40'
                    : 'cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-500',
              )}
            >
              <span aria-hidden="true" className="text-base leading-none">
                {opsNotified ? '✓' : notifyingOps ? '⏳' : '🔔'}
              </span>
              <span>
                {opsNotified
                  ? 'Operations Notified'
                  : notifyingOps
                    ? 'Notifying Operations...'
                    : 'Notify Operations'}
              </span>
            </button>

            {showNotifyTooltip && (
              <div
                id="notify-ops-tooltip"
                role="tooltip"
                className={cn(
                  'pointer-events-none absolute bottom-full right-0 z-50 mb-2 w-[280px] rounded-lg border border-slate-200 bg-slate-900 px-3 py-2 text-[12px] leading-snug text-white shadow-xl',
                  'dark:border-slate-700 dark:bg-slate-800',
                )}
              >
                {!canNotifyOps
                  ? 'Save the funding call first to enable this.'
                  : !isFundingCallStatusCallDone(form.callStatus)
                    ? 'Set call status to "Call Done" and save — Operations are notified automatically. Use this button to send a reminder.'
                    : opsNotified
                      ? 'Operations have been notified. Use this button to send a reminder if needed.'
                      : 'Save with status "Call Done" to notify Operations automatically, or click to notify now.'}
                <span
                  aria-hidden="true"
                  className="absolute right-6 top-full -mt-px h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-slate-900 dark:border-t-slate-800"
                />
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={isBusy}
          className={cn(
            'cursor-pointer rounded-full border-none bg-[#1e60a3] px-8 py-3 font-[550] text-white shadow-[0_10px_20px_rgba(30,96,163,0.3)]',
            'disabled:cursor-not-allowed disabled:opacity-60 dark:shadow-[0_10px_24px_rgba(30,96,163,0.35)]',
          )}
        >
          {saving ? 'Saving...' : 'Update Status'}
        </button>
      </div>

      {isBusy && (
        <div
          aria-hidden="true"
          className="pointer-events-auto absolute inset-0 z-[999] rounded-[18px] bg-transparent"
        />
      )}
    </div>
  );
};
