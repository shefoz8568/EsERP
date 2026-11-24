"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, contactsApi, salesApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { Opportunity } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const STAGES = ["PROSPECTING", "QUALIFICATION", "PROPOSAL", "NEGOTIATION", "WON", "LOST"];

export default function OpportunitiesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [title, setTitle] = useState("");
  const [probability, setProbability] = useState("50");
  const [expectedValue, setExpectedValue] = useState("");

  const query = useQuery({
    queryKey: ["opportunities", search, stage],
    queryFn: () => salesApi.listOpportunities({ search: search || undefined, stage: stage || undefined }),
  });
  const customers = useQuery({ queryKey: ["contacts-customers"], queryFn: () => contactsApi.list({ type: "CUSTOMER", pageSize: 100 }) });
  const opps = asList<Opportunity>(query.data);
  const customerList = asList(customers.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["opportunities"] });

  const create = useMutation({
    mutationFn: () =>
      salesApi.createOpportunity({
        customerId,
        title,
        stage: "PROSPECTING",
        probability: Math.min(100, Math.max(0, Math.round(Number(probability || 0)))),
        expectedValueMinor: Math.round(Number(expectedValue || 0) * 100),
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setTitle(""); setExpectedValue(""); setProbability("50");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const updateStage = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => salesApi.updateOpportunity(id, { stage: s }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<Opportunity>[] = [
    { accessorKey: "title", header: t("sales.title") },
    { accessorKey: "customer", header: t("sales.customer"), cell: ({ row }) => row.original.customer?.displayName ?? "—" },
    {
      accessorKey: "stage",
      header: t("sales.stage"),
      cell: ({ row }) => (
        <Select value={row.original.stage} onValueChange={(v) => updateStage.mutate({ id: row.original.id, s: v })}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STAGES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
      ),
    },
    { accessorKey: "probability", header: t("sales.probability"), cell: ({ row }) => `${row.original.probability}%` },
    {
      accessorKey: "expectedValueMinor",
      header: t("sales.expectedValue"),
      cell: ({ row }) => formatMoney(row.original.expectedValueMinor, row.original.expectedValueCurrency, locale),
    },
    { accessorKey: "expectedCloseDate", header: t("sales.expectedCloseDate"), cell: ({ row }) => row.original.expectedCloseDate?.slice(0, 10) ?? "—" },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("sales.opportunities")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardHeader><CardTitle>{t("sales.addOpportunity")}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>{t("sales.customer")}</Label>
                <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("sales.customer")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {customerList.map((c) => (<SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("sales.title")}</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("sales.probability")}</Label><Input type="number" min="0" max="100" value={probability} onChange={(e) => setProbability(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("sales.expectedValue")}</Label><Input type="number" min="0" step="0.01" value={expectedValue} onChange={(e) => setExpectedValue(e.target.value)} /></div>
            </div>
            <div className="mt-4">
              <Button disabled={!customerId || !title || create.isPending} onClick={() => create.mutate()}>{t("common.save")}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap gap-3">
              <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={stage || "all"} onValueChange={(v) => setStage(v === "all" ? "" : v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("sales.stage")}</SelectItem>
                  {STAGES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <DataTable columns={columns} data={opps} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
