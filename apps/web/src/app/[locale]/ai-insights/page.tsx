"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, toast } from "@eserp/ui";
import { aiApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";

export default function AiInsightsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<{ source: string; intent: string; answer: string } | null>(null);

  const insights = useQuery({ queryKey: ["ai-insights"], queryFn: () => aiApi.insights() });
  const ask = useMutation({
    mutationFn: () => aiApi.ask(question),
    onSuccess: (res) => { setAnswer(res); },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("ai.insights")}</h1>
        {insights.isError && <ErrorState message={t("common.error")} />}
        {insights.data && (
          <Card>
            <CardHeader><CardTitle>{t("ai.sourceRuleBased")} · {insights.data.source}</CardTitle></CardHeader>
            <CardContent>
              {insights.data.insights.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("ai.noInsights")}</p>
              ) : (
                <ul className="space-y-3">
                  {insights.data.insights.map((ins) => (
                    <li key={ins.id} className="flex items-start gap-2">
                      <Badge variant={ins.severity === "info" ? "secondary" : "default"}>{ins.severity}</Badge>
                      <span className="text-sm"><span className="font-medium">{ins.title}:</span> {ins.detail}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-4 text-sm text-muted-foreground">{insights.data.summary}</p>
            </CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>{t("ai.ask")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Input className="min-w-64 flex-1" value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t("ai.askPlaceholder")} onKeyDown={(e) => { if (e.key === "Enter" && question.trim()) ask.mutate(); }} />
              <Button disabled={!question.trim() || ask.isPending} onClick={() => ask.mutate()}>{t("ai.ask")}</Button>
            </div>
            {answer && (
              <div className="rounded-md border p-4 text-sm">
                <div className="mb-1 text-xs text-muted-foreground">{answer.intent} · {answer.source}</div>
                {answer.answer}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
