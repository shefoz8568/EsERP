"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, inventoryApi, purchasingApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { GoodsReceipt, PurchaseOrder, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function GoodsReceiptsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [poId, setPoId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [qtys, setQtys] = useState<Record<string, number>>({});

  const query = useQuery({ queryKey: ["goods-receipts"], queryFn: () => inventoryApi.listReceipts({ pageSize: 100 }) });
  const pos = useQuery({ queryKey: ["purchase-orders-open"], queryFn: () => purchasingApi.listOrders({ status: "CONFIRMED", pageSize: 100 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const receipts = asList<GoodsReceipt>(query.data);
  const poList = asList<PurchaseOrder>(pos.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const selectedPo = poList.find((p) => p.id === poId);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["goods-receipts"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      inventoryApi.createReceipt({
        purchaseOrderId: poId,
        warehouseId,
        receiptDate: `${receiptDate}T00:00:00.000Z`,
        lines: (selectedPo?.lines ?? [])
          .filter((l) => (qtys[l.itemId] ?? 0) > 0)
          .map((l) => ({ purchaseOrderLineId: l.id as string, itemId: l.itemId, quantity: qtys[l.itemId], unitCostMinor: l.unitCostMinor })),
      }),
    onSuccess: () => { toast.success(t("common.success")); setQtys({}); setPoId(""); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => inventoryApi.postReceipt(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => inventoryApi.cancelReceipt(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<GoodsReceipt>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "purchaseOrder", header: t("inventory.purchaseOrder"), cell: ({ row }) => row.original.purchaseOrder?.number ?? "—" },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "receiptDate", header: t("inventory.receiptDate"), cell: ({ row }) => row.original.receiptDate.slice(0, 10) },
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
        <h1 className="text-2xl font-bold">{t("inventory.goodsReceipts")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("inventory.addReceipt")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("inventory.purchaseOrder")}</Label>
                <Select value={poId || "none"} onValueChange={(v) => { setPoId(v === "none" ? "" : v); setQtys({}); }}>
                  <SelectTrigger><SelectValue placeholder={t("inventory.purchaseOrder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {poList.map((p) => (<SelectItem key={p.id} value={p.id}>{p.number} — {p.supplier?.displayName ?? ""}</SelectItem>))}
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
                <Label>{t("inventory.receiptDate")}</Label>
                <Input type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} />
              </div>
            </div>
            {selectedPo && (
              <div className="space-y-2">
                {(selectedPo.lines ?? []).map((l) => (
                  <div key={l.itemId} className="flex items-center gap-3 text-sm">
                    <span className="w-56">{l.item?.sku} — {l.item?.name}</span>
                    <span>ordered {l.quantityOrdered}, received {l.quantityReceived}</span>
                    <Input type="number" min={0} className="w-28" placeholder={t("inventory.quantityReceived")} value={qtys[l.itemId] ?? ""} onChange={(e) => setQtys({ ...qtys, [l.itemId]: Number(e.target.value) })} />
                    <span>@ {formatMoney(l.unitCostMinor, "SAR", locale)}</span>
                  </div>
                ))}
              </div>
            )}
            <Button disabled={!poId || !warehouseId || !(selectedPo?.lines ?? []).some((l) => (qtys[l.itemId] ?? 0) > 0)} onClick={() => create.mutate()}>{t("inventory.addReceipt")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("inventory.goodsReceipts")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={receipts} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
