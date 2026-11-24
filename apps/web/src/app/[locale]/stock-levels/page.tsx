"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eserp/ui";
import { asList, asTotal, inventoryApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { StatusBadge } from "@/components/StatusBadge";
import { formatMoney } from "@/lib/money";
import type { StockLevel, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

type StockView = "all" | "low";

export default function StockLevelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [warehouseId, setWarehouseId] = useState("");
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<StockView>("all");

  useEffect(() => {
    setPage(1);
  }, [warehouseId, search, lowOnly, view]);

  const query = useQuery({
    queryKey: ["stock-levels", warehouseId, search, lowOnly, view, page],
    queryFn: () =>
      inventoryApi.listStock({
        warehouseId: warehouseId || undefined,
        search: search || undefined,
        lowStockOnly: lowOnly || view === "low" ? true : undefined,
        page,
        pageSize: 10,
      }),
  });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const rows = asList<StockLevel>(query.data);
  const warehouseList = asList<Warehouse>(warehouses.data);

  const columns: ColumnDef<StockLevel>[] = [
    { accessorKey: "item", header: t("inventory.item"), cell: ({ row }) => `${row.original.item?.sku ?? "—"} — ${row.original.item?.name ?? ""}` },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "qtyOnHand", header: t("inventory.onHand"), meta: { numeric: true } },
    { accessorKey: "qtyReserved", header: t("inventory.reserved"), meta: { numeric: true } },
    { accessorKey: "qtyAvailable", header: t("inventory.available"), meta: { numeric: true } },
    { accessorKey: "reorderPoint", header: t("inventory.reorderPoint"), meta: { numeric: true }, cell: ({ row }) => row.original.item?.reorderPoint ?? 0 },
    { accessorKey: "averageCostMinor", header: t("inventory.averageCost"), meta: { numeric: true }, cell: ({ row }) => formatMoney(row.original.averageCostMinor, row.original.currency, locale) },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) =>
        row.original.qtyOnHand <= (row.original.item?.reorderPoint ?? 0) ? (
          <StatusBadge status="LOW" label={t("inventory.lowStock")} />
        ) : (
          <StatusBadge status="OK" />
        ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("inventory.stockLevels")}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Input placeholder={t("common.search")} className="w-44" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={warehouseId || "all"} onValueChange={(v) => setWarehouseId(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44"><SelectValue placeholder={t("inventory.warehouse")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("inventory.warehouse")}</SelectItem>
                {warehouseList.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex items-center gap-1 text-sm">
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => setLowOnly(e.target.checked)}
                className="h-4 w-4 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {t("inventory.lowStock")}
            </label>
          </div>
        </div>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("inventory.stockLevels")}</CardTitle></CardHeader>
            <CardContent>
              <DataTable
                id="stock-levels"
                columns={columns}
                data={rows}
                ariaLabel={t("inventory.stockLevels")}
                savedViews={[
                  { id: "all", label: t("common.showAll") },
                  { id: "low", label: t("inventory.lowStock") },
                ]}
                activeViewId={view}
                onSelectView={(viewId) => setView(viewId as StockView)}
                serverPagination={{ page, pageSize: 10, total: asTotal(query.data), onPageChange: setPage }}
              />
              <p className="mt-2 text-sm text-muted-foreground">{t("common.viewAll")}: {asTotal(query.data)}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
