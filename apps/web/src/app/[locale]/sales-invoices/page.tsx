"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useEffect, useState } from "react";
import { Button, Card, CardContent, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, contactsApi, itemsApi, salesApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable, type DataTableSavedView } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormSection } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";
import { DocLinesEditor, emptyDocLine, toApiLines, type DocLineDraft } from "@/components/DocLinesEditor";
import { formatMoney } from "@/lib/money";
import type { SalesInvoice } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

type InvoiceView = "all" | "unpaid" | "overdue" | "this-month";

const BUILTIN_VIEWS: { id: InvoiceView; labelKey: string }[] = [
  { id: "all", labelKey: "common.showAll" },
  { id: "unpaid", labelKey: "dashboard.unpaidInvoices" },
  { id: "overdue", labelKey: "common.overdue" },
  { id: "this-month", labelKey: "common.thisMonth" },
];

interface CustomInvoiceView extends DataTableSavedView {
  status?: string;
}

function loadCustomViews(): CustomInvoiceView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem("eserp:views:sales-invoices");
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (v): v is CustomInvoiceView =>
            !!v && typeof v === "object" && typeof (v as CustomInvoiceView).id === "string",
        )
      : [];
  } catch {
    return [];
  }
}

export default function SalesInvoicesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("INVOICE");
  const [customerId, setCustomerId] = useState("");
  const [orderId, setOrderId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [lines, setLines] = useState<DocLineDraft[]>([emptyDocLine()]);
  const [page, setPage] = useState(1);
  const [view, setView] = useState<InvoiceView>("all");
  const [customViews, setCustomViews] = useState<CustomInvoiceView[]>([]);
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    setCustomViews(loadCustomViews());
  }, []);

  // "Overdue" / "This month" are client-side filters over a larger fetch;
  // the plain list uses server pagination.
  const isClientView = view === "overdue" || view === "this-month" || view === "unpaid";
  useEffect(() => {
    setPage(1);
  }, [search, status, view]);

  const query = useQuery({
    queryKey: ["sales-invoices", search, status, isClientView ? "client-view" : page],
    queryFn: () =>
      salesApi.listInvoices({
        search: search || undefined,
        status: status || undefined,
        page: isClientView ? 1 : page,
        pageSize: isClientView ? 100 : 10,
      }),
  });
  const customers = useQuery({ queryKey: ["contacts-customers"], queryFn: () => contactsApi.list({ type: "CUSTOMER", pageSize: 100 }) });
  const items = useQuery({ queryKey: ["items"], queryFn: () => itemsApi.list({ pageSize: 100 }) });
  const orders = useQuery({
    queryKey: ["sales-orders", customerId],
    queryFn: () => salesApi.listOrders({ customerId: customerId || undefined, pageSize: 100 }),
    enabled: !!customerId,
  });
  const invoices = asList<SalesInvoice>(query.data);
  const customerList = asList(customers.data);
  const itemList = asList(items.data);
  const orderList = asList(orders.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["sales-invoices"] });
  const onSuccess = () => { toast.success(t("common.success")); invalidate(); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      salesApi.createInvoice({
        type,
        customerId,
        orderId: orderId || null,
        invoiceDate: `${invoiceDate}T00:00:00.000Z`,
        lines: toApiLines(lines),
      }),
    onSuccess: () => { toast.success(t("common.success")); setLines([emptyDocLine()]); setTriedSave(false); invalidate(); },
    onError,
  });
  const post = useMutation({ mutationFn: (id: string) => salesApi.postInvoice(id), onSuccess, onError });
  const voidIt = useMutation({ mutationFn: (id: string) => salesApi.voidInvoice(id), onSuccess, onError });

  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = today.slice(0, 7);
  const visibleInvoices =
    view === "unpaid"
      ? invoices.filter((i) => ["POSTED", "PARTIALLY_PAID"].includes(i.status))
      : view === "overdue"
        ? invoices.filter((i) => i.dueDate.slice(0, 10) < today && !["PAID", "VOID"].includes(i.status))
        : view === "this-month"
          ? invoices.filter((i) => i.invoiceDate.slice(0, 7) === thisMonth)
          : invoices;

  const columns: ColumnDef<SalesInvoice>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "type", header: "Type" },
    { accessorKey: "customer", header: t("sales.customer"), cell: ({ row }) => row.original.customer?.displayName ?? "—" },
    { accessorKey: "invoiceDate", header: t("sales.invoiceDate"), cell: ({ row }) => row.original.invoiceDate.slice(0, 10) },
    { accessorKey: "dueDate", header: t("sales.dueDate"), cell: ({ row }) => row.original.dueDate.slice(0, 10) },
    {
      accessorKey: "totalMinor",
      header: t("sales.total"),
      meta: { numeric: true },
      cell: ({ row }) => formatMoney(row.original.totalMinor, row.original.currency, locale),
    },
    {
      accessorKey: "paidMinor",
      header: t("sales.paid"),
      meta: { numeric: true },
      cell: ({ row }) => formatMoney(row.original.paidMinor, row.original.currency, locale),
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

  const valid = customerId && lines.every((l) => l.itemId && Number(l.quantity) > 0 && Number(l.unitPrice) >= 0);

  const saveView = (name: string) => {
    // A saved view captures the current status filter; selecting it later re-applies it.
    const next = [...customViews, { id: `custom-${Date.now()}`, label: name, status }];
    setCustomViews(next);
    try {
      window.localStorage.setItem("eserp:views:sales-invoices", JSON.stringify(next));
    } catch {
      /* Storage unavailable: the view lives for this session only. */
    }
  };

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("sales.salesInvoices")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormSection
              id="create-invoice"
              title={type === "CREDIT_NOTE" ? t("sales.addCreditNote") : t("sales.addInvoice")}
            >
              <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
                <FormField label="Type">
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="INVOICE">INVOICE</SelectItem>
                      <SelectItem value="CREDIT_NOTE">CREDIT_NOTE</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField
                  label={t("sales.customer")}
                  required
                  error={triedSave && !customerId ? t("common.required") : undefined}
                >
                  <Select value={customerId || "none"} onValueChange={(v) => { setCustomerId(v === "none" ? "" : v); setOrderId(""); }}>
                    <SelectTrigger><SelectValue placeholder={t("sales.customer")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {customerList.map((c) => (<SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("sales.salesOrders")}>
                  <Select value={orderId || "none"} onValueChange={(v) => setOrderId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {orderList.map((o) => (<SelectItem key={o.id} value={o.id}>{o.number}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("sales.invoiceDate")} required>
                  <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
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
                  {["DRAFT", "POSTED", "PARTIALLY_PAID", "PAID", "VOID"].map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {query.isError ? (
              <ErrorState onRetry={() => void query.refetch()} />
            ) : (
              <DataTable
                id="sales-invoices"
                columns={columns}
                data={visibleInvoices}
                ariaLabel={t("sales.salesInvoices")}
                enableSelection
                bulkActions={[
                  {
                    id: "post",
                    label: t("sales.post"),
                    disabled: (rows) => !rows.some((r) => r.status === "DRAFT"),
                    onClick: (rows) => rows.filter((r) => r.status === "DRAFT").forEach((r) => post.mutate(r.id)),
                  },
                  {
                    id: "void",
                    label: t("sales.void"),
                    variant: "outline",
                    disabled: (rows) => !rows.some((r) => r.status === "DRAFT"),
                    onClick: (rows) => rows.filter((r) => r.status === "DRAFT").forEach((r) => voidIt.mutate(r.id)),
                  },
                ]}
                savedViews={[
                  ...BUILTIN_VIEWS.map((v) => ({ id: v.id, label: t(v.labelKey as never) })),
                  ...customViews,
                ]}
                activeViewId={view}
                onSelectView={(viewId) => {
                  if ((BUILTIN_VIEWS as { id: string }[]).some((v) => v.id === viewId)) {
                    setView(viewId as InvoiceView);
                  } else {
                    const custom = customViews.find((v) => v.id === viewId);
                    if (custom) {
                      setStatus(custom.status ?? "");
                      setView(viewId as InvoiceView);
                    }
                  }
                }}
                onSaveView={saveView}
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
