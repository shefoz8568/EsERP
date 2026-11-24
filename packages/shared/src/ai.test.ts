import { describe, expect, it } from 'vitest';
import { buildRuleInsights, formatMinor, matchIntent, RuleBasedProvider } from './ai.js';

describe('AI intent matcher', () => {
  it('matches known questions (en + ar)', () => {
    expect(matchIntent('What was our revenue this month?')).toBe('revenue');
    expect(matchIntent('ما هي الإيرادات هذا الشهر؟')).toBe('revenue');
    expect(matchIntent('How much do customers owe us?')).toBe('ar');
    expect(matchIntent('Which invoices are overdue?')).toBe('ar');
    expect(matchIntent('What do we owe suppliers?')).toBe('ap');
    expect(matchIntent('Which items are low on stock?')).toBe('stock');
    expect(matchIntent('ما هو المخزون المنخفض؟')).toBe('stock');
    expect(matchIntent('What is our payroll cost?')).toBe('payroll');
    expect(matchIntent('Who are our top customers?')).toBe('topCustomers');
    expect(matchIntent('What are our top items by revenue?')).toBe('topItems');
    expect(matchIntent('Show sales by month')).toBe('salesByMonth');
    expect(matchIntent('What is our gross margin?')).toBe('grossProfit');
  });

  it('unknown questions fall through to unknown', () => {
    expect(matchIntent('What is the weather tomorrow?')).toBe('unknown');
    expect(matchIntent('Tell me a joke')).toBe('unknown');
    expect(matchIntent('')).toBe('unknown');
  });
});

describe('rule-based insights', () => {
  it('reports overdue invoices, low stock, margin fall and payroll share from real aggregates', () => {
    const insights = buildRuleInsights({
      overdueInvoices: { count: 3, totalMinor: 123_456n },
      lowStockCount: 2,
      grossMarginBps: 4_000,
      previousGrossMarginBps: 5_000,
      payrollMinor: 400_000n,
      revenueMinor: 1_000_000n,
      openPurchaseOrdersMinor: 0n,
      openArMinor: 500_000n,
      openApMinor: 200_000n,
    });
    const byId = new Map(insights.map((i) => [i.id, i]));
    expect(byId.get('overdue-invoices')?.detail).toContain('3 invoice(s) overdue');
    expect(byId.get('low-stock')?.detail).toContain('2 item(s)');
    expect(byId.get('gross-margin')?.detail).toContain('fell');
    expect(byId.get('payroll-share')?.detail).toContain('40.0%');
    expect(insights.every((i) => i.source === 'rule-based')).toBe(true);
  });

  it('returns an all-clear card when there is nothing to flag', () => {
    const insights = buildRuleInsights({
      overdueInvoices: { count: 0, totalMinor: 0n },
      lowStockCount: 0,
      grossMarginBps: null,
      previousGrossMarginBps: null,
      payrollMinor: 0n,
      revenueMinor: 0n,
      openPurchaseOrdersMinor: 0n,
      openArMinor: 0n,
      openApMinor: 0n,
    });
    expect(insights).toHaveLength(1);
    expect(insights[0].id).toBe('all-clear');
  });

  it('formats minor units without floats', () => {
    expect(formatMinor(1_234_567n)).toBe('SAR 12,345.67');
    expect(formatMinor(-500n)).toBe('SAR -5.00');
    expect(formatMinor(0n)).toBe('SAR 0.00');
  });

  it('RuleBasedProvider never fabricates: it echoes the computed insights', async () => {
    const provider = new RuleBasedProvider();
    expect(provider.name).toBe('rule-based');
    const text = await provider.summarize('summarise', {
      insights: [{ title: 'Overdue invoices', detail: '2 invoice(s) overdue totalling SAR 10.00.' }],
    });
    expect(text).toContain('2 invoice(s) overdue');
    expect(await provider.summarize('summarise', { insights: [] })).toContain('No notable insights');
  });
});
