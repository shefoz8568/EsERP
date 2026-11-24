import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { parse } from 'csv-parse/sync';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { onboardingStepData } from '@eserp/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TOTAL_STEPS = 7; // 0..6

@Injectable()
export class OnboardingService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService, @Inject(AuditService) private readonly audit: AuditService, @Inject(QueueService) private readonly queue: QueueService) {}

  async get(tenantId: string) {
    const state = await this.prisma.withTenant(tenantId, (tx) => tx.onboardingState.findUnique({ where: { tenantId } }));
    if (!state) throw new NotFoundException('Onboarding state not found');
    return { ...state, totalSteps: TOTAL_STEPS };
  }

  async submitStep(tenantId: string, actorId: string, step: number, data: Record<string, unknown>) {
    const schema = onboardingStepData[step];
    if (!schema) throw new BadRequestException(`Unknown onboarding step ${step}`);
    const validated = schema.parse(data);
    const state = await this.prisma.withTenant(tenantId, (tx) => tx.onboardingState.findUnique({ where: { tenantId } }));
    if (!state) throw new NotFoundException('Onboarding state not found');

    const result = await this.prisma.withTenant(tenantId, async (tx) => {
      // Step-specific side effects, all inside the same transaction.
      if (step === 0) {
        await tx.companyProfile.upsert({ where: { tenantId }, update: validated as any, create: { tenantId, ...(validated as any) } });
      }
      if (step === 1) {
        const v = validated as { fiscalYearStartMonth: number; calendarType: string };
        await tx.tenant.update({ where: { id: tenantId }, data: { fiscalYearStartMonth: v.fiscalYearStartMonth, calendarType: v.calendarType } });
      }
      if (step === 2) {
        const v = validated as { template: string };
        if (v.template === 'saudi') await this.applySaudiCoa(tx, tenantId);
      }
      if (step === 3) {
        const v = validated as { taxes?: { name: string; rateBps: number; type?: string; isInclusive?: boolean; isDefault?: boolean }[] };
        for (const t of v.taxes ?? []) {
          await tx.taxRate.upsert({ where: { name_tenantId: { name: t.name, tenantId } }, update: t, create: { tenantId, ...t } });
        }
      }
      if (step === 4) {
        await tx.warehouse.create({ data: { tenantId, ...(validated as any) } });
      }
      if (step === 5) {
        const v = validated as { invites?: { email: string; roleNames: string[] }[] };
        for (const invite of v.invites ?? []) {
          const token = randomUUID();
          await tx.invitation.upsert({
            where: { email_tenantId: { email: invite.email, tenantId } },
            update: { roleNames: invite.roleNames },
            create: { tenantId, email: invite.email, roleNames: invite.roleNames, tokenHash: await argon2.hash(token), invitedById: actorId, expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000) },
          });
        }
      }
      if (step === 6) {
        // Import preview only — validated in previewCsv(), nothing stored here.
      }
      const completed = new Set<number>([...(state.stepsCompleted as number[]), step]);
      const updated = await tx.onboardingState.update({
        where: { tenantId },
        data: { currentStep: Math.max(state.currentStep, step + 1), stepsCompleted: [...completed].sort((a, b) => a - b) },
      });
      await this.audit.log({ tenantId, actorId, action: `onboarding:step:${step}`, entityType: 'OnboardingState', entityId: state.id, after: validated }, tx as any);
      return updated;
    });

    if (step === 5) {
      const invites = (data.invites as { email: string }[] | undefined) ?? [];
      for (const invite of invites) {
        await this.queue.queueEmail({ to: invite.email, subject: 'You are invited to EsERP', text: 'You have been invited to join EsERP. Please check your inbox for the invitation link.' });
      }
    }
    return { ...result, totalSteps: TOTAL_STEPS };
  }

  /** CSV import preview: parse server-side, validate rows, never store invalid rows. */
  previewCsv(csvText: string): { rows: number; valid: number; errors: { row: number; message: string }[]; preview: Record<string, string>[] } {
    let records: Record<string, string>[];
    try {
      records = parse(csvText, { columns: true, skip_empty_lines: true, trim: true }) as Record<string, string>[];
    } catch (err) {
      throw new BadRequestException(`CSV parse error: ${(err as Error).message}`);
    }
    const errors: { row: number; message: string }[] = [];
    const preview: Record<string, string>[] = [];
    records.forEach((row, i) => {
      const rowNo = i + 2; // header is row 1
      if (!row.name && !row.code) { errors.push({ row: rowNo, message: 'Row must have a name or code' }); return; }
      if (row.amount !== undefined && row.amount !== '' && !/^-?\d+(\.\d+)?$/.test(row.amount)) {
        errors.push({ row: rowNo, message: `Invalid amount: ${row.amount}` }); return;
      }
      preview.push(row);
    });
    return { rows: records.length, valid: preview.length, errors, preview: preview.slice(0, 10) };
  }

  async complete(tenantId: string, actorId: string) {
    const state = await this.prisma.withTenant(tenantId, (tx) => tx.onboardingState.findUnique({ where: { tenantId } }));
    if (!state) throw new NotFoundException('Onboarding state not found');
    const done = new Set(state.stepsCompleted as number[]);
    for (let s = 0; s <= 4; s++) {
      if (!done.has(s)) throw new BadRequestException(`Onboarding step ${s} is not complete yet`);
    }
    return this.prisma.withTenant(tenantId, async (tx) => {
      const updated = await tx.onboardingState.update({ where: { tenantId }, data: { completedAt: new Date(), currentStep: TOTAL_STEPS } });
      await this.audit.log({ tenantId, actorId, action: 'onboarding:complete', entityType: 'OnboardingState', entityId: state.id }, tx as any);
      return updated;
    });
  }

  private async applySaudiCoa(tx: any, tenantId: string): Promise<void> {
    // CoA JSON lives in @eserp/db; resolve relative to this file's package.
    // In the compiled app __dirname is apps/api/dist/modules/onboarding, so
    // the repo-root candidate is 5 levels up from there; in ts-node/vitest
    // runs it is apps/api/src/modules/onboarding (4 levels up). The
    // process.cwd() fallback covers running from the monorepo root.
    const here = __dirname;
    const candidates = [
      join(here, '..', '..', '..', '..', '..', 'packages', 'db', 'prisma', 'data', 'saudi-coa.json'),
      join(here, '..', '..', '..', '..', 'packages', 'db', 'prisma', 'data', 'saudi-coa.json'),
      join(process.cwd(), 'packages', 'db', 'prisma', 'data', 'saudi-coa.json'),
    ];
    let coa: { code: string; nameAr: string; nameEn: string; type: string; parentCode: string | null }[] | null = null;
    for (const c of candidates) {
      try { coa = JSON.parse(readFileSync(c, 'utf-8')); break; } catch { /* try next */ }
    }
    if (!coa) throw new BadRequestException('Saudi CoA template not found');
    const ids = new Map<string, string>();
    for (const pass of [coa.filter((a) => !a.parentCode), coa.filter((a) => a.parentCode)]) {
      for (const a of pass) {
        const row = await tx.chartOfAccounts.upsert({
          where: { code_tenantId: { code: a.code, tenantId } },
          update: { nameAr: a.nameAr, nameEn: a.nameEn, type: a.type, parentId: a.parentCode ? ids.get(a.parentCode) ?? null : null, isSystem: true },
          create: { tenantId, code: a.code, nameAr: a.nameAr, nameEn: a.nameEn, type: a.type, parentId: a.parentCode ? ids.get(a.parentCode) ?? null : null, isSystem: true },
        });
        ids.set(a.code, row.id);
      }
    }
  }
}
