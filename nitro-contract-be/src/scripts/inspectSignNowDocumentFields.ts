/**
 * Dump the live field layout of a SignNow document group, exactly as the API
 * returns it, so we can see why a widget is or is not reaching the signer.
 *
 *   npx ts-node src/scripts/inspectSignNowDocumentFields.ts <documentGroupId>
 *
 * Optional: add a filter to narrow to the interesting page/labels, e.g.
 *   npx ts-node src/scripts/inspectSignNowDocumentFields.ts <id> reference
 *
 * For each document it prints the roles SignNow knows about and one row per
 * field: container, name, type, role, role_id, required flag, page, and whether
 * the field currently holds a value. A widget that shows `role=(none)` is one
 * the merchant publish deletes, because a field with no resolvable role is
 * dropped from the PUT that rewrites the document.
 */
import { loadBackendEnv } from '../config/loadEnv';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';

loadBackendEnv();

const CONTAINERS = ['fields', 'fillable_fields', 'texts', 'signatures', 'initials', 'checks'] as const;

function roleNamesById(remote: any): Map<string, string> {
  const byId = new Map<string, string>();
  const buckets = [
    remote?.roles,
    remote?.document_roles,
    remote?.signing_roles,
    remote?.field_invites,
    remote?.routing_details?.roles,
  ];
  for (const rows of buckets) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const name = String(row.name || row.role || row.role_name || row.signer_role || '').trim();
      if (!name) continue;
      for (const key of ['unique_id', 'id', 'role_id', 'signer_role_id']) {
        const id = String((row as any)[key] || '').trim();
        if (id && !byId.has(id)) byId.set(id, name);
      }
    }
  }
  return byId;
}

async function main(): Promise<void> {
  const groupId = String(process.argv[2] || '').trim();
  const filter = String(process.argv[3] || '').trim().toLowerCase();
  if (!groupId) throw new Error('Pass the SignNow document group id (the CRM envelopeId)');

  const client = await createSignNowApiClient();
  const groupRes = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
  if (groupRes.status >= 400) {
    throw new Error(`GET /documentgroup/${groupId} → ${groupRes.status}`);
  }
  const documents = Array.isArray(groupRes.data?.documents) ? groupRes.data.documents : [];
  console.log(`Document group ${groupId}: ${documents.length} document(s)\n`);

  for (const summary of documents) {
    const docId = String(summary?.id || summary?.document_id || '').trim();
    if (!docId) continue;
    const res = await client.get(`/document/${docId}`, { validateStatus: () => true });
    if (res.status >= 400) {
      console.log(`--- ${docId}: GET failed ${res.status}\n`);
      continue;
    }
    const remote = res.data;
    const name = String(remote?.document_name || remote?.name || docId);
    const byId = roleNamesById(remote);
    console.log(`=== ${name}  (${docId})`);
    console.log(`    roles known to SignNow: ${[...new Set(byId.values())].join(', ') || '(none)'}`);

    let shown = 0;
    let noRole = 0;
    for (const container of CONTAINERS) {
      const rows = Array.isArray(remote?.[container]) ? remote[container] : [];
      for (const field of rows) {
        if (!field || typeof field !== 'object') continue;
        const attrs =
          field.json_attributes && typeof field.json_attributes === 'object'
            ? field.json_attributes
            : {};
        const label = String(field.name || field.field_name || attrs.name || '').trim();
        const role = String(field.role || field.signer || attrs.role || '').trim();
        const roleId = String(field.role_id || attrs.role_id || '').trim();
        const resolved = role || (roleId ? byId.get(roleId) || '' : '');
        if (!resolved) noRole += 1;
        if (filter && !label.toLowerCase().includes(filter)) continue;
        const value = String(field.prefilled_text || field.data || attrs.prefilled_text || '').trim();
        console.log(
          [
            `    [${container}]`,
            `name=${label || '(unnamed)'}`,
            `type=${field.type || '(none)'}`,
            `role=${resolved || '(NONE → DELETED)'}`,
            `role_id=${roleId || '-'}`,
            `required=${field.required ?? attrs.required ?? '-'}`,
            `page=${field.page_number ?? attrs.page_number ?? '-'}`,
            `value=${value ? 'yes' : 'EMPTY'}`,
          ].join('  '),
        );
        shown += 1;
      }
    }
    console.log(`    printed ${shown} field(s); ${noRole} field(s) have NO resolvable role\n`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[SignNow] inspect failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
