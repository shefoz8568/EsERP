"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Button, Card, CardContent, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { accountingApi, asList, asTotal, settingsApi, type JournalLineInput } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormSection } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";
import type { JournalEntry } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

type DraftLine = { accountId: string; debit: string; credit: string; taxRateId: string; costCenterId: string };

const emptyLine = (): DraftLine => ({ accountId: "", debit: "", credit: "", taxRateId: "", costCenterId: "" });

type JournalView = "all" | "DRAFT" | "POSTED" | "REVERSED" | "this-month";

export default function JournalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [entryDate, setEntryDate] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState("");
  const [reference, setReference] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([emptyLine(), emptyLine()]);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<JournalView>("all");
  const [triedSave, setTriedSave] = useState(false);

  const isClientView = view === "this-month";
  useEffect(() => {
    setPage(1);
  }, [search, status, view]);

  const query = useQuery({
    queryKey: ["journals", search, status, view, isClientView ? "client-view" : page],
    queryFn: () =>
      accountingApi.listJournals({
        search: search || undefined,
        status: status || (view === "all" || view === "this-month" ? undefined : view),
        page: isClientView ? 1 : page,
        pageSize: isClientView ? 100 : 10,
      }),
  });
  const accounts = useQuery({ queryKey: ["chart-of-accounts"], queryFn: () => accountingApi.listChartOfAccounts() });
  const taxes = useQuery({ queryKey: ["taxes"], queryFn: () => settingsApi.listTaxes() });
  const costCenters = useQuery({ queryKey: ["cost-centers"], queryFn: () => accountingApi.listCostCenters({ pageSize: 100 }) });
  const journals = asList<JournalEntry>(query.data);
  const accountList = asList(accounts.data).filter((a) => a.isPosting);
  const taxList = asList(taxes.data);
  const ccList = asList(costCenters.data);

  const totalDebit = lines.reduce((s, l) => s + Math.round(Number(l.debit || 0) * 100), 0);
  const totalCredit = lines.reduce((s, l) => s + Math.round(Number(l.credit || 0) * 100), 0);
  const balanced = totalDebit === totalCredit && totalDebit > 0;

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["journals"] });

  const create = useMutation({
    mutationFn: () => {
      const payloadLines: JournalLineInput[] = lines.map((l, i) => ({
        accountId: l.accountId,
        debitMinor: Math.round(Number(l.debit || 0) * 100),
        creditMinor: Math.round(Number(l.credit || 0) * 100),
        taxRateId: l.taxRateId || undefined,
        costCenterId: l.costCenterId || undefined,
        lineOrder: i,
      }));
      return accountingApi.createJournal({
        entryDate: `${entryDate}T00:00:00.000Z`,
        description,
        reference: reference || undefined,
        lines: payloadLines,
      });
    },
    onSuccess: () => {
      toast.success(t("common.success"));
      setDescription(""); setReference(""); setLines([emptyLine(), emptyLine()]); setTriedSave(false);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const post = useMutation({
    mutationFn: (id: string) => accountingApi.postJournal(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  // Same endpoint + guard as the journal detail page (POSTED only).
  const reverse = useMutation({
    mutationFn: (id: string) => accountingApi.reverseJournal(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const thisMonth = new Date().toISOString().slice(0, 7);
  const visibleJournals = isClientView
    ? journals.filter((j) => j.entryDate.slice(0, 7) === thisMonth)
    : journals;

  const columns: ColumnDef<JournalEntry>[] = [
    {
      accessorKey: "number",
      header: t("accounting.number"),
      cell: ({ row }) => (
        <Link href={`/${locale}/journals/${row.original.id}`} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {row.original.number}
        </Link>
      ),
    },
    { accessorKey: "entryDate", header: t("accounting.entryDate"), cell: ({ row }) => row.original.entryDate.slice(0, 10) },
    { accessorKey: "description", header: t("accounting.description") },
    {
      accessorKey: "totalDebitMinor",
      header: t("accounting.debit"),
      meta: { numeric: true },
      cell: ({ row }) => formatMoney(row.original.totalDebitMinor, row.original.currency, locale),
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) =>
        row.original.status === "DRAFT" ? (
          <Button size="sm" onClick={() => post.mutate(row.original.id)}>{t("accounting.post")}</Button>
        ) : row.original.status === "POSTED" ? (
          <Button size="sm" variant="outline" onClick={() => reverse.mutate(row.original.id)}>{t("accounting.reverse")}</Button>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        ),
    },
  ];

  const valid = balanced && !!description && lines.every((l) => l.accountId);

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("accounting.journals")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormSection id="add-journal" title={t("accounting.addJournal")}>
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <FormField label={t("accounting.entryDate")} required>
                    <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
                  </FormField>
                  <FormField
                    label={t("accounting.description")}
                    required
                    error={triedSave && !description ? t("common.required") : undefined}
                  >
                    <Input value={description} onChange={(e) => setDescription(e.target.value)} />
                  </FormField>
                  <FormField label={t("accounting.reference")}>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} />
                  </FormField>
                </div>
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-5">
                    <FormField label={t("accounting.account")} required error={triedSave && !line.accountId ? t("common.required") : undefined}>
                      <Select value={line.accountId} onValueChange={(v) => setLine(i, { accountId: v })}>
                        <SelectTrigger><SelectValue placeholder={t("accounting.selectAccount")} /></SelectTrigger>
                        <SelectContent>
                          {accountList.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.code} — {locale === "ar" ? a.nameAr : a.nameEn}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label={t("accounting.debit")}>
                      <Input type="number" min="0" step="0.01" value={line.debit} onChange={(e) => setLine(i, { debit: e.target.value, credit: e.target.value ? "" : line.credit })} />
                    </FormField>
                    <FormField label={t("accounting.credit")}>
                      <Input type="number" min="0" step="0.01" value={line.credit} onChange={(e) => setLine(i, { credit: e.target.value, debit: e.target.value ? "" : line.debit })} />
                    </FormField>
                    <FormField label={t("accounting.taxRate")}>
                      <Select value={line.taxRateId || "none"} onValueChange={(v) => setLine(i, { taxRateId: v === "none" ? "" : v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {taxList.map((tx) => (
                            <SelectItem key={tx.id} value={tx.id}>{tx.name} ({tx.rateBps / 100}%)</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                    <FormField label={t("accounting.costCenter")}>
                      <Select value={line.costCenterId || "none"} onValueChange={(v) => setLine(i, { costCenterId: v === "none" ? "" : v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {ccList.map((cc) => (
                            <SelectItem key={cc.id} value={cc.id}>{cc.code} — {cc.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormField>
                  </div>
                ))}
                <div className="flex flex-wrap items-center gap-3">
                  <Button variant="outline" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>{t("accounting.addLine")}</Button>
                  <span className="text-sm tabular-nums">
                    {t("accounting.totalDebit")}: {formatMoney(totalDebit, "SAR", locale)} · {t("accounting.totalCredit")}: {formatMoney(totalCredit, "SAR", locale)}
                  </span>
                  {!balanced && (
                    <span role="alert" className="text-sm text-destructive">{t("accounting.unbalanced")}</span>
                  )}
                  <Button
                    disabled={create.isPending}
                    onClick={() => {
                      setTriedSave(true);
                      if (valid) create.mutate();
                    }}
                  >
                    {t("common.save")}
                  </Button>
                </div>
              </div>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap gap-3">
              <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.status")}</SelectItem>
                  <SelectItem value="DRAFT">{t("accounting.draft")}</SelectItem>
                  <SelectItem value="POSTED">{t("accounting.posted")}</SelectItem>
                  <SelectItem value="REVERSED">{t("accounting.reversed")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {query.isError ? (
              <ErrorState onRetry={() => void query.refetch()} />
            ) : (
              <DataTable
                id="journals"
                columns={columns}
                data={visibleJournals}
                ariaLabel={t("accounting.journals")}
                enableSelection
                bulkActions={[
                  {
                    id: "post",
                    label: t("accounting.post"),
                    disabled: (rows) => !rows.some((r) => r.status === "DRAFT"),
                    onClick: (rows) => rows.filter((r) => r.status === "DRAFT").forEach((r) => post.mutate(r.id)),
                  },
                  {
                    id: "reverse",
                    label: t("accounting.reverse"),
                    disabled: (rows) => !rows.some((r) => r.status === "POSTED"),
                    onClick: (rows) => rows.filter((r) => r.status === "POSTED").forEach((r) => reverse.mutate(r.id)),
                  },
                ]}
                savedViews={[
                  { id: "all", label: t("common.showAll") },
                  { id: "DRAFT", label: t("accounting.draft") },
                  { id: "POSTED", label: t("accounting.posted") },
                  { id: "REVERSED", label: t("accounting.reversed") },
                  { id: "this-month", label: t("common.thisMonth") },
                ]}
                activeViewId={view}
                onSelectView={(viewId) => setView(viewId as JournalView)}
                serverPagination={
                  isClientView
                    ? undefined
                    : { page, pageSize: 10, total: asTotal(query.data), onPageChange: setPage }
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
