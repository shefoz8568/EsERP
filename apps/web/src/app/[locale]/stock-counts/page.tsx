"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, inventoryApi, itemsApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Item, StockCount, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function StockCountsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [counted, setCounted] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const query = useQuery({ queryKey: ["stock-counts"], queryFn: () => inventoryApi.listCounts({ pageSize: 100 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const rows = asList<StockCount>(query.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const itemList = asList<Item>(items.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["stock-counts"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createCount({
        warehouseId,
        countDate: `${date}T00:00:00.000Z`,
        lines: [{ itemId, countedQuantity: Number(counted) }],
      }),
    onSuccess: () => { toast.success(t("common.success")); setCounted(""); invalidate(); },
    onError,
  });
  const approve = useMutation({ mutationFn: (id: string) => inventoryApi.approveCount(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => inventoryApi.cancelCount(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<StockCount>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "countDate", header: t("inventory.countDate"), cell: ({ row }) => row.original.countDate.slice(0, 10) },
    {
      accessorKey: "variance",
      header: t("inventory.variance"),
      cell: ({ row }) => row.original.lines.map((l) => `${l.item?.sku ?? ""}: ${l.varianceQuantity}`).join(", "),
    },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "APPROVED" ? "default" : row.original.status === "CANCELLED" ? "destructive" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {row.original.status === "DRAFT" && <Button size="sm" onClick={() => approve.mutate(row.original.id)}>{t("inventory.approve")}</Button>}
          {row.original.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.original.id)}>{t("inventory.cancel")}</Button>}
        </div>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("inventory.counts")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("inventory.addCount")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>{t("inventory.warehouse")}</Label>
                <Select value={warehouseId || "none"} onValueChange={(v) => setWarehouseId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("inventory.warehouse")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {warehouseList.map((w) => (<SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("inventory.item")}</Label>
                <Select value={itemId || "none"} onValueChange={(v) => setItemId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("inventory.item")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {itemList.map((i) => (<SelectItem key={i.id} value={i.id}>{i.sku} — {i.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("inventory.countedQuantity")}</Label>
                <Input type="number" min={0} value={counted} onChange={(e) => setCounted(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("inventory.countDate")}</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <Button disabled={!warehouseId || !itemId || counted === ""} onClick={() => create.mutate()}>{t("inventory.addCount")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("inventory.counts")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
