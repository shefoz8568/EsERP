import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** Shared PrismaClient singleton (one per process; survives HMR in dev). */
export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Run `fn` inside a transaction with the RLS tenant context set.
 * `SET LOCAL app.tenant_id` only lives for the transaction, so the tenant
 * can never leak into another request on a pooled connection.
 */
export async function withTenant<T>(tenantId: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${escapeTenantId(tenantId)}'`);
    return fn(tx as PrismaTx);
  });
}

/** Set the RLS tenant context on an already-open transaction client. */
export async function setTenantContext(
  client: { $executeRawUnsafe: (sql: string) => Promise<unknown> },
  tenantId: string,
): Promise<void> {
  await client.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${escapeTenantId(tenantId)}'`);
}

/**
 * Run fn in a transaction with the login-bootstrap flag set (see rls.sql).
 * Server-side only: pre-authentication lookups and the outbox drain worker.
 * Never call this with user-controlled input.
 */
export async function withBootstrap<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.bootstrap = 'eserp-login'`);
    return fn(tx as PrismaTx);
  });
}

function escapeTenantId(tenantId: string): string {
  if (!tenantId || typeof tenantId !== 'string') throw new Error('tenantId is required');
  return tenantId.replace(/'/g, "''");
}

export * from '@prisma/client';
export * from './encryption.js';
export default prisma;
