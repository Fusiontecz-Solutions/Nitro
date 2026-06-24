import { useEffect, useRef, useState, type ReactNode } from "react";

import { FileText, Upload } from "lucide-react";

import {

  Dialog,

  DialogContent,

  DialogFooter,

  DialogHeader,

  DialogTitle,

} from "@/components/ui/dialog";

import { Button } from "@/components/ui/button";

import { Input } from "@/components/ui/input";

import { Label } from "@/components/ui/label";

import {

  Select,

  SelectContent,

  SelectItem,

  SelectTrigger,

  SelectValue,

} from "@/components/ui/select";

import { DEFAULT_CONTRACT_FILENAME } from "@/redux/actions/integrationSettingsActions";

import type { FunderProfile, FunderProfileInput } from "@/types/integrationSettingsTypes";



type Props = {

  open: boolean;

  saving?: boolean;

  initial?: FunderProfile | null;

  docusignOptions: Array<{ id: string; name: string }>;

  onClose: () => void;

  onSave: (payload: FunderProfileInput, contractFile?: File | null) => Promise<void>;

};



const emptyForm: FunderProfileInput = {

  name: "",

  isActive: true,

  allowedStates: [],

};



function SectionTitle({ children }: { children: ReactNode }) {

  return (

    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">

      {children}

    </p>

  );

}



function Field({ children, className }: { children: ReactNode; className?: string }) {

  return <div className={className ? `grid gap-2 ${className}` : "grid gap-2"}>{children}</div>;

}



export default function FunderProfileModal({

  open,

  saving,

  initial,

  docusignOptions,

  onClose,

  onSave,

}: Props) {

  const [form, setForm] = useState<FunderProfileInput>(emptyForm);

  const [statesText, setStatesText] = useState("");

  const [contractFile, setContractFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);



  useEffect(() => {

    if (!open) return;

    setContractFile(null);

    if (initial) {

      setForm({

        name: initial.name,

        dealIdPrefix: initial.dealIdPrefix ?? "",

        docusignAccountProfileId: initial.docusignAccountProfileId ?? null,

        isActive: initial.isActive,

      });

      setStatesText((initial.allowedStates ?? []).join(", "));

    } else {

      setForm(emptyForm);

      setStatesText("");

    }

  }, [open, initial]);



  const set = (key: keyof FunderProfileInput, value: string | number | boolean | null) => {

    setForm((prev) => ({ ...prev, [key]: value }));

  };



  const currentContractLabel =

    contractFile?.name ||

    initial?.contractPdfFileName ||

    DEFAULT_CONTRACT_FILENAME;



  const handleSubmit = async () => {

    if (!form.name.trim()) return;

    const allowedStates = statesText

      .split(/[,;\n]+/)

      .map((s) => s.trim())

      .filter(Boolean);



    const payload: FunderProfileInput = {

      name: form.name.trim(),

      dealIdPrefix: form.dealIdPrefix?.trim() || undefined,

      allowedStates,

      docusignAccountProfileId: form.docusignAccountProfileId || null,

      isActive: form.isActive,

    };



    if (initial) {

      payload.mainContractLayoutKey = initial.mainContractLayoutKey;

      payload.assignsDealId = initial.assignsDealId;

      payload.sortOrder = initial.sortOrder;

    }



    await onSave(payload, contractFile);

  };



  return (

    <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>

      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">

        <DialogHeader>

          <DialogTitle>{initial ? "Edit funder" : "Add funder"}</DialogTitle>

        </DialogHeader>



        <div className="grid gap-6 py-2">

          <div>

            <SectionTitle>Funder</SectionTitle>

            <div className="grid gap-4 sm:grid-cols-2">

              <Field className="sm:col-span-2">

                <Label htmlFor="f-name">Funder name</Label>

                <Input

                  id="f-name"

                  value={form.name}

                  onChange={(e) => set("name", e.target.value)}

                  placeholder="e.g. Katan II"

                />

              </Field>

              <Field className="sm:col-span-2">

                <Label>DocuSign account</Label>

                <Select

                  value={form.docusignAccountProfileId || "__none__"}

                  onValueChange={(v: string) =>

                    set("docusignAccountProfileId", v === "__none__" ? null : v)

                  }

                >

                  <SelectTrigger>

                    <SelectValue placeholder="Select DocuSign account" />

                  </SelectTrigger>

                  <SelectContent>

                    <SelectItem value="__none__">Not linked</SelectItem>

                    {docusignOptions.map((opt) => (

                      <SelectItem key={opt.id} value={opt.id}>

                        {opt.name}

                      </SelectItem>

                    ))}

                  </SelectContent>

                </Select>

              </Field>

            </div>

          </div>



          <div>

            <SectionTitle>Contract</SectionTitle>

            <div className="grid gap-4 sm:grid-cols-2">

              <Field className="sm:col-span-2">

                <Label>Contract PDF</Label>

                <input

                  ref={fileInputRef}

                  type="file"

                  accept="application/pdf"

                  className="hidden"

                  onChange={(e) => {

                    const file = e.target.files?.[0] ?? null;

                    setContractFile(file);

                  }}

                />

                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">

                  <Button

                    type="button"

                    variant="outline"

                    className="gap-2 shrink-0"

                    onClick={() => fileInputRef.current?.click()}

                  >

                    <Upload className="h-4 w-4" />

                    {contractFile ? "Change PDF" : "Upload contract PDF"}

                  </Button>

                  <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">

                    <FileText className="h-4 w-4 shrink-0" />

                    <span className="truncate">{currentContractLabel}</span>

                  </div>

                </div>

                <p className="text-xs text-muted-foreground">

                  {initial

                    ? "Upload a new PDF to replace the current contract. Leave empty to keep the existing file."

                    : `If no PDF is uploaded, the default contract (${DEFAULT_CONTRACT_FILENAME}) is used.`}

                </p>

              </Field>

              <Field>

                <Label htmlFor="f-prefix">Deal ID prefix</Label>

                <Input

                  id="f-prefix"

                  value={form.dealIdPrefix ?? ""}

                  onChange={(e) => set("dealIdPrefix", e.target.value)}

                  placeholder="KK, KC"

                />

              </Field>

              <Field className="sm:col-span-2">

                <Label htmlFor="f-states">

                  Allowed states (comma-separated; empty = all states)

                </Label>

                <Input

                  id="f-states"

                  value={statesText}

                  onChange={(e) => setStatesText(e.target.value)}

                  placeholder="TX, Texas"

                />

              </Field>

            </div>

          </div>



          <label className="flex items-center gap-2 text-sm">

            <input

              type="checkbox"

              checked={form.isActive !== false}

              onChange={(e) => set("isActive", e.target.checked)}

            />

            Active

          </label>

        </div>



        <DialogFooter>

          <Button variant="outline" onClick={onClose} disabled={saving}>

            Cancel

          </Button>

          <Button

            className="bg-[var(--brand)] hover:bg-[var(--brand)]/90"

            disabled={saving}

            onClick={() => void handleSubmit()}

          >

            {saving ? "Saving…" : initial ? "Save changes" : "Add funder"}

          </Button>

        </DialogFooter>

      </DialogContent>

    </Dialog>

  );

}

