"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, exportsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { ExportJob } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const EXPORT_TYPES = ["contacts", "items", "sales-invoices", "purchase-orders", "journal-entries", "stock-levels", "employees"];

export default function ExportsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [type, setType] = useState("contacts");
  const [format, setFormat] = useState("csv");

  const query = useQuery({ queryKey: ["export-jobs"], queryFn: () => exportsApi.listJobs({ pageSize: 100 }) });
  const rows = asList<ExportJob>(query.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["export-jobs"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => exportsApi.createJob({ type, format: format.toUpperCase() }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });

  const columns: ColumnDef<ExportJob>[] = [
    { accessorKey: "type", header: "Type" },
    { accessorKey: "format", header: "Format" },
    { accessorKey: "status", header: t("common.status") },
    { accessorKey: "rowCount", header: t("integrations.rowCount") },
    { accessorKey: "createdAt", header: t("common.createdAt"), cell: ({ row }) => row.original.createdAt.slice(0, 19).replace("T", " ") },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("integrations.exports")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("integrations.createJob")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{EXPORT_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Format</Label>
              <Select value={format} onValueChange={setFormat}>
                <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="csv">CSV</SelectItem><SelectItem value="json">JSON</SelectItem></SelectContent>
              </Select>
            </div>
            <Button className="self-end" disabled={create.isPending} onClick={() => create.mutate()}>{t("integrations.createJob")}</Button>
            <Button className="self-end" variant="outline" onClick={() => { void exportsApi.download(type, format).catch(onError); }}>{t("integrations.download")}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("integrations.exports")} ({rows.length})</CardTitle></CardHeader>
          <CardContent><DataTable columns={columns} data={rows} /></CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
