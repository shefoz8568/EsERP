"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, inventoryApi, salesApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { DeliveryNote, SalesOrder, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function DeliveryNotesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [orderId, setOrderId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10));
  const [qtys, setQtys] = useState<Record<string, number>>({});

  const query = useQuery({ queryKey: ["delivery-notes"], queryFn: () => inventoryApi.listDeliveries({ pageSize: 100 }) });
  const orders = useQuery({ queryKey: ["sales-orders-open"], queryFn: () => salesApi.listOrders({ status: "CONFIRMED", pageSize: 100 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const notes = asList<DeliveryNote>(query.data);
  const orderList = asList<SalesOrder>(orders.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const selectedOrder = orderList.find((o) => o.id === orderId);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["delivery-notes"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createDelivery({
        salesOrderId: orderId,
        warehouseId,
        deliveryDate: `${deliveryDate}T00:00:00.000Z`,
        lines: (selectedOrder?.lines ?? [])
          .filter((l) => (qtys[l.itemId] ?? 0) > 0)
          .map((l) => ({ salesOrderLineId: l.id as string, itemId: l.itemId, quantity: qtys[l.itemId] })),
      }),
    onSuccess: () => { toast.success(t("common.success")); setQtys({}); setOrderId(""); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => inventoryApi.postDelivery(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => inventoryApi.cancelDelivery(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<DeliveryNote>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "salesOrder", header: t("inventory.salesOrder"), cell: ({ row }) => row.original.salesOrder?.number ?? "—" },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "deliveryDate", header: t("inventory.deliveryDate"), cell: ({ row }) => row.original.deliveryDate.slice(0, 10) },
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

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("inventory.deliveryNotes")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("inventory.addDelivery")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("inventory.salesOrder")}</Label>
                <Select value={orderId || "none"} onValueChange={(v) => { setOrderId(v === "none" ? "" : v); setQtys({}); }}>
                  <SelectTrigger><SelectValue placeholder={t("inventory.salesOrder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {orderList.map((o) => (<SelectItem key={o.id} value={o.id}>{o.number} — {o.customer?.displayName ?? ""}</SelectItem>))}
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
              <div className="space-y-1">
                <Label>{t("inventory.deliveryDate")}</Label>
                <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </div>
            </div>
            {selectedOrder && (
              <div className="space-y-2">
                {(selectedOrder.lines ?? []).map((l) => (
                  <div key={l.itemId} className="flex items-center gap-3 text-sm">
                    <span className="w-56">{l.item?.sku} — {l.item?.name}</span>
                    <span>ordered {l.quantityOrdered}, fulfilled {l.quantityFulfilled}</span>
                    <Input type="number" min={0} className="w-28" placeholder={t("inventory.quantityDelivered")} value={qtys[l.itemId] ?? ""} onChange={(e) => setQtys({ ...qtys, [l.itemId]: Number(e.target.value) })} />
                  </div>
                ))}
              </div>
            )}
            <Button disabled={!orderId || !warehouseId || !(selectedOrder?.lines ?? []).some((l) => (qtys[l.itemId] ?? 0) > 0)} onClick={() => create.mutate()}>{t("inventory.addDelivery")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("inventory.deliveryNotes")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={notes} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
