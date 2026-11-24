"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, contactsApi, itemsApi, salesApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { DocLinesEditor, emptyDocLine, toApiLines, type DocLineDraft } from "@/components/DocLinesEditor";
import { formatMoney } from "@/lib/money";
import type { SalesOrder } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function SalesOrdersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [lines, setLines] = useState<DocLineDraft[]>([emptyDocLine()]);

  const query = useQuery({
    queryKey: ["sales-orders", search, status],
    queryFn: () => salesApi.listOrders({ search: search || undefined, status: status || undefined }),
  });
  const customers = useQuery({ queryKey: ["contacts-customers"], queryFn: () => contactsApi.list({ type: "CUSTOMER", pageSize: 100 }) });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const orders = asList<SalesOrder>(query.data);
  const customerList = asList(customers.data);
  const itemList = asList(items.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
  const onSuccess = () => { toast.success(t("common.success")); invalidate(); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => salesApi.createOrder({ customerId, lines: toApiLines(lines) }),
    onSuccess: () => { toast.success(t("common.success")); setLines([emptyDocLine()]); invalidate(); },
    onError,
  });
  const confirm = useMutation({ mutationFn: (id: string) => salesApi.confirmOrder(id), onSuccess, onError });
  const cancel = useMutation({ mutationFn: (id: string) => salesApi.cancelOrder(id), onSuccess, onError });

  const columns: ColumnDef<SalesOrder>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "customer", header: t("sales.customer"), cell: ({ row }) => row.original.customer?.displayName ?? "—" },
    {
      accessorKey: "totalMinor",
      header: t("sales.total"),
      cell: ({ row }) => formatMoney(row.original.totalMinor, row.original.currency, locale),
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => <Badge variant={row.original.status === "CONFIRMED" ? "default" : row.original.status === "CANCELLED" ? "destructive" : "secondary"}>{row.original.status}</Badge>,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex gap-2">
          {row.original.status === "DRAFT" && <Button size="sm" onClick={() => confirm.mutate(row.original.id)}>{t("sales.confirm")}</Button>}
          {["DRAFT", "CONFIRMED"].includes(row.original.status) && (
            <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.original.id)}>{t("sales.cancel")}</Button>
          )}
        </div>
      ),
    },
  ];

  const valid = customerId && lines.every((l) => l.itemId && Number(l.quantity) > 0 && Number(l.unitPrice) >= 0);

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("sales.salesOrders")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardHeader><CardTitle>{t("sales.addOrder")}</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label>{t("sales.customer")}</Label>
                <Select value={customerId || "none"} onValueChange={(v) => setCustomerId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("sales.customer")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {customerList.map((c) => (<SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DocLinesEditor items={itemList} lines={lines} onChange={setLines} />
            <div className="mt-4">
              <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>{t("common.save")}</Button>
            </div>
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
                  {["DRAFT", "CONFIRMED", "PARTIALLY_FULFILLED", "FULFILLED", "CANCELLED"].map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <DataTable columns={columns} data={orders} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
