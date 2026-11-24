"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eserp/ui";
import { accountingApi, asList } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";

export default function GeneralLedgerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const year = new Date().getFullYear();
  const [accountId, setAccountId] = useState("");
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const accounts = useQuery({ queryKey: ["chart-of-accounts"], queryFn: () => accountingApi.listChartOfAccounts() });
  const accountList = asList(accounts.data).filter((a) => a.isPosting);
  const selected = accountId || accountList[0]?.id || "";
  const ledger = useQuery({
    queryKey: ["general-ledger", selected, from, to],
    queryFn: () => accountingApi.generalLedger(selected, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`),
    enabled: Boolean(selected),
  });

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("accounting.generalLedger")}</h1>
        <Card>
          <CardContent className="flex flex-wrap gap-4 pt-6">
            <div className="space-y-1">
              <Label>{t("accounting.account")}</Label>
              <Select value={selected} onValueChange={setAccountId}>
                <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {accountList.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.code} — {locale === "ar" ? a.nameAr : a.nameEn}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("accounting.from")}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("accounting.to")}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          </CardContent>
        </Card>
        {ledger.isError ? (
          <ErrorState onRetry={() => void ledger.refetch()} />
        ) : ledger.data ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {ledger.data.account.code} — {locale === "ar" ? ledger.data.account.nameAr : ledger.data.account.nameEn}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm">
                {t("accounting.opening")}: <strong>{formatMoney(ledger.data.openingNetMinor, "SAR", locale)}</strong>
                {" · "}
                {t("accounting.closing")}: <strong>{formatMoney(ledger.data.closingNetMinor, "SAR", locale)}</strong>
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-start">
                    <th className="py-2 text-start font-medium">{t("accounting.entryDate")}</th>
                    <th className="py-2 text-start font-medium">{t("accounting.number")}</th>
                    <th className="py-2 text-start font-medium">{t("accounting.description")}</th>
                    <th className="py-2 text-end font-medium">{t("accounting.debit")}</th>
                    <th className="py-2 text-end font-medium">{t("accounting.credit")}</th>
                    <th className="py-2 text-end font-medium">{t("accounting.runningBalance")}</th>
                  </tr>
                </thead>
                <tbody>
                  {ledger.data.lines.map((l, i) => (
                    <tr key={i} className="border-b">
                      <td className="py-2">{l.entryDate.slice(0, 10)}</td>
                      <td className="py-2">{l.entryNumber}</td>
                      <td className="py-2">{l.description ?? "—"}</td>
                      <td className="py-2 text-end">{formatMoney(l.debitMinor, "SAR", locale)}</td>
                      <td className="py-2 text-end">{formatMoney(l.creditMinor, "SAR", locale)}</td>
                      <td className="py-2 text-end font-medium">{formatMoney(l.runningBalanceMinor, "SAR", locale)}</td>
                    </tr>
                  ))}
                  {ledger.data.lines.length === 0 && (
                    <tr><td colSpan={6} className="py-4 text-center text-muted-foreground">{t("common.noData")}</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        )}
      </div>
    </AppShell>
  );
}
