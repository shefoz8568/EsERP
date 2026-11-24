"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, itemsApi, priceListsApi } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormPageHeader, FormSection } from "@/components/FormPage";
import type { PriceListItem } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function PriceListDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["pricelists", id], queryFn: () => priceListsApi.get(id) });
  const list = query.data;
  const itemsQuery = useQuery({ queryKey: ["items", "all"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const allItems = asList(itemsQuery.data);
  const [itemId, setItemId] = useState("");
  const [price, setPrice] = useState("");
  const [minQuantity, setMinQuantity] = useState("1");
  const [triedSave, setTriedSave] = useState(false);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pricelists", id] });

  const addLine = useMutation({
    mutationFn: () =>
      priceListsApi.addItem(id, { itemId, priceMinor: Math.round(Number(price) * 100), minQuantity: Number(minQuantity) || 1 }),
    onSuccess: () => { toast.success(t("common.success")); setItemId(""); setPrice(""); setMinQuantity("1"); setTriedSave(false); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const removeLine = useMutation({
    mutationFn: (lineId: string) => priceListsApi.removeItem(id, lineId),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const removeList = useMutation({
    mutationFn: () => priceListsApi.delete(id),
    onSuccess: () => { toast.success(t("common.success")); router.push(`/${locale}/pricelists`); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<PriceListItem>[] = [
    {
      accessorKey: "item",
      header: t("masterData.items"),
      cell: ({ row }) => `${row.original.item?.sku ?? ""} · ${row.original.item?.name ?? row.original.itemId}`,
    },
    {
      accessorKey: "priceMinor",
      header: t("masterData.price"),
      meta: { numeric: true },
      cell: ({ row }) => formatMoney(row.original.priceMinor, list?.currency ?? "SAR", locale),
    },
    { accessorKey: "minQuantity", header: t("masterData.minQuantity"), meta: { numeric: true } },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button variant="destructive" size="sm" onClick={() => removeLine.mutate(row.original.id)}>
          {t("common.delete")}
        </Button>
      ),
    },
  ];

  const valid = !!itemId && !!price && Number(price) >= 0 && Number(minQuantity) >= 1;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <FormPageHeader
          title={list?.name ?? t("common.loading")}
          subtitle={list ? `${list.currency}` : undefined}
          onBack={() => router.push(`/${locale}/pricelists`)}
          backLabel={t("common.back")}
          actions={
            <Button variant="destructive" disabled={removeList.isPending} onClick={() => removeList.mutate()}>
              {t("common.delete")}
            </Button>
          }
        />
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : !list ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <FormSection id="add-price" title={t("masterData.addPrice")}>
              <div className="flex flex-wrap items-end gap-3">
                <FormField label={t("masterData.items")} required error={triedSave && !itemId ? t("common.required") : undefined}>
                  <Select value={itemId || "NONE"} onValueChange={(v) => setItemId(v === "NONE" ? "" : v)}>
                    <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">—</SelectItem>
                      {allItems.map((it) => <SelectItem key={it.id} value={it.id}>{it.sku} · {it.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={`${t("masterData.price")} (${list.currency})`} required error={triedSave && !price ? t("common.required") : undefined}>
                  <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} className="w-32" />
                </FormField>
                <FormField label={t("masterData.minQuantity")} required>
                  <Input type="number" min="1" value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} className="w-24" />
                </FormField>
                <Button
                  disabled={addLine.isPending}
                  onClick={() => {
                    setTriedSave(true);
                    if (valid) addLine.mutate();
                  }}
                >
                  {t("masterData.addPrice")}
                </Button>
              </div>
              {triedSave && !valid && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {t("common.required")}
                </p>
              )}
            </FormSection>
            {(list.items ?? []).length === 0 ? (
              <EmptyState message={t("common.noData")} />
            ) : (
              <DataTable id="pricelist-lines" columns={columns} data={list.items ?? []} ariaLabel={t("masterData.price")} />
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
