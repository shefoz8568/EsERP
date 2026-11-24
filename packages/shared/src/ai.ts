/**
 * Phase 10 — AI insights: provider-agnostic interface + rule-based fallback.
 *
 * There is NO Phase 0 AI interface in the repo (searched 2026-11-24: the
 * only "provider" mentions are OAuth providers) — this module IS the
 * provider interface, introduced in Phase 10 (see docs/erd-phase10.md).
 *
 * `AiProvider` is the single seam for a future LLM: `summarize(prompt,
 * data)` returns text. Exactly ONE adapter is shipped — `RuleBasedProvider`
 * — which never calls any external service and never fabricates text: it
 * formats deterministic insights computed from real aggregates. A real LLM
 * adapter may be added later by implementing `AiProvider` and selecting it
 * when a key is configured (`AI_PROVIDER` / `AI_API_KEY`); until then
 * every response is labelled `source: 'rule-based'`.
 *
 * `POST /ai/ask` answers ONLY from computed aggregates via a small intent
 * matcher (`matchIntent`, English + Arabic keywords). Unknown questions get
 * the fallback response — never a hallucinated number.
 */

export type AiSource = 'rule-based' | string;

export interface AiProvider {
  /** Provider name used as the response `source` label (e.g. 'rule-based'). */
  readonly name: string;
  /** Summarise structured data into short insight text. Must never invent numbers. */
  summarize(prompt: string, data: Record<string, unknown>): Promise<string>;
}

/** The shipped provider: deterministic, offline, no key required. */
export class RuleBasedProvider implements AiProvider {
  readonly name = 'rule-based';
  async summarize(prompt: string, data: Record<string, unknown>): Promise<string> {
    const lines = (data.insights as { title: string; detail: string }[] | undefined) ?? [];
    if (lines.length === 0) return 'No notable insights in the current data.';
    return lines.map((i) => `${i.title}: ${i.detail}`).join('\n');
  }
}

export type AiIntent =
  | 'revenue'
  | 'grossProfit'
  | 'ar'
  | 'ap'
  | 'stock'
  | 'payroll'
  | 'topCustomers'
  | 'topItems'
  | 'salesByMonth'
  | 'unknown';

/** Keyword intent matcher (English + Arabic). Order matters: specific intents first. */
export function matchIntent(question: string): AiIntent {
  const q = question.toLowerCase();
  const has = (...words: string[]): boolean => words.some((w) => q.includes(w));
  if (has('top customer', 'best customer', 'أفضل عميل', 'أعلى عميل', 'أكبر عميل', 'top customers')) return 'topCustomers';
  if (has('top item', 'best item', 'best-selling', 'best selling', 'أفضل منتج', 'أعلى منتج', 'الأكثر مبيع')) return 'topItems';
  if (has('sales by month', 'monthly sales', 'revenue by month', 'المبيعات الشهرية', 'المبيعات حسب الشهر', 'الإيرادات الشهرية')) return 'salesByMonth';
  if (has('gross profit', 'gross margin', 'margin', 'هامش الربح', 'الربح الإجمالي', 'إجمالي الربح')) return 'grossProfit';
  if (has('receivable', 'owed to us', 'customers owe', 'overdue', 'المدينون', 'الذمم المدينة', 'مستحقات العملاء', 'الفواتير المتأخرة', 'المتأخرات')) return 'ar';
  if (has('payable', 'we owe', 'suppliers owe', 'الدائنون', 'الذمم الدائنة', 'مستحقات الموردين')) return 'ap';
  if (has('stock', 'inventory', 'low stock', 'reorder', 'المخزون', 'المخزون المنخفض', 'نفاد')) return 'stock';
  if (has('payroll', 'salary', 'salaries', 'wages', 'الرواتب', 'مسيرات الرواتب', 'الأجور')) return 'payroll';
  if (has('revenue', 'sales', 'income', 'الإيرادات', 'المبيعات', 'الدخل')) return 'revenue';
  return 'unknown';
}

/** The questions the ask endpoint can answer (shown in the fallback). */
export const AI_ASK_TOPICS =
  'revenue, gross profit / margin, accounts receivable, accounts payable, stock, payroll, top customers, top items, or sales by month';

