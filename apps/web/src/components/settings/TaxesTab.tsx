"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Input, Label, toast } from "@eserp/ui";
import { asList, settingsApi } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatPercent } from "@/lib/money";
import { bpsToPercent, percentToBps, type Tax } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export function TaxesTab() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [name, setName] = useState("VAT");
  const [rate, setRate] = useState(15);
  const [inclusive, setInclusive] = useState(false);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["taxes"],
    queryFn: () => settingsApi.listTaxes(),
  });
  const taxes = asList<Tax>(data);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["taxes"] });

  const create = useMutation({
    mutationFn: () =>
      settingsApi.createTax({
        name,
        rateBps: percentToBps(rate),
        type: "standard",
        isInclusive: inclusive,
        isDefault: false,
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => settingsApi.deleteTax(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<Tax>[] = [
    { accessorKey: "name", header: t("settings.tax.name") },
    {
      accessorKey: "rateBps",
      header: t("settings.tax.rate"),
      cell: ({ row }) => formatPercent(bpsToPercent(row.original.rateBps), "en"),
    },
    {
      accessorKey: "isInclusive",
      header: t("settings.tax.type"),
      cell: ({ row }) =>
        row.original.isInclusive ? (
          <Badge variant="secondary">{t("settings.tax.inclusive")}</Badge>
        ) : (
          <Badge variant="outline">{t("settings.tax.exclusive")}</Badge>
        ),
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button variant="destructive" size="sm" disabled={remove.isPending} onClick={() => remove.mutate(row.original.id)}>
          {t("common.delete")}
        </Button>
      ),
    },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <DataTable columns={columns} data={taxes} emptyMessage={t("common.noData")} />
      <form
        className="max-w-xl space-y-4 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) create.mutate();
        }}
      >
        <h3 className="font-medium">{t("settings.tax.addTax")}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="tax-name">{t("settings.tax.name")}</Label>
            <Input id="tax-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tax-rate">{t("settings.tax.rate")}</Label>
            <Input id="tax-rate" type="number" min={0} max={100} value={rate} onChange={(e) => setRate(Number(e.target.value))} />
          </div>
          <div className="space-y-2">
            <Label>{t("settings.tax.type")}</Label>
            <div className="flex h-9 items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="taxType" checked={!inclusive} onChange={() => setInclusive(false)} />
                {t("settings.tax.exclusive")}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="taxType" checked={inclusive} onChange={() => setInclusive(true)} />
                {t("settings.tax.inclusive")}
              </label>
            </div>
          </div>
        </div>
        <Button type="submit" disabled={create.isPending}>{t("common.add")}</Button>
      </form>
    </div>
  );
}
