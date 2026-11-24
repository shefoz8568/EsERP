import { Injectable } from '@nestjs/common';
import { Prisma } from '@eserp/db';
import type { PrismaTx } from '../../common/prisma/prisma.service';

/** Transactional outbox: publish() writes in the SAME tx as the mutation. */
@Injectable()
export class OutboxService {
  async publish(tx: PrismaTx, event: { tenantId: string; eventType: string; aggregateId?: string; payload: Record<string, unknown>; createdBy?: string }): Promise<void> {
    await tx.outboxEvent.create({ data: { tenantId: event.tenantId, eventType: event.eventType, aggregateId: event.aggregateId, payload: event.payload as unknown as Prisma.InputJsonValue, createdBy: event.createdBy } });
  }
}
