import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import type { AppConfig } from '../../config/configuration';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface EmailJob { to: string; subject: string; text?: string; html?: string }
export interface ExportJob { tenantId: string; userId: string; kind: string; params?: Record<string, unknown> }
export interface WebhookDeliveryJob { deliveryId: string }

/**
 * BullMQ queues "email", "exports" and "webhooks" (Redis). The email worker
 * sends via MailService; the export worker is a Phase-0 stub that logs the
 * request (real export generation lands with the reporting modules).
 *
 * Phase 11 — outbox → webhooks: the drain worker (below) fans each
 * unpublished OutboxEvent out to the tenant's ACTIVE webhook endpoints whose
 * subscribed eventTypes include the event type. It creates a
 * WebhookDelivery row (tenant-scoped) and enqueues it on the `webhooks`
 * queue; the actual HTTP POST + HMAC signing lives in WebhooksService
 * (apps/api/src/modules/webhooks), which owns that queue's worker.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private emailQueue!: Queue<EmailJob>;
  private exportsQueue!: Queue<ExportJob>;
  private outboxQueue!: Queue;
  private webhooksQueue!: Queue<WebhookDeliveryJob>;
  private workers: Worker[] = [];

  constructor(@Inject(ConfigService) private readonly config: ConfigService<AppConfig>, @Inject(MailService) private readonly mail: MailService, @Inject(PrismaService) private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    const connection = { url: this.config.get<string>('redisUrl') ?? 'redis://localhost:6379' };
    this.emailQueue = new Queue<EmailJob>('email', { connection });
    this.exportsQueue = new Queue<ExportJob>('exports', { connection });
    this.outboxQueue = new Queue('outbox', { connection });
    this.webhooksQueue = new Queue<WebhookDeliveryJob>('webhooks', { connection });
    void this.outboxQueue.add('drain', {}, { repeat: { every: 60_000 } });
    this.workers.push(
      new Worker<EmailJob>('email', async (job: Job<EmailJob>) => {
        await this.mail.sendMail(job.data);
      }, { connection }),
      new Worker<ExportJob>('exports', async (job: Job<ExportJob>) => {
        this.logger.log(`Export requested: ${job.data.kind} for tenant ${job.data.tenantId} (Phase 0: logged only)`);
      }, { connection }),
      // Outbox drain worker: marks unpublished events published + logs them,
      // and fans them out to matching webhook endpoints (Phase 11).
      new Worker('outbox', async () => {
        const events = await this.prisma.withBootstrap((tx) => tx.outboxEvent.findMany({ where: { publishedAt: null }, take: 100, orderBy: { createdAt: 'asc' } }));
        for (const e of events) {
          this.logger.log(`Outbox drain: ${e.eventType} ${e.aggregateId ?? ''} (tenant ${e.tenantId})`);
          await this.fanOutToWebhooks(e).catch((err) => this.logger.error(`Webhook fan-out failed for event ${e.id}: ${(err as Error).message}`));
          await this.prisma.withBootstrap((tx) => tx.outboxEvent.update({ where: { id: e.id }, data: { publishedAt: new Date() } }));
        }
        return events.length;
      }, { connection }),
    );
    for (const w of this.workers) {
      w.on('failed', (job, err) => this.logger.error(`Job ${job?.id} failed: ${err.message}`));
    }
  }

  /** Create + enqueue one WebhookDelivery per ACTIVE endpoint subscribed to this event type. */
  private async fanOutToWebhooks(event: { id: string; tenantId: string; eventType: string; aggregateId?: string | null; payload: unknown }): Promise<void> {
    const endpoints: any[] = await this.prisma.withBootstrap((tx) =>
      (tx as any).webhookEndpoint.findMany({ where: { tenantId: event.tenantId, status: 'ACTIVE' } }),
    );
    for (const endpoint of endpoints) {
      const subscribed: string[] = Array.isArray(endpoint.eventTypes) ? endpoint.eventTypes : [];
      if (!subscribed.includes(event.eventType)) continue;
      const delivery: any = await this.prisma.withTenant(event.tenantId, (tx) =>
        (tx as any).webhookDelivery.create({
          data: {
            tenantId: event.tenantId, endpointId: endpoint.id, eventType: event.eventType,
            payload: (event.payload ?? {}) as never, status: 'PENDING', createdBy: null,
          },
        }),
      );
      await this.webhooksQueue.add(
        'deliver',
        { deliveryId: delivery.id as string },
        { attempts: 5, backoff: { type: 'exponential', delay: 60_000 } },
      );
    }
  }

  async queueEmail(job: EmailJob): Promise<void> {
    await this.emailQueue.add('send', job, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } });
  }

  async queueExport(job: ExportJob): Promise<void> {
    await this.exportsQueue.add('export', job, { attempts: 2 });
  }

  async onModuleDestroy(): Promise<void> {
    for (const w of this.workers) await w.close().catch(() => undefined);
    await this.emailQueue?.close().catch(() => undefined);
    await this.exportsQueue?.close().catch(() => undefined);
    await this.outboxQueue?.close().catch(() => undefined);
    await this.webhooksQueue?.close().catch(() => undefined);
  }
}
