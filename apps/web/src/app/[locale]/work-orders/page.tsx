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
import type { Bom, Item, Warehouse, WorkOrder } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function WorkOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [finishedItemId, setFinishedItemId] = useState("");
  const [bomId, setBomId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [qtyPlanned, setQtyPlanned] = useState("10");
  const [dueDate, setDueDate] = useState("");
  const [selectedId, setSelectedId] = useState("");

  const query = useQuery({ queryKey: ["work-orders"], queryFn: () => manufacturingApi.listWorkOrders({ pageSize: 100 }) });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 200 }) });
  const boms = useQuery({ queryKey: ["boms", finishedItemId], queryFn: () => manufacturingApi.listBoms({ finishedItemId: finishedItemId || undefined, status: "ACTIVE", pageSize: 100 }), enabled: !!finishedItemId });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const detail = useQuery({ queryKey: ["work-order", selectedId], queryFn: () => manufacturingApi.getWorkOrder(selectedId), enabled: !!selectedId });
  const rows = asList<WorkOrder>(query.data);
  const itemList = asList<Item>(items.data);
  const bomList = asList<Bom>(boms.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["work-orders"] }); if (selectedId) void queryClient.invalidateQueries({ queryKey: ["work-order", selectedId] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => manufacturingApi.createWorkOrder({ finishedItemId, bomId, warehouseId, qtyPlanned: Number(qtyPlanned), dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : undefined }),
    onSuccess: (wo) => { toast.success(t("common.success")); setSelectedId(wo.id); setFinishedItemId(""); setBomId(""); setWarehouseId(""); setQtyPlanned("10"); setDueDate(""); invalidate(); },
    onError,
  });
  const release = useMutation({ mutationFn: (id: string) => manufacturingApi.releaseWorkOrder(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const complete = useMutation({ mutationFn: (id: string) => manufacturingApi.completeWorkOrder(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => manufacturingApi.cancelWorkOrder(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => manufacturingApi.deleteWorkOrder(id), onSuccess: () => { toast.success(t("common.success")); setSelectedId(""); invalidate(); }, onError });

  const columns: ColumnDef<WorkOrder>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "finishedItem", header: t("manufacturing.finishedItem"), cell: ({ row }) => `${row.original.finishedItem?.sku ?? "—"} — ${row.original.finishedItem?.name ?? ""}` },
    { accessorKey: "qtyPlanned", header: t("manufacturing.qtyPlanned") },
    { accessorKey: "qtyProduced", header: t("manufacturing.qtyProduced") },
    { accessorKey: "completionPct", header: t("manufacturing.completion"), cell: ({ row }) => `${row.original.completionPct}%` },
    { accessorKey: "materialCostPlannedMinor", header: t("manufacturing.plannedCost"), cell: ({ row }) => formatMoney(row.original.materialCostPlannedMinor, "SAR", locale) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "COMPLETED" ? "default" : row.original.status === "CANCELLED" ? "destructive" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelectedId(row.original.id)}>{t("common.viewAll")}</Button>
          {row.original.status === "DRAFT" && <Button size="sm" onClick={() => release.mutate(row.original.id)}>{t("manufacturing.release")}</Button>}
          {(row.original.status === "RELEASED" || row.original.status === "IN_PROGRESS") && <Button size="sm" onClick={() => complete.mutate(row.original.id)}>{t("manufacturing.complete")}</Button>}
          {(row.original.status === "DRAFT" || row.original.status === "RELEASED") && <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.original.id)}>{t("manufacturing.cancel")}</Button>}
          {row.original.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>}
        </div>
      ),
    },
  ];

  const d = detail.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("manufacturing.workOrders")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("manufacturing.addWorkOrder")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("manufacturing.finishedItem")}</Label>
                <Select value={finishedItemId || "none"} onValueChange={(v) => { setFinishedItemId(v === "none" ? "" : v); setBomId(""); }}>
                  <SelectTrigger><SelectValue placeholder={t("manufacturing.finishedItem")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {itemList.map((i) => (<SelectItem key={i.id} value={i.id}>{i.sku} — {i.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("manufacturing.boms")}</Label>
                <Select value={bomId || "none"} onValueChange={(v) => setBomId(v === "none" ? "" : v)} disabled={!finishedItemId}>
                  <SelectTrigger><SelectValue placeholder={t("manufacturing.boms")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {bomList.map((b) => (<SelectItem key={b.id} value={b.id}>v{b.version} — {formatMoney(b.standardCostMinor, "SAR", locale)}</SelectItem>))}
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
              <div className="space-y-1"><Label>{t("manufacturing.qtyPlanned")}</Label><Input type="number" min={1} value={qtyPlanned} onChange={(e) => setQtyPlanned(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("manufacturing.dueDate")}</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            </div>
            <Button disabled={!finishedItemId || !bomId || !warehouseId || Number(qtyPlanned) <= 0} onClick={() => create.mutate()}>{t("manufacturing.addWorkOrder")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("manufacturing.workOrders")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
        {d && (
          <Card>
            <CardHeader><CardTitle>{d.number} — {d.finishedItem?.name ?? ""}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-6">
                <span>{t("manufacturing.completion")}: {d.completionPct}%</span>
                <span>{t("manufacturing.plannedCost")}: {formatMoney(d.materialCostPlannedMinor, "SAR", locale)}</span>
                <span>{t("manufacturing.actualCost")}: {formatMoney(d.materialCostActualMinor, "SAR", locale)}</span>
                <span>{t("manufacturing.wipBalance")}: {formatMoney(d.wipBalanceMinor ?? 0, "SAR", locale)}</span>
                {d.variance && <span>{t("inventory.variance")}: {formatMoney(d.variance.varianceMinor, "SAR", locale)}</span>}
              </div>
              <div>
                <p className="font-medium">{t("manufacturing.component")}</p>
                {(d.lines ?? []).map((l) => (
                  <p key={l.id}>{l.componentItem?.sku} — {t("manufacturing.quantityPerUnit")} {l.quantityPerUnit} · {t("manufacturing.materialIssued")} {l.qtyIssued}/{l.qtyRequired}</p>
                ))}
              </div>
              <div>
                <p className="font-medium">{t("manufacturing.operation")}</p>
                {(d.operations ?? []).map((o) => (
                  <p key={o.id}>{o.name} — {o.plannedHours}h {t("manufacturing.plannedHours")}{o.actualHours != null ? ` · ${o.actualHours}h ${t("manufacturing.actualHours")}` : ""}</p>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
