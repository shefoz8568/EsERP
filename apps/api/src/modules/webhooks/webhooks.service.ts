/**
 * Phase 11 — outbound webhooks.
 *
 * `WebhookEndpoint` subscribes to outbox event types (e.g.
 * `sales-invoice.posted`, `order.confirmed`, `customer-payment.created`,
 * `payroll-run.approved`, `stock.low`, `ping`). The outbox drain worker in
 * QueueService creates a `WebhookDelivery` per matching ACTIVE endpoint and
 * enqueues it on the BullMQ `webhooks` queue; this service's worker performs
 * the HTTP POST with an HMAC-SHA256 signature header
 * (`X-EsERP-Signature: sha256=<hex>` over the raw JSON body, keyed by the
 * endpoint secret). BullMQ retries up to 5 attempts with exponential
 * backoff; after the 5th failed attempt the delivery is FAILED with the
 * last response recorded. Deliveries are at-least-once: receivers must be
 * idempotent on the delivery id in the payload.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import { WEBHOOK_SIGNATURE_HEADER, type WebhookEndpointDto, type WebhookEndpointUpdateDto } from '@eserp/shared';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../queue/outbox.service';
import { pageMeta, parsePageParams, toJson } from '../master-data/serialize';

export const MAX_WEBHOOK_ATTEMPTS = 5;

export function signWebhookPayload(secret: string, rawBody: string): string {
  return `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
}

export function verifyWebhookSignature(secret: string, rawBody: string, signature: string): boolean {
  return signWebhookPayload(secret, rawBody) === signature;
}

export interface WebhookDeliveryJob {
  deliveryId: string;
}

@Injectable()
export class WebhooksService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhooksService.name);
  private queue!: Queue<WebhookDeliveryJob>;
  private worker!: Worker<WebhookDeliveryJob>;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ConfigService) private readonly config: ConfigService<AppConfig>,
  ) {}

  onModuleInit(): void {
    const connection = { url: this.config.get<string>('redisUrl') ?? 'redis://localhost:6379' };
    this.queue = new Queue<WebhookDeliveryJob>('webhooks', { connection });
    this.worker = new Worker<WebhookDeliveryJob>(
      'webhooks',
      async (job: Job<WebhookDeliveryJob>) => {
        const ok = await this.deliver(job.data.deliveryId);
        if (!ok) throw new Error('Webhook delivery failed (non-2xx or network error) — BullMQ will retry');
        return true;
      },
      { connection },
    );
    this.worker.on('failed', (job, err) => this.logger.error(`Webhook job ${job?.id} failed: ${err.message}`));
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  async queueDelivery(deliveryId: string): Promise<void> {
    await this.queue.add('deliver', { deliveryId }, { attempts: MAX_WEBHOOK_ATTEMPTS, backoff: { type: 'exponential', delay: 60_000 } });
  }

  /** Create a delivery row for an endpoint + event, then enqueue it. */
  async createDelivery(tenantId: string, endpointId: string, eventType: string, payload: Record<string, unknown>, actorId?: string): Promise<string> {
    const delivery: any = await this.prisma.withTenant(tenantId, (tx) =>
      (tx as any).webhookDelivery.create({
        data: { tenantId, endpointId, eventType, payload: payload as never, status: 'PENDING', createdBy: actorId ?? null },
      }),
    );
    await this.queueDelivery(delivery.id as string).catch((err) => {
      this.logger.error(`Failed to enqueue webhook delivery ${delivery.id}: ${(err as Error).message}`);
    });
    return delivery.id as string;
  }

  /**
   * Perform ONE delivery attempt. Returns true on 2xx. Updates attemptCount,
   * last response, and status (DELIVERED on success; FAILED after the 5th
   * attempt; otherwise PENDING with nextRetryAt for the BullMQ retry).
   */
  async deliver(deliveryId: string): Promise<boolean> {
    const delivery: any = await this.prisma.withBootstrap((tx) =>
      (tx as any).webhookDelivery.findUnique({ where: { id: deliveryId }, include: { endpoint: true } }),
    );
    if (!delivery) {
      this.logger.warn(`Webhook delivery ${deliveryId} not found — skipping`);
      return true;
    }
    if (delivery.status === 'DELIVERED') return true;
    const endpoint = delivery.endpoint as { id: string; url: string; secret: string; tenantId: string; status: string };
    const rawBody = JSON.stringify({ deliveryId: delivery.id, eventType: delivery.eventType, payload: delivery.payload });
    const attemptCount = (delivery.attemptCount as number) + 1;
    let ok = false;
    let statusCode: number | undefined;
    let responseText = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      try {
        const res = await fetch(endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            [WEBHOOK_SIGNATURE_HEADER]: signWebhookPayload(endpoint.secret, rawBody),
            'X-EsERP-Event': delivery.eventType as string,
            'X-EsERP-Delivery': delivery.id as string,
          },
          body: rawBody,
          signal: controller.signal,
        });
        statusCode = res.status;
        responseText = (await res.text()).slice(0, 2000);
        ok = res.ok;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      responseText = (err as Error).message.slice(0, 2000);
    }
    const status = ok ? 'DELIVERED' : attemptCount >= MAX_WEBHOOK_ATTEMPTS ? 'FAILED' : 'PENDING';
    await this.prisma.withTenant(endpoint.tenantId, (tx) =>
      (tx as any).webhookDelivery.update({
        where: { id: deliveryId },
        data: {
          attemptCount,
          status,
          lastStatusCode: statusCode ?? null,
          lastResponse: responseText || null,
          deliveredAt: ok ? new Date() : null,
          nextRetryAt: ok || status === 'FAILED' ? null : new Date(Date.now() + 60_000 * 2 ** (attemptCount - 1)),
        },
      }),
    );
    return ok;
  }

  // --- Endpoints ------------------------------------------------------------

  async listEndpoints(tenantId: string, query: { page?: string; pageSize?: string; status?: string }) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).webhookEndpoint.count({ where }),
        (tx as any).webhookEndpoint.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async listDeliveries(tenantId: string, query: { page?: string; pageSize?: string; endpointId?: string; status?: string; eventType?: string }) {
    const { page, pageSize } = parsePageParams(query);
    const where: Record<string, unknown> = { tenantId };
    if (query.endpointId) where.endpointId = query.endpointId;
    if (query.status) where.status = query.status;
    if (query.eventType) where.eventType = query.eventType;
    const [total, data] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        (tx as any).webhookDelivery.count({ where }),
        (tx as any).webhookDelivery.findMany({
          where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize,
          include: { endpoint: { select: { id: true, name: true, url: true } } },
        }),
      ]),
    );
    return { data: toJson(data), meta: pageMeta(total, { page, pageSize }) };
  }

  async createEndpoint(tenantId: string, actorId: string, dto: WebhookEndpointDto) {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const created: any = await (tx as any).webhookEndpoint.create({
        data: {
          tenantId, name: dto.name, url: dto.url,
          secret: dto.secret ?? randomBytes(32).toString('hex'),
          eventTypes: dto.eventTypes as never, status: dto.status, createdBy: actorId,
        },
      });
      await this.audit.log(
        { tenantId, actorId, action: 'create:WebhookEndpoint', entityType: 'WebhookEndpoint', entityId: created.id, after: { name: dto.name, url: dto.url, eventTypes: dto.eventTypes, status: dto.status } },
        tx as never,
      );
      await this.outbox.publish(tx as never, {
        tenantId, eventType: 'webhook-endpoint.created', aggregateId: created.id,
        payload: { id: created.id, name: dto.name }, createdBy: actorId,
      });
      return toJson(created);
    });
  }

  async updateEndpoint(tenantId: string, actorId: string, id: string, dto: WebhookEndpointUpdateDto) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).webhookEndpoint.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Webhook endpoint not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const data: Record<string, unknown> = {};
      if (dto.name !== undefined) data.name = dto.name;
      if (dto.url !== undefined) data.url = dto.url;
      if (dto.secret !== undefined) data.secret = dto.secret;
      if (dto.eventTypes !== undefined) data.eventTypes = dto.eventTypes;
      if (dto.status !== undefined) data.status = dto.status;
      const updated: any = await (tx as any).webhookEndpoint.update({ where: { id }, data });
      await this.audit.log(
        { tenantId, actorId, action: 'update:WebhookEndpoint', entityType: 'WebhookEndpoint', entityId: id, before, after: updated },
        tx as never,
      );
      return toJson(updated);
    });
  }

  async deleteEndpoint(tenantId: string, actorId: string, id: string) {
    const before: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).webhookEndpoint.findUnique({ where: { id } }));
    if (!before || before.tenantId !== tenantId) throw new NotFoundException('Webhook endpoint not found');
    return this.prisma.withTenant(tenantId, async (tx) => {
      const deleted: any = await (tx as any).webhookEndpoint.delete({ where: { id } });
      await this.audit.log(
        { tenantId, actorId, action: 'delete:WebhookEndpoint', entityType: 'WebhookEndpoint', entityId: id, before },
        tx as never,
      );
      return toJson(deleted);
    });
  }

  /** Send a `ping` event to the endpoint (creates a delivery + enqueues it). */
  async testEndpoint(tenantId: string, actorId: string, id: string) {
    const endpoint: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).webhookEndpoint.findUnique({ where: { id } }));
    if (!endpoint || endpoint.tenantId !== tenantId) throw new NotFoundException('Webhook endpoint not found');
    if (endpoint.status !== 'ACTIVE') throw new BadRequestException('Endpoint is DISABLED — enable it before sending a test delivery');
    const deliveryId = await this.createDelivery(
      tenantId, id, 'ping',
      { event: 'ping', message: 'EsERP webhook test delivery', sentAt: new Date().toISOString() },
      actorId,
    );
    const delivery: any = await this.prisma.withTenant(tenantId, (tx) => (tx as any).webhookDelivery.findUnique({ where: { id: deliveryId } }));
    return toJson(delivery);
  }
}
