"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, itemsApi, settingsApi } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormSection } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";
import type { Item } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

type ItemView = "all" | "ACTIVE" | "INACTIVE" | "DISCONTINUED";

export default function ItemsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [newCategoryId, setNewCategoryId] = useState<string>("");
  const [newUomId, setNewUomId] = useState<string>("");
  const [salesPrice, setSalesPrice] = useState("");
  const [purchasePrice, setPurchasePrice] = useState("");
  const [catCode, setCatCode] = useState("");
  const [catName, setCatName] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<ItemView>("all");
  const [triedSave, setTriedSave] = useState(false);

  const isClientView = view !== "all";
  useEffect(() => {
    setPage(1);
  }, [search, categoryId, view]);

  const query = useQuery({
    queryKey: ["items", search, categoryId, isClientView ? "client-view" : page],
    queryFn: () =>
      itemsApi.list({
        search: search || undefined,
        categoryId: categoryId || undefined,
        page: isClientView ? 1 : page,
        pageSize: isClientView ? 100 : 10,
      }),
  });
  const categories = useQuery({ queryKey: ["item-categories"], queryFn: () => itemsApi.listCategories() });
  const units = useQuery({ queryKey: ["units"], queryFn: () => settingsApi.listUnits() });
  const items = asList<Item>(query.data);
  const categoryList = asList(categories.data);
  const unitList = asList(units.data);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["items"] });
    void queryClient.invalidateQueries({ queryKey: ["item-categories"] });
  };

  const create = useMutation({
    mutationFn: () =>
      itemsApi.create({
        sku, name, categoryId: newCategoryId || undefined, defaultUomId: newUomId,
        salesPriceMinor: salesPrice ? Math.round(Number(salesPrice) * 100) : 0,
        purchasePriceMinor: purchasePrice ? Math.round(Number(purchasePrice) * 100) : 0,
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setSku(""); setName(""); setSalesPrice(""); setPurchasePrice(""); setTriedSave(false);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const createCategory = useMutation({
    mutationFn: () => itemsApi.createCategory({ code: catCode.toUpperCase(), name: catName }),
    onSuccess: () => { toast.success(t("common.success")); setCatCode(""); setCatName(""); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => itemsApi.delete(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const visibleItems = isClientView ? items.filter((i) => i.status === view) : items;

  const columns: ColumnDef<Item>[] = [
    {
      accessorKey: "sku",
      header: t("masterData.sku"),
      cell: ({ row }) => (
        <Link href={`/${locale}/items/${row.original.id}`} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {row.original.sku}
        </Link>
      ),
    },
    { accessorKey: "name", header: t("common.name") },
    {
      accessorKey: "category",
      header: t("masterData.category"),
      cell: ({ row }) => row.original.category?.name ?? "—",
    },
    {
      accessorKey: "salesPriceMinor",
      header: t("masterData.salesPrice"),
      meta: { numeric: true },
      cell: ({ row }) => formatMoney(row.original.salesPriceMinor, row.original.salesPriceCurrency, locale),
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
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

  const valid = !!sku && !!name && !!newUomId;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("masterData.items")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormSection id="add-item" title={t("masterData.addItem")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label={t("masterData.sku")} required error={triedSave && !sku ? t("common.required") : undefined}>
                  <Input value={sku} onChange={(e) => setSku(e.target.value)} />
                </FormField>
                <FormField label={t("common.name")} required error={triedSave && !name ? t("common.required") : undefined}>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.category")}>
                  <Select value={newCategoryId || "NONE"} onValueChange={(v) => setNewCategoryId(v === "NONE" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">—</SelectItem>
                      {categoryList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("masterData.unit")} required error={triedSave && !newUomId ? t("common.required") : undefined}>
                  <Select value={newUomId || "NONE"} onValueChange={(v) => setNewUomId(v === "NONE" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">—</SelectItem>
                      {unitList.map((u) => <SelectItem key={u.id} value={u.id}>{u.code} · {u.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={`${t("masterData.salesPrice")} (SAR)`}>
                  <Input type="number" min="0" step="0.01" value={salesPrice} onChange={(e) => setSalesPrice(e.target.value)} />
                </FormField>
                <FormField label={`${t("masterData.purchasePrice")} (SAR)`}>
                  <Input type="number" min="0" step="0.01" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
                </FormField>
              </div>
              <Button
                className="mt-4"
                disabled={create.isPending}
                onClick={() => {
                  setTriedSave(true);
                  if (valid) create.mutate();
                }}
              >
                {t("masterData.addItem")}
              </Button>
              {triedSave && !valid && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {t("common.required")}
                </p>
              )}
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t("masterData.categories")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1"><Label>{t("masterData.code")}</Label><Input value={catCode} onChange={(e) => setCatCode(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={catName} onChange={(e) => setCatName(e.target.value)} /></div>
              <Button disabled={!catCode || !catName || createCategory.isPending} onClick={() => createCategory.mutate()}>
                {t("masterData.addCategory")}
              </Button>
            </div>
            <ul className="mt-3 space-y-1 text-sm">
              {categoryList.map((c) => (
                <li key={c.id} className="flex justify-between gap-4 border-b py-1 last:border-0">
                  <span>{c.code} · {c.name}</span>
                  <span className="text-muted-foreground">{c._count?.items ?? 0} {t("masterData.items")}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={categoryId || "ALL"} onValueChange={(v) => setCategoryId(v === "ALL" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("masterData.category")}</SelectItem>
              {categoryList.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <DataTable
            id="items"
            columns={columns}
            data={visibleItems}
            ariaLabel={t("masterData.items")}
            enableSelection
            bulkActions={[
              {
                id: "delete",
                label: t("common.delete"),
                variant: "destructive",
                onClick: (rows) => rows.forEach((r) => remove.mutate(r.id)),
              },
            ]}
            savedViews={[
              { id: "all", label: t("common.showAll") },
              { id: "ACTIVE", label: t("common.active") },
              { id: "INACTIVE", label: t("common.inactive") },
              { id: "DISCONTINUED", label: t("masterData.discontinued") },
            ]}
            activeViewId={view}
            onSelectView={(viewId) => setView(viewId as ItemView)}
            serverPagination={
              isClientView
                ? undefined
                : { page, pageSize: 10, total: asTotal(query.data), onPageChange: setPage }
            }
          />
        )}
      </div>
    </AppShell>
  );
}
