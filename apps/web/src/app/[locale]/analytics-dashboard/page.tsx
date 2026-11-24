"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use } from "react";
import { Banknote, Boxes, Hourglass, Receipt, Scale, ShoppingCart, TrendingUp, Users, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@eserp/ui";
import { aiApi, analyticsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { StatCard } from "@/components/StatCard";
import { formatMoney } from "@/lib/money";

/** Simple CSS bar chart (no charting dependency): monthly revenue bars. */
function SalesBarChart({ data, locale }: { data: { month: string; revenueMinor: number }[]; locale: string }) {
  const max = Math.max(1, ...data.map((d) => d.revenueMinor));
  return (
    <div className="flex h-40 items-end gap-2">
      {data.map((d) => (
        <div key={d.month} className="flex flex-1 flex-col items-center gap-1" title={`${d.month}: ${formatMoney(d.revenueMinor, "SAR", locale)}`}>
          <div className="w-full rounded-t bg-primary" style={{ height: `${Math.max(2, (d.revenueMinor / max) * 120)}px` }} />
          <span className="text-[10px] text-muted-foreground">{d.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsDashboardPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  const dash = useQuery({ queryKey: ["analytics-dashboard", year, month], queryFn: () => analyticsApi.dashboard(year, month) });
  const insights = useQuery({ queryKey: ["ai-insights"], queryFn: () => aiApi.insights() });
  const d = dash.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("analytics.dashboard")}</h1>
        {dash.isError && <ErrorState message={t("common.error")} />}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <StatCard title={t("analytics.revenue")} value={d ? formatMoney(d.revenueMinor, "SAR", locale) : "—"} icon={TrendingUp} loading={dash.isLoading} />
          <StatCard title={t("analytics.grossProfit")} value={d ? formatMoney(d.grossProfitMinor, "SAR", locale) : "—"} icon={Scale} loading={dash.isLoading} />
          <StatCard title={t("analytics.openAr")} value={d ? formatMoney(d.openArMinor, "SAR", locale) : "—"} icon={Receipt} loading={dash.isLoading} />
          <StatCard title={t("analytics.openAp")} value={d ? formatMoney(d.openApMinor, "SAR", locale) : "—"} icon={Receipt} loading={dash.isLoading} />
          <StatCard title={t("analytics.stockValue")} value={d ? formatMoney(d.stockValueMinor, "SAR", locale) : "—"} icon={Boxes} loading={dash.isLoading} />
          <StatCard title={t("analytics.lowStock")} value={d ? String(d.lowStockCount) : "—"} icon={Hourglass} loading={dash.isLoading} />
          <StatCard title={t("analytics.openPurchaseOrders")} value={d ? formatMoney(d.openPurchaseOrdersMinor, "SAR", locale) : "—"} icon={ShoppingCart} loading={dash.isLoading} />
          <StatCard title={t("analytics.payrollCost")} value={d ? formatMoney(d.payrollCostMinor, "SAR", locale) : "—"} icon={Wallet} loading={dash.isLoading} />
        </div>
        {d && (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>{t("analytics.salesByMonth")}</CardTitle></CardHeader>
                <CardContent><SalesBarChart data={d.salesByMonth} locale={locale} /></CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>{t("analytics.grossMargin")}</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  <div className="text-3xl font-bold">{d.grossMarginBps === null ? "—" : `${(d.grossMarginBps / 100).toFixed(1)}%`}</div>
                  <div className="text-sm text-muted-foreground">{t("analytics.previousRevenue")}: {formatMoney(d.previousRevenueMinor, "SAR", locale)}</div>
                  <div className="text-sm text-muted-foreground">{t("analytics.overdueAr")}: {formatMoney(d.overdueArMinor, "SAR", locale)} · {t("analytics.overdueAp")}: {formatMoney(d.overdueApMinor, "SAR", locale)}</div>
                  <div className="text-sm text-muted-foreground">{t("analytics.netIncome")}: {formatMoney(d.netIncomeMinor, "SAR", locale)}</div>
                </CardContent>
              </Card>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" />{t("analytics.topCustomers")}</CardTitle></CardHeader>
                <CardContent>
                  {d.topCustomers.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
                    <ul className="space-y-2">{d.topCustomers.map((c) => <li key={c.customerId} className="flex justify-between text-sm"><span>{c.name}</span><span className="font-medium">{formatMoney(c.revenueMinor, "SAR", locale)}</span></li>)}</ul>
                  )}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Banknote className="h-4 w-4" />{t("analytics.topItems")}</CardTitle></CardHeader>
                <CardContent>
                  {d.topItems.length === 0 ? <p className="text-sm text-muted-foreground">{t("common.noData")}</p> : (
                    <ul className="space-y-2">{d.topItems.map((i) => <li key={i.itemId} className="flex justify-between text-sm"><span>{i.name} ({i.sku})</span><span className="font-medium">{formatMoney(i.revenueMinor, "SAR", locale)}</span></li>)}</ul>
                  )}
                </CardContent>
              </Card>
            </div>
          </>
        )}
        {insights.data && insights.data.insights.length > 0 && (
          <Card>
            <CardHeader><CardTitle>{t("ai.insights")} · {insights.data.source}</CardTitle></CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {insights.data.insights.map((ins) => (
                  <li key={ins.id} className="text-sm"><span className="font-medium">{ins.title}:</span> {ins.detail}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
