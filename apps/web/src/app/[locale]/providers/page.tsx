"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@eserp/ui";
import { providersApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";

export default function ProvidersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [amount, setAmount] = useState("11500");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [chargeResult, setChargeResult] = useState<string | null>(null);
  const [smsResult, setSmsResult] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["providers-status"], queryFn: () => providersApi.status() });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));
  const status = query.data;

  const charge = useMutation({
    mutationFn: () => providersApi.simulateCharge({ amountMinor: Number(amount), currency: "SAR" }),
    onSuccess: (r) => setChargeResult(`${r.status} — ${r.transactionId} (${r.message})`),
    onError,
  });
  const sms = useMutation({
    mutationFn: () => providersApi.simulateSms({ to, message }),
    onSuccess: (r) => setSmsResult(`${r.status} — ${r.messageId} (mock — no SMS sent)`),
    onError,
  });

  const row = (label: string, value: { provider: string; simulated: boolean; configured: boolean; note: string }) => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b py-3 last:border-0">
      <div>
        <p className="font-medium">{label}</p>
        <p className="text-sm text-muted-foreground">{value.note}</p>
      </div>
      <div className="flex gap-2">
        <Badge>{value.provider}</Badge>
        {value.simulated && <Badge>{t("integrations.mock")}</Badge>}
        <Badge>{value.configured ? t("integrations.configured") : t("integrations.notConfigured")}</Badge>
      </div>
    </div>
  );

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("integrations.providers")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("integrations.providerStatus")}</CardTitle></CardHeader>
          <CardContent>
            {status && (
              <>
                {row("Payment", status.payment)}
                {row("SMS", status.sms)}
                {row("ZATCA", { provider: status.zatca.mode, simulated: status.zatca.mode === "simulation", configured: status.zatca.configured, note: status.zatca.note })}
                {row("AI", { ...status.ai, configured: false })}
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("integrations.simulateCharge")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("integrations.amount")}</Label><Input className="w-56" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <Button className="self-end" disabled={charge.isPending} onClick={() => charge.mutate()}>{t("integrations.simulateCharge")}</Button>
            {chargeResult && <p className="self-end text-sm">{chargeResult}</p>}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("integrations.simulateSms")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("integrations.to")}</Label><Input className="w-56" value={to} onChange={(e) => setTo(e.target.value)} placeholder="+9665…" /></div>
            <div className="space-y-1"><Label>{t("integrations.message")}</Label><Input className="w-80" value={message} onChange={(e) => setMessage(e.target.value)} /></div>
            <Button className="self-end" disabled={sms.isPending || !to || !message} onClick={() => sms.mutate()}>{t("integrations.simulateSms")}</Button>
            {smsResult && <p className="self-end text-sm">{smsResult}</p>}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
