"use client";

import { useEffect, useState } from "react";
import { Edit2, Trash2, Eye, EyeOff } from "lucide-react";
import { useDispatch, useSelector } from "react-redux";
import type { AppDispatch, RootState } from "@/redux/store";

import { createBankDetail, getBankDetails, updateBankDetail, deleteBankDetail } from "@/redux/actions/bankDetailActions";
import { toast } from "react-toastify";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ApplicationSheetBankDetailProps = {
  applicationId: string;
  onClose?: () => void;
};

export default function ApplicationSheetBankDetail({
  applicationId,
  onClose,
}: ApplicationSheetBankDetailProps) {

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
    onClose?.();
  };

  const handleEditClick = (id: string) => {
    const bank = bankDetails.find((b) => b._id === id);
    if (!bank) return;

    setForm({
      bankName: bank.bankName || "",
      accountNumber: bank.accountNumber || "",
      routingNumber: bank.routingNumber || "",
    });
    setEditingId(id);
    setShowAccount(false);
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
      onClose?.();
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
            />

            {/* Eye Icon */}
            <button
              type="button"
              onClick={() => setShowAccount(!showAccount)}
              className="absolute cursor-pointer right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
          />
        </div>
      </div>

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
                      >
                        <Edit2 size={18} />
                      </Button>
                      <Button
                        type="button"
                        onClick={() => handleDeleteClick(bank._id)}
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive cursor-pointer hover:text-destructive"
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
          disabled={saving}
        >
          {editingId ? "Cancel Edit" : "Cancel"}
        </Button>
        <Button
          className="cursor-pointer bg-[#3B8BD1] text-white hover:bg-[#337dbb]"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : editingId ? "Update Details" : "Save Details"}
        </Button>
      </div>
      </CardContent>
    </Card>
  );
}
