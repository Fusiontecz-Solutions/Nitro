/**
 * Live SignNow package test (creates groups, does not email signers).
 *
 *   npx ts-node --transpile-only src/scripts/testSignNowPackageSends.ts
 *
 * 1) Addendum standalone (ACH Weekly, no PCM_CONTRACT)
 * 2) Contract + disclosure (PCM_CONTRACT + SignNow disclosure)
 */
import '../config/loadEnv';
import prisma from '../config/prismaClient';
import { createSignNowApiClient } from '../services/signnow/utils/signnow-client';
import { signNowService } from '../services/signnow/signnow.service';
import { signNowDocumentOrderRank } from '../services/signnow/utils/signnow-document-order';

const TEST_ROLES = [
  {
    roleName: 'Owner',
    signerName: 'Nitro Advance',
    signerEmail: 'contracts@nitroadvance.com',
    signerOrder: 0,
  },
  {
    roleName: 'Recipient 1',
    signerName: 'Package Send Test',
    signerEmail: 'contracts@nitroadvance.com',
    signerOrder: 1,
  },
];

const TEST_TITLE_PREFIX = 'CRM TEST —';

async function deleteLeftoverTestGroups() {
  const known = [
    'eb7d6bf5f0624fe29ba9b377dd091f7bde61fee0',
    '51578cc152a84876b8ab15659b380f78e3cf1a70',
    '942e9a76281c490ebb3e5814d975d71bcdb86b45',
    'f3a706e6dd6a4660bae15d279f39b6751aee5d6d',
    '7c5f9c96783046729054246a4de8cdbb15b4edf7',
    'c4dbd6d9c431481689b6c302155e802b04a79611',
  ];
  for (const id of known) {
    await deleteGroup(id);
  }
  const client = await createSignNowApiClient();
  const res = await client.get('/user/documentgroups?limit=50', { validateStatus: () => true });
  const groups =
    res.data?.document_groups ||
    res.data?.groups ||
    (Array.isArray(res.data) ? res.data : []);
  for (const row of Array.isArray(groups) ? groups : []) {
    const name = String(row?.group_name || row?.name || '').trim();
    const id = String(row?.id || row?.unique_id || '').trim();
    if (!id || !name.startsWith(TEST_TITLE_PREFIX)) continue;
    const deleted = await deleteGroup(id);
    console.log(
      deleted.ok
        ? `  deleted leftover "${name}" (${id})`
        : `  leftover "${name}" (${id}) HTTP ${deleted.status}`,
    );
  }
}

function docNames(
  docs: Array<{ document_name?: string; name?: string; id?: string }> | undefined,
): string[] {
  return (Array.isArray(docs) ? docs : [])
    .map((d) => String(d.document_name || d.name || d.id || '').trim())
    .filter(Boolean);
}

async function inspectGroup(groupId: string) {
  const client = await createSignNowApiClient();
  const res = await client.get(`/documentgroup/${groupId}`, { validateStatus: () => true });
  const docs = Array.isArray(res.data?.documents) ? res.data.documents : [];
  return {
    status: res.status,
    names: docNames(docs),
    count: docs.length,
    inviteId: res.data?.invite_id || res.data?.document_group_invite_id || null,
  };
}

async function deleteGroup(groupId: string): Promise<{ ok: boolean; status: number; path: string }> {
  const client = await createSignNowApiClient();
  await client.delete(`/v2/document-groups/${groupId}/embedded-invites`, {
    validateStatus: () => true,
  });
  const paths = [`/documentgroup/${groupId}`, `/v2/document-groups/${groupId}`];
  let last = { ok: false, status: 0, path: paths[0] };
  for (const path of paths) {
    const res = await client.delete(path, { validateStatus: () => true });
    last = { ok: res.status < 400, status: res.status, path };
    if (last.ok) return last;
  }
  return last;
}

