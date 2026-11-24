/**
 * Phase 10 — AI insights / ask. Provider-agnostic: the `AiProvider`
 * interface lives in @eserp/shared and the ONLY shipped adapter is
 * `RuleBasedProvider` (deterministic, offline, no key). A real LLM adapter
 * can be added later by implementing `AiProvider` and selecting it when
 * `AI_PROVIDER` + `AI_API_KEY` are configured; until then every response
 * is labelled `source: 'rule-based'` and no text is ever fabricated.
 *
 * `ask` answers ONLY from computed aggregates via the intent matcher.
 * Unknown questions get the fallback — never a hallucinated number.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_ASK_TOPICS, buildRuleInsights, formatMinor, matchIntent, RuleBasedProvider } from '@eserp/shared';
import type { AiInsight, AiProvider } from '@eserp/shared';
import { AnalyticsService } from '../analytics/analytics.service';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly provider: AiProvider;

  constructor(
    @Inject(AnalyticsService) private readonly analytics: AnalyticsService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {
    const configured = this.config.get<string>('AI_PROVIDER');
    if (configured && configured !== 'rule-based') {
      // No LLM adapter is shipped in Phase 10 — fall back loudly, never fail.
      this.logger.warn(`AI_PROVIDER=${configured} has no adapter in this build; using the rule-based provider (no key required).`);
    }
    this.provider = new RuleBasedProvider();
  }

  async insights(tenantId: string): Promise<{ source: string; insights: AiInsight[]; summary: string }> {
    const now = new Date();
    const dash: any = await this.analytics.dashboard(tenantId, now.getUTCFullYear(), now.getUTCMonth() + 1);
    const overdue = await this.analytics.overdueAr(tenantId);
    const insights = buildRuleInsights({
      overdueInvoices: overdue,
      lowStockCount: dash.lowStockCount,
      grossMarginBps: dash.grossMarginBps,
      previousGrossMarginBps: dash.previousGrossMarginBps,
      payrollMinor: BigInt(dash.payrollCostMinor),
      revenueMinor: BigInt(dash.revenueMinor),
      openPurchaseOrdersMinor: BigInt(dash.openPurchaseOrdersMinor),
      openArMinor: BigInt(dash.openArMinor),
      openApMinor: BigInt(dash.openApMinor),
    });
    const summary = await this.provider.summarize('Summarise the dashboard insights.', { insights });
    return { source: this.provider.name, insights, summary };
  }

  async ask(tenantId: string, question: string): Promise<{ source: string; intent: string; answer: string }> {
    const intent = matchIntent(question);
    const now = new Date();
    const dash: any = await this.analytics.dashboard(tenantId, now.getUTCFullYear(), now.getUTCMonth() + 1);
    const source = this.provider.name;
    switch (intent) {
      case 'revenue':
        return { source, intent, answer: `Revenue this month is ${formatMinor(dash.revenueMinor)} (last month ${formatMinor(dash.previousRevenueMinor)}).` };
      case 'grossProfit':
        return { source, intent, answer: `Gross profit this month is ${formatMinor(dash.grossProfitMinor)} at a ${(dash.grossMarginBps === null ? 'n/a' : `${(dash.grossMarginBps / 100).toFixed(1)}%`)} margin (last month ${(dash.previousGrossMarginBps === null ? 'n/a' : `${(dash.previousGrossMarginBps / 100).toFixed(1)}%`)}).` };
      case 'ar': {
        const overdue = await this.analytics.overdueAr(tenantId);
        return { source, intent, answer: `Open receivables are ${formatMinor(dash.openArMinor)}, of which ${formatMinor(dash.overdueArMinor)} is overdue across ${overdue.count} invoice(s).` };
      }
      case 'ap':
        return { source, intent, answer: `Open payables are ${formatMinor(dash.openApMinor)}, of which ${formatMinor(dash.overdueApMinor)} is overdue.` };
      case 'stock':
        return { source, intent, answer: `Stock is valued at ${formatMinor(dash.stockValueMinor)} with ${dash.lowStockCount} item(s) at or below reorder point.` };
      case 'payroll':
        return { source, intent, answer: `Payroll cost this month is ${formatMinor(dash.payrollCostMinor)}.` };
      case 'topCustomers': {
        const list = (dash.topCustomers as any[]).map((c, i) => `${i + 1}. ${c.name} — ${formatMinor(c.revenueMinor)}`).join('; ');
        return { source, intent, answer: list ? `Top customers by revenue: ${list}.` : 'No posted sales invoices yet, so there are no top customers.' };
      }
      case 'topItems': {
        const list = (dash.topItems as any[]).map((c, i) => `${i + 1}. ${c.name} (${c.sku}) — ${formatMinor(c.revenueMinor)}`).join('; ');
        return { source, intent, answer: list ? `Top items by revenue: ${list}.` : 'No posted sales invoice lines yet, so there are no top items.' };
      }
      case 'salesByMonth': {
        const list = (dash.salesByMonth as any[]).map((m) => `${m.month}: ${formatMinor(m.revenueMinor)}`).join('; ');
        return { source, intent, answer: `Revenue by month (last 12 months): ${list}.` };
      }
      default:
        return {
          source,
          intent: 'unknown',
          answer: `I can only answer questions about ${AI_ASK_TOPICS}. Please ask about one of those.`,
        };
    }
  }
}
