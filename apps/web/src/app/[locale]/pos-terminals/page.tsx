"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, posApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Branch, PosTerminal, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function PosTerminalsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [branchId, setBranchId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");

  const query = useQuery({ queryKey: ["pos-terminals"], queryFn: () => posApi.listTerminals({ pageSize: 100 }) });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => settingsApi.listBranches() });
  const warehouses = useQuery({ queryKey: ["warehouses"], queryFn: () => settingsApi.listWarehouses() });
  const rows = asList<PosTerminal>(query.data);
  const branchList = asList<Branch>(branches.data);
  const warehouseList = asList<Warehouse>(warehouses.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pos-terminals"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => posApi.createTerminal({ code, name, branchId, warehouseId }),
    onSuccess: () => { toast.success(t("common.success")); setCode(""); setName(""); invalidate(); },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (row: PosTerminal) => posApi.updateTerminal(row.id, { status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });

  const columns: ColumnDef<PosTerminal>[] = [
    { accessorKey: "code", header: t("pos.code") },
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "branch", header: t("pos.branch"), cell: ({ row }) => row.original.branch?.name ?? "—" },
    { accessorKey: "warehouse", header: t("inventory.warehouse"), cell: ({ row }) => row.original.warehouse?.name ?? "—" },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "ACTIVE" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => toggle.mutate(row.original)}>
          {row.original.status === "ACTIVE" ? t("common.inactive") : t("common.active")}
        </Button>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("pos.terminals")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("pos.addTerminal")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1"><Label>{t("pos.code")}</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="POS-RIY-01" /></div>
              <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1">
                <Label>{t("pos.branch")}</Label>
                <Select value={branchId || "none"} onValueChange={(v) => setBranchId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("pos.branch")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {branchList.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
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
            </div>
            <Button disabled={!code || !name || !branchId || !warehouseId} onClick={() => create.mutate()}>{t("pos.addTerminal")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("pos.terminals")}</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