/** Count live documents whose name matches a token, ignoring the "(2)" suffix. */
function countByToken(names: string[], token: string): number {
  const needle = token.trim().toLowerCase();
  return names.filter((name) => name.trim().toLowerCase().includes(needle)).length;
}

/** Assert the live group reads Disclosure → Contract → Addendums. */
function assertCanonicalOrder(label: string, names: string[]) {
  const ranks = names.map((name) =>
    signNowDocumentOrderRank({ id: name, document_name: name }),
  );
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] < ranks[i - 1]) {
      throw new Error(
        `${label}: documents are out of order (want Disclosure → Contract → Addendums), got: ${names.join(' | ')}`,
      );
    }
  }
  console.log('  order: OK (Disclosure → Contract → Addendums)');
}

async function runCase(
  label: string,
  options: Parameters<typeof signNowService.createContractFromGroupTemplate>[1],
  expect: {
    mustInclude: string[];
    mustExclude: string[];
    /** Exact live-document count per name token, e.g. { 'exhibit c': 1 }. */
    exactCounts?: Record<string, number>;
    /** Verify Disclosure → Contract → Addendums in the live group. */
    canonicalOrder?: boolean;
  },
) {
  console.log(`\n=== ${label} ===`);
  const result = await signNowService.createContractFromGroupTemplate('package-send-test', {
    ...options,
    autoSend: false,
    skipApplicationEnvelopeLink: true,
  });
  const groupId = String(result.envelopeId || result.documentId || '').trim();
  console.log('  groupId:', groupId || '(missing)');
  console.log('  sendUrl:', result.sendUrl ? 'yes' : 'no');
  console.log(
    '  prefill:',
    `applied ${result.data?.prefillTabsApplied ?? '?'} / attempted ${result.data?.prefillTabsAttempted ?? '?'}`,
  );

  if (!groupId) {
    throw new Error(`${label}: no group id returned`);
  }

  const inspected = await inspectGroup(groupId);
  console.log('  documents:', inspected.count, inspected.names.join(' | ') || '(none)');

  const blob = inspected.names.join(' ').toLowerCase();
  const missing = expect.mustInclude.filter((token) => !blob.includes(token.toLowerCase()));
  const unexpected = expect.mustExclude.filter((token) => blob.includes(token.toLowerCase()));
  if (missing.length) {
    throw new Error(`${label}: missing expected document token(s): ${missing.join(', ')}`);
  }
  if (unexpected.length) {
    throw new Error(`${label}: unexpected document token(s): ${unexpected.join(', ')}`);
  }

  for (const [token, want] of Object.entries(expect.exactCounts || {})) {
    const got = countByToken(inspected.names, token);
    if (got !== want) {
      throw new Error(
        `${label}: expected exactly ${want} "${token}" document(s), got ${got}: ${inspected.names.join(' | ')}`,
      );
    }
    console.log(`  count "${token}": ${got} (expected ${want})`);
  }
  if (expect.canonicalOrder) assertCanonicalOrder(label, inspected.names);

  const deleted = await deleteGroup(groupId);
  console.log(
    deleted.ok
      ? `  cleaned up via ${deleted.path} (${deleted.status})`
      : `  cleanup skipped (${deleted.path} HTTP ${deleted.status}) — delete in SignNow if needed`,
  );
  return { groupId, names: inspected.names };
}

