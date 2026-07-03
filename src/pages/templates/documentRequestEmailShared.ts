/** Backend replaces this token with the public upload portal URL before SendGrid send. */
export const DOCUMENT_REQUEST_UPLOAD_URL_PLACEHOLDER =
  "__DOCUMENT_REQUEST_UPLOAD_URL__";

export function documentRequestEmailSubject(
  applicationNumber: string | number,
  clientName?: string | null,
  applicationOwnerName?: string | null,
): string {
  const num = String(applicationNumber || "").trim() || "N/A";
  const client = String(clientName || "").trim();
  const owner = String(applicationOwnerName || "").trim();
  const parts = [`Document request — Application #${num}`];
  if (client) parts.push(client);
  if (owner) parts.push(owner);
  return parts.join(" — ");
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type DocumentRequestEmailFields = {
  isoName: string;
  clientName: string;
  applicationOwnerName: string;
  applicationNumber: string;
  requestedDocumentLabels: string[];
  note: string;
  uploadUrl: string;
  teamName: string;
};

export function resolveDocumentRequestEmailFields(
  values: Record<string, string | undefined>,
): DocumentRequestEmailFields {
  const isoName =
    String(values.iso_name || "").trim() || "ISO Partner";
  const clientName = String(values.client_name || "").trim();
  const applicationOwnerName = String(values.application_owner_name || "").trim();
  const applicationNumber =
    String(values.application_number || "").trim() || "N/A";
  const rawDocs = String(values.requested_documents || "").trim();
  const requestedDocumentLabels = rawDocs
    ? rawDocs
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    : [];
  const note = String(values.note || "").trim();
  const uploadUrl =
    String(values.upload_documents_url || "").trim() ||
    DOCUMENT_REQUEST_UPLOAD_URL_PLACEHOLDER;
  const teamName = String(values.team_name || "").trim() || "Katan Capital Team";

  return {
    isoName,
    clientName,
    applicationOwnerName,
    applicationNumber,
    requestedDocumentLabels,
    note,
    uploadUrl,
    teamName,
  };
}
