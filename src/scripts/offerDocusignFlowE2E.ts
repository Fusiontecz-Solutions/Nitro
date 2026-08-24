/**
 * E2E Offer → Prefill → DocuSign signer-view sync check (demo account).
 *
 * Run from harbor_in_house_be:
 *   npx --yes tsx src/scripts/offerDocusignFlowE2E.ts
 *
 * Creates a draft envelope (autoSend=false), compares key tabs to OfferDecision,
 * then requests a recipient (signer) view URL. Voids the draft when done.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import axios from 'axios';
import prisma from '../config/prismaClient';
import { getDocusignJwtSession, isDocusignJwtConfigured } from '../services/docusign/utils/docusign-jwt';
import { DocusignService } from '../services/docusign/docusign.service';
import { syncTermsOfferFromOfferDecision } from '../services/syncTermsOfferFromOfferDecision';
import { buildPrefillValueMap } from '../services/docusign/utils/docusign-prefill';
import { normalizeDocusignRestBaseUri } from '../services/docusign/utils/docusign-client';

function money(n: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.trunc(n * 100) / 100);
}

function parseMoney(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function near(a: number | null, b: number | null, eps = 0.02): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) <= eps;
}

async function main() {
  console.log('=== Offer → DocuSign Signer View E2E ===\n');

  if (!isDocusignJwtConfigured()) {
    throw new Error('DocuSign JWT is not configured in .env');
  }

  console.log('1) DocuSign JWT session…');
  const session = await getDocusignJwtSession();
  console.log(`   accountId=${session.accountId} baseUri=${session.baseUri}`);
  const restBase = normalizeDocusignRestBaseUri(session.baseUri);
  const client = axios.create({
    baseURL: restBase,
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  const accountId = session.accountId;

  console.log('2) Load application with approved OfferDecision…');
  const app = await prisma.application.findFirst({
    where: {
      OfferDecision: {
        is: {
          decision: { equals: 'approved', mode: 'insensitive' },
          offer: { not: null },
        },
      },
      client: {
        is: {
          OR: [
            { ownerEmail: { contains: '@' } },
            { businessEmail: { contains: '@' } },
          ],
        },
      },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      applicationId: true,
      dealId: true,
      dealDisplayName: true,
      OfferDecision: true,
      client: {
        select: {
          businessName: true,
          ownerFirstName: true,
          ownerLastName: true,
          ownerEmail: true,
          businessEmail: true,
          businessEinNumber: true,
        },
      },
      contract: {
        select: { id: true, approvedAmount: true, totalAmount: true, offerId: true, status: true },
      },
      termsOffers: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true, approvedAmount: true, paybackAmount: true, factorRate: true },
      },
    },
  });

  if (!app?.OfferDecision) {
    throw new Error('No application with an approved OfferDecision found');
  }

  const od = app.OfferDecision;
  const offerAmt = Number(od.offer);
  const paybackAmt =
    od.totalRemit != null && Number(od.totalRemit) > 0
      ? Number(od.totalRemit)
      : offerAmt * Number(od.rate ?? 1);
  const signerEmail = String(
    app.client?.ownerEmail || app.client?.businessEmail || '',
  )
    .trim()
    .toLowerCase();
  const signerName =
    `${app.client?.ownerFirstName ?? ''} ${app.client?.ownerLastName ?? ''}`.trim() ||
    String(app.client?.businessName || 'Test Signer').trim();
  const businessName = String(app.client?.businessName || app.dealDisplayName || 'Test Biz').trim();

  console.log(
    `   app=${app.applicationId ?? app.dealId ?? app.id} offer=${offerAmt} payback=${paybackAmt}`,
  );
  console.log(`   signer=${signerName} <${signerEmail}> business=${businessName}`);

  console.log('3) Sync TermsOffer from OfferDecision…');
  await syncTermsOfferFromOfferDecision(app.id, null);
  const termsAfter = await prisma.termsOffer.findFirst({
    where: { applicationId: app.id },
    orderBy: { createdAt: 'desc' },
  });
  assert.ok(termsAfter, 'TermsOffer missing after sync');
  assert.ok(
    near(Number(termsAfter.approvedAmount), offerAmt),
    `TermsOffer.approvedAmount=${termsAfter.approvedAmount} != OfferDecision.offer=${offerAmt}`,
  );
  console.log(`   TermsOffer.approvedAmount=${termsAfter.approvedAmount} ✓`);

  if (app.contract?.status === 'DRAFT') {
    await prisma.contract.update({
      where: { id: app.contract.id },
      data: {
        approvedAmount: offerAmt,
        totalAmount: paybackAmt,
        purchaseAmount: String(offerAmt),
        purchasePrice: String(paybackAmt),
        offerId: od.id,
      },
    });
    console.log('   Draft Contract amounts refreshed from OfferDecision ✓');
  }

  const offerFmt = money(offerAmt);
  const paybackFmt = money(paybackAmt);
  const prefillFields = [
    { id: 'client_legal_name', value: businessName },
    { id: 'client_name', value: signerName },
    { id: 'purchase_amount', value: offerFmt },
    { id: 'purchase_price', value: paybackFmt },
    { id: 'frequency', value: String(od.frequency || 'Daily') },
    {
      id: 'remittance',
      value: od.repayPerPeriod != null ? money(Number(od.repayPerPeriod)) : '',
    },
    {
      id: 'refinance_amount',
      value: od.refinanceAmount != null ? money(Number(od.refinanceAmount)) : '0.00',
    },
    { id: 'federal_tax_id_EIN', value: String(app.client?.businessEinNumber || '') },
  ].filter((f) => f.value);

  console.log('4) Prefill map (OfferDecision → DocuSign field ids)…');
  const valueMap = buildPrefillValueMap(prefillFields);
  assert.equal(valueMap.get('purchase_amount') || valueMap.get('purchaseamount'), offerFmt);
  assert.equal(valueMap.get('purchase_price') || valueMap.get('purchaseprice'), paybackFmt);
  console.log(`   purchase_amount=${offerFmt} purchase_price=${paybackFmt} ✓`);

  const actor =
    (await prisma.user.findFirst({
      where: { role: { in: ['SUPER_ADMIN', 'ADMIN', 'OPERATIONS'] as any } },
      select: { id: true, email: true },
      orderBy: { createdAt: 'asc' },
    })) ??
    (await prisma.user.findFirst({ select: { id: true, email: true } }));
  if (!actor?.id) throw new Error('No CRM user found to act as DocuSign sender');

  const docusignService = new DocusignService();
  console.log(`5) merge-and-send draft envelope as ${actor.email ?? actor.id}…`);
  const sendResult = await docusignService.mergeAndSendTemplates(actor.id, {
    applicationId: app.id,
    contractId: app.contract?.id,
    includeMainContract: true,
    autoSend: false,
    skipApplicationEnvelopeLink: true,
    title: `E2E Sync Test: ${businessName} $${offerAmt}`,
    message: 'Automated offer/prefill/DocuSign sync verification (draft).',
    redirectUrl: process.env.DOCUSIGN_SENDER_RETURN_URL || 'https://www.docusign.com',
    roles: [
      {
        signerName,
        signerEmail,
        signerRole: process.env.DOCUSIGN_DEFAULT_ROLE_NAME || 'Signer',
      },
    ],
    prefillFields,
    funderName: 'Nitro Advance',
    contractState: 'NY',
  });

  const envelopeId = String(
    (sendResult as any)?.envelopeId ||
      (sendResult as any)?.documentId ||
      (sendResult as any)?.id ||
      '',
  ).trim();
  if (!envelopeId) {
    console.error('Send result:', JSON.stringify(sendResult, null, 2));
    throw new Error('No envelopeId returned from mergeAndSendTemplates');
  }
  console.log(`   envelopeId=${envelopeId}`);
  if ((sendResult as any)?.sendUrl) {
    console.log(`   senderView from create: ${String((sendResult as any).sendUrl).slice(0, 100)}…`);
  }

  console.log('6) Read envelope tabs and compare to OfferDecision…');
  const docsRes = await client.get(
    `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents`,
  );
  const docs = (docsRes.data?.envelopeDocuments || []) as Array<{ documentId?: string }>;
  const tabValues: Record<string, string> = {};
  for (const doc of docs) {
    const docId = String(doc.documentId || '').trim();
    if (!docId || docId === 'certificate') continue;
    try {
      const tabsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/${docId}/tabs`,
      );
      const textTabs = (tabsRes.data?.textTabs || []) as Array<{
        tabLabel?: string;
        name?: string;
        value?: string;
      }>;
      for (const tab of textTabs) {
        const label = String(tab.tabLabel || tab.name || '')
          .trim()
          .toLowerCase()
          .replace(/__p\d+_[a-z0-9]+$/i, '');
        if (!label) continue;
        if (tab.value != null && String(tab.value).trim() !== '') {
          tabValues[label] = String(tab.value).trim();
        }
      }
    } catch {
      /* some docs may have no tabs */
    }
  }

  const purchaseAmountTab =
    tabValues['purchase_amount'] || tabValues['purchaseamount'];
  const purchasePriceTab =
    tabValues['purchase_price'] || tabValues['purchaseprice'];
  const legalNameTab =
    tabValues['client_legal_name'] ||
    tabValues['clientlegalname'] ||
    tabValues['legal_name'];

  console.log('   Sample tabs:', {
    purchase_amount: purchaseAmountTab,
    purchase_price: purchasePriceTab,
    client_legal_name: legalNameTab,
    tabCount: Object.keys(tabValues).length,
  });

  const mismatches: string[] = [];
  if (purchaseAmountTab) {
    if (!near(parseMoney(purchaseAmountTab), offerAmt)) {
      mismatches.push(
        `purchase_amount tab=${purchaseAmountTab} vs offer=${offerAmt}`,
      );
    }
  } else {
    console.warn('   WARN: purchase_amount tab not found on envelope (layout may use coords only)');
  }
  if (purchasePriceTab) {
    if (!near(parseMoney(purchasePriceTab), paybackAmt)) {
      mismatches.push(
        `purchase_price tab=${purchasePriceTab} vs payback=${paybackAmt}`,
      );
    }
  }
  if (mismatches.length) {
    throw new Error(`Tab mismatches:\n- ${mismatches.join('\n- ')}`);
  }
  console.log('   Money tabs match OfferDecision ✓');

  console.log('7) Send envelope, then open DocuSign Signer View…');
  await client.put(`/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
    status: 'sent',
  });
  console.log('   Envelope status → sent ✓');

  const embeddedClientUserId = `e2e-${Date.now()}`;
  const recipientsRes = await client.get(
    `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`,
  );
  const firstSigner = (recipientsRes.data?.signers || [])[0] as
    | { recipientId?: string; email?: string; name?: string; status?: string }
    | undefined;
  assert.ok(firstSigner?.recipientId, 'Envelope has no signer recipient');
  assert.equal(
    String(firstSigner.email || '').toLowerCase(),
    signerEmail.toLowerCase(),
    `Signer email mismatch: ${firstSigner.email} vs ${signerEmail}`,
  );
  console.log(
    `   Recipient OK: ${firstSigner.name} <${firstSigner.email}> status=${firstSigner.status}`,
  );

  await client.put(`/v2.1/accounts/${accountId}/envelopes/${envelopeId}/recipients`, {
    signers: [
      {
        recipientId: firstSigner.recipientId,
        email: firstSigner.email || signerEmail,
        name: firstSigner.name || signerName,
        clientUserId: embeddedClientUserId,
      },
    ],
  });

  const recipientView = await client.post(
    `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/views/recipient`,
    {
      returnUrl: process.env.DOCUSIGN_SENDER_RETURN_URL || 'https://www.docusign.com',
      authenticationMethod: 'none',
      email: firstSigner.email || signerEmail,
      userName: firstSigner.name || signerName,
      clientUserId: embeddedClientUserId,
    },
  );
  const signerViewUrl = String(recipientView.data?.url || '').trim();
  assert.ok(signerViewUrl.startsWith('http'), 'Expected signer view URL');
  console.log(`   DocuSign Signer View URL obtained ✓`);
  console.log(`   ${signerViewUrl.slice(0, 140)}…`);

  // Re-check tabs after send (signer sees these values)
  const tabsAfterSend: Record<string, string> = {};
  for (const doc of docs) {
    const docId = String(doc.documentId || '').trim();
    if (!docId || docId === 'certificate') continue;
    try {
      const tabsRes = await client.get(
        `/v2.1/accounts/${accountId}/envelopes/${envelopeId}/documents/${docId}/tabs`,
      );
      for (const tab of (tabsRes.data?.textTabs || []) as Array<{
        tabLabel?: string;
        value?: string;
      }>) {
        const label = String(tab.tabLabel || '')
          .trim()
          .toLowerCase()
          .replace(/__p\d+_[a-z0-9]+$/i, '');
        if (label && tab.value) tabsAfterSend[label] = String(tab.value).trim();
      }
    } catch {
      /* ignore */
    }
  }
  const sentPurchase = tabsAfterSend['purchase_amount'] || tabsAfterSend['purchaseamount'];
  const sentPayback = tabsAfterSend['purchase_price'] || tabsAfterSend['purchaseprice'];
  assert.ok(near(parseMoney(sentPurchase), offerAmt), `Signer purchase_amount=${sentPurchase}`);
  assert.ok(near(parseMoney(sentPayback), paybackAmt), `Signer purchase_price=${sentPayback}`);
  console.log('   Signer-visible money tabs still match OfferDecision ✓');

  console.log('8) Void envelope (cleanup)…');
  try {
    await client.put(`/v2.1/accounts/${accountId}/envelopes/${envelopeId}`, {
      status: 'voided',
      voidedReason: 'E2E offer/prefill/DocuSign sync test cleanup',
    });
    console.log('   Voided ✓');
  } catch (voidErr: any) {
    console.warn('   Void skipped:', voidErr?.response?.data || voidErr?.message || voidErr);
  }

  console.log('\n=== E2E PASSED: Offer Create sync → Prefill → DocuSign → Signer View ===');
}

main()
  .catch((err) => {
    console.error('\n=== E2E FAILED ===');
    console.error(err?.response?.data || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await prisma.$disconnect();
    } catch {
      /* ignore */
    }
  });
