"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eserp/ui";
import { asList, inventoryApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { StockMovement } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const TYPES = ["IN", "OUT", "TRANSFER", "ADJUSTMENT", "RETURN_IN", "RETURN_OUT"];
const SOURCES = ["GOODS_RECEIPT", "DELIVERY_NOTE", "POS_SALE", "ADJUSTMENT", "COUNT", "TRANSFER"];

export default function StockMovementsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const [type, setType] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [search, setSearch] = useState("");

  const query = useQuery({
    queryKey: ["stock-movements", type, sourceType],
    queryFn: () => inventoryApi.listMovements({ type: type || undefined, sourceType: sourceType || undefined, pageSize: 100 }),
  });
  const rows = asList<StockMovement>(query.data).filter((r) =>
    search ? (r.item?.sku ?? "").toLowerCase().includes(search.toLowerCase()) || (r.reference ?? "").toLowerCase().includes(search.toLowerCase()) : true,
  );

  const columns: ColumnDef<StockMovement>[] = [
    { accessorKey: "movementDate", header: t("common.name"), cell: ({ row }) => row.original.movementDate.slice(0, 10) },
    { accessorKey: "item", header: t("inventory.item"), cell: ({ row }) => `${row.original.item?.sku ?? "—"} — ${row.original.item?.name ?? ""}` },
    { accessorKey: "type", header: t("inventory.movementType"), cell: ({ row }) => <Badge variant="secondary">{row.original.type}</Badge> },
    { accessorKey: "sourceType", header: t("inventory.source"), cell: ({ row }) => row.original.sourceType },
    { accessorKey: "reference", header: t("common.name"), cell: ({ row }) => row.original.reference ?? "—" },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "quantity", header: t("sales.quantity") },
    { accessorKey: "totalCostMinor", header: t("sales.total"), cell: ({ row }) => formatMoney(row.original.totalCostMinor, row.original.currency, locale) },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("inventory.stockMovements")}</h1>
          <div className="flex items-center gap-2">
            <Input placeholder={t("common.search")} className="w-44" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={type || "all"} onValueChange={(v) => setType(v === "all" ? "" : v)}>
              <SelectTrigger className="w-40"><SelectValue placeholder={t("inventory.movementType")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("inventory.movementType")}</SelectItem>
                {TYPES.map((x) => (<SelectItem key={x} value={x}>{x}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={sourceType || "all"} onValueChange={(v) => setSourceType(v === "all" ? "" : v)}>
              <SelectTrigger className="w-44"><SelectValue placeholder={t("inventory.source")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("inventory.source")}</SelectItem>
                {SOURCES.map((x) => (<SelectItem key={x} value={x}>{x}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("inventory.stockMovements")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
