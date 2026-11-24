"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, itemsApi, manufacturingApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { Bom, Item, WorkCenter } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

type LineDraft = { componentItemId: string; quantityPerUnit: number; scrapBps: number; workCenterId: string };

export default function BomsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [finishedItemId, setFinishedItemId] = useState("");
  const [version, setVersion] = useState("1");
  const [lines, setLines] = useState<LineDraft[]>([{ componentItemId: "", quantityPerUnit: 1, scrapBps: 0, workCenterId: "" }]);

  const query = useQuery({ queryKey: ["boms"], queryFn: () => manufacturingApi.listBoms({ pageSize: 100 }) });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 200 }) });
  const workCenters = useQuery({ queryKey: ["work-centers"], queryFn: () => manufacturingApi.listWorkCenters({ pageSize: 100 }) });
  const rows = asList<Bom>(query.data);
  const itemList = asList<Item>(items.data);
  const wcList = asList<WorkCenter>(workCenters.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["boms"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      manufacturingApi.createBom({
        finishedItemId,
        version: Number(version),
        status: "DRAFT",
        lines: lines
          .filter((l) => l.componentItemId && l.quantityPerUnit > 0)
          .map((l) => ({ componentItemId: l.componentItemId, quantityPerUnit: l.quantityPerUnit, scrapBps: l.scrapBps, workCenterId: l.workCenterId || null })),
      }),
    onSuccess: () => { toast.success(t("common.success")); setFinishedItemId(""); setVersion("1"); setLines([{ componentItemId: "", quantityPerUnit: 1, scrapBps: 0, workCenterId: "" }]); invalidate(); },
    onError,
  });
  const activate = useMutation({ mutationFn: (id: string) => manufacturingApi.updateBom(id, { status: "ACTIVE" }), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const remove = useMutation({ mutationFn: (id: string) => manufacturingApi.deleteBom(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const setLine = (i: number, patch: Partial<LineDraft>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const columns: ColumnDef<Bom>[] = [
    { accessorKey: "finishedItem", header: t("manufacturing.finishedItem"), cell: ({ row }) => `${row.original.finishedItem?.sku ?? "—"} — ${row.original.finishedItem?.name ?? ""}` },
    { accessorKey: "version", header: t("manufacturing.version") },
    { accessorKey: "standardCostMinor", header: t("manufacturing.standardCost"), cell: ({ row }) => formatMoney(row.original.standardCostMinor, "SAR", locale) },
    { accessorKey: "lines", header: t("manufacturing.component"), cell: ({ row }) => row.original.lines.map((l) => `${l.componentItem?.sku ?? l.componentItemId} × ${l.quantityPerUnit}${l.scrapBps ? ` (+${l.scrapBps / 100}%)` : ""}`).join(", ") },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "ACTIVE" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {row.original.status === "DRAFT" && <Button size="sm" onClick={() => activate.mutate(row.original.id)}>{t("manufacturing.activate")}</Button>}
          {row.original.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>}
        </div>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("manufacturing.boms")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("manufacturing.addBom")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>{t("manufacturing.finishedItem")}</Label>
                <Select value={finishedItemId || "none"} onValueChange={(v) => setFinishedItemId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("manufacturing.finishedItem")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {itemList.map((i) => (<SelectItem key={i.id} value={i.id}>{i.sku} — {i.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("manufacturing.version")}</Label><Input type="number" min={1} value={version} onChange={(e) => setVersion(e.target.value)} /></div>
            </div>
            <div className="space-y-2">
              {lines.map((l, i) => (
                <div key={i} className="flex flex-wrap items-end gap-3">
                  <div className="w-64 space-y-1">
                    <Label>{t("manufacturing.component")}</Label>
                    <Select value={l.componentItemId || "none"} onValueChange={(v) => setLine(i, { componentItemId: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder={t("manufacturing.component")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {itemList.map((it) => (<SelectItem key={it.id} value={it.id}>{it.sku} — {it.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-28 space-y-1"><Label>{t("manufacturing.quantityPerUnit")}</Label><Input type="number" min={1} value={l.quantityPerUnit} onChange={(e) => setLine(i, { quantityPerUnit: Number(e.target.value) })} /></div>
                  <div className="w-28 space-y-1"><Label>{t("manufacturing.scrapPct")}</Label><Input type="number" min={0} value={l.scrapBps / 100} onChange={(e) => setLine(i, { scrapBps: Math.round(Number(e.target.value) * 100) })} /></div>
                  <div className="w-48 space-y-1">
                    <Label>{t("manufacturing.operation")}</Label>
                    <Select value={l.workCenterId || "none"} onValueChange={(v) => setLine(i, { workCenterId: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {wcList.map((w) => (<SelectItem key={w.id} value={w.id}>{w.code} — {w.name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setLines(lines.filter((_, j) => j !== i))}>{t("common.delete")}</Button>
                </div>
              ))}
              <Button size="sm" variant="outline" onClick={() => setLines([...lines, { componentItemId: "", quantityPerUnit: 1, scrapBps: 0, workCenterId: "" }])}>{t("common.add")}</Button>
            </div>
            <Button disabled={!finishedItemId || !lines.some((l) => l.componentItemId && l.quantityPerUnit > 0)} onClick={() => create.mutate()}>{t("manufacturing.addBom")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("manufacturing.boms")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
