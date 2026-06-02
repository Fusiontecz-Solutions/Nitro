"use client";

import { useEffect, useState } from "react";
import { Edit2, Trash2, Eye, EyeOff, Shield } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";

import { createBankDetail, getBankDetails, updateBankDetail, deleteBankDetail } from "@/redux/actions/bankDetailActions";
import { sendBankEditOtp, verifyBankEditOtp } from "@/redux/actions/authActions";
import { toast } from "react-toastify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type ApplicationSheetBankDetailProps = {
  applicationId: string;
};

export default function ApplicationSheetBankDetail({ applicationId }: ApplicationSheetBankDetailProps) {

  const dispatch = useDispatch<AppDispatch>();
  const { data: bankDetails, loading } = useSelector((state: RootState) => state.bankDetails);

  const [form, setForm] = useState({
    bankName: "",
    accountNumber: "",
    routingNumber: "",
  });

  const [showAccount, setShowAccount] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // OTP gate for sensitive "edit bank details" flow
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpSending, setOtpSending] = useState(false);
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);

  const otpGateActive = otpDialogOpen || otpSending || otpVerifying;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  useEffect(() => {
    if (applicationId) {
      dispatch(getBankDetails({ application: applicationId }));
    }
  }, [applicationId, dispatch]);

  const resetForm = () => {
    setForm({
      bankName: "",
      accountNumber: "",
      routingNumber: "",
    });
    setEditingId(null);
  };

  const handleCancel = () => {
    resetForm();
  };

  const handleEditClick = (id: string) => {
    const bank = bankDetails.find((b) => b._id === id);
    if (!bank) return;

    // Gate entry into edit mode behind OTP verification
    setPendingEditId(id);
    setOtpError(null);
    setOtpCode("");
    setOtpDialogOpen(true);
    setOtpSending(true);

    dispatch(sendBankEditOtp())
      .unwrap()
      .then(() => {
        setOtpSending(false);
      })
      .catch((error: any) => {
        setOtpSending(false);
        setOtpDialogOpen(false);
        setPendingEditId(null);
        setOtpCode("");
        setOtpError(null);
        toast.error(typeof error === "string" ? error : error?.message || "Failed to send OTP");
      });
  };

  const handleVerifyOtp = async () => {
    if (!pendingEditId) return;
    if (!otpCode) {
      setOtpError("Please enter the OTP.");
      return;
    }

    setOtpError(null);
    setOtpVerifying(true);

    try {
      await dispatch(verifyBankEditOtp({ otp: otpCode })).unwrap();

      const bank = bankDetails.find((b) => b._id === pendingEditId);
      if (!bank) {
        throw new Error("Bank details not found. Please try again.");
      }

      setForm({
        bankName: bank.bankName || "",
        accountNumber: bank.accountNumber || "",
        routingNumber: bank.routingNumber || "",
      });
      setEditingId(pendingEditId);
      setPendingEditId(null);
      setOtpDialogOpen(false);
      setOtpCode("");
      setShowAccount(false);
      toast.success("OTP verified. You can now update bank details.");
    } catch (error: any) {
      const message = typeof error === "string" ? error : error?.message || "Invalid OTP";
      setOtpError(message);
    } finally {
      setOtpVerifying(false);
    }
  };

  const handleResendOtp = async () => {
    setOtpError(null);
    setOtpCode("");
    setOtpVerifying(false);
    setOtpSending(true);

    try {
      await dispatch(sendBankEditOtp()).unwrap();
      toast.success("OTP resent to your email.");
    } catch (error: any) {
      const message = typeof error === "string" ? error : error?.message || "Failed to resend OTP";
      setOtpError(message);
    } finally {
      setOtpSending(false);
    }
  };

  const handleDeleteClick = async (id: string) => {
    try {
      await dispatch(deleteBankDetail(id)).unwrap();
      toast.success("Bank detail deleted.");
      if (editingId === id) {
        resetForm();
      }
    } catch (error: any) {
      toast.error(
        typeof error === "string" ? error : "Failed to delete bank detail."
      );
    }
  };

  const handleSave = async () => {
    if (!form.accountNumber || !applicationId) {
      toast.error("Please enter an account number.");
      return;
    }

    try {
      setSaving(true);
      if (editingId) {
        await dispatch(
          updateBankDetail({
            id: editingId,
            data: {
              bankName: form.bankName,
              accountNumber: form.accountNumber,
              routingNumber: form.routingNumber,
            },
          })
        ).unwrap();
        toast.success("Bank details updated successfully.");
      } else {
        await dispatch(
          createBankDetail({
            bankName: form.bankName,
            accountNumber: form.accountNumber,
            routingNumber: form.routingNumber,
            application: applicationId,
          })
        ).unwrap();
        toast.success("Bank details saved successfully.");
      }

      resetForm();
    } catch (error: any) {
      toast.error(
        typeof error === "string" ? error : "Failed to save bank details."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="w-full max-w-4xl mx-auto">
      <CardHeader className="pb-0">
        <CardTitle className="text-xl">Add Bank Details</CardTitle>
      </CardHeader>

      <CardContent className="pt-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Bank Name */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Bank Name
          </label>
          <Input
            type="text"
            name="bankName"
            placeholder="e.g. Bank of America"
            value={form.bankName}
            onChange={handleChange}
            className="h-11 px-4 text-sm"
            disabled={otpGateActive}
          />
        </div>

        {/* Account Number with Eye Toggle */}
        <div className="flex flex-col gap-1 relative">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Account Number
          </label>

          <div className="relative">
            <Input
              type={showAccount ? "text" : "password"}
              name="accountNumber"
              placeholder="e.g. 1234567890"
              value={form.accountNumber}
              onChange={handleChange}
              className="h-11 w-full px-4 pr-10 text-sm tracking-widest"
              disabled={otpGateActive}
            />

            {/* Eye Icon */}
            <button
              type="button"
              onClick={() => {
                if (otpGateActive) return;
                setShowAccount(!showAccount);
              }}
              className="absolute cursor-pointer right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              disabled={otpGateActive}
            >
              {showAccount ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {/* Routing Number */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Routing Number
          </label>
          <Input
            type="text"
            name="routingNumber"
            placeholder="e.g. 1234567890"
            value={form.routingNumber}
            onChange={handleChange}
            className="h-11 px-4 text-sm"
            disabled={otpGateActive}
          />
        </div>
      </div>

      {/* <CardDescription className="mt-4 text-xs">
        Funds will typically be disbursed within 24–48 business hours after final approval.
      </CardDescription> */}

      <div className="mt-6">
        <h3 className="text-sm font-semibold text-foreground mb-2">
          Client Bank Info
        </h3>
        {loading ? (
          <p className="text-xs text-muted-foreground">Loading bank details...</p>
        ) : bankDetails && bankDetails.length > 0 ? (
          <div className="overflow-x-auto border border-border rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Bank Name
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Account Number
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Routing Number
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {bankDetails.map((bank) => (
                  <tr key={bank._id} className="border-t border-border">
                    <td className="px-4 py-2 text-foreground">
                      {bank.bankName || "-"}
                    </td>
                    <td className="px-4 py-2 text-foreground">
                      {bank.accountNumber
                        ? "••••••" + bank.accountNumber.slice(-4)
                        : "-"}
                    </td>
                    <td className="px-4 py-2 text-foreground">
                      {bank.routingNumber || "-"}
                    </td>
                    <td className="px-4 py-2 text-left">
                      <div className="inline-flex items-center gap-1">
                      <Button
                        type="button"
                        onClick={() => handleEditClick(bank._id)}
                        variant="ghost"
                        size="icon-sm"
                        className="text-primary cursor-pointer  hover:text-primary"
                        disabled={otpGateActive}
                      >
                        <Edit2 size={18} />
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleDeleteClick(bank._id)}
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive cursor-pointer hover:text-destructive"
                        disabled={otpGateActive}
                      >
                     <Trash2 size={18} />
                      </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No bank details added yet.</p>
        )}
      </div>

      <div className="flex justify-end gap-3 mt-6">
        <Button
          type="button"
          variant="outline"
          className="cursor-pointer"
          onClick={handleCancel}
          disabled={saving || otpGateActive}
        >
          {editingId ? "Cancel Edit" : "Cancel"}
        </Button>
        <Button
          className="cursor-pointer bg-[#3B8BD1] text-white hover:bg-[#337dbb]"
          onClick={handleSave}
          disabled={saving || otpGateActive}
        >
          {saving ? "Saving..." : editingId ? "Update Details" : "Save Details"}
        </Button>
      </div>

      <Dialog
        open={otpDialogOpen}
        onOpenChange={(open: boolean) => {
          // Prevent accidental close while sending/verifying
          if (!open) {
            if (otpSending || otpVerifying) return;
            setOtpDialogOpen(false);
            setPendingEditId(null);
            setOtpCode("");
            setOtpError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none shadow-2xl">
          {/* Subtle decorative top bar */}
          <div className="h-1.5 w-full bg-gradient-to-r from-blue-400 via-blue-600 to-indigo-600" />

          <div className="p-8">
            <DialogHeader className="flex flex-col items-center text-center space-y-4">
              <div className="relative flex items-center justify-center w-16 h-16 bg-blue-50 rounded-full mb-2">
                <Shield className="w-8 h-8 text-blue-600" />
                <div className="absolute inset-0 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
              </div>

              <DialogTitle className="text-xl font-bold text-slate-900">
                Verify OTP
              </DialogTitle>

              <DialogDescription className="text-slate-500 text-balance leading-relaxed">
                {otpSending ? (
                  <>Sending OTP to your email...</>
                ) : (
                  <>OTP has been sent to your email. Please verify to continue edit.</>
                )}
              </DialogDescription>
            </DialogHeader>

            <div className="mt-8 space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Enter OTP
                </label>
                <Input
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  placeholder="e.g. 123456"
                  className="tracking-widest"
                  disabled={otpSending || otpVerifying}
                />
              </div>

              {otpError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-100 px-3 py-2 rounded">
                  {otpError}
                </p>
              )}

              <div className="flex items-center justify-between gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleResendOtp}
                  disabled={otpSending || otpVerifying}
                  className="cursor-pointer"
                >
                  Resend OTP
                </Button>

                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (otpSending || otpVerifying) return;
                      setOtpDialogOpen(false);
                      setPendingEditId(null);
                      setOtpCode("");
                      setOtpError(null);
                    }}
                    disabled={otpSending || otpVerifying}
                    className="cursor-pointer"
                  >
                    Cancel
                  </Button>

                  <Button
                    type="button"
                    className="bg-[#1e60a3] hover:bg-[#184c80] text-white cursor-pointer"
                    onClick={handleVerifyOtp}
                    disabled={otpSending || otpVerifying || !otpCode}
                    
                  >
                    {otpVerifying ? "Verifying..." : "Verify & Continue"}
                  </Button>
                </div>
              </div>

              {otpSending && (
                <p className="text-[11px] text-center text-slate-400 font-medium uppercase tracking-widest">
                  Please wait...
                </p>
              )}

              <p className="text-[11px] text-center text-slate-400 font-medium uppercase tracking-widest">
                Secure OTP Verification
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </CardContent>
    </Card>
  );
}