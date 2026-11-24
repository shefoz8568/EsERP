"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, Label, toast } from "@eserp/ui";
import { asList, settingsApi } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Branch, Paginated, Warehouse } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

function useCrud<T extends { id: string }>(
  queryKey: string[],
  list: () => Promise<T[] | Paginated<T>>,
) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey, queryFn: list });
  const invalidate = () => void queryClient.invalidateQueries({ queryKey });
  return { ...query, items: asList<T>(query.data), invalidate };
}

export function WarehousesTab() {
  const t = useTranslations();

  const warehouses = useCrud(["warehouses"], () => settingsApi.listWarehouses());
  const branches = useCrud(["branches"], () => settingsApi.listBranches());

  const [whName, setWhName] = useState("");
  const [whCity, setWhCity] = useState("");
  const [brName, setBrName] = useState("");
  const [brCity, setBrCity] = useState("");

  const createWarehouse = useMutation({
    mutationFn: () => settingsApi.createWarehouse({ name: whName, city: whCity }),
    onSuccess: () => { toast.success(t("common.success")); setWhName(""); setWhCity(""); warehouses.invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const deleteWarehouse = useMutation({
    mutationFn: (id: string) => settingsApi.deleteWarehouse(id),
    onSuccess: () => { toast.success(t("common.success")); warehouses.invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  const createBranch = useMutation({
    mutationFn: () => settingsApi.createBranch({ name: brName, city: brCity }),
    onSuccess: () => { toast.success(t("common.success")); setBrName(""); setBrCity(""); branches.invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });
  // NOTE: the API has no DELETE /settings/branches/:id, so branches are
  // list + create only (warehouses support delete).

  const deleteButton = (id: string, pending: boolean, onClick: (id: string) => void) => (
    <Button variant="destructive" size="sm" disabled={pending} onClick={() => onClick(id)}>
      {t("common.delete")}
    </Button>
  );

  const warehouseColumns: ColumnDef<Warehouse>[] = [
    { accessorKey: "name", header: t("settings.warehouse.name") },
    { accessorKey: "city", header: t("settings.warehouse.city") },
    { accessorKey: "address", header: t("settings.warehouse.address") },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => deleteButton(row.original.id, deleteWarehouse.isPending, (id) => deleteWarehouse.mutate(id)),
    },
  ];
  const branchColumns: ColumnDef<Branch>[] = [
    { accessorKey: "name", header: t("settings.branch.name") },
    { accessorKey: "city", header: t("settings.branch.city") },
  ];

  if (warehouses.isLoading || branches.isLoading)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (warehouses.isError || branches.isError)
    return <ErrorState onRetry={() => { void warehouses.refetch(); void branches.refetch(); }} />;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-lg font-medium">{t("settings.warehouses")}</h3>
        <DataTable columns={warehouseColumns} data={warehouses.items} emptyMessage={t("common.noData")} />
        <form
          className="max-w-xl space-y-4 rounded-lg border p-4"
          onSubmit={(e) => { e.preventDefault(); if (whName.trim()) createWarehouse.mutate(); }}
        >
          <h4 className="font-medium">{t("settings.warehouse.addWarehouse")}</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="wh-name">{t("settings.warehouse.name")}</Label>
              <Input id="wh-name" value={whName} onChange={(e) => setWhName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wh-city">{t("settings.warehouse.city")}</Label>
              <Input id="wh-city" value={whCity} onChange={(e) => setWhCity(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={createWarehouse.isPending}>{t("common.add")}</Button>
        </form>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-medium">{t("settings.branches")}</h3>
        <DataTable columns={branchColumns} data={branches.items} emptyMessage={t("common.noData")} />
        <form
          className="max-w-xl space-y-4 rounded-lg border p-4"
          onSubmit={(e) => { e.preventDefault(); if (brName.trim()) createBranch.mutate(); }}
        >
          <h4 className="font-medium">{t("settings.branch.addBranch")}</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="br-name">{t("settings.branch.name")}</Label>
              <Input id="br-name" value={brName} onChange={(e) => setBrName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="br-city">{t("settings.branch.city")}</Label>
              <Input id="br-city" value={brCity} onChange={(e) => setBrCity(e.target.value)} />
            </div>
          </div>
          <Button type="submit" disabled={createBranch.isPending}>{t("common.add")}</Button>
        </form>
      </section>
    </div>
  );
}
