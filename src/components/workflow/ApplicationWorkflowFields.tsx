import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UsCurrencyInput } from "@/components/ui/us-currency-input";
import { axiosGet } from "@/redux/axios";
import type { ApplicationWorkflowFieldValues } from "@/lib/applicationWorkflowFields";

type IsoOption = { id: string; name: string; email?: string | null; status?: string | null };

async function fetchIsoOptions(): Promise<IsoOption[]> {
  const res = await axiosGet("/iso", { skipCache: true });
  const rows = Array.isArray(res.data?.data) ? res.data.data : [];
  return rows
    .map((r: any) => ({ id: String(r.id ?? r._id ?? ""), name: String(r.name ?? ""), email: r.email, status: r.status }))
    .filter((r: IsoOption) => r.id && r.name && String(r.status ?? "active").toLowerCase() !== "inactive");
}

/**
 * Agent application intake additions: ISO link, notes and extra business / owner details
 * for a new client. Values are sent with the create payload (see CreateApplication).
 */
export default function ApplicationWorkflowFields({
  value,
  onChange,
  showNewClientFields,
  isoRequired,
  labelClass,
  inputClass,
}: {
  value: ApplicationWorkflowFieldValues;
  onChange: (next: ApplicationWorkflowFieldValues) => void;
  showNewClientFields: boolean;
  isoRequired: boolean;
  labelClass: string;
  inputClass: string;
}) {
  const isos = useQuery({ queryKey: ["iso-options"], queryFn: fetchIsoOptions, staleTime: 5 * 60_000 });
  const set = (key: keyof ApplicationWorkflowFieldValues) => (v: string) => onChange({ ...value, [key]: v });
  const selectedIso = isos.data?.find((i) => i.id === value.isoId);

  const text = (key: keyof ApplicationWorkflowFieldValues, label: string, placeholder: string, type = "text") => (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label className={labelClass}>{label}</Label>
      <Input
        type={type}
        value={value[key]}
        placeholder={placeholder}
        className={inputClass}
        onChange={(e) => set(key)(e.target.value)}
      />
    </div>
  );

  return (
    <div className="space-y-4 px-6">
      {showNewClientFields ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {text("newBusinessEmail", "Business Email", "business@example.com", "email")}
          {text("newOwnerEmail", "Owner Email", "owner@example.com", "email")}
          {text("newOwnerPhone", "Owner Mobile", "(XXX) XXX-XXXX")}
          {text("newBusinessAddress1", "Business Address", "Street address")}
          {text("newBusinessCity", "City", "City")}
          <div className="grid grid-cols-2 gap-3">
            {text("newBusinessState", "State", "NY")}
            {text("newBusinessZipCode", "ZIP", "10001")}
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label className={labelClass}>Monthly Revenue</Label>
            <UsCurrencyInput
              value={value.newBusinessMonthlyRevenue}
              onChange={(v: string) => set("newBusinessMonthlyRevenue")(v)}
              className={inputClass}
            />
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label className={labelClass}>
            ISO {isoRequired ? <span className="text-red-500">*</span> : null}
          </Label>
          <Select value={value.isoId || undefined} onValueChange={set("isoId")} disabled={isos.isLoading}>
            <SelectTrigger className={`${inputClass} w-full`}>
              <SelectValue placeholder={isos.isLoading ? "Loading ISOs..." : "Select ISO"} />
            </SelectTrigger>
            <SelectContent>
              {(isos.data ?? []).map((iso) => (
                <SelectItem key={iso.id} value={iso.id}>
                  {iso.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {selectedIso?.email
              ? `Approval requests go to ${selectedIso.email}.`
              : isos.data && isos.data.length === 0
                ? "No ISOs yet — ask a Super Admin to add one."
                : "The ISO receives the approval request after underwriting."}
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label className={labelClass}>Notes for underwriting</Label>
          <Textarea
            rows={3}
            value={value.note}
            maxLength={2000}
            placeholder="Context for the underwriter (use of funds, existing positions, …)"
            onChange={(e) => set("note")(e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}
