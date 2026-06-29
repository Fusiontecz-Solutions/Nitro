/** Status label shown in ApplicationSummary — current workflow queue only. */
export function getApplicationSummaryStatusLabel(app: {
  currentQueue?: string | null;
  queue?: string | null;
}): string {
  const q = app.currentQueue ?? app.queue;
  if (q != null && String(q).trim() !== "") {
    return String(q).trim();
  }
  return "-";
}
