import type { google } from '@google-cloud/documentai/build/protos/protos';
import {
  applyDocumentAiSchemaFallbacks,
  mapDocumentAiToExtractResult,
  mapDocumentAiToKycKeyData,
} from './mapDocumentAiToExtractResult';
import { mapKycKeyDataToPrefill } from '../contractKycPrefillMapper';

type Document = google.cloud.documentai.v1.IDocument;

function docFromEntities(entities: Array<{ type: string; mentionText: string }>): Document {
  return {
    text: entities.map((e) => e.mentionText).join('\n'),
    entities: entities.map((e) => ({ type: e.type, mentionText: e.mentionText })),
  };
}

describe('Document AI schema mapping', () => {
  it('keeps application, DL, and void-check schema fields distinct', () => {
    const result = mapDocumentAiToExtractResult(
      docFromEntities([
        { type: 'business_name', mentionText: 'Sparkle Water LLC' },
        { type: 'legal_business_name', mentionText: 'Sparkle Water Limited' },
        { type: 'owner_first_name', mentionText: 'Jane' },
        { type: 'owner_last_name', mentionText: 'Doe' },
        { type: 'first_name', mentionText: 'LONG THANH QUOC' },
        { type: 'last_name', mentionText: 'NGUYEN' },
        { type: 'city', mentionText: 'Houston' },
        { type: 'owner_city', mentionText: 'Austin' },
        { type: 'account_holder_name', mentionText: 'SPARKLE WATER LLC' },
        { type: 'account_holder_address_line1', mentionText: '501 SPARKLING WATER DR' },
      ]),
    );

    expect(result.key_data.business_name).toBe('Sparkle Water LLC');
    expect(result.key_data.legal_business_name).toBe('Sparkle Water Limited');
    expect(result.key_data.owner_first_name).toBe('Jane');
    expect(result.key_data.owner_last_name).toBe('Doe');
    expect(result.key_data.first_name).toBe('LONG THANH QUOC');
    expect(result.key_data.last_name).toBe('NGUYEN');
    expect(result.key_data.city).toBe('Houston');
    expect(result.key_data.owner_city).toBe('Austin');
    expect(result.key_data.account_holder_name).toBe('SPARKLE WATER LLC');
    expect(result.key_data.account_holder_address_line1).toBe('501 SPARKLING WATER DR');
  });

  it('fills owner names from first/last when application owner fields are empty', () => {
    const kd = applyDocumentAiSchemaFallbacks({
      first_name: 'LONG THANH QUOC',
      last_name: 'NGUYEN',
    });
    expect(kd.owner_first_name).toBe('LONG THANH QUOC');
    expect(kd.owner_last_name).toBe('NGUYEN');
  });

  it('maps DL schema fields into KYC owner/guarantor panels', () => {
    const kd = mapDocumentAiToKycKeyData(
      docFromEntities([
        { type: 'first_name', mentionText: 'LONG THANH QUOC' },
        { type: 'last_name', mentionText: 'NGUYEN' },
        { type: 'driver_license_number', mentionText: '36602930' },
        { type: 'address_line1', mentionText: '501 SPARKLING WATER DR' },
        { type: 'address_line2', mentionText: 'APT 4' },
        { type: 'owner_city', mentionText: 'AUSTIN' },
        { type: 'owner_state', mentionText: 'TX' },
        { type: 'owner_zip', mentionText: '78701' },
      ]),
      'driverLicense',
    );
    const mapped = mapKycKeyDataToPrefill('driverLicense', kd);
    expect(mapped.panels.owner?.firstName).toBe('Long Thanh Quoc');
    expect(mapped.panels.owner?.lastName).toBe('Nguyen');
    expect(mapped.panels.owner?.address).toBe('501 SPARKLING WATER DR, APT 4');
    expect(mapped.panels.owner?.city).toBe('AUSTIN');
    expect(mapped.panels.guarantor?.driverLicenseNumber).toBe('36602930');
  });

  it('maps void-check schema fields into ACH panel', () => {
    const kd = mapDocumentAiToKycKeyData(
      docFromEntities([
        { type: 'account_holder_name', mentionText: 'SPARKLE WATER LLC DBA SPARKLE' },
        { type: 'account_holder_address_line1', mentionText: '501 SPARKLING WATER DR' },
        { type: 'bank_name', mentionText: 'Chase' },
        { type: 'routing_number', mentionText: '021000021' },
        { type: 'account_number', mentionText: '123456789' },
        { type: 'account_type', mentionText: 'Checking' },
        { type: 'city', mentionText: 'Austin' },
        { type: 'state', mentionText: 'TX' },
        { type: 'zip', mentionText: '78701' },
      ]),
      'voidedCheck',
    );
    const mapped = mapKycKeyDataToPrefill('voidedCheck', kd);
    expect(mapped.panels.ach?.bankName).toBe('Chase');
    expect(mapped.panels.ach?.accountNumber).toBe('123456789');
    expect(mapped.panels.ach?.routingNumber).toBe('021000021');
    expect(mapped.panels.ach?.address).toBe('501 SPARKLING WATER DR');
    expect(mapped.panels.ach?.dba).toBe('SPARKLE');
  });
});
