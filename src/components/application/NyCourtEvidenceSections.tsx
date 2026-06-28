import { useId, useState } from "react";
import { ExternalLink, Link2, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "react-toastify";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { BackgroundCheckEvidenceItem } from "./backgroundCheckTypes";
import {
  deleteBackgroundCheckAttachment,
  uploadBackgroundCheckAttachment,
} from "./backgroundCheckAttachment";

type EvidenceSectionProps = {
  title: string;
  items: BackgroundCheckEvidenceItem[];
  onChange: (items: BackgroundCheckEvidenceItem[]) => void;
};

function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function newItemId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function BackgroundCheckEvidenceSection({
  title,
  items,
  onChange,
}: EvidenceSectionProps) {
  const fileInputId = useId();
  const pasteZoneId = useId();
  const [linkDraft, setLinkDraft] = useState("");
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const focusPasteZone = () => {
    document.getElementById(pasteZoneId)?.focus();
  };

  const clearPasteZone = () => {
    const el = document.getElementById(pasteZoneId) as HTMLTextAreaElement | null;
    if (el) el.value = "";
  };

  const addLink = () => {
    const url = linkDraft.trim();
    if (!url) {
      toast.info("Paste a link first.");
      return;
    }
    if (!isValidHttpUrl(url)) {
      toast.error("Enter a valid http:// or https:// link.");
      return;
    }
    onChange([
      ...items,
      {
        id: newItemId("link"),
        kind: "link",
        url,
        name: url,
      },
    ]);
    setLinkDraft("");
    toast.success("Link added.");
  };

  const uploadImage = async (file: File) => {
    setUploading(true);
    try {
      const uploaded = await uploadBackgroundCheckAttachment(file);
      onChange([
        ...items,
        {
          id: newItemId("img"),
          kind: "image",
          url: uploaded.url,
          name: uploaded.name,
          publicId: uploaded.publicId,
        },
      ]);
      toast.success("Screenshot added.");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not upload screenshot.";
      toast.error(message);
    } finally {
      setUploading(false);
    }
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const clipboardItems = Array.from(event.clipboardData?.items ?? []);
    const imageItem = clipboardItems.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    event.preventDefault();
    const ext = file.type.split("/")[1]?.replace("jpeg", "jpg") || "png";
    const namedFile = new File([file], `screenshot-${Date.now()}.${ext}`, {
      type: file.type,
    });
    await uploadImage(namedFile);
    clearPasteZone();
  };

  const removeItem = async (item: BackgroundCheckEvidenceItem) => {
    setRemovingId(item.id);
    try {
      if (item.kind === "image" && item.publicId) {
        await deleteBackgroundCheckAttachment(item.publicId);
      }
      onChange(items.filter((entry) => entry.id !== item.id));
    } catch {
      toast.error("Could not remove item.");
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="rounded-md border border-[#E5E7EB] bg-[#FAFBFC] px-3 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#374151]">
        {title}
      </p>
      <p className="mt-0.5 text-[11px] text-[#6B7280]">
        Add links or screenshots (multiple allowed).
      </p>

      {items.length > 0 ? (
        <ul className="mt-2 space-y-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded border border-[#E2E8F0] bg-white px-2 py-1.5"
            >
              {item.kind === "image" ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 overflow-hidden rounded border border-[#E2E8F0]"
                  title={item.name}
                >
                  <img
                    src={item.url}
                    alt={item.name}
                    className="h-10 w-10 object-cover object-top"
                  />
                </a>
              ) : (
                <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded border border-[#E2E8F0] bg-[#F8FAFC] text-[#64748B]">
                  <Link2 className="h-4 w-4" aria-hidden />
                </span>
              )}
              <div className="min-w-0 flex-1">
                {item.kind === "link" ? (
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-xs text-[var(--brand)] hover:underline"
                  >
                    {item.url}
                  </a>
                ) : (
                  <p className="truncate text-xs text-[#334155]">{item.name}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void removeItem(item)}
                disabled={removingId === item.id}
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#64748B] hover:bg-[#FEF2F2] hover:text-red-600",
                  removingId === item.id && "cursor-not-allowed opacity-60",
                )}
                title="Remove"
                aria-label="Remove"
              >
                {removingId === item.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] italic text-[#9CA3AF]">None added yet.</p>
      )}

      <div className="mt-2 space-y-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <Input
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLink();
              }
            }}
            placeholder="Paste link (https://…)"
            className="h-8 flex-1 text-xs"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 px-2.5 text-xs"
            onClick={addLink}
          >
            <ExternalLink className="mr-1 h-3 w-3" aria-hidden />
            Add link
          </Button>
        </div>

        <div>
          <p className="mb-1 text-[11px] font-medium text-[#374151]">Screenshots</p>
          <div className="flex flex-wrap items-start gap-2">
            <Textarea
              id={pasteZoneId}
              rows={2}
              readOnly={uploading}
              onPaste={(e) => void handlePaste(e)}
              onClick={focusPasteZone}
              placeholder="Click here and paste screenshot (Ctrl+V)…"
              className="min-h-[52px] flex-1 resize-none border-[#E5E7EB] bg-white text-xs placeholder:text-[#9CA3AF]"
            />
            <input
              id={fileInputId}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 px-2.5 text-xs"
              disabled={uploading}
              onClick={() => document.getElementById(fileInputId)?.click()}
            >
              {uploading ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <Upload className="mr-1 h-3 w-3" aria-hidden />
              )}
              Upload
            </Button>
          </div>
          {uploading ? (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#64748B]">
              <Loader2 className="h-3 w-3 animate-spin text-[var(--brand)]" aria-hidden />
              Uploading screenshot…
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

type NyCourtEvidenceSectionsProps = {
  judgements: BackgroundCheckEvidenceItem[];
  liens: BackgroundCheckEvidenceItem[];
  onJudgementsChange: (items: BackgroundCheckEvidenceItem[]) => void;
  onLiensChange: (items: BackgroundCheckEvidenceItem[]) => void;
};

export default function NyCourtEvidenceSections({
  judgements,
  liens,
  onJudgementsChange,
  onLiensChange,
}: NyCourtEvidenceSectionsProps) {
  return (
    <div className="mt-3 space-y-2">
      <BackgroundCheckEvidenceSection
        title="Judgements"
        items={judgements}
        onChange={onJudgementsChange}
      />
      <BackgroundCheckEvidenceSection
        title="Liens"
        items={liens}
        onChange={onLiensChange}
      />
    </div>
  );
}
