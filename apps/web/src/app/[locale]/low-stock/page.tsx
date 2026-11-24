"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eserp/ui";
import { asList, inventoryApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { StockLevel, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function LowStockPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [warehouseId, setWarehouseId] = useState("");

  const query = useQuery({
    queryKey: ["low-stock", warehouseId],
    queryFn: () => inventoryApi.lowStock(warehouseId || undefined),
  });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const rows = (query.data?.data ?? []) as StockLevel[];
  const warehouseList = asList<Warehouse>(warehouses.data);

  const columns: ColumnDef<StockLevel>[] = [
    { accessorKey: "item", header: t("inventory.item"), cell: ({ row }) => `${row.original.item?.sku ?? "—"} — ${row.original.item?.name ?? ""}` },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "qtyOnHand", header: t("inventory.onHand") },
    { accessorKey: "qtyReserved", header: t("inventory.reserved") },
    { accessorKey: "qtyAvailable", header: t("inventory.available") },
    { accessorKey: "reorderPoint", header: t("inventory.reorderPoint"), cell: ({ row }) => row.original.item?.reorderPoint ?? 0 },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: () => <Badge variant="destructive">{t("inventory.lowStock")}</Badge>,
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("inventory.lowStock")}</h1>
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
            <CardHeader><CardTitle>{t("inventory.lowStock")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
