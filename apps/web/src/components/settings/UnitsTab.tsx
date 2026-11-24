"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, Label, toast } from "@eserp/ui";
import { asList, settingsApi } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Unit } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

/**
 * Units of measure. Real DTO: { code, name, nameAr?, baseUnitCode? }.
 * There is no DELETE/PATCH route for units in the API, and conversions
 * live on a separate POST /settings/units/conversions endpoint, so this
 * tab is create + list only.
 */
export function UnitsTab() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [baseUnitCode, setBaseUnitCode] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["units"],
    queryFn: () => settingsApi.listUnits(),
  });
  const units = asList<Unit>(data);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["units"] });

  const create = useMutation({
    mutationFn: () =>
      settingsApi.createUnit({ code: code.toUpperCase(), name, baseUnitCode: baseUnitCode || undefined }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setName(""); setCode(""); setBaseUnitCode("");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<Unit>[] = [
    { accessorKey: "code", header: t("settings.unit.symbol") },
    { accessorKey: "name", header: t("settings.unit.name") },
    { accessorKey: "baseUnitCode", header: t("settings.unit.conversionFactor") },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <DataTable columns={columns} data={units} emptyMessage={t("common.noData")} />
      <form
        className="max-w-xl space-y-4 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim() && code.trim()) create.mutate();
        }}
      >
        <h3 className="font-medium">{t("settings.unit.addUnit")}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="unit-name">{t("settings.unit.name")}</Label>
            <Input id="unit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit-code">{t("settings.unit.symbol")}</Label>
            <Input id="unit-code" value={code} maxLength={20} className="uppercase" onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="unit-base">{t("settings.unit.conversionFactor")}</Label>
            <Input id="unit-base" value={baseUnitCode} maxLength={20} className="uppercase" onChange={(e) => setBaseUnitCode(e.target.value)} placeholder="PCS" />
          </div>
        </div>
        <Button type="submit" disabled={create.isPending}>{t("common.add")}</Button>
      </form>
    </div>
  );
}
