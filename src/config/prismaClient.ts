import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool, type PoolClient } from 'pg';

// Reuse a single PrismaClient instance across the app.
const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Use the standard PostgreSQL driver (pg) against the Neon connection string.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not set');
}

/**
 * Prisma 7.9.x `adapter-pg` fans out relation `include`s with Promise.all while
 * holding a single `pg` PoolClient (implicit write transactions and `$transaction`).
 * Concurrent `client.query()` poisons that connection:
 *   "Calling client.query() when the client is already executing a query"
 * then later: "Client has encountered a connection error and is not queryable".
 * Serialize queries per physical client until Prisma ships the adapter mutex.
 */
const queryWrappedClients = new WeakSet<object>();
const poisonedClients = new WeakMap<object, Error>();

function isUnusablePgClientError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return (
    /not queryable/i.test(message) ||
    /already executing a query/i.test(message) ||
    /connection terminated/i.test(message) ||
    /Client has encountered a connection error/i.test(message)
  );
}

function guardPoolClient(client: PoolClient): void {
  if (!queryWrappedClients.has(client)) {
    queryWrappedClients.add(client);
    const originalQuery = client.query.bind(client) as (...args: unknown[]) => unknown;
    let queue: Promise<unknown> = Promise.resolve();

    const wrappedQuery = (...args: unknown[]) => {
      const maybeCb = args[args.length - 1];
      const callback =
        typeof maybeCb === 'function'
          ? (args.pop() as (err: Error | null, res?: unknown) => void)
          : undefined;

      const run = () => {
        const poisoned = poisonedClients.get(client);
        if (poisoned) return Promise.reject(poisoned);
        return Promise.resolve(originalQuery(...args));
      };

      const result = queue.then(run, run);
      queue = result.then(
        () => undefined,
        (err) => {
          if (isUnusablePgClientError(err)) {
            poisonedClients.set(client, err instanceof Error ? err : new Error(String(err)));
          }
        },
      );

      if (callback) {
        result.then(
          (res) => callback(null, res),
          (err) => callback(err),
        );
        return undefined;
      }
      return result;
    };

    client.query = wrappedQuery as typeof client.query;
  }

  // Pool reassigns `release` on every checkout; wrap the current one so a dead
  // client is destroyed instead of being returned to the pool.
  const originalRelease = client.release.bind(client);
  client.release = (err?: boolean | Error) => {
    originalRelease(err || poisonedClients.get(client) || undefined);
  };
}

// Neon connection strings often set channel_binding=require; that conflicts with
// ssl.rejectUnauthorized=false and can drop the socket mid-request.
const poolConnectionString = connectionString.replace(
  /([?&])channel_binding=require/i,
  '$1channel_binding=prefer',
);

const pool = new Pool({
  connectionString: poolConnectionString,
  ssl: { rejectUnauthorized: false },
  keepAlive: true,
  idleTimeoutMillis: 20000,
  max: Number(process.env.DB_POOL_MAX ?? 15),
  // Recycle clients so a poisoned/stale Neon-pooler socket cannot be reused forever.
  maxUses: 500,
  connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS ?? '10000'),
});

const originalConnect = pool.connect.bind(pool);
pool.connect = ((cb?: (err: Error | undefined, client?: PoolClient, release?: (err?: boolean | Error) => void) => void) => {
  if (typeof cb === 'function') {
    return originalConnect((err, client, release) => {
      if (client) guardPoolClient(client);
      cb(err, client, release);
    });
  }
  return originalConnect().then((client) => {
    guardPoolClient(client);
    return client;
  });
}) as typeof pool.connect;

pool.on('error', (err) => {
  console.error('Database pool error:', err.message);
});

const adapter = new PrismaPg(pool);

const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: ['error', 'warn'],
  } as any);

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;


