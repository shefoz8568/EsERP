"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, inventoryApi, itemsApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { Item, StockTransfer, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function StockTransfersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const query = useQuery({ queryKey: ["stock-transfers"], queryFn: () => inventoryApi.listTransfers({ pageSize: 100 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const rows = asList<StockTransfer>(query.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const itemList = asList<Item>(items.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["stock-transfers"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createTransfer({
        fromWarehouseId: fromId,
        toWarehouseId: toId,
        transferDate: `${date}T00:00:00.000Z`,
        lines: [{ itemId, quantity: Number(qty) }],
      }),
    onSuccess: () => { toast.success(t("common.success")); setQty(""); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => inventoryApi.postTransfer(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => inventoryApi.cancelTransfer(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<StockTransfer>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "fromWarehouse", header: t("inventory.fromWarehouse"), cell: ({ row }) => row.original.fromWarehouse?.name ?? "—" },
    { accessorKey: "toWarehouse", header: t("inventory.toWarehouse"), cell: ({ row }) => row.original.toWarehouse?.name ?? "—" },
    { accessorKey: "transferDate", header: t("inventory.transferDate"), cell: ({ row }) => row.original.transferDate.slice(0, 10) },
    { accessorKey: "totalCostMinor", header: t("sales.total"), cell: ({ row }) => formatMoney(row.original.totalCostMinor, row.original.currency, locale) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "POSTED" ? "default" : row.original.status === "CANCELLED" ? "destructive" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {row.original.status === "DRAFT" && <Button size="sm" onClick={() => post.mutate(row.original.id)}>{t("inventory.post")}</Button>}
          {row.original.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.original.id)}>{t("inventory.cancel")}</Button>}
        </div>
      ),
    },
  ];

  const warehouseSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value || "none"} onValueChange={(v) => onChange(v === "none" ? "" : v)}>
        <SelectTrigger><SelectValue placeholder={label} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="none">—</SelectItem>
          {warehouseList.map((w) => (<SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("inventory.transfers")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("inventory.addTransfer")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-5">
              {warehouseSelect(fromId, setFromId, t("inventory.fromWarehouse"))}
              {warehouseSelect(toId, setToId, t("inventory.toWarehouse"))}
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
                <Label>{t("sales.quantity")}</Label>
                <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t("inventory.transferDate")}</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <Button disabled={!fromId || !toId || fromId === toId || !itemId || Number(qty) <= 0} onClick={() => create.mutate()}>{t("inventory.addTransfer")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("inventory.transfers")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
