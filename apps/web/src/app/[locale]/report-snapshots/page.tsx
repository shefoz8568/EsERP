"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { analyticsApi, asList } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { ReportSnapshot } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const SNAPSHOT_TYPES = ["PROFIT_LOSS", "BALANCE_SHEET", "CASH_FLOW", "AR_AGING", "AP_AGING", "STOCK_VALUATION", "SALES_BY_ITEM", "SALES_BY_CUSTOMER"];

export default function ReportSnapshotsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [type, setType] = useState("PROFIT_LOSS");

  const query = useQuery({ queryKey: ["report-snapshots"], queryFn: () => analyticsApi.listSnapshots({ pageSize: 100 }) });
  const rows = asList<ReportSnapshot>(query.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["report-snapshots"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => analyticsApi.createSnapshot({ type, parameters: {} }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });

  const columns: ColumnDef<ReportSnapshot>[] = [
    { accessorKey: "type", header: t("analytics.type") },
    { accessorKey: "format", header: "Format" },
    { accessorKey: "generatedAt", header: t("analytics.generatedAt"), cell: ({ row }) => row.original.generatedAt.slice(0, 19).replace("T", " ") },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => { void analyticsApi.downloadSnapshot(row.original.id, "csv").catch(onError); }}>{t("analytics.download")}</Button>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("analytics.snapshots")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("analytics.addSnapshot")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("analytics.type")}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{SNAPSHOT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button className="self-end" disabled={create.isPending} onClick={() => create.mutate()}>{t("common.add")}</Button>
          </CardContent>
        </Card>
        <DataTable columns={columns} data={rows} />
      </div>
    </AppShell>
  );
}
