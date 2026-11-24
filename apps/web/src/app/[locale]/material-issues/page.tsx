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
import type { MaterialIssue, Warehouse, WorkOrder } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function MaterialIssuesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [workOrderId, setWorkOrderId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [qtys, setQtys] = useState<Record<string, number>>({});

  const query = useQuery({ queryKey: ["material-issues"], queryFn: () => manufacturingApi.listIssues({ pageSize: 100 }) });
  const workOrders = useQuery({ queryKey: ["work-orders-open"], queryFn: () => manufacturingApi.listWorkOrders({ pageSize: 100 }) });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const detail = useQuery({ queryKey: ["work-order", workOrderId], queryFn: () => manufacturingApi.getWorkOrder(workOrderId), enabled: !!workOrderId });
  const rows = asList<MaterialIssue>(query.data);
  const woList = asList<WorkOrder>(workOrders.data).filter((w) => w.status === "RELEASED" || w.status === "IN_PROGRESS");
  const warehouseList = asList<Warehouse>(warehouses.data);
  const selectedWo = detail.data;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["material-issues"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      manufacturingApi.createIssue({
        workOrderId,
        warehouseId,
        issueDate: `${issueDate}T00:00:00.000Z`,
        lines: (selectedWo?.lines ?? [])
          .filter((l) => (qtys[l.id] ?? 0) > 0)
          .map((l) => ({ workOrderLineId: l.id, itemId: l.componentItemId, quantity: qtys[l.id] })),
      }),
    onSuccess: () => { toast.success(t("common.success")); setQtys({}); setWorkOrderId(""); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => manufacturingApi.postIssue(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => manufacturingApi.cancelIssue(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<MaterialIssue>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "workOrder", header: t("manufacturing.workOrder"), cell: ({ row }) => row.original.workOrder?.number ?? "—" },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "issueDate", header: t("manufacturing.issueDate"), cell: ({ row }) => row.original.issueDate.slice(0, 10) },
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
        <h1 className="text-2xl font-bold">{t("manufacturing.materialIssues")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("manufacturing.addIssue")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("manufacturing.workOrder")}</Label>
                <Select value={workOrderId || "none"} onValueChange={(v) => { setWorkOrderId(v === "none" ? "" : v); setQtys({}); }}>
                  <SelectTrigger><SelectValue placeholder={t("manufacturing.workOrder")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {woList.map((w) => (<SelectItem key={w.id} value={w.id}>{w.number} — {w.finishedItem?.name ?? ""}</SelectItem>))}
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
              <div className="space-y-1"><Label>{t("manufacturing.issueDate")}</Label><Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
            </div>
            {selectedWo && (
              <div className="space-y-2">
                {(selectedWo.lines ?? []).map((l) => (
                  <div key={l.id} className="flex items-center gap-3 text-sm">
                    <span className="w-56">{l.componentItem?.sku} — {l.componentItem?.name}</span>
                    <span>{t("manufacturing.materialIssued")} {l.qtyIssued} / {l.qtyRequired}</span>
                    <Input type="number" min={0} max={l.qtyRequired - l.qtyIssued} className="w-28" placeholder={t("manufacturing.quantity")} value={qtys[l.id] ?? ""} onChange={(e) => setQtys({ ...qtys, [l.id]: Number(e.target.value) })} />
                  </div>
                ))}
              </div>
            )}
            <Button disabled={!workOrderId || !warehouseId || !(selectedWo?.lines ?? []).some((l) => (qtys[l.id] ?? 0) > 0)} onClick={() => create.mutate()}>{t("manufacturing.addIssue")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("manufacturing.materialIssues")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
