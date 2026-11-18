import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Confirm a workflow hand-off with an optional (or required) note to the next person. */
export default function WorkflowNoteDialog({
  open,
  onOpenChange,
  title,
  description,
  noteLabel,
  notePlaceholder,
  noteRequired = false,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  noteLabel: string;
  notePlaceholder?: string;
  noteRequired?: boolean;
  confirmLabel: string;
  onConfirm: (note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  const canSubmit = !submitting && (!noteRequired || note.trim().length > 0);

  const handleConfirm = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onConfirm(note.trim());
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next: boolean) => !submitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="workflow-note">
            {noteLabel}
            {noteRequired ? <span className="text-destructive"> *</span> : null}
          </Label>
          <Textarea
            id="workflow-note"
            rows={4}
            value={note}
            maxLength={2000}
            placeholder={notePlaceholder}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={!canSubmit} loading={submitting}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
