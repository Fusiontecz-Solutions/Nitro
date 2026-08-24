/**
 * State disclosure field positions for BoldSign.
 * Source of truth is the DocuSign measured config (same PDFs / coordinates).
 */
export {
  STATE_DOCUMENT_CONFIG,
  getStateDocumentConfig,
  resolveStateDocumentConfigKey,
  inferDisclosureDealTypeFromTemplate,
  type StateDocumentFieldConfig as DocumentFieldConfig,
} from '../docusign/state-document-config';
