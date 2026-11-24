/**
 * Phase 11 — provider interfaces + mocks (bring-your-own-credentials).
 *
 * Only MOCK providers ship. They never call a live service and every
 * response is labelled `simulated: true` / `provider: 'mock'`:
 * - `MockPaymentProvider`: deterministic charge/refund results (transaction
 *   id derived from the input hash, so the same input always yields the
 *   same id). Real Saudi gateways (Moyasar / HyperPay) are documented as
 *   env-var config in `.env.example` and in docs/erd-phase11.md — wiring a
 *   real gateway means implementing `PaymentGateway` against its API and
 *   selecting it when its key is configured; until then the mock answers.
 * - `MockSmsProvider`: logs the message as an outbox event (`sms.sent`,
 *   simulated) and returns a mock message id. No SMS is ever sent.
 */
import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PaymentChargeInput, PaymentGateway, PaymentResult, SmsInput, SmsProvider, SmsResult } from '@eserp/shared';
import type { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../queue/outbox.service';

export class MockPaymentProvider implements PaymentGateway {
  readonly name = 'mock';

  private deterministicId(prefix: string, input: unknown): string {
    return `${prefix}_${createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 16)}`;
  }

  async charge(input: PaymentChargeInput): Promise<PaymentResult> {
    return {
      provider: 'mock',
      simulated: true,
      status: 'succeeded',
      transactionId: this.deterministicId('mock_txn', input),
      amountMinor: Number(input.amountMinor),
      currency: input.currency,
      message: 'Simulated charge — no live payment was made (mock provider).',
    };
  }

  async refund(transactionId: string, amountMinor: bigint | number): Promise<PaymentResult> {
    return {
      provider: 'mock',
      simulated: true,
      status: 'succeeded',
      transactionId: this.deterministicId('mock_ref', { transactionId, amountMinor: Number(amountMinor) }),
      amountMinor: Number(amountMinor),
      currency: 'SAR',
      message: 'Simulated refund — no live refund was made (mock provider).',
    };
  }
}

export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock';

  async send(input: SmsInput): Promise<SmsResult> {
    return {
      provider: 'mock',
      simulated: true,
      status: 'queued',
      messageId: `mock_sms_${randomBytes(4).toString('hex')}`,
    };
  }
}

@Injectable()
export class ProvidersService {
  private readonly payment = new MockPaymentProvider();
  private readonly sms = new MockSmsProvider();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(ConfigService) private readonly config: ConfigService<AppConfig>,
  ) {}

  status() {
    const providers = this.config.get<AppConfig['providers']>('providers');
    const zatca = this.config.get<AppConfig['zatca']>('zatca');
    return {
      payment: {
        provider: 'mock',
        simulated: true,
        configured: Boolean(providers?.moyasarKey || (providers?.hyperpayUserId && providers?.hyperpayToken)),
        configuredGateways: [
          ...(providers?.moyasarKey ? ['moyasar'] : []),
          ...(providers?.hyperpayUserId && providers?.hyperpayToken ? ['hyperpay'] : []),
        ],
        note: 'Mock provider active. Set MOYASAR_API_KEY or HyperPay credentials to enable a real gateway (see docs/erd-phase11.md).',
      },
      sms: {
        provider: 'mock',
        simulated: true,
        configured: Boolean(providers?.smsApiKey),
        note: 'Mock provider active — messages are logged, never sent. Set SMS_API_KEY to enable a real SMS provider.',
      },
      zatca: {
        mode: zatca?.mode ?? 'simulation',
        configured: Boolean(zatca?.complianceCsid && zatca?.secret),
        note: 'Simulation is the default. Set ZATCA_MODE=sandbox with ZATCA_COMPLIANCE_CSID/ZATCA_SECRET for sandbox calls; production clearance needs tenant onboarding.',
      },
      ai: { provider: 'rule-based', simulated: false, note: 'Deterministic rule-based insights (Phase 10).' },
    };
  }

  charge(input: PaymentChargeInput): Promise<PaymentResult> {
    return this.payment.charge(input);
  }

  refund(transactionId: string, amountMinor: bigint | number): Promise<PaymentResult> {
    return this.payment.refund(transactionId, amountMinor);
  }

  async sendSms(tenantId: string, actorId: string, input: SmsInput): Promise<SmsResult> {
    const result = await this.sms.send(input);
    await this.prisma.withTenant(tenantId, (tx) =>
      this.outbox.publish(tx as never, {
        tenantId, eventType: 'sms.sent', aggregateId: result.messageId,
        payload: { to: input.to, messageId: result.messageId, simulated: true }, createdBy: actorId,
      }),
    );
    return result;
  }
}
