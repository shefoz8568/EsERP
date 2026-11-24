"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, webhooksApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { WebhookDelivery, WebhookEndpoint } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const EVENT_OPTIONS = ["sales-invoice.created", "sales-invoice.posted", "sales-invoice.voided", "customer-payment.created", "order.created", "order.confirmed", "order.cancelled", "payroll-run.approved", "payroll-run.paid", "stock.low", "ping"];

export default function WebhooksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [eventTypes, setEventTypes] = useState("sales-invoice.posted");
  const [status, setStatus] = useState("DISABLED");

  const endpointsQuery = useQuery({ queryKey: ["webhook-endpoints"], queryFn: () => webhooksApi.listEndpoints({ pageSize: 100 }) });
  const deliveriesQuery = useQuery({ queryKey: ["webhook-deliveries"], queryFn: () => webhooksApi.listDeliveries({ pageSize: 100 }) });
  const endpoints = asList<WebhookEndpoint>(endpointsQuery.data);
  const deliveries = asList<WebhookDelivery>(deliveriesQuery.data);
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["webhook-endpoints"] });
    void queryClient.invalidateQueries({ queryKey: ["webhook-deliveries"] });
  };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => webhooksApi.createEndpoint({ name, url, eventTypes: eventTypes.split(",").map((s) => s.trim()).filter(Boolean), status }),
    onSuccess: () => { toast.success(t("common.success")); setName(""); setUrl(""); invalidate(); },
    onError,
  });
  const test = useMutation({
    mutationFn: (id: string) => webhooksApi.testEndpoint(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => webhooksApi.deleteEndpoint(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });

  const endpointColumns: ColumnDef<WebhookEndpoint>[] = [
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "url", header: "URL", cell: ({ row }) => <span className="break-all text-xs">{row.original.url}</span> },
    { accessorKey: "eventTypes", header: t("integrations.eventTypes"), cell: ({ row }) => row.original.eventTypes.join(", ") },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    {
      id: "actions", header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={row.original.status !== "ACTIVE" || test.isPending} onClick={() => test.mutate(row.original.id)}>{t("integrations.testDelivery")}</Button>
          <Button size="sm" variant="outline" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>
        </div>
      ),
    },
  ];

  const deliveryColumns: ColumnDef<WebhookDelivery>[] = [
    { accessorKey: "eventType", header: t("integrations.eventTypes") },
    { accessorKey: "endpoint", header: t("integrations.endpoints"), cell: ({ row }) => row.original.endpoint?.name ?? row.original.endpointId },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { accessorKey: "attemptCount", header: t("integrations.attemptCount") },
    { accessorKey: "lastStatusCode", header: "HTTP" },
    { accessorKey: "lastResponse", header: t("integrations.lastResponse"), cell: ({ row }) => <span className="block max-w-64 truncate text-xs">{row.original.lastResponse ?? "—"}</span> },
    { accessorKey: "createdAt", header: t("common.createdAt"), cell: ({ row }) => row.original.createdAt.slice(0, 19).replace("T", " ") },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("integrations.webhooks")}</h1>
        {(endpointsQuery.isError || deliveriesQuery.isError) && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("integrations.createEndpoint")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("common.name")}</Label><Input className="w-56" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label>URL</Label><Input className="w-80" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/eserp" /></div>
            <div className="space-y-1"><Label>{t("integrations.eventTypes")}</Label>
              <Select value={eventTypes} onValueChange={setEventTypes}>
                <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
                <SelectContent>{EVENT_OPTIONS.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("common.status")}</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="ACTIVE">ACTIVE</SelectItem><SelectItem value="DISABLED">DISABLED</SelectItem></SelectContent>
              </Select>
            </div>
            <Button className="self-end" disabled={create.isPending || !name || !url} onClick={() => create.mutate()}>{t("common.add")}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("integrations.endpoints")} ({endpoints.length})</CardTitle></CardHeader>
          <CardContent><DataTable columns={endpointColumns} data={endpoints} /></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("integrations.deliveries")} ({deliveries.length})</CardTitle></CardHeader>
          <CardContent><DataTable columns={deliveryColumns} data={deliveries} /></CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
