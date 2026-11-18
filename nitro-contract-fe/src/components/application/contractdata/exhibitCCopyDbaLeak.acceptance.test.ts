/**
 * An Exhibit C (2) entity's DBA must never reach the agreement's D/B/A line.
 *
 * Tiberian's ACH Daily and Exhibit C are sent as bare SignNow hex ids, which
 * `resolveAddendumKind` cannot classify from the ref alone. The supplemental
 * fallback therefore never saw the ACH Daily (so its "skip Exhibit C" guard was
 * off) and merged the saved tab of EVERY Exhibit C mapping matching the ref —
 * copy (2) included — into the flat payload, where `doing_business_as` fills
 * the agreement. Contract 228: the CRM DBA was blank, entity 2 was FUSIONTECZ,
 * and the Tiberian agreement printed "D/B/A: FUSIONTECZ".
 *
 * Run: npx --yes tsx src/components/application/contractdata/exhibitCCopyDbaLeak.acceptance.test.ts
 */
import assert from "node:assert/strict";
import {
    getDocumentTemplatePrefillFieldRowsForEditor,
    mergeSignNowSupplementalPrefillFallback,
    resolveSharedDbaValue,
    savedOverridesForSupplementalRef,
    withoutExhibitCCopyDbas,
} from "./documentTemplateMappingPrefill";
import { mergeExhibitCEntitiesForSignNowSend } from "./exhibitCEntityPrefill";

const TIBERIAN_EXHIBIT_C = "52b24e67aa00000000000000000000000000c0c0";
const TIBERIAN_ACH_DAILY = "4e472889a5d54b5992c050feedd896eced1ed193";

const mappingRows = [
    {
        id: "ach-daily",
        order: 1,
        template: { templateId: TIBERIAN_ACH_DAILY, name: "ACH DAILY TIBERIAN FUNDING" },
    },
    // Listed copy-first on purpose: send order, not array order, picks copy #1.
    {
        id: "exhibit-c-2",
        order: 3,
        template: { templateId: TIBERIAN_EXHIBIT_C, name: "EXHIBIT C TIBERIAN FUNDING" },
    },
    {
        id: "exhibit-c-1",
        order: 2,
        template: { templateId: TIBERIAN_EXHIBIT_C, name: "EXHIBIT C TIBERIAN FUNDING" },
    },
];

const blob = {
    "exhibit-c-1": {
        client_legal_name: "RE-NEW-IT RENOVATIONS, LLC",
        doing_business_as: "",
        ach_account_holder_dba_p1: "",
    },
    "exhibit-c-2": {
        client_legal_name: "FUSIONTECZ",
        doing_business_as: "FUSIONTECZ",
        ach_account_holder_dba_p1: "FUSIONTECZ",
        ach_authorization_account_holder_dba: "FUSIONTECZ",
    },
};

function testSavedOverridesReadOnlyCopyOne() {
    const saved = savedOverridesForSupplementalRef({
        ref: TIBERIAN_EXHIBIT_C,
        blob,
        mappingRows,
    });
    assert.equal(saved.client_legal_name, "RE-NEW-IT RENOVATIONS, LLC");
    assert.equal(saved.doing_business_as, undefined);
    assert.equal(saved.ach_account_holder_dba_p1, undefined);
    assert.equal(saved.ach_authorization_account_holder_dba, undefined);
}

function testFlatPayloadKeepsBlankDba() {
    const payload = mergeSignNowSupplementalPrefillFallback({
        payload: [
            { id: "client_legal_name", label: "Legal name", value: "RE-NEW-IT RENOVATIONS, LLC" },
            { id: "doing_business_as", label: "DBA", value: "" },
        ],
        supplementalRefs: [TIBERIAN_ACH_DAILY, TIBERIAN_EXHIBIT_C],
        contract: { legalName: "RE-NEW-IT RENOVATIONS, LLC" },
        contractPrefillOverridesRaw: { documentTemplatePrefillByMappingId: blob },
        templateMappingRows: mappingRows,
    });
    const leaked = payload.filter((f) => /FUSIONTECZ/i.test(String(f.value ?? "")));
    assert.deepEqual(
        leaked.map((f) => f.id),
        [],
        "no Exhibit C (2) value may enter the flat payload",
    );
}

