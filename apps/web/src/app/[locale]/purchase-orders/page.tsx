"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
import { Button, Card, CardContent, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, contactsApi, itemsApi, purchasingApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormSection } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";
import { DocLinesEditor, emptyDocLine, toApiLines, type DocLineDraft } from "@/components/DocLinesEditor";
import { formatMoney } from "@/lib/money";
import type { PurchaseOrder } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

type PoView = "all" | "draft" | "sent" | "confirmed" | "this-month";

const VIEW_STATUS: Partial<Record<PoView, string>> = {
  draft: "DRAFT",
  sent: "SENT",
  confirmed: "CONFIRMED",
};

export default function PurchaseOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [lines, setLines] = useState<DocLineDraft[]>([emptyDocLine()]);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<PoView>("all");
  const [triedSave, setTriedSave] = useState(false);

  const isClientView = view === "this-month";
  useEffect(() => {
    setPage(1);
  }, [search, status, view]);

  const query = useQuery({
    queryKey: ["purchase-orders", search, status, view, isClientView ? "client-view" : page],
    queryFn: () =>
      purchasingApi.listOrders({
        search: search || undefined,
        status: status || VIEW_STATUS[view] || undefined,
        page: isClientView ? 1 : page,
        pageSize: isClientView ? 100 : 10,
      }),
  });
  const suppliers = useQuery({ queryKey: ["contacts-suppliers"], queryFn: () => contactsApi.list({ type: "SUPPLIER", pageSize: 100 }) });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const orders = asList<PurchaseOrder>(query.data);
  const supplierList = asList(suppliers.data);
  const itemList = asList(items.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["purchase-orders"] });
  const onSuccess = () => { toast.success(t("common.success")); invalidate(); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      purchasingApi.createOrder({
        supplierId,
        expectedDate: expectedDate ? `${expectedDate}T00:00:00.000Z` : null,
        lines: toApiLines(lines),
      }),
    onSuccess: () => { toast.success(t("common.success")); setLines([emptyDocLine()]); setTriedSave(false); invalidate(); },
    onError,
  });
  const send = useMutation({ mutationFn: (id: string) => purchasingApi.sendOrder(id), onSuccess, onError });
  const confirm = useMutation({ mutationFn: (id: string) => purchasingApi.confirmOrder(id), onSuccess, onError });
  const close = useMutation({ mutationFn: (id: string) => purchasingApi.closeOrder(id), onSuccess, onError });
  const cancel = useMutation({ mutationFn: (id: string) => purchasingApi.cancelOrder(id), onSuccess, onError });

  const thisMonth = new Date().toISOString().slice(0, 7);
  const visibleOrders = isClientView
    ? orders.filter((o) => (o.expectedDate ?? "").slice(0, 7) === thisMonth)
    : orders;

  const columns: ColumnDef<PurchaseOrder>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "supplier", header: t("purchasing.supplier"), cell: ({ row }) => row.original.supplier?.displayName ?? "—" },
    { accessorKey: "expectedDate", header: t("purchasing.expectedDate"), cell: ({ row }) => row.original.expectedDate?.slice(0, 10) ?? "—" },
    {
      accessorKey: "totalMinor",
      header: t("sales.total"),
      meta: { numeric: true },
      cell: ({ row }) => formatMoney(row.original.totalMinor, row.original.currency, locale),
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
        <div className="flex flex-wrap gap-2">
          {row.original.status === "DRAFT" && <Button size="sm" onClick={() => send.mutate(row.original.id)}>{t("sales.send")}</Button>}
          {row.original.status === "SENT" && <Button size="sm" onClick={() => confirm.mutate(row.original.id)}>{t("sales.confirm")}</Button>}
          {["CONFIRMED", "RECEIVED"].includes(row.original.status) && (
            <Button size="sm" variant="outline" onClick={() => close.mutate(row.original.id)}>{t("purchasing.close")}</Button>
          )}
          {["DRAFT", "SENT", "CONFIRMED"].includes(row.original.status) && (
            <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.original.id)}>{t("sales.cancel")}</Button>
          )}
        </div>
      ),
    },
  ];

  const valid = supplierId && lines.every((l) => l.itemId && Number(l.quantity) > 0 && Number(l.unitPrice) >= 0);

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("purchasing.purchaseOrders")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormSection id="create-order" title={t("purchasing.addOrder")}>
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField
                  label={t("purchasing.supplier")}
                  required
                  error={triedSave && !supplierId ? t("common.required") : undefined}
                >
                  <Select value={supplierId || "none"} onValueChange={(v) => setSupplierId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder={t("purchasing.supplier")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {supplierList.map((c) => (<SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("purchasing.expectedDate")}>
                  <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                </FormField>
              </div>
              <DocLinesEditor items={itemList} lines={lines} onChange={setLines} />
              <div className="mt-4">
                <Button
                  disabled={create.isPending}
                  onClick={() => {
                    setTriedSave(true);
                    if (valid) create.mutate();
                  }}
                >
                  {t("common.save")}
                </Button>
                {triedSave && !valid && (
                  <p role="alert" className="mt-2 text-sm text-destructive">
                    {t("common.required")}
                  </p>
                )}
              </div>
            </FormSection>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap gap-3">
              <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.status")}</SelectItem>
                  {["DRAFT", "SENT", "CONFIRMED", "PARTIALLY_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"].map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {query.isError ? (
              <ErrorState onRetry={() => void query.refetch()} />
            ) : (
              <DataTable
                id="purchase-orders"
                columns={columns}
                data={visibleOrders}
                ariaLabel={t("purchasing.purchaseOrders")}
                enableSelection
                bulkActions={[
                  {
                    id: "send",
                    label: t("sales.send"),
                    disabled: (rows) => !rows.some((r) => r.status === "DRAFT"),
                    onClick: (rows) => rows.filter((r) => r.status === "DRAFT").forEach((r) => send.mutate(r.id)),
                  },
                  {
                    id: "confirm",
                    label: t("sales.confirm"),
                    disabled: (rows) => !rows.some((r) => r.status === "SENT"),
                    onClick: (rows) => rows.filter((r) => r.status === "SENT").forEach((r) => confirm.mutate(r.id)),
                  },
                  {
                    id: "cancel",
                    label: t("sales.cancel"),
                    variant: "outline",
                    disabled: (rows) => !rows.some((r) => ["DRAFT", "SENT", "CONFIRMED"].includes(r.status)),
                    onClick: (rows) => rows.filter((r) => ["DRAFT", "SENT", "CONFIRMED"].includes(r.status)).forEach((r) => cancel.mutate(r.id)),
                  },
                ]}
                savedViews={[
                  { id: "all", label: t("common.showAll") },
                  { id: "draft", label: "DRAFT" },
                  { id: "sent", label: "SENT" },
                  { id: "confirmed", label: "CONFIRMED" },
                  { id: "this-month", label: t("common.thisMonth") },
                ]}
                activeViewId={view}
                onSelectView={(viewId) => setView(viewId as PoView)}
                serverPagination={
                  isClientView
                    ? undefined
                    : { page, pageSize: 10, total: asTotal(query.data), onPageChange: setPage }
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
