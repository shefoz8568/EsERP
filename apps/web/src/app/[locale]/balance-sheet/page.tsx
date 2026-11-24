"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@eserp/ui";
import { analyticsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";

export default function BalanceSheetPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const bs = useQuery({ queryKey: ["balance-sheet", asOf], queryFn: () => analyticsApi.balanceSheet(`${asOf}T00:00:00.000Z`) });
  const d = bs.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("analytics.balanceSheet")}</h1>
        {bs.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardContent className="flex flex-wrap gap-4 pt-6">
            <div className="space-y-1"><Label>{t("projects.date")}</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} /></div>
            <Button variant="outline" className="self-end" onClick={() => { void analyticsApi.downloadExport("balance-sheet", { asOf: `${asOf}T00:00:00.000Z` }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : t("common.error"))); }}>{t("analytics.downloadCsv")}</Button>
          </CardContent>
        </Card>
        {d && (
          <Card>
            <CardHeader><CardTitle>{t("analytics.balanceSheet")}</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2">
                <div className="flex justify-between"><dt className="font-bold">{t("analytics.assets")}</dt><dd className="font-bold">{formatMoney(d.assetsMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.liabilities")}</dt><dd>{formatMoney(d.liabilitiesMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.equity")}</dt><dd>{formatMoney(d.equityMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.netIncome")}</dt><dd>{formatMoney(d.netIncomeMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between border-t pt-2"><dt className="font-bold">{t("analytics.totalLiabilitiesEquity")}</dt><dd className="font-bold">{formatMoney(d.totalLiabilitiesEquityMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between text-sm text-muted-foreground"><dt>{t("analytics.balanced")}</dt><dd>{d.balanced ? t("common.yes") : `${t("common.no")} (${t("analytics.difference")}: ${formatMoney(d.differenceMinor, "SAR", locale)})`}</dd></div>
              </dl>
              <table className="mt-6 w-full text-sm">
                <thead><tr className="border-b"><th className="py-2 text-start">{t("common.name")}</th><th className="py-2 text-end">Balance</th></tr></thead>
                <tbody>
                  {d.accounts.map((a) => (
                    <tr key={a.accountCode} className="border-b">
                      <td className="py-2">{a.accountCode} — {a.accountName} ({a.accountType})</td>
                      <td className="py-2 text-end">{formatMoney(a.netDebitMinor, "SAR", locale)}</td>
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
