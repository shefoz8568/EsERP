"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, contactsApi, itemsApi, purchasingApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { DocLinesEditor, emptyDocLine, toApiLines, type DocLineDraft } from "@/components/DocLinesEditor";
import { formatMoney } from "@/lib/money";
import type { SupplierInvoice } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function SupplierInvoicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DocLineDraft[]>([emptyDocLine()]);

  const query = useQuery({
    queryKey: ["supplier-invoices", search, status],
    queryFn: () => purchasingApi.listInvoices({ search: search || undefined, status: status || undefined }),
  });
  const suppliers = useQuery({ queryKey: ["contacts-suppliers"], queryFn: () => contactsApi.list({ type: "SUPPLIER", pageSize: 100 }) });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const pos = useQuery({
    queryKey: ["purchase-orders", supplierId],
    queryFn: () => purchasingApi.listOrders({ supplierId: supplierId || undefined, pageSize: 100 }),
    enabled: !!supplierId,
  });
  const selectedPo = useQuery({
    queryKey: ["purchase-order", purchaseOrderId],
    queryFn: () => purchasingApi.getOrder(purchaseOrderId),
    enabled: !!purchaseOrderId,
  });
  const invoices = asList<SupplierInvoice>(query.data);
  const supplierList = asList(suppliers.data);
  const itemList = asList(items.data);
  const poList = asList(pos.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["supplier-invoices"] });
  const onSuccess = () => { toast.success(t("common.success")); invalidate(); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => {
      // Link each line to the matching PO line (same item) so the 3-way
      // match can run on posting.
      const poLines = selectedPo.data?.lines ?? [];
      const apiLines = toApiLines(lines).map((l) => ({
        ...l,
        purchaseOrderLineId: poLines.find((p) => p.itemId === l.itemId)?.id ?? null,
      }));
      return purchasingApi.createInvoice({
        supplierId,
        purchaseOrderId: purchaseOrderId || null,
        invoiceDate: `${invoiceDate}T00:00:00.000Z`,
        lines: apiLines,
      });
    },
    onSuccess: () => { toast.success(t("common.success")); setLines([emptyDocLine()]); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => purchasingApi.postInvoice(id), onSuccess, onError });
  const voidIt = useMutation({ mutationFn: (id: string) => purchasingApi.voidInvoice(id), onSuccess, onError });

  const columns: ColumnDef<SupplierInvoice>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "supplier", header: t("purchasing.supplier"), cell: ({ row }) => row.original.supplier?.displayName ?? "—" },
    { accessorKey: "purchaseOrder", header: t("purchasing.purchaseOrder"), cell: ({ row }) => row.original.purchaseOrder?.number ?? "—" },
    { accessorKey: "invoiceDate", header: t("sales.invoiceDate"), cell: ({ row }) => row.original.invoiceDate.slice(0, 10) },
    { accessorKey: "dueDate", header: t("sales.dueDate"), cell: ({ row }) => row.original.dueDate.slice(0, 10) },
    {
      accessorKey: "totalMinor",
      header: t("sales.total"),
      cell: ({ row }) => formatMoney(row.original.totalMinor, row.original.currency, locale),
    },
    {
      accessorKey: "paidMinor",
      header: t("sales.paid"),
      cell: ({ row }) => formatMoney(row.original.paidMinor, row.original.currency, locale),
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => <Badge variant={row.original.status === "PAID" ? "default" : row.original.status === "VOID" ? "destructive" : "secondary"}>{row.original.status}</Badge>,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex gap-2">
          {row.original.status === "DRAFT" && (
            <>
              <Button size="sm" onClick={() => post.mutate(row.original.id)}>{t("sales.post")}</Button>
              <Button size="sm" variant="outline" onClick={() => voidIt.mutate(row.original.id)}>{t("sales.void")}</Button>
            </>
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
          <h1 className="text-2xl font-bold">{t("purchasing.supplierInvoices")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardHeader><CardTitle>{t("purchasing.addInvoice")}</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>{t("purchasing.supplier")}</Label>
                <Select value={supplierId || "none"} onValueChange={(v) => { setSupplierId(v === "none" ? "" : v); setPurchaseOrderId(""); }}>
                  <SelectTrigger><SelectValue placeholder={t("purchasing.supplier")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {supplierList.map((c) => (<SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("purchasing.purchaseOrder")}</Label>
                <Select value={purchaseOrderId || "none"} onValueChange={(v) => setPurchaseOrderId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {poList.map((o) => (<SelectItem key={o.id} value={o.id}>{o.number} ({o.status})</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("sales.invoiceDate")}</Label><Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></div>
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
                  {["DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "VOID"].map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <DataTable columns={columns} data={invoices} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