/**
 * Nitro contract 183: copy #1's DBA is blank, copy (2)'s is FUSIONTECZ, and an
 * earlier save (copy #1 picked by list position) stored FUSIONTECZ as the
 * deal's own DBA. Neither the shared-DBA sync nor the form may keep it.
 */
const NITRO_ENTITIES = JSON.stringify([
    { id: "a", accountHolderName: "RE-NEW-IT RENOVATIONS, LLC", accountHolderDba: "" },
    { id: "b", accountHolderName: "FUSIONTECZ", accountHolderDba: "FUSIONTECZ" },
]);

function testSharedDbaIgnoresCopyDba() {
    const contract = {
        legalName: "Re-New-It Renovations, LLC",
        doingBusinessAs: "FUSIONTECZ",
        contractPrefillOverrides: {
            doingBusinessAs: "FUSIONTECZ",
            achAuthorizationAccountHolderDba: "FUSIONTECZ",
            exhibitCEntities: NITRO_ENTITIES,
        },
    };
    const dba = resolveSharedDbaValue({
        mainPrefill: { doingBusinessAs: "FUSIONTECZ" },
        contract,
        // Copy (2)'s tab, which a list-order slip leaves in.
        mappingBlobs: { "exhibit-c-2": { doing_business_as: "FUSIONTECZ" } },
    });
    assert.equal(dba, "", "a copy's DBA is never the deal's shared DBA");

    const real = resolveSharedDbaValue({
        mainPrefill: { doingBusinessAs: "RENEW HOMES" },
        contract,
    });
    assert.equal(real, "RENEW HOMES", "a real deal DBA still syncs");
}

function testFormDropsCopyDba() {
    const entities = JSON.parse(NITRO_ENTITIES);
    const cleaned = withoutExhibitCCopyDbas(
        {
            legalName: "Re-New-It Renovations, LLC",
            doingBusinessAs: "FUSIONTECZ",
            achAuthorizationAccountHolderDba: "FUSIONTECZ",
            securityDoingBusinessAs: "FUSIONTECZ",
            clientName: "FUSIONTECZ",
        },
        entities,
    );
    assert.equal(cleaned.doingBusinessAs, "");
    assert.equal(cleaned.achAuthorizationAccountHolderDba, "");
    assert.equal(cleaned.securityDoingBusinessAs, "");
    assert.equal(cleaned.clientName, "FUSIONTECZ", "only DBA keys are touched");

    const shared = withoutExhibitCCopyDbas(
        { doingBusinessAs: "FUSIONTECZ" },
        [{ accountHolderDba: "FUSIONTECZ" }, entities[1]],
    );
    assert.equal(shared.doingBusinessAs, "FUSIONTECZ", "copy #1 holding the same DBA keeps it");
}

/**
 * The agreement's own Exhibit C page (`ach_bank_name_p20`, `ach_account_holder_name_p19`, …)
 * resolves through the flat payload's `ach_*` keys, so it must print the ACH /
 * funding bank. With no ACH Daily/Weekly in the package, the selected Exhibit C's
 * saved tab used to overwrite those keys and the agreement printed its entity.
 */
function testAgreementExhibitCKeepsFundingBank() {
    const funding = {
        ach_bank_name: "JP SIB",
        ach_bank_account: "675478988",
        ach_bank_routing: "101001306",
        ach_account_holder_name: "RE-NEW-IT RENOVATIONS, LLC",
    };
    const payload = mergeSignNowSupplementalPrefillFallback({
        payload: Object.entries(funding).map(([id, value]) => ({ id, label: id, value })),
        supplementalRefs: ["exhibit_c"],
        contract: { legalName: "RE-NEW-IT RENOVATIONS, LLC" },
        contractPrefillOverridesRaw: {
            documentTemplatePrefillByMappingId: {
                "exhibit-c-1": {
                    ach_account_holder_name: "FUSIONTECZ",
                    ach_account_holder_dba: "FUSIONTECZ",
                    ach_bank_name: "FUSIONTECZ",
                    ach_bank_account: "123456789",
                    ach_bank_routing: "123456789",
                },
            },
        },
        templateMappingRows: [
            { id: "exhibit-c-1", order: 1, template: { layoutKey: "exhibit_c", name: "Exhibit C" } },
        ],
    });
    const byId = Object.fromEntries(payload.map((f) => [f.id, String(f.value ?? "")]));
    for (const [id, value] of Object.entries(funding)) {
        assert.equal(byId[id], value.toUpperCase(), `${id} keeps the funding bank`);
    }
    assert.equal(byId.ach_account_holder_dba ?? "", "", "the Exhibit C DBA never reaches the agreement");
}

