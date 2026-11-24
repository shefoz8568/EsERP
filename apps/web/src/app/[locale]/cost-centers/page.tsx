"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@eserp/ui";
import { accountingApi, asList, asTotal } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { CostCenter } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function CostCentersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");

  const query = useQuery({ queryKey: ["cost-centers", search], queryFn: () => accountingApi.listCostCenters({ search: search || undefined }) });
  const centers = asList<CostCenter>(query.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["cost-centers"] });

  const create = useMutation({
    mutationFn: () => accountingApi.createCostCenter({ code: code.toUpperCase(), name, nameAr: nameAr || undefined }),
    onSuccess: () => { toast.success(t("common.success")); setCode(""); setName(""); setNameAr(""); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const remove = useMutation({
    mutationFn: (id: string) => accountingApi.deleteCostCenter(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<CostCenter>[] = [
    { accessorKey: "code", header: t("masterData.code") },
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "nameAr", header: t("common.name"), cell: ({ row }) => row.original.nameAr ?? "—" },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => <Badge variant="secondary">{row.original.status}</Badge>,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button variant="destructive" size="sm" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("accounting.costCenters")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>
        <Card>
          <CardHeader><CardTitle>{t("accounting.addCostCenter")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label>{t("masterData.code")}</Label><Input value={code} onChange={(e) => setCode(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("common.name")} (ar)</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
              <Button disabled={!code || !name || create.isPending} onClick={() => create.mutate()}>{t("common.add")}</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Input className="mb-4 max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <DataTable columns={columns} data={centers} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
