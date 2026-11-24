"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Input, Label, toast } from "@eserp/ui";
import { asList, settingsApi } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Currency } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export function CurrenciesTab() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["currencies"],
    queryFn: () => settingsApi.listCurrencies(),
  });
  const currencies = asList<Currency>(data);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["currencies"] });

  const create = useMutation({
    mutationFn: () => settingsApi.createCurrency({ code: code.toUpperCase(), name, symbol, isDefault: false }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setCode(""); setName(""); setSymbol("");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => settingsApi.deleteCurrency(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<Currency>[] = [
    { accessorKey: "code", header: t("settings.currency.code") },
    { accessorKey: "name", header: t("settings.currency.name") },
    { accessorKey: "symbol", header: t("settings.currency.symbol") },
    {
      accessorKey: "isDefault",
      header: t("settings.currency.isDefault"),
      cell: ({ row }) =>
        row.original.isDefault ? <Badge>{t("settings.currency.isDefault")}</Badge> : <span className="text-muted-foreground">—</span>,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button
          variant="destructive"
          size="sm"
          disabled={row.original.isDefault || remove.isPending}
          onClick={() => remove.mutate(row.original.id)}
        >
          {t("common.delete")}
        </Button>
      ),
    },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <DataTable columns={columns} data={currencies} emptyMessage={t("common.noData")} />
      <form
        className="max-w-xl space-y-4 rounded-lg border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (code.trim() && name.trim()) create.mutate();
        }}
      >
        <h3 className="font-medium">{t("settings.currency.addCurrency")}</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="cur-code">{t("settings.currency.code")}</Label>
            <Input id="cur-code" value={code} maxLength={3} className="uppercase" onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cur-name">{t("settings.currency.name")}</Label>
            <Input id="cur-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cur-symbol">{t("settings.currency.symbol")}</Label>
            <Input id="cur-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
          </div>
        </div>
        <Button type="submit" disabled={create.isPending}>{t("common.add")}</Button>
      </form>
    </div>
  );
}
