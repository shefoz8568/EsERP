"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eserp/ui";
import { accountingApi, asList } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";

const TYPE_ORDER = ["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"];

export default function TrialBalancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const periods = useQuery({ queryKey: ["fiscal-periods"], queryFn: () => accountingApi.listPeriods({ pageSize: 100 }) });
  const periodList = asList(periods.data);
  const [periodId, setPeriodId] = useState("");
  const selected = periodId || periodList.find((p) => p.status === "OPEN")?.id || "";
  const tb = useQuery({
    queryKey: ["trial-balance", selected],
    queryFn: () => accountingApi.trialBalance(selected),
    enabled: Boolean(selected),
  });
  const vat = useQuery({
    queryKey: ["vat-summary", selected],
    queryFn: () => accountingApi.vatSummary(selected),
    enabled: Boolean(selected),
  });
  const rows = tb.data?.rows ?? [];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("accounting.trialBalance")}</h1>
        <Card>
          <CardContent className="flex flex-wrap gap-4 pt-6">
            <div className="space-y-1">
              <Label>{t("accounting.period")}</Label>
              <Select value={selected} onValueChange={setPeriodId}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {periodList.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.fiscalYear}/{p.periodNumber} — {p.status}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {vat.data && (
              <div className="flex flex-wrap gap-6 text-sm">
                <span>{t("accounting.outputVat")}: <strong>{formatMoney(vat.data.outputVatMinor, "SAR", locale)}</strong></span>
                <span>{t("accounting.inputVat")}: <strong>{formatMoney(vat.data.inputVatMinor, "SAR", locale)}</strong></span>
                <span>{t("accounting.netVatPayable")}: <strong>{formatMoney(vat.data.netVatPayableMinor, "SAR", locale)}</strong></span>
              </div>
            )}
          </CardContent>
        </Card>
        {tb.isError ? (
          <ErrorState onRetry={() => void tb.refetch()} />
        ) : tb.data ? (
          TYPE_ORDER.map((type) => {
            const group = rows.filter((r) => r.accountType === type);
            if (group.length === 0) return null;
            return (
              <Card key={type}>
                <CardHeader><CardTitle>{type}</CardTitle></CardHeader>
                <CardContent>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-start">
                        <th className="py-2 text-start font-medium">{t("accounting.account")}</th>
                        <th className="py-2 text-end font-medium">{t("accounting.opening")} {t("accounting.debit")}</th>
                        <th className="py-2 text-end font-medium">{t("accounting.opening")} {t("accounting.credit")}</th>
                        <th className="py-2 text-end font-medium">{t("accounting.debit")}</th>
                        <th className="py-2 text-end font-medium">{t("accounting.credit")}</th>
                        <th className="py-2 text-end font-medium">{t("accounting.closing")} {t("accounting.debit")}</th>
                        <th className="py-2 text-end font-medium">{t("accounting.closing")} {t("accounting.credit")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((r) => (
                        <tr key={r.accountId} className="border-b">
                          <td className="py-2">{r.accountCode} — {r.accountName}</td>
                          <td className="py-2 text-end">{formatMoney(r.openingDebitMinor, "SAR", locale)}</td>
                          <td className="py-2 text-end">{formatMoney(r.openingCreditMinor, "SAR", locale)}</td>
                          <td className="py-2 text-end">{formatMoney(r.periodDebitMinor, "SAR", locale)}</td>
                          <td className="py-2 text-end">{formatMoney(r.periodCreditMinor, "SAR", locale)}</td>
                          <td className="py-2 text-end">{formatMoney(r.closingDebitMinor, "SAR", locale)}</td>
                          <td className="py-2 text-end">{formatMoney(r.closingCreditMinor, "SAR", locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            );
          })
        ) : (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
        {tb.data && (
          <Card>
            <CardContent className="flex flex-wrap gap-6 pt-6 text-sm">
              <span>{t("accounting.totalDebit")}: <strong>{formatMoney(tb.data.totals.closingDebitMinor, "SAR", locale)}</strong></span>
              <span>{t("accounting.totalCredit")}: <strong>{formatMoney(tb.data.totals.closingCreditMinor, "SAR", locale)}</strong></span>
              <span>{tb.data.totals.closingDebitMinor === tb.data.totals.closingCreditMinor ? "✓" : "✗"}</span>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
