"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Checkbox, Input, Label, toast } from "@eserp/ui";
import { asList, asTotal, priceListsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";
import type { PriceList } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function PriceListsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [currency, setCurrency] = useState("SAR");
  const [isDefault, setIsDefault] = useState(false);

  const query = useQuery({
    queryKey: ["pricelists", search],
    queryFn: () => priceListsApi.list({ search: search || undefined }),
  });
  const lists = asList<PriceList>(query.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["pricelists"] });

  const create = useMutation({
    mutationFn: () => priceListsApi.create({ name, currency: currency.toUpperCase(), isDefault }),
    onSuccess: () => { toast.success(t("common.success")); setName(""); setIsDefault(false); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => priceListsApi.delete(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<PriceList>[] = [
    {
      accessorKey: "name",
      header: t("common.name"),
      cell: ({ row }) => (
        <Link href={`/${locale}/pricelists/${row.original.id}`} className="font-medium text-primary hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    { accessorKey: "currency", header: t("masterData.currency") },
    {
      accessorKey: "isDefault",
      header: t("masterData.isDefault"),
      cell: ({ row }) => (row.original.isDefault ? <Badge>{t("masterData.isDefault")}</Badge> : <span className="text-muted-foreground">—</span>),
    },
    {
      accessorKey: "_count",
      header: t("masterData.items"),
      cell: ({ row }) => String(row.original._count?.items ?? 0),
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button variant="destructive" size="sm" onClick={() => remove.mutate(row.original.id)}>
          {t("common.delete")}
        </Button>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("masterData.priceLists")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardHeader><CardTitle>{t("masterData.addPriceList")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("masterData.currency")}</Label><Input value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-24" /></div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={isDefault} onCheckedChange={(v) => setIsDefault(v === true)} />
                {t("masterData.isDefault")}
              </label>
              <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>
                {t("masterData.addPriceList")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />

        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : lists.length === 0 ? (
          <EmptyState message={t("common.noData")} />
        ) : (
          <DataTable columns={columns} data={lists} />
        )}
      </div>
    </AppShell>
  );
}
