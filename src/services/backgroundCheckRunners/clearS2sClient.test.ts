import { buildBusinessSearchXml, buildPersonSearchXml } from './clearS2sClient';

const config = {
    permissiblePurpose: { glb: 'Q', dppa: '0', voter: '7' },
};

describe('CLEAR XML builders', () => {
    it('builds the v3 Person Search request and escapes subject data', () => {
        const xml = buildPersonSearchXml(
            {
                firstName: 'Jane & John',
                middleName: 'Quinn',
                lastName: 'Sample',
                dateOfBirth: new Date('1980-02-03T00:00:00.000Z'),
                ssn: '123456789',
                address: {
                    street: '1 Main <Street>',
                    state: 'ny',
                },
            },
            config,
            'Woodmere application-1',
        );

        expect(xml).toContain('<ps:PersonSearchRequestV3');
        expect(xml).toContain('<FirstName>Jane &amp; John</FirstName>');
        expect(xml).toContain('<MiddleInitial>Q</MiddleInitial>');
        expect(xml).toContain('<Street>1 Main &lt;Street&gt;</Street>');
        expect(xml).toContain('<State>NY</State>');
        expect(xml).toContain('<PersonBirthDate>02/03/1980</PersonBirthDate>');
        expect(xml).toContain('<SSN>123-45-6789</SSN>');
        expect(xml).toContain('<WorldCheckRiskIntelligence>false</WorldCheckRiskIntelligence>');
    });

    it('requires an owner first and last name', () => {
        expect(() =>
            buildPersonSearchXml(
                { firstName: '', lastName: '' },
                config,
                'Woodmere application-1',
            ),
        ).toThrow(/first and last name/i);
    });

    it('builds the v2 Business Search request', () => {
        const xml = buildBusinessSearchXml(
            {
                businessName: 'Example & Sons LLC',
                fein: '12-3456789',
                ownerFirstName: 'Jane',
                ownerLastName: 'Owner',
                address: { state: 'ny' },
            },
            config,
            'Woodmere application-1 Business',
        );

        expect(xml).toContain('<bs:BusinessSearchRequest');
        expect(xml).toContain('<BusinessName>Example &amp; Sons LLC</BusinessName>');
        expect(xml).toContain('<FEIN>123456789</FEIN>');
        expect(xml).toContain('<State>NY</State>');
        expect(xml).toContain('<PublicRecordBusiness>true</PublicRecordBusiness>');
        expect(xml).toContain('<PublicRecordUCCFilings>true</PublicRecordUCCFilings>');
    });
});
