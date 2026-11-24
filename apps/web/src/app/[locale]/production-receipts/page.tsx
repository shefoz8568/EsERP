"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, manufacturingApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { ProductionReceipt, Warehouse, WorkOrder } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function ProductionReceiptsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [workOrderId, setWorkOrderId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantity, setQuantity] = useState("");

  const query = useQuery({ queryKey: ["production-receipts"], queryFn: () => manufacturingApi.listReceipts({ pageSize: 100 }) });
  const workOrders = useQuery({ queryKey: ["work-orders-open"], queryFn: () => manufacturingApi.listWorkOrders({ pageSize: 100 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const rows = asList<ProductionReceipt>(query.data);
  const woList = asList<WorkOrder>(workOrders.data).filter((w) => w.status === "RELEASED" || w.status === "IN_PROGRESS");
  const warehouseList = asList<Warehouse>(warehouses.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["production-receipts"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => manufacturingApi.createReceipt({ workOrderId, warehouseId, receiptDate: `${receiptDate}T00:00:00.000Z`, quantity: Number(quantity) }),
    onSuccess: () => { toast.success(t("common.success")); setWorkOrderId(""); setQuantity(""); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => manufacturingApi.postReceipt(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => manufacturingApi.cancelReceipt(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<ProductionReceipt>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "workOrder", header: t("manufacturing.workOrder"), cell: ({ row }) => row.original.workOrder?.number ?? "—" },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "receiptDate", header: t("manufacturing.receiptDate"), cell: ({ row }) => row.original.receiptDate.slice(0, 10) },
    { accessorKey: "quantity", header: t("manufacturing.quantity") },
    { accessorKey: "unitCostMinor", header: t("inventory.unitCost"), cell: ({ row }) => formatMoney(row.original.unitCostMinor, row.original.currency, locale) },
    { accessorKey: "totalCostMinor", header: t("sales.total"), cell: ({ row }) => formatMoney(row.original.totalCostMinor, row.original.currency, locale) },
    { accessorKey: "overProduced", header: t("manufacturing.overProduced"), cell: ({ row }) => row.original.overProduced ? <Badge variant="destructive">{t("common.yes")}</Badge> : t("common.no") },
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
        <h1 className="text-2xl font-bold">{t("manufacturing.productionReceipts")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("manufacturing.addReceipt")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>{t("manufacturing.workOrder")}</Label>
                <Select value={workOrderId || "none"} onValueChange={(v) => setWorkOrderId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("manufacturing.workOrder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {woList.map((w) => (<SelectItem key={w.id} value={w.id}>{w.number} — {w.finishedItem?.name ?? ""} ({w.qtyProduced}/{w.qtyPlanned})</SelectItem>))}
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
              <div className="space-y-1"><Label>{t("manufacturing.receiptDate")}</Label><Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("manufacturing.quantity")}</Label><Input type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} /></div>
            </div>
            <Button disabled={!workOrderId || !warehouseId || Number(quantity) <= 0} onClick={() => create.mutate()}>{t("manufacturing.addReceipt")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("manufacturing.productionReceipts")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
