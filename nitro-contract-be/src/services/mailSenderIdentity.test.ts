const findMany = jest.fn();
jest.mock('../config/prismaClient', () => ({
  __esModule: true,
  default: { funderProfile: { findMany: (...args: unknown[]) => findMany(...args) } },
}));

import {
  invalidateSenderDirectoryCache,
  MissingSenderNameError,
  parseMailSender,
  resolveMailSender,
} from './mailSenderIdentity';

const ENV_KEYS = [
  'SMTP_FROM',
  'MAIL_FROM',
  'SENDGRID_FROM_EMAIL',
  'SENDGRID_AUTH_USER',
  'SMTP_AUTH_USER',
  'SENDGRID_FROM_NAME',
  'MAIL_FROM_NAME',
];
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  invalidateSenderDirectoryCache();
  findMany.mockReset();
  findMany.mockResolvedValue([
    { sendgridFromEmail: 'contracts@nitroadvance.com', sendgridFromName: 'Nitro Advance' },
    { sendgridFromEmail: 'contracts@tiberianfunding.com', sendgridFromName: 'Tiberian Funding' },
    { sendgridFromEmail: 'subs@obsidiancapitalgrps.com', sendgridFromName: 'Obsidian Capital Group' },
    { sendgridFromEmail: 'nameless@example.com', sendgridFromName: null },
  ]);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('parseMailSender', () => {
  it('splits quoted and bare forms', () => {
    expect(parseMailSender('"Tiberian Funding" <contracts@tiberianfunding.com>')).toEqual({
      email: 'contracts@tiberianfunding.com',
      name: 'Tiberian Funding',
    });
    expect(parseMailSender('contracts@nitroadvance.com')).toEqual({
      email: 'contracts@nitroadvance.com',
      name: null,
    });
  });
});

describe('resolveMailSender', () => {
  it('keeps an explicit sender identity untouched', async () => {
    process.env.SENDGRID_FROM_NAME = 'Nitro Advance';
    await expect(
      resolveMailSender({ email: 'contracts@tiberianfunding.com', name: 'Tiberian Funding' }),
    ).resolves.toEqual({ email: 'contracts@tiberianfunding.com', name: 'Tiberian Funding' });
  });

  it('keeps the name inside a "Name" <email> string', async () => {
    await expect(
      resolveMailSender('"Obsidian Capital Group" <subs@obsidiancapitalgrps.com>'),
    ).resolves.toEqual({ email: 'subs@obsidiancapitalgrps.com', name: 'Obsidian Capital Group' });
  });

  it('takes a bare address name from the funder that owns it, not the brand', async () => {
    process.env.SENDGRID_FROM_EMAIL = 'contracts@nitroadvance.com';
    process.env.SENDGRID_FROM_NAME = 'Nitro Advance';
    await expect(resolveMailSender('CONTRACTS@tiberianfunding.com')).resolves.toEqual({
      email: 'CONTRACTS@tiberianfunding.com',
      name: 'Tiberian Funding',
    });
  });

  it('pairs SENDGRID_FROM_NAME only with the default SENDGRID_FROM_EMAIL', async () => {
    process.env.SENDGRID_FROM_EMAIL = 'contracts@nitroadvance.com';
    process.env.SENDGRID_FROM_NAME = 'Nitro Advance';
    await expect(resolveMailSender(undefined, { sendgridOnly: true })).resolves.toEqual({
      email: 'contracts@nitroadvance.com',
      name: 'Nitro Advance',
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('names the default sender from its funder when SENDGRID_FROM_NAME is unset', async () => {
    process.env.SENDGRID_FROM_EMAIL = 'contracts@tiberianfunding.com';
    await expect(resolveMailSender(undefined)).resolves.toEqual({
      email: 'contracts@tiberianfunding.com',
      name: 'Tiberian Funding',
    });
  });

  it('refuses a sender with no configured name instead of using "Nitro Advance"', async () => {
    process.env.SENDGRID_FROM_EMAIL = 'contracts@nitroadvance.com';
    process.env.SENDGRID_FROM_NAME = 'Nitro Advance';
    await expect(resolveMailSender('nameless@example.com')).rejects.toBeInstanceOf(
      MissingSenderNameError,
    );
    await expect(resolveMailSender('unknown@example.com')).rejects.toBeInstanceOf(
      MissingSenderNameError,
    );
  });
});
