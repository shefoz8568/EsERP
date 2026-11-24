"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eserp/ui";
import { asList, manufacturingApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { Warehouse, WipRow } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function WipReportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [warehouseId, setWarehouseId] = useState("");

  const query = useQuery({ queryKey: ["wip-report", warehouseId], queryFn: () => manufacturingApi.wipReport(warehouseId || undefined) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const rows = (query.data?.data ?? []) as WipRow[];
  const warehouseList = asList<Warehouse>(warehouses.data);

  const columns: ColumnDef<WipRow>[] = [
    { accessorKey: "workOrderNumber", header: t("manufacturing.workOrder") },
    { accessorKey: "finishedItem", header: t("manufacturing.finishedItem"), cell: ({ row }) => `${row.original.finishedItem?.sku ?? "—"} — ${row.original.finishedItem?.name ?? ""}` },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge> },
    { accessorKey: "qtyProduced", header: t("manufacturing.qtyProduced"), cell: ({ row }) => `${row.original.qtyProduced}/${row.original.qtyPlanned}` },
    { accessorKey: "materialIssuedMinor", header: t("manufacturing.materialIssued"), cell: ({ row }) => formatMoney(row.original.materialIssuedMinor, "SAR", locale) },
    { accessorKey: "productionReceivedMinor", header: t("manufacturing.productionReceived"), cell: ({ row }) => formatMoney(row.original.productionReceivedMinor, "SAR", locale) },
    { accessorKey: "finishedScrapMinor", header: t("manufacturing.finishedScrapValue"), cell: ({ row }) => formatMoney(row.original.finishedScrapMinor, "SAR", locale) },
    { accessorKey: "wipBalanceMinor", header: t("manufacturing.wipBalance"), cell: ({ row }) => formatMoney(row.original.wipBalanceMinor, "SAR", locale) },
    { accessorKey: "completionPct", header: t("manufacturing.completion"), cell: ({ row }) => `${row.original.completionPct}%` },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("manufacturing.wipReport")}</h1>
          <Select value={warehouseId || "all"} onValueChange={(v) => setWarehouseId(v === "all" ? "" : v)}>
            <SelectTrigger className="w-52"><SelectValue placeholder={t("inventory.warehouse")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("inventory.warehouse")}</SelectItem>
              {warehouseList.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("manufacturing.wipReport")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
