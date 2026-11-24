"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@eserp/ui";
import { analyticsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";

export default function CashFlowPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const now = new Date();
  const [from, setFrom] = useState(`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const cf = useQuery({ queryKey: ["cash-flow", from, to], queryFn: () => analyticsApi.cashFlow({ from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` }) });
  const d = cf.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("analytics.cashFlow")}</h1>
        {cf.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardContent className="flex flex-wrap gap-4 pt-6">
            <div className="space-y-1"><Label>{t("projects.startDate")}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.dueDate")}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
            <Button variant="outline" className="self-end" onClick={() => { void analyticsApi.downloadExport("cash-flow", { from: `${from}T00:00:00.000Z`, to: `${to}T23:59:59.999Z` }).catch((e: unknown) => toast.error(e instanceof Error ? e.message : t("common.error"))); }}>{t("analytics.downloadCsv")}</Button>
          </CardContent>
        </Card>
        {d && (
          <Card>
            <CardHeader><CardTitle>{t("analytics.cashFlow")}</CardTitle></CardHeader>
            <CardContent>
              <dl className="space-y-2">
                <div className="flex justify-between"><dt>{t("analytics.netIncome")}</dt><dd>{formatMoney(d.netIncomeMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.operating")}</dt><dd>{formatMoney(d.operatingMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.investing")}</dt><dd>{formatMoney(d.investingMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.financing")}</dt><dd>{formatMoney(d.financingMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between border-t pt-2"><dt className="font-bold">{t("analytics.netChangeInCash")}</dt><dd className="font-bold">{formatMoney(d.netChangeInCashMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.openingCash")}</dt><dd>{formatMoney(d.openingCashMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between"><dt>{t("analytics.closingCash")}</dt><dd>{formatMoney(d.closingCashMinor, "SAR", locale)}</dd></div>
                <div className="flex justify-between text-sm text-muted-foreground"><dt>{t("analytics.balanced")}</dt><dd>{d.balanced ? t("common.yes") : `${t("common.no")} (${t("analytics.difference")}: ${formatMoney(d.differenceMinor, "SAR", locale)})`}</dd></div>
              </dl>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
