import { parseRetryAfterMs, isUnknownInviteOutcome } from './signnow-invite-send';

export type GroupInviteHttpResult = {
  status: number;
  data?: unknown;
  headers?: Record<string, unknown>;
};

export function groupInviteErrorDetail(res: GroupInviteHttpResult): string {
  const data = (res.data || {}) as Record<string, any>;
  return String(
    data?.errors?.[0]?.message || data?.error || JSON.stringify(data || {}),
  );
}

export function groupInviteAlreadyExists(detail: string): boolean {
  return /already exists|group invite already/i.test(detail);
}

export function retryAfterFromHeaders(headers: Record<string, unknown> | undefined): string | undefined {
  if (!headers) return undefined;
  const raw =
    headers['retry-after'] ??
    headers['Retry-After'] ??
    headers['RETRY-AFTER'];
  if (Array.isArray(raw)) return String(raw[0] ?? '');
  return raw == null ? undefined : String(raw);
}

export type SafeInvitePostDeps = {
  groupId: string;
  requestId: string;
  attemptNumber: number;
  postInvite: () => Promise<GroupInviteHttpResult>;
  findExistingInviteId: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  /** Repair payload for 400 unknown/omitted role. Return false to stop. */
  repairForFailedDetail?: (detail: string) => boolean | Promise<boolean>;
  maxRoleRepairs?: number;
  log?: (event: string, extra?: Record<string, unknown>) => void;
};

/**
 * POST groupinvite once (plus bounded 400 role repairs and a single 429 wait).
 * Never blindly retries 5xx/timeouts: those may have already created an invite.
 */