export interface RuleInsightInput {
  overdueInvoices: { count: number; totalMinor: bigint | number };
  lowStockCount: number;
  grossMarginBps: number | null;
  previousGrossMarginBps: number | null;
  payrollMinor: bigint | number;
  revenueMinor: bigint | number;
  openPurchaseOrdersMinor: bigint | number;
  openArMinor: bigint | number;
  openApMinor: bigint | number;
}

export interface AiInsight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  source: AiSource;
}

/** Format minor units as "SAR 12,345.67" using integer math only. */
export function formatMinor(minor: bigint | number, currency = 'SAR'): string {
  const v = typeof minor === 'bigint' ? minor : BigInt(minor);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const whole = abs / 100n;
  const frac = abs % 100n;
  return `${currency} ${sign}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${frac.toString().padStart(2, '0')}`;
}

/** Deterministic insight cards computed from real aggregates — no LLM text. */
export function buildRuleInsights(input: RuleInsightInput): AiInsight[] {
  const insights: AiInsight[] = [];
  const revenue = typeof input.revenueMinor === 'bigint' ? input.revenueMinor : BigInt(input.revenueMinor);
  const payroll = typeof input.payrollMinor === 'bigint' ? input.payrollMinor : BigInt(input.payrollMinor);
  if (input.overdueInvoices.count > 0) {
    insights.push({
      id: 'overdue-invoices',
      severity: 'warning',
      title: 'Overdue invoices',
      detail: `${input.overdueInvoices.count} invoice(s) overdue totalling ${formatMinor(input.overdueInvoices.totalMinor)}.`,
      source: 'rule-based',
    });
  }
  if (input.lowStockCount > 0) {
    insights.push({
      id: 'low-stock',
      severity: 'warning',
      title: 'Low stock',
      detail: `${input.lowStockCount} item(s) at or below reorder point.`,
      source: 'rule-based',
    });
  }
  if (input.grossMarginBps !== null && input.previousGrossMarginBps !== null) {
    const fell = input.grossMarginBps < input.previousGrossMarginBps;
    insights.push({
      id: 'gross-margin',
      severity: fell ? 'warning' : 'info',
      title: 'Gross margin',
      detail: fell
        ? `Gross margin fell to ${(input.grossMarginBps / 100).toFixed(1)}% from ${(input.previousGrossMarginBps / 100).toFixed(1)}% last month.`
        : `Gross margin is ${(input.grossMarginBps / 100).toFixed(1)}%, up from ${(input.previousGrossMarginBps / 100).toFixed(1)}% last month.`,
      source: 'rule-based',
    });
  }
  if (revenue > 0n && payroll > 0n) {
    const pct = Number((payroll * 10_000n) / revenue) / 100;
    insights.push({
      id: 'payroll-share',
      severity: payroll * 100n > revenue * 50n ? 'warning' : 'info',
      title: 'Payroll share of revenue',
      detail: `Payroll is ${pct.toFixed(1)}% of revenue this month (${formatMinor(payroll)} of ${formatMinor(revenue)}).`,
      source: 'rule-based',
    });
  }
  if (input.openArMinor !== 0n && input.openApMinor !== 0n) {
    const ar = typeof input.openArMinor === 'bigint' ? input.openArMinor : BigInt(input.openArMinor);
    const ap = typeof input.openApMinor === 'bigint' ? input.openApMinor : BigInt(input.openApMinor);
    insights.push({
      id: 'working-capital',
      severity: 'info',
      title: 'Working capital',
      detail: `Open receivables ${formatMinor(ar)} vs open payables ${formatMinor(ap)}.`,
      source: 'rule-based',
    });
  }
  if (input.openPurchaseOrdersMinor !== 0n) {
    insights.push({
      id: 'open-pos',
      severity: 'info',
      title: 'Open purchase orders',
      detail: `Open purchase orders total ${formatMinor(input.openPurchaseOrdersMinor)}.`,
      source: 'rule-based',
    });
  }
  if (insights.length === 0) {
    insights.push({
      id: 'all-clear',
      severity: 'info',
      title: 'All clear',
      detail: 'No overdue invoices, no low-stock items, and no margin or payroll warnings in the current data.',
      source: 'rule-based',
    });
  }
  return insights;
}
