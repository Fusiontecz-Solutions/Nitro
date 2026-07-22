import { createClearS2sRunner } from './clearS2sRunner';

describe('createClearS2sRunner', () => {
    it('aggregates business and every owner search', async () => {
        const searchPerson = jest
            .fn()
            .mockResolvedValueOnce({
                environment: 'beta',
                statusCode: '200',
                groupCount: 0,
                groupIds: [],
                personEntityIds: [],
            })
            .mockResolvedValueOnce({
                environment: 'beta',
                statusCode: '200',
                groupCount: 2,
                groupIds: ['owner-group-1', 'owner-group-2'],
                personEntityIds: [],
            });
        const searchBusiness = jest.fn().mockResolvedValue({
            environment: 'beta',
            statusCode: '200',
            groupCount: 1,
            groupIds: ['business-group'],
            companyEntityIds: ['company-1'],
        });
        const runner = createClearS2sRunner(searchPerson, searchBusiness);

        const result = await runner.runCheck({
            checkType: 'TLO',
            applicationId: 'application-1',
            businessSubject: { businessName: 'Example LLC' },
            subjects: [
                { firstName: 'Jane', lastName: 'One' },
                { firstName: 'John', lastName: 'Two' },
            ],
        });

        expect(searchBusiness).toHaveBeenCalledTimes(1);
        expect(searchPerson).toHaveBeenCalledTimes(2);
        expect(result.result).toBe('FLAG');
        expect(result.notes).toMatch(/1 possible business match.*2 possible owner matches/i);
        expect(result.raw).toEqual(
            expect.objectContaining({ ownerCount: 2, groupCount: 3 }),
        );
    });

    it('passes when business and owners have no matches', async () => {
        const emptyPerson = jest.fn().mockResolvedValue({
            environment: 'beta',
            statusCode: '200',
            groupCount: 0,
            groupIds: [],
            personEntityIds: [],
        });
        const emptyBusiness = jest.fn().mockResolvedValue({
            environment: 'beta',
            statusCode: '200',
            groupCount: 0,
            groupIds: [],
            companyEntityIds: [],
        });

        const result = await createClearS2sRunner(emptyPerson, emptyBusiness).runCheck({
            checkType: 'TLO',
            businessSubject: { businessName: 'Example LLC' },
            subjects: [{ firstName: 'Jane', lastName: 'Owner' }],
        });

        expect(result.result).toBe('PASS');
    });
});