/**
 * An older build saved the deal's legal name onto Exhibit C's entity and tab.
 * Every Exhibit C starts blank, so the editor must not show that echo — only
 * the agreement date is auto-filled.
 */
function testEditorDropsDealLegalNameEcho() {
    const echo = "Re-New-It Renovations, LLC";
    for (const exhibitCEntityIndex of [0, 1]) {
        const rows = getDocumentTemplatePrefillFieldRowsForEditor({
            templateId: null,
            templateName: "Exhibit C",
            templateLayoutKey: "exhibit_c",
            documentType: "addendum",
            contract: {
                legalName: echo,
                contractPrefillOverrides: {
                    exhibitCEntities: JSON.stringify([
                        { clientLegalName: echo, bankAccount: "123456789" },
                    ]),
                },
            },
            application: null,
            savedOverridesForMapping: { client_legal_name_p1: echo, legal_name: echo },
            exhibitCEntityIndex,
        });
        const byId = Object.fromEntries(rows.map((r) => [r.id, String(r.value ?? "")]));
        assert.equal(byId.client_legal_name_p1, "", `Exhibit C #${exhibitCEntityIndex + 1} legal name starts blank`);
        assert.ok(byId.agreement_date_p1, "agreement date stays auto-filled");
    }
}

/**
 * Obsidian: saving another addendum pushed the deal's DBA into the Exhibit C
 * tab. The copy's own record has a blank DBA, so neither the send payload nor
 * the editor may bring the tab's value back.
 */
function testSavedCopyIgnoresPushedTabValues() {
    const overrides = {
        exhibitCEntities: JSON.stringify([
            { id: "a", clientLegalName: "FUSIONTECZ", accountHolderName: "RE-NEW-IT RENOVATIONS, LLC", bankName: "FUSIONTECZ" },
        ]),
        documentTemplatePrefillByMappingId: {
            "exhibit-c-1": {
                doing_business_as: "RE-NEW-IT RENOVATIONS, LLC",
                ach_account_holder_dba_p1: "RE-NEW-IT RENOVATIONS, LLC",
                ach_bank_portal_p1: "chase.com",
            },
        },
    };
    const [entity] = mergeExhibitCEntitiesForSignNowSend({
        rawOverrides: overrides,
        mappingRows: [{ id: "exhibit-c-1", template: { layoutKey: "exhibit_c", name: "Exhibit C" } }],
    });
    assert.equal(entity.accountHolderDba, "", "the copy keeps its blank DBA");
    assert.equal(entity.bankPortal, "", "no other tab value fills a saved copy");
    assert.equal(entity.accountHolderName, "RE-NEW-IT RENOVATIONS, LLC");

    const rows = getDocumentTemplatePrefillFieldRowsForEditor({
        templateId: null,
        templateName: "Exhibit C",
        templateLayoutKey: "exhibit_c",
        documentType: "addendum",
        contract: { legalName: "FUSIONTECZ", contractPrefillOverrides: overrides },
        application: null,
        savedOverridesForMapping: overrides.documentTemplatePrefillByMappingId["exhibit-c-1"],
        exhibitCEntityIndex: 0,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, String(r.value ?? "")]));
    assert.equal(byId.ach_account_holder_dba_p1 ?? "", "", "the editor shows what SignNow receives");
}

testSavedOverridesReadOnlyCopyOne();
testSavedCopyIgnoresPushedTabValues();
testFlatPayloadKeepsBlankDba();
testEditorDropsDealLegalNameEcho();
testAgreementExhibitCKeepsFundingBank();
testSharedDbaIgnoresCopyDba();
testFormDropsCopyDba();
console.log("exhibitCCopyDbaLeak: all assertions passed");