export async function postGroupInviteSafely(deps: SafeInvitePostDeps): Promise<{
  ok: boolean;
  skippedBecauseExisting: boolean;
  inviteId: string;
  status: number | null;
  detail: string;
  postCount: number;
}> {
  const sleep = deps.sleep || ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const log = deps.log || (() => undefined);
  const maxRoleRepairs = deps.maxRoleRepairs ?? 4;
  let postCount = 0;

  const existingBefore = await deps.findExistingInviteId();
  if (existingBefore) {
    log('Contract already SENT - skipping duplicate invite', {
      contractId: deps.groupId,
      requestId: deps.requestId,
      signnowDocumentId: deps.groupId,
      sendStatus: 'SENT',
      attemptNumber: deps.attemptNumber,
      timestamp: new Date().toISOString(),
    });
    return {
      ok: true,
      skippedBecauseExisting: true,
      inviteId: existingBefore,
      status: 200,
      detail: '',
      postCount: 0,
    };
  }

  const runPost = async () => {
    postCount += 1;
    log('Invite request started', {
      contractId: deps.groupId,
      requestId: deps.requestId,
      signnowDocumentId: deps.groupId,
      sendStatus: 'SENDING',
      attemptNumber: deps.attemptNumber,
      postCount,
      timestamp: new Date().toISOString(),
    });
    return deps.postInvite();
  };

  let res: GroupInviteHttpResult;
  try {
    res = await runPost();
  } catch (err) {
    const existing = await deps.findExistingInviteId();
    if (existing) {
      log('Retry skipped because invite state is unknown', {
        contractId: deps.groupId,
        requestId: deps.requestId,
        signnowDocumentId: deps.groupId,
        signnowInviteId: existing,
        sendStatus: 'SENT',
        attemptNumber: deps.attemptNumber,
        timestamp: new Date().toISOString(),
      });
      return {
        ok: true,
        skippedBecauseExisting: true,
        inviteId: existing,
        status: null,
        detail: 'timeout_or_network',
        postCount,
      };
    }
    log('Retry skipped because invite state is unknown', {
      contractId: deps.groupId,
      requestId: deps.requestId,
      signnowDocumentId: deps.groupId,
      sendStatus: 'FAILED',
      attemptNumber: deps.attemptNumber,
      timestamp: new Date().toISOString(),
    });
    throw err;
  }

  if (res.status < 400) {
    const inviteId =
      (await deps.findExistingInviteId()) ||
      String(
        (res.data as any)?.id ||
          (res.data as any)?.invite_id ||
          (res.data as any)?.data?.id ||
          '',
      ).trim();
    log('Invite request successful', {
      contractId: deps.groupId,
      requestId: deps.requestId,
      signnowDocumentId: deps.groupId,
      signnowInviteId: inviteId || undefined,
      sendStatus: 'SENT',
      attemptNumber: deps.attemptNumber,
      timestamp: new Date().toISOString(),
    });
    return {
      ok: true,
      skippedBecauseExisting: false,
      inviteId,
      status: res.status,
      detail: '',
      postCount,
    };
  }

  let detail = groupInviteErrorDetail(res);
  if (groupInviteAlreadyExists(detail)) {
    const inviteId = await deps.findExistingInviteId();
    log('groupinvite already exists; treating send as complete', {
      contractId: deps.groupId,
      requestId: deps.requestId,
      signnowDocumentId: deps.groupId,
      sendStatus: 'SENT',
      attemptNumber: deps.attemptNumber,
      timestamp: new Date().toISOString(),
    });
    return {
      ok: true,
      skippedBecauseExisting: true,
      inviteId,
      status: res.status,
      detail,
      postCount,
    };
  }

  if (res.status === 429) {
    const waitMs = parseRetryAfterMs(retryAfterFromHeaders(res.headers));
    log('HTTP 429 — waiting Retry-After then checking existing invite', {
      contractId: deps.groupId,
      requestId: deps.requestId,
      waitMs,
      attemptNumber: deps.attemptNumber,
      timestamp: new Date().toISOString(),
    });
    await sleep(waitMs);
    const afterWait = await deps.findExistingInviteId();
    if (afterWait) {
      return {
        ok: true,
        skippedBecauseExisting: true,
        inviteId: afterWait,
        status: 429,
        detail,
        postCount,
      };
    }
    try {
      res = await runPost();
    } catch (err) {
      const existing = await deps.findExistingInviteId();
      if (existing) {
        return {
          ok: true,
          skippedBecauseExisting: true,
          inviteId: existing,
          status: null,
          detail: 'timeout_or_network',
          postCount,
        };
      }
      throw err;
    }
    if (res.status < 400 || groupInviteAlreadyExists(groupInviteErrorDetail(res))) {
      const inviteId = await deps.findExistingInviteId();
      return {
        ok: true,
        skippedBecauseExisting: groupInviteAlreadyExists(groupInviteErrorDetail(res)),
        inviteId,
        status: res.status,
        detail: '',
        postCount,
      };
    }
    detail = groupInviteErrorDetail(res);
  }

  if (isUnknownInviteOutcome(res.status)) {
    const existing = await deps.findExistingInviteId();
    if (existing) {
      log('Retry skipped because invite state is unknown', {
        contractId: deps.groupId,
        requestId: deps.requestId,
        signnowDocumentId: deps.groupId,
        signnowInviteId: existing,
        sendStatus: 'SENT',
        attemptNumber: deps.attemptNumber,
        timestamp: new Date().toISOString(),
      });
      return {
        ok: true,
        skippedBecauseExisting: true,
        inviteId: existing,
        status: res.status,
        detail,
        postCount,
      };
    }
    log('Retry skipped because invite state is unknown', {
      contractId: deps.groupId,
      requestId: deps.requestId,
      signnowDocumentId: deps.groupId,
      sendStatus: 'FAILED',
      httpStatus: res.status,
      attemptNumber: deps.attemptNumber,
      timestamp: new Date().toISOString(),
    });
    return {
      ok: false,
      skippedBecauseExisting: false,
      inviteId: '',
      status: res.status,
      detail,
      postCount,
    };
  }

  for (let repair = 0; repair < maxRoleRepairs && res.status >= 400; repair += 1) {
    const existing = await deps.findExistingInviteId();
    if (existing) {
      return {
        ok: true,
        skippedBecauseExisting: true,
        inviteId: existing,
        status: res.status,
        detail,
        postCount,
      };
    }
    if (!(await deps.repairForFailedDetail?.(detail))) break;
    try {
      res = await runPost();
    } catch (err) {
      const found = await deps.findExistingInviteId();
      if (found) {
        return {
          ok: true,
          skippedBecauseExisting: true,
          inviteId: found,
          status: null,
          detail: 'timeout_or_network',
          postCount,
        };
      }
      throw err;
    }
    if (res.status < 400 || groupInviteAlreadyExists(groupInviteErrorDetail(res))) {
      const inviteId = await deps.findExistingInviteId();
      return {
        ok: true,
        skippedBecauseExisting: false,
        inviteId,
        status: res.status,
        detail: '',
        postCount,
      };
    }
    detail = groupInviteErrorDetail(res);
    if (isUnknownInviteOutcome(res.status)) {
      return {
        ok: false,
        skippedBecauseExisting: false,
        inviteId: '',
        status: res.status,
        detail,
        postCount,
      };
    }
  }

  return {
    ok: res.status < 400,
    skippedBecauseExisting: false,
    inviteId: await deps.findExistingInviteId(),
    status: res.status,
    detail,
    postCount,
  };
}
