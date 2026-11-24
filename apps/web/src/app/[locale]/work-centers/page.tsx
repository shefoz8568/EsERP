"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@eserp/ui";
import { asList, manufacturingApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { WorkCenter } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function WorkCentersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [rateSar, setRateSar] = useState("");

  const query = useQuery({ queryKey: ["work-centers"], queryFn: () => manufacturingApi.listWorkCenters({ pageSize: 100 }) });
  const rows = asList<WorkCenter>(query.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["work-centers"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => manufacturingApi.createWorkCenter({ code, name, nameAr: nameAr || undefined, standardCostRateMinor: Math.round(Number(rateSar || 0) * 100) }),
    onSuccess: () => { toast.success(t("common.success")); setCode(""); setName(""); setNameAr(""); setRateSar(""); invalidate(); },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => manufacturingApi.deleteWorkCenter(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<WorkCenter>[] = [
    { accessorKey: "code", header: t("pos.code") },
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "standardCostRateMinor", header: t("manufacturing.hourlyRate"), cell: ({ row }) => `${formatMoney(row.original.standardCostRateMinor, "SAR", locale)} / h` },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "ACTIVE" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("manufacturing.workCenters")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("manufacturing.addWorkCenter")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1"><Label>{t("pos.code")}</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="WC-PACK-01" /></div>
              <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("common.name")} (AR)</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("manufacturing.hourlyRate")} (SAR)</Label><Input type="number" min={0} value={rateSar} onChange={(e) => setRateSar(e.target.value)} /></div>
            </div>
            <Button disabled={!code || !name} onClick={() => create.mutate()}>{t("manufacturing.addWorkCenter")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("manufacturing.workCenters")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
