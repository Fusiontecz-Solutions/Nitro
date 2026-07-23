import {
    buildBusinessSearchXml,
    buildPersonSearchXml,
} from './clearS2sClient';

describe('buildPersonSearchXml', () => {
    const config = {
        permissiblePurpose: { glb: 'Q', dppa: '0', voter: '7' },
    };

    it('builds Person Search with first, last, and SSN only', () => {
        const xml = buildPersonSearchXml(
            {
                firstName: 'Jane & John',
                middleName: 'Quinn',
                lastName: 'Sample',
                dateOfBirth: new Date('1980-02-03T00:00:00.000Z'),
                ssn: '123456789',
                emailAddress: 'jane@example.com',
                address: {
                    street: '1 Main <Street>',
                    city: 'Albany',
                    state: 'ny',
                    zipCode: '12207',
                    country: 'USA',
                },
            },
            config,
            'Ocean application-1',
        );

        expect(xml).toContain('<ps:PersonSearchRequestV3');
        expect(xml).toContain('<GLB>Q</GLB>');
        expect(xml).toContain('<FirstName>Jane &amp; John</FirstName>');
        expect(xml).toContain('<LastName>Sample</LastName>');
        expect(xml).toContain('<SSN>123-45-6789</SSN>');
        expect(xml).toContain('<WorldCheckRiskIntelligence>false</WorldCheckRiskIntelligence>');
        expect(xml).not.toContain('<MiddleInitial>');
        expect(xml).not.toContain('<Street>');
        expect(xml).not.toContain('<PersonBirthDate>');
        expect(xml).not.toContain('<EmailAddress>');
    });

    it('rejects a request without the owner name', () => {
        expect(() =>
            buildPersonSearchXml(
                { firstName: '', lastName: '' },
                config,
                'Ocean application-1',
            ),
        ).toThrow(/first and last name/i);
    });
});

describe('buildBusinessSearchXml', () => {
    it('builds Business Search with name and FEIN only', () => {
        const xml = buildBusinessSearchXml(
            {
                businessName: 'Example & Sons LLC',
                fein: '12-3456789',
                phoneNumber: '212-555-0100',
                ownerFirstName: 'Jane',
                ownerLastName: 'Owner',
                address: {
                    street: '10 Main Street',
                    city: 'New York',
                    state: 'ny',
                    zipCode: '10001',
                    country: 'USA',
                },
            },
            { permissiblePurpose: { glb: 'Q', dppa: '0', voter: '7' } },
            'Ocean application-1 Business',
        );

        expect(xml).toContain('<bs:BusinessSearchRequest');
        expect(xml).toContain('<BusinessName>Example &amp; Sons LLC</BusinessName>');
        expect(xml).toContain('<FEIN>123456789</FEIN>');
        expect(xml).toContain('<PublicRecordBusiness>true</PublicRecordBusiness>');
        expect(xml).toContain('<PublicRecordUCCFilings>true</PublicRecordUCCFilings>');
        expect(xml).not.toContain('<State>');
        expect(xml).not.toContain('<FirstName>');
        expect(xml).not.toContain('<PhoneNumber>');
    });
});
