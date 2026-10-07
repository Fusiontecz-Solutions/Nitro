/**
 * A deal can have several agents; they are stored comma-separated on the
 * contract. `prismaClient` is stubbed so nothing touches a database.
 */
const contract = { findUnique: jest.fn(), updateMany: jest.fn() };
const application = { findUnique: jest.fn() };
jest.mock('../config/prismaClient', () => ({
  __esModule: true,
  default: { contract, application },
}));

import { readContractAgentEmail, saveContractAgentEmail, splitAgentEmails } from './contractAgentEmail';

beforeEach(() => {
  jest.clearAllMocks();
  application.findUnique.mockResolvedValue({ referringAgent: { email: 'ref@broker.com' }, createdBy: null });
  contract.updateMany.mockResolvedValue({ count: 1 });
});

it('splits and de-duplicates a list', () => {
  expect(splitAgentEmails('a@x.com, b@x.com;A@X.com')).toEqual(['a@x.com', 'b@x.com']);
  expect(splitAgentEmails([' a@x.com ', '', 'b@x.com'])).toEqual(['a@x.com', 'b@x.com']);
  expect(splitAgentEmails(null)).toEqual([]);
});

it('reads every saved agent ahead of the referring agent', async () => {
  contract.findUnique.mockResolvedValue({ agentEmail: 'one@broker.com,two@broker.com' });
  expect(await readContractAgentEmail('app-1')).toEqual({
    agentEmails: ['one@broker.com', 'two@broker.com'],
    agentEmail: 'one@broker.com',
    savedAgentEmails: ['one@broker.com', 'two@broker.com'],
    source: 'contract',
  });
});

it('falls back to the referring agent when none are saved', async () => {
  contract.findUnique.mockResolvedValue({ agentEmail: null });
  const result = await readContractAgentEmail('app-1');
  expect(result.agentEmails).toEqual(['ref@broker.com']);
  expect(result.source).toBe('referring_agent');
});

it('saves a list comma-separated, and clears with an empty list', async () => {
  contract.findUnique.mockResolvedValue({ agentEmail: null });
  await saveContractAgentEmail('app-1', ['one@broker.com', 'two@broker.com']);
  expect(contract.updateMany).toHaveBeenCalledWith({
    where: { applicationId: 'app-1' },
    data: { agentEmail: 'one@broker.com,two@broker.com' },
  });
  await saveContractAgentEmail('app-1', []);
  expect(contract.updateMany).toHaveBeenLastCalledWith({
    where: { applicationId: 'app-1' },
    data: { agentEmail: null },
  });
});

it('rejects the whole list when any address is invalid', async () => {
  await expect(saveContractAgentEmail('app-1', ['one@broker.com', 'nope'])).rejects.toMatchObject({
    status: 400,
  });
  expect(contract.updateMany).not.toHaveBeenCalled();
});
