import {
    buildBusinessSearchXml,
    buildPersonSearchXml,
    parseClearBusinessHits,
    parseClearPersonHits,
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

describe('parseClearPersonHits', () => {
    it('parses person hit fields from result XML', () => {
        const xml = `
          <Status><StatusCode>200</StatusCode></Status>
          <PersonSearchResult>
            <GroupId>person-group-1</GroupId>
            <PersonEntityId>pe-1</PersonEntityId>
            <FirstName>Jane</FirstName>
            <MiddleName>Q</MiddleName>
            <LastName>Doe</LastName>
            <SSN>123-45-6789</SSN>
            <PersonBirthDate>1980-02-03</PersonBirthDate>
            <Street>1 Main St</Street>
            <City>Albany</City>
            <State>NY</State>
            <ZipCode>12207</ZipCode>
            <EmailAddress>jane@example.com</EmailAddress>
            <PhoneNumber>5185550100</PhoneNumber>
          </PersonSearchResult>
        `;
        expect(parseClearPersonHits(xml)).toEqual([
            expect.objectContaining({
                groupId: 'person-group-1',
                personEntityId: 'pe-1',
                firstName: 'Jane',
                middleName: 'Q',
                lastName: 'Doe',
                ssn: '123-45-6789',
                dateOfBirth: '1980-02-03',
                address1: '1 Main St',
                city: 'Albany',
                state: 'NY',
                zipCode: '12207',
                email: 'jane@example.com',
                phoneNumber: '5185550100',
            }),
        ]);
    });
});

describe('parseClearBusinessHits', () => {
    it('parses business hit fields from result XML', () => {
        const xml = `
          <Status><StatusCode>200</StatusCode></Status>
          <BusinessSearchResult>
            <GroupId>biz-group-1</GroupId>
            <CompanyEntityId>ce-1</CompanyEntityId>
            <BusinessName>Acme LLC</BusinessName>
            <FEIN>123456789</FEIN>
            <Street>10 Main Street</Street>
            <City>New York</City>
            <State>NY</State>
            <ZipCode>10001</ZipCode>
          </BusinessSearchResult>
        `;
        expect(parseClearBusinessHits(xml)).toEqual([
            expect.objectContaining({
                groupId: 'biz-group-1',
                companyEntityId: 'ce-1',
                name: 'Acme LLC',
                fein: '123456789',
                address1: '10 Main Street',
                city: 'New York',
                state: 'NY',
                zipCode: '10001',
            }),
        ]);
    });
});
