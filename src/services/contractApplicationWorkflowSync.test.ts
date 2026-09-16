import {
  applyContractCompletedSyncToApplicationRecord,
  APPLICATION_QUEUE_CONTRACT_SENT,
  APPLICATION_STATE_CONTRACT_SENT,
  APPLICATION_QUEUE_CONTRACT_SIGNED,
  APPLICATION_STATE_CONTRACT_SIGNED,
} from './contractApplicationWorkflowSync';

jest.mock('./applicationActivityLogService', () => ({
  createApplicationActivityLog: jest.fn().mockResolvedValue(undefined),
}));

type Row = Record<string, any>;

/** Minimal in-memory stand-in for the Prisma client this module touches. */
function makePrisma(seed: { application: Row; contract?: Row | null; document?: Row | null }) {
  const state = {
    application: { ...seed.application },
    contract: seed.contract ? { ...seed.contract } : null,
    document: seed.document ? { ...seed.document } : null,
  };
  return {
    state,
    client: {
      application: {
        findUnique: jest.fn(async () => ({ ...state.application })),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(state.application, data);
          return { ...state.application };
        }),
      },
      contract: {
        findFirst: jest.fn(async () => (state.contract ? { ...state.contract } : null)),
        update: jest.fn(async ({ data }: any) => {
          Object.assign(state.contract as Row, data);
          return { ...(state.contract as Row) };
        }),
      },
      document: {
        findUnique: jest.fn(async () => (state.document ? { ...state.document } : null)),
      },
    } as any,
  };
}

describe('applyContractCompletedSyncToApplicationRecord', () => {
  it('promotes a sent-but-unsigned contract from Contract Generated to Contract Sent', async () => {
    // The reported bug: SignNow shows the contract as Sent while the
    // application summary still reads Contract Generated.
    const { client, state } = makePrisma({
      application: {
        id: 'app-1',
        applicationId: 'A-1',
        currentQueue: 'Contract Generated',
        currentState: 'CONTRACT_GENERATED',
      },
      contract: { id: 1, applicationId: 'app-1', status: 'SENT' },
      document: { status: 'sent', sentAt: new Date() },
    });
    const record = {
      id: 'app-1',
      currentQueue: 'Contract Generated',
      currentState: 'CONTRACT_GENERATED',
    };

    const synced = await applyContractCompletedSyncToApplicationRecord(client, record, 'test');

    expect(synced).toBe(true);
    expect(state.application.currentQueue).toBe(APPLICATION_QUEUE_CONTRACT_SENT);
    expect(state.application.currentState).toBe(APPLICATION_STATE_CONTRACT_SENT);
    // The in-memory record the GET handler returns must reflect it too.
    expect(record.currentQueue).toBe(APPLICATION_QUEUE_CONTRACT_SENT);
    expect(record.currentState).toBe(APPLICATION_STATE_CONTRACT_SENT);
  });

  it('promotes a completed contract all the way to Contract Signed', async () => {
    const { client, state } = makePrisma({
      application: {
        id: 'app-2',
        applicationId: 'A-2',
        currentQueue: 'Contract Sent',
        currentState: 'CONTRACT_SENT',
      },
      contract: { id: 2, applicationId: 'app-2', status: 'SENT' },
      document: { status: 'completed', sentAt: new Date() },
    });
    const record = { id: 'app-2', currentQueue: 'Contract Sent', currentState: 'CONTRACT_SENT' };

    const synced = await applyContractCompletedSyncToApplicationRecord(client, record, 'test');

    expect(synced).toBe(true);
    // Document completed but Contract still SENT — the contract row is repaired.
    expect(state.contract?.status).toBe('COMPLETED');
    expect(state.application.currentQueue).toBe(APPLICATION_QUEUE_CONTRACT_SIGNED);
    expect(state.application.currentState).toBe(APPLICATION_STATE_CONTRACT_SIGNED);
  });

  it('heals a completed contract that is still sitting on Contract Generated', async () => {
    const { client, state } = makePrisma({
      application: {
        id: 'app-3',
        applicationId: 'A-3',
        currentQueue: 'Contract Generated',
        currentState: 'CONTRACT_GENERATED',
      },
      contract: { id: 3, applicationId: 'app-3', status: 'SENT' },
      document: { status: 'completed', sentAt: new Date() },
    });
    const record = {
      id: 'app-3',
      currentQueue: 'Contract Generated',
      currentState: 'CONTRACT_GENERATED',
    };

    expect(await applyContractCompletedSyncToApplicationRecord(client, record, 'test')).toBe(true);
    expect(state.application.currentQueue).toBe(APPLICATION_QUEUE_CONTRACT_SIGNED);
  });

  it('leaves a generated-but-never-sent contract alone', async () => {
    const { client, state } = makePrisma({
      application: {
        id: 'app-4',
        applicationId: 'A-4',
        currentQueue: 'Contract Generated',
        currentState: 'CONTRACT_GENERATED',
      },
      contract: { id: 4, applicationId: 'app-4', status: 'DRAFT' },
      document: { status: 'draft', sentAt: null },
    });
    const record = {
      id: 'app-4',
      currentQueue: 'Contract Generated',
      currentState: 'CONTRACT_GENERATED',
    };

    expect(await applyContractCompletedSyncToApplicationRecord(client, record, 'test')).toBe(false);
    expect(state.application.currentQueue).toBe('Contract Generated');
  });

  it('never walks an already-signed application backwards', async () => {
    const { client, state } = makePrisma({
      application: {
        id: 'app-5',
        applicationId: 'A-5',
        currentQueue: APPLICATION_QUEUE_CONTRACT_SIGNED,
        currentState: APPLICATION_STATE_CONTRACT_SIGNED,
      },
      contract: { id: 5, applicationId: 'app-5', status: 'SENT' },
      document: { status: 'sent', sentAt: new Date() },
    });
    const record = {
      id: 'app-5',
      currentQueue: APPLICATION_QUEUE_CONTRACT_SIGNED,
      currentState: APPLICATION_STATE_CONTRACT_SIGNED,
    };

    expect(await applyContractCompletedSyncToApplicationRecord(client, record, 'test')).toBe(false);
    expect(state.application.currentQueue).toBe(APPLICATION_QUEUE_CONTRACT_SIGNED);
  });
});
