"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { Button, Input, toast } from "@eserp/ui";
import { accountingApi, type JournalLineInput } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormPageHeader, FormSection, StickySaveBar } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";

export default function JournalDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["journals", id], queryFn: () => accountingApi.getJournal(id) });
  const entry = query.data;

  const [description, setDescription] = useState("");
  const [amounts, setAmounts] = useState<Record<string, { debit: string; credit: string }>>({});
  const [initialDescription, setInitialDescription] = useState<string | null>(null);
  const [initialAmounts, setInitialAmounts] = useState<Record<string, { debit: string; credit: string }> | null>(null);

  useEffect(() => {
    if (entry && initialDescription === null) {
      setDescription(entry.description);
      setInitialDescription(entry.description);
      const m: Record<string, { debit: string; credit: string }> = {};
      for (const l of entry.lines) m[l.id] = { debit: String(l.debitMinor / 100), credit: String(l.creditMinor / 100) };
      setAmounts(m);
      setInitialAmounts(m);
    }
  }, [entry, initialDescription]);

  const dirty =
    initialDescription !== null &&
    (description !== initialDescription ||
      JSON.stringify(amounts) !== JSON.stringify(initialAmounts));

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["journals", id] });

  const post = useMutation({
    mutationFn: () => accountingApi.postJournal(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const reverse = useMutation({
    mutationFn: () => accountingApi.reverseJournal(id),
    onSuccess: (reversal) => {
      toast.success(t("common.success"));
      invalidate();
      router.push(`/${locale}/journals/${reversal.id}`);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: () => accountingApi.deleteJournal(id),
    onSuccess: () => { toast.success(t("common.success")); router.push(`/${locale}/journals`); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const save = useMutation({
    mutationFn: () => {
      const lines: JournalLineInput[] = (entry?.lines ?? []).map((l, i) => ({
        accountId: l.accountId,
        debitMinor: Math.round(Number(amounts[l.id]?.debit || 0) * 100),
        creditMinor: Math.round(Number(amounts[l.id]?.credit || 0) * 100),
        costCenterId: l.costCenterId ?? undefined,
        taxRateId: l.taxRateId ?? undefined,
        description: l.description ?? undefined,
        lineOrder: i,
      }));
      return accountingApi.updateJournal(id, { description, lines });
    },
    onSuccess: () => {
      toast.success(t("common.success"));
      setInitialDescription(description);
      setInitialAmounts(amounts);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const isDraft = entry?.status === "DRAFT";

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <FormPageHeader
          title={entry?.number ?? t("common.loading")}
          subtitle={entry?.description}
          status={entry ? <StatusBadge status={entry.status} /> : undefined}
          onBack={() => router.push(`/${locale}/journals`)}
          backLabel={t("common.back")}
          actions={
            entry ? (
              <>
                {isDraft && (
                  <>
                    <Button onClick={() => post.mutate()} disabled={post.isPending}>{t("accounting.post")}</Button>
                    <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>{t("common.delete")}</Button>
                  </>
                )}
                {entry.status === "POSTED" && (
                  <Button variant="outline" onClick={() => reverse.mutate()} disabled={reverse.isPending}>{t("accounting.reverse")}</Button>
                )}
              </>
            ) : undefined
          }
        />
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : !entry ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <FormSection id="journal-details" title={t("accounting.journal")}>
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div><dt className="text-muted-foreground">{t("accounting.entryDate")}</dt><dd>{entry.entryDate.slice(0, 10)}</dd></div>
                <div><dt className="text-muted-foreground">{t("accounting.period")}</dt><dd>{entry.fiscalPeriod ? `${entry.fiscalPeriod.fiscalYear}/${entry.fiscalPeriod.periodNumber}` : "—"}</dd></div>
                <div><dt className="text-muted-foreground">{t("accounting.sourceModule")}</dt><dd>{entry.sourceModule}</dd></div>
                <div><dt className="text-muted-foreground">{t("accounting.reference")}</dt><dd>{entry.reference ?? "—"}</dd></div>
                {entry.reverses && <div><dt className="text-muted-foreground">{t("accounting.reversalOf")}</dt><dd>{entry.reverses.number}</dd></div>}
                {entry.reversedBy && <div><dt className="text-muted-foreground">{t("accounting.reversed")}</dt><dd>{entry.reversedBy.number}</dd></div>}
              </dl>
              {isDraft && (
                <div className="mt-4">
                  <FormField label={t("accounting.description")} required error={description.trim() ? undefined : t("common.required")}>
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                  </FormField>
                </div>
              )}
            </FormSection>

            <FormSection id="journal-lines" title={t("accounting.journal")}>
              <div className="max-h-[65vh] overflow-auto rounded-md border" role="region" aria-label={t("accounting.journal")} tabIndex={0}>
                <table className="w-full min-w-[40rem] text-sm">
                  <thead>
                    <tr className="border-b text-start">
                      <th scope="col" className="sticky top-0 z-20 bg-background px-2 py-2 text-start font-medium">{t("accounting.account")}</th>
                      <th scope="col" className="sticky top-0 z-20 bg-background px-2 py-2 text-end font-medium tabular-nums">{t("accounting.debit")}</th>
                      <th scope="col" className="sticky top-0 z-20 bg-background px-2 py-2 text-end font-medium tabular-nums">{t("accounting.credit")}</th>
                      <th scope="col" className="sticky top-0 z-20 bg-background px-2 py-2 text-start font-medium">{t("accounting.costCenter")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entry.lines.map((l) => (
                      <tr key={l.id} className="border-b">
                        <td className="px-2 py-2">{l.account ? `${l.account.code} — ${locale === "ar" ? l.account.nameAr : l.account.nameEn}` : l.accountId}</td>
                        <td className="px-2 py-2 text-end tabular-nums">
                          {isDraft ? (
                            <Input type="number" min="0" step="0.01" className="ms-auto w-32 text-end" aria-label={`${t("accounting.debit")} ${l.account?.code ?? ""}`} value={amounts[l.id]?.debit ?? ""} onChange={(e) => setAmounts((p) => ({ ...p, [l.id]: { debit: e.target.value, credit: e.target.value ? "" : p[l.id]?.credit ?? "" } }))} />
                          ) : formatMoney(l.debitMinor, l.currency, locale)}
                        </td>
                        <td className="px-2 py-2 text-end tabular-nums">
                          {isDraft ? (
                            <Input type="number" min="0" step="0.01" className="ms-auto w-32 text-end" aria-label={`${t("accounting.credit")} ${l.account?.code ?? ""}`} value={amounts[l.id]?.credit ?? ""} onChange={(e) => setAmounts((p) => ({ ...p, [l.id]: { credit: e.target.value, debit: e.target.value ? "" : p[l.id]?.debit ?? "" } }))} />
                          ) : formatMoney(l.creditMinor, l.currency, locale)}
                        </td>
                        <td className="px-2 py-2">{l.costCenter ? `${l.costCenter.code} — ${l.costCenter.name}` : "—"}</td>
                      </tr>
                    ))}
                    <tr className="font-semibold">
                      <td className="px-2 py-2">{t("accounting.totalDebit")} / {t("accounting.totalCredit")}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{formatMoney(entry.totalDebitMinor, entry.currency, locale)}</td>
                      <td className="px-2 py-2 text-end tabular-nums">{formatMoney(entry.totalCreditMinor, entry.currency, locale)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </FormSection>

            {isDraft && (
              <StickySaveBar
                dirty={dirty}
                saving={save.isPending}
                saveDisabled={!description.trim()}
                onSave={() => save.mutate()}
                onDiscard={() => {
                  setDescription(initialDescription ?? "");
                  setAmounts(initialAmounts ?? {});
                }}
                saveLabel={t("common.save")}
                discardLabel={t("common.discard")}
                unsavedLabel={t("common.unsavedChanges")}
              />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
