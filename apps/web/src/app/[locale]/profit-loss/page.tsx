"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { accountingApi, analyticsApi, asList } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";

export default function ProfitLossPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const periods = useQuery({ queryKey: ["fiscal-periods"], queryFn: () => accountingApi.listPeriods({ pageSize: 100 }) });
  const periodList = asList(periods.data);
  const [periodId, setPeriodId] = useState("");
  const selected = periodId || periodList.find((p) => p.status === "OPEN")?.id || "";
  const pl = useQuery({ queryKey: ["profit-loss", selected], queryFn: () => analyticsApi.profitLoss({ fiscalPeriodId: selected }), enabled: Boolean(selected) });
  const d = pl.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("analytics.profitLoss")}</h1>
        {pl.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardContent className="flex flex-wrap gap-4 pt-6">
            <div className="space-y-1"><Label>{t("hr.period")}</Label>
              <Select value={selected} onValueChange={setPeriodId}>
                <SelectTrigger className="w-64"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{periodList.map((p) => <SelectItem key={p.id} value={p.id}>{p.fiscalYear}-{String(p.periodNumber).padStart(2, "0")} ({p.status})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button variant="outline" className="self-end" disabled={!selected} onClick={() => { void analyticsApi.downloadExport("profit-loss", { fiscalPeriodId: selected }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : t("common.error"))); }}>{t("analytics.downloadCsv")}</Button>
          </CardContent>
        </Card>
        {d && (
          <Card>
            <CardHeader><CardTitle>{t("analytics.profitLoss")}</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2">
                <div className="flex justify-between"><dt>{t("analytics.revenue")}</dt><dd className="font-medium">{formatMoney(d.revenueMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.cogs")}</dt><dd className="font-medium">{formatMoney(d.cogsMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between border-t pt-2"><dt className="font-bold">{t("analytics.grossProfit")}</dt><dd className="font-bold">{formatMoney(d.grossProfitMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.operatingExpenses")}</dt><dd className="font-medium">{formatMoney(d.operatingExpensesMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between border-t pt-2"><dt className="font-bold">{t("analytics.netIncome")}</dt><dd className="font-bold">{formatMoney(d.netIncomeMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between text-sm text-muted-foreground"><dt>{t("analytics.grossMargin")}</dt><dd>{d.grossMarginBps === null ? "—" : `${(d.grossMarginBps / 100).toFixed(1)}%`}</dd></div>
              </dl>
              <table className="mt-6 w-full text-sm">
                <thead><tr className="border-b text-start"><th className="py-2 text-start">{t("common.name")}</th><th className="py-2 text-end">Debit</th><th className="py-2 text-end">Credit</th></tr></thead>
                <tbody>
                  {d.accounts.map((a) => (
                    <tr key={a.accountCode} className="border-b">
                      <td className="py-2">{a.accountCode} — {a.accountName} ({a.accountType})</td>
                      <td className="py-2 text-end">{formatMoney(a.debitMinor, "SAR", locale)}</td>
                      <td className="py-2 text-end">{formatMoney(a.creditMinor, "SAR", locale)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