async function main() {
  console.log('=== SignNow package send tests (no signer emails) ===');
  console.log('Cleaning leftover CRM TEST groups…');
  await deleteLeftoverTestGroups();

  const addendum = await runCase(
    '1) Addendum standalone (ACH Weekly, no main contract)',
    {
      roles: TEST_ROLES,
      title: 'CRM TEST — ACH Weekly standalone',
      sendPackage: {
        includeMainContract: false,
        includeAddendum: true,
        includeDisclosure: false,
      },
      supplementalDocumentRefs: ['ach_weekly'],
    },
    {
      mustInclude: ['ach'],
      mustExclude: ['pcm', 'disclosure'],
    },
  );

  const contractDisclosure = await runCase(
    '2) Contract + disclosure (PCM_CONTRACT + SignNow disclosure)',
    {
      roles: TEST_ROLES,
      title: 'CRM TEST — PCM_CONTRACT + disclosure',
      sendPackage: {
        includeMainContract: true,
        includeAddendum: false,
        includeDisclosure: true,
      },
      supplementalDocumentRefs: ['signnow_disclosure'],
    },
    {
      mustInclude: [],
      mustExclude: ['ach weekly', 'ach_weekly'],
    },
  );

  if (contractDisclosure.names.length < 2) {
    throw new Error(
      `2) Contract + disclosure: expected PCM_CONTRACT docs plus disclosure, got ${contractDisclosure.names.length}: ${contractDisclosure.names.join(' | ')}`,
    );
  }

  // Issue 1: selecting Exhibit C once must attach exactly one Exhibit C.
  const exhibitCOnce = await runCase(
    '3) Contract + disclosure + Exhibit C selected ONCE',
    {
      roles: TEST_ROLES,
      title: 'CRM TEST — Exhibit C once',
      sendPackage: {
        includeMainContract: true,
        includeAddendum: true,
        includeDisclosure: true,
      },
      supplementalDocumentRefs: ['exhibit_c', 'signnow_disclosure'],
    },
    {
      mustInclude: ['exhibit'],
      // The duplicate this ticket is about.
      mustExclude: ['exhibit c (2)'],
      exactCounts: { 'exhibit c': 1 },
      canonicalOrder: true,
    },
  );

  // Exhibit C x N stays supported when it is genuinely requested twice.
  const exhibitCTwice = await runCase(
    '4) Contract + Exhibit C selected TWICE (multi-instance still works)',
    {
      roles: TEST_ROLES,
      title: 'CRM TEST — Exhibit C x2',
      sendPackage: {
        includeMainContract: true,
        includeAddendum: true,
        includeDisclosure: false,
      },
      supplementalDocumentRefs: ['exhibit_c', 'exhibit_c'],
    },
    {
      mustInclude: ['exhibit c', 'exhibit c (2)'],
      mustExclude: ['exhibit c (3)'],
      exactCounts: { 'exhibit c': 2 },
      canonicalOrder: true,
    },
  );

  // Issue 3: disclosure first, contract second, addendums after, every time.
  const multiAddendum = await runCase(
    '5) Contract + disclosure + multiple addendums (order is deterministic)',
    {
      roles: TEST_ROLES,
      title: 'CRM TEST — multi addendum order',
      sendPackage: {
        includeMainContract: true,
        includeAddendum: true,
        includeDisclosure: true,
      },
      // Disclosure deliberately last in the refs: order must not follow selection order.
      supplementalDocumentRefs: ['ach_daily', 'exhibit_c', 'monthly_fee', 'signnow_disclosure'],
    },
    {
      mustInclude: ['disclosure', 'exhibit', 'ach'],
      mustExclude: ['exhibit c (2)'],
      exactCounts: { 'exhibit c': 1, 'ach daily': 1 },
      canonicalOrder: true,
    },
  );

  console.log('\nRESULT: all package paths created SignNow groups successfully.');
  console.log('  addendum-only docs:', addendum.names.join(' | '));
  console.log('  contract+disclosure docs:', contractDisclosure.names.join(' | '));
  console.log('  exhibit C once docs:', exhibitCOnce.names.join(' | '));
  console.log('  exhibit C twice docs:', exhibitCTwice.names.join(' | '));
  console.log('  multi-addendum docs:', multiAddendum.names.join(' | '));
}

main()
  .catch((err) => {
    console.error('\nFAIL:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await deleteLeftoverTestGroups();
    } catch {
      /* ignore */
    }
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
  });
