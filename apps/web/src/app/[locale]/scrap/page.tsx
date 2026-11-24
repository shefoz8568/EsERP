"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, itemsApi, manufacturingApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { Item, Scrap, Warehouse, WorkOrder } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function ScrapPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [workOrderId, setWorkOrderId] = useState("");
  const [kind, setKind] = useState("FINISHED");
  const [itemId, setItemId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [scrapDate, setScrapDate] = useState(new Date().toISOString().slice(0, 10));

  const query = useQuery({ queryKey: ["scrap"], queryFn: () => manufacturingApi.listScrap({ pageSize: 100 }) });
  const workOrders = useQuery({ queryKey: ["work-orders-open"], queryFn: () => manufacturingApi.listWorkOrders({ pageSize: 100 }) });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 200 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const rows = asList<Scrap>(query.data);
  const woList = asList<WorkOrder>(workOrders.data).filter((w) => w.status === "RELEASED" || w.status === "IN_PROGRESS");
  const itemList = asList<Item>(items.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["scrap"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => manufacturingApi.createScrap({ workOrderId: workOrderId || undefined, kind, itemId, warehouseId, quantity: Number(quantity), reason, scrapDate: `${scrapDate}T00:00:00.000Z` }),
    onSuccess: () => { toast.success(t("common.success")); setWorkOrderId(""); setItemId(""); setQuantity(""); setReason(""); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => manufacturingApi.postScrap(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => manufacturingApi.cancelScrap(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<Scrap>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "workOrder", header: t("manufacturing.workOrder"), cell: ({ row }) => row.original.workOrder?.number ?? "—" },
    { accessorKey: "kind", header: t("manufacturing.kind"), cell: ({ row }) => row.original.kind === "FINISHED" ? t("manufacturing.finishedScrap") : t("manufacturing.componentScrap") },
    { accessorKey: "item", header: t("inventory.item"), cell: ({ row }) => `${row.original.item?.sku ?? "—"} — ${row.original.item?.name ?? ""}` },
    { accessorKey: "quantity", header: t("manufacturing.quantity") },
    { accessorKey: "reason", header: t("inventory.reason") },
    { accessorKey: "totalCostMinor", header: t("sales.total"), cell: ({ row }) => formatMoney(row.original.totalCostMinor, row.original.currency, locale) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "POSTED" ? "default" : row.original.status === "CANCELLED" ? "destructive" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {row.original.status === "DRAFT" && <Button size="sm" onClick={() => post.mutate(row.original.id)}>{t("manufacturing.post")}</Button>}
          {row.original.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.original.id)}>{t("manufacturing.cancel")}</Button>}
        </div>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("manufacturing.scrap")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("manufacturing.addScrap")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("manufacturing.workOrder")}</Label>
                <Select value={workOrderId || "none"} onValueChange={(v) => setWorkOrderId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("manufacturing.workOrder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {woList.map((w) => (<SelectItem key={w.id} value={w.id}>{w.number} — {w.finishedItem?.name ?? ""}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("manufacturing.kind")}</Label>
                <Select value={kind} onValueChange={setKind}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FINISHED">{t("manufacturing.finishedScrap")}</SelectItem>
                    <SelectItem value="COMPONENT">{t("manufacturing.componentScrap")}</SelectItem>
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
                <Label>{t("inventory.warehouse")}</Label>
                <Select value={warehouseId || "none"} onValueChange={(v) => setWarehouseId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("inventory.warehouse")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {warehouseList.map((w) => (<SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("manufacturing.quantity")}</Label><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("manufacturing.scrapDate")}</Label><Input type="date" value={scrapDate} onChange={(e) => setScrapDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("inventory.reason")}</Label><Input value={reason} onChange={(e) => setReason(e.target.value)} /></div>
            </div>
            <Button disabled={!itemId || !warehouseId || Number(quantity) <= 0 || !reason} onClick={() => create.mutate()}>{t("manufacturing.addScrap")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("manufacturing.scrap")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
