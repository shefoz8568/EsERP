import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { prisma, withTenant, withBootstrap, type PrismaTx } from '@eserp/db';

export type { PrismaTx };

/** Thin Nest wrapper around the @eserp/db Prisma singleton + tenant helper. */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client = prisma;

  async onModuleInit(): Promise<void> {
    await this.client.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }

  /** Run fn in a transaction with RLS tenant context set (see @eserp/db). */
  withTenant<T>(tenantId: string, fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return withTenant(tenantId, fn);
  }

  /** Server-side bootstrap transaction (pre-auth lookups, outbox drain). */
  withBootstrap<T>(fn: (tx: PrismaTx) => Promise<T>): Promise<T> {
    return withBootstrap(fn);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
