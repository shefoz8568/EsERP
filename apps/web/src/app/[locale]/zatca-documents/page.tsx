"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, zatcaApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { ZatcaDocument } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function ZatcaDocumentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [invoiceId, setInvoiceId] = useState("");
  const [type, setType] = useState("SIMPLIFIED");
  const [selected, setSelected] = useState<ZatcaDocument | null>(null);

  const query = useQuery({ queryKey: ["zatca-documents"], queryFn: () => zatcaApi.list({ pageSize: 100 }) });
  const rows = asList<ZatcaDocument>(query.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["zatca-documents"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const generate = useMutation({
    mutationFn: () => zatcaApi.generate({ invoiceId, type }),
    onSuccess: (doc) => { toast.success(t("common.success")); setSelected(doc); invalidate(); },
    onError,
  });
  const submit = useMutation({
    mutationFn: (id: string) => zatcaApi.submit(id),
    onSuccess: (doc) => { toast.success(t("common.success")); setSelected(doc); invalidate(); },
    onError,
  });

  const columns: ColumnDef<ZatcaDocument>[] = [
    { accessorKey: "invoice", header: t("sales.invoiceDate"), cell: ({ row }) => row.original.invoice?.number ?? row.original.invoiceId },
    { accessorKey: "type", header: t("integrations.documentType") },
    {
      accessorKey: "status", header: t("common.status"),
      cell: ({ row }) => <Badge>{row.original.status}</Badge>,
    },
    { accessorKey: "invoiceHash", header: t("integrations.invoiceHash"), cell: ({ row }) => <span className="font-mono text-xs">{row.original.invoiceHash.slice(0, 16)}…</span> },
    { accessorKey: "createdAt", header: t("common.createdAt"), cell: ({ row }) => row.original.createdAt.slice(0, 19).replace("T", " ") },
    {
      id: "actions", header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelected(row.original)}>{t("common.view")}</Button>
          {(row.original.status === "GENERATED" || row.original.status === "REJECTED") && (
            <Button size="sm" disabled={submit.isPending} onClick={() => submit.mutate(row.original.id)}>{t("integrations.submit")}</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("integrations.zatcaDocuments")}</h1>
        <p className="text-sm text-muted-foreground">{t("integrations.zatcaNote")}</p>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("integrations.generate")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("integrations.invoiceId")}</Label><Input className="w-80" value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} placeholder="Invoice UUID" /></div>
            <div className="space-y-1"><Label>{t("integrations.documentType")}</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="SIMPLIFIED">{t("integrations.simplified")}</SelectItem>
                  <SelectItem value="STANDARD">{t("integrations.standard")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="self-end" disabled={generate.isPending || !invoiceId} onClick={() => generate.mutate()}>{t("integrations.generate")}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("integrations.zatcaDocuments")} ({rows.length})</CardTitle></CardHeader>
          <CardContent><DataTable columns={columns} data={rows} /></CardContent>
        </Card>
        {selected && (
          <Card>
            <CardHeader><CardTitle>{selected.invoice?.number ?? selected.invoiceId} — {selected.status}</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><Label>{t("integrations.qrCode")}</Label><p className="font-mono break-all text-xs">{selected.qrData}</p></div>
              <div><Label>{t("integrations.invoiceHash")}</Label><p className="font-mono break-all text-xs">{selected.invoiceHash}</p></div>
              {selected.previousHash && <div><Label>{t("integrations.previousHash")}</Label><p className="font-mono break-all text-xs">{selected.previousHash}</p></div>}
              <div><Label>{t("integrations.xml")}</Label><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-xs" dir="ltr">{selected.xml}</pre></div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
