"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, contactsApi, salesApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { CustomerPayment } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const METHODS = ["CASH", "BANK_TRANSFER", "CARD", "CHEQUE"];

type AllocDraft = { invoiceId: string; amount: string };

export default function CustomerPaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [allocs, setAllocs] = useState<AllocDraft[]>([{ invoiceId: "", amount: "" }]);

  const query = useQuery({
    queryKey: ["customer-payments", search],
    queryFn: () => salesApi.listPayments({ search: search || undefined }),
  });
  const customers = useQuery({ queryKey: ["contacts-customers"], queryFn: () => contactsApi.list({ type: "CUSTOMER", pageSize: 100 }) });
  const openInvoices = useQuery({
    queryKey: ["sales-invoices-open", customerId],
    queryFn: () => salesApi.listInvoices({ customerId: customerId || undefined, status: "POSTED", pageSize: 100 }),
    enabled: !!customerId,
  });
  const partialInvoices = useQuery({
    queryKey: ["sales-invoices-partial", customerId],
    queryFn: () => salesApi.listInvoices({ customerId: customerId || undefined, status: "PARTIALLY_PAID", pageSize: 100 }),
    enabled: !!customerId,
  });
  const payments = asList<CustomerPayment>(query.data);
  const customerList = asList(customers.data);
  const invoiceList = [...asList(openInvoices.data), ...asList(partialInvoices.data)];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["customer-payments"] });

  const totalMinor = allocs.reduce((s, a) => s + Math.round(Number(a.amount || 0) * 100), 0);

  const create = useMutation({
    mutationFn: () =>
      salesApi.createPayment({
        customerId,
        method,
        reference: reference || undefined,
        paymentDate: `${paymentDate}T00:00:00.000Z`,
        amountMinor: totalMinor,
        allocations: allocs.map((a) => ({ invoiceId: a.invoiceId, amountMinor: Math.round(Number(a.amount || 0) * 100) })),
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setAllocs([{ invoiceId: "", amount: "" }]);
      setReference("");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const setAlloc = (i: number, patch: Partial<AllocDraft>) =>
    setAllocs((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));

  const columns: ColumnDef<CustomerPayment>[] = [
    { accessorKey: "number", header: t("accounting.number") },
    { accessorKey: "customer", header: t("sales.customer"), cell: ({ row }) => row.original.customer?.displayName ?? "—" },
    { accessorKey: "method", header: t("sales.method") },
    { accessorKey: "paymentDate", header: t("sales.paymentDate"), cell: ({ row }) => row.original.paymentDate.slice(0, 10) },
    {
      accessorKey: "amountMinor",
      header: t("sales.amount"),
      cell: ({ row }) => formatMoney(row.original.amountMinor, row.original.currency, locale),
    },
    {
      accessorKey: "allocations",
      header: t("sales.allocations"),
      cell: ({ row }) => row.original.allocations.map((a) => `${a.invoice?.number ?? a.invoiceId.slice(0, 8)}: ${(a.amountMinor / 100).toFixed(2)}`).join(", "),
    },
  ];

  const valid = customerId && totalMinor > 0 && allocs.every((a) => a.invoiceId && Number(a.amount) > 0);

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("sales.customerPayments")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardHeader><CardTitle>{t("sales.addPayment")}</CardTitle></CardHeader>
          <CardContent>
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>{t("sales.customer")}</Label>
                <Select value={customerId || "none"} onValueChange={(v) => { setCustomerId(v === "none" ? "" : v); setAllocs([{ invoiceId: "", amount: "" }]); }}>
                  <SelectTrigger><SelectValue placeholder={t("sales.customer")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {customerList.map((c) => (<SelectItem key={c.id} value={c.id}>{c.displayName}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("sales.method")}</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{METHODS.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("sales.reference")}</Label><Input value={reference} onChange={(e) => setReference(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("sales.paymentDate")}</Label><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
            </div>
            <div className="space-y-3">
              {allocs.map((a, i) => (
                <div key={i} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{t("sales.invoice")}</Label>
                    <Select value={a.invoiceId || "none"} onValueChange={(v) => setAlloc(i, { invoiceId: v === "none" ? "" : v })}>
                      <SelectTrigger><SelectValue placeholder={t("sales.invoice")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">—</SelectItem>
                        {invoiceList.map((inv) => (
                          <SelectItem key={inv.id} value={inv.id}>{inv.number} — {t("sales.balance")}: {((inv.totalMinor - inv.paidMinor) / 100).toFixed(2)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1"><Label>{t("sales.amount")}</Label><Input type="number" min="0" step="0.01" value={a.amount} onChange={(e) => setAlloc(i, { amount: e.target.value })} /></div>
                </div>
              ))}
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => setAllocs((p) => [...p, { invoiceId: "", amount: "" }])}>{t("common.add")}</Button>
                <span className="text-sm text-muted-foreground">{t("sales.total")}: {(totalMinor / 100).toFixed(2)}</span>
              </div>
            </div>
            <div className="mt-4">
              <Button disabled={!valid || create.isPending} onClick={() => create.mutate()}>{t("common.save")}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap gap-3">
              <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <DataTable columns={columns} data={payments} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
