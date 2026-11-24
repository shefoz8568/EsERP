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
import type { Item, StockAdjustment, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const REASONS = ["DAMAGE", "THEFT", "FOUND", "CORRECTION", "OTHER"];

export default function StockAdjustmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [warehouseId, setWarehouseId] = useState("");
  const [itemId, setItemId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("CORRECTION");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const query = useQuery({ queryKey: ["stock-adjustments"], queryFn: () => inventoryApi.listAdjustments({ pageSize: 100 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const rows = asList<StockAdjustment>(query.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const itemList = asList<Item>(items.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["stock-adjustments"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createAdjustment({
        warehouseId,
        adjustmentDate: `${date}T00:00:00.000Z`,
        lines: [{ itemId, quantityDelta: Number(delta), reason }],
      }),
    onSuccess: () => { toast.success(t("common.success")); setDelta(""); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => inventoryApi.postAdjustment(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => inventoryApi.cancelAdjustment(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<StockAdjustment>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "adjustmentDate", header: t("inventory.adjustmentDate"), cell: ({ row }) => row.original.adjustmentDate.slice(0, 10) },
    { accessorKey: "totalValueMinor", header: t("sales.total"), cell: ({ row }) => formatMoney(row.original.totalValueMinor, row.original.currency, locale) },
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

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("inventory.adjustments")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("inventory.addAdjustment")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-5">
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
                <Label>{t("inventory.quantityDelta")}</Label>
                <Input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="-2" />
              </div>
              <div className="space-y-1">
                <Label>{t("inventory.reason")}</Label>
                <Select value={reason} onValueChange={setReason}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REASONS.map((r) => (<SelectItem key={r} value={r}>{r}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("inventory.adjustmentDate")}</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
            </div>
            <Button disabled={!warehouseId || !itemId || Number(delta) === 0} onClick={() => create.mutate()}>{t("inventory.addAdjustment")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("inventory.adjustments")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
