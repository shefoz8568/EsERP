"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@eserp/ui";
import { asList, apiKeysApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { ApiKey } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const SCOPE_OPTIONS = ["sales-invoices:read", "sales-orders:read", "contacts:read", "items:read", "purchase-orders:read", "stock:read", "journals:read", "analytics:read", "zatca:read", "webhooks:read", "exports:read"];

export default function ApiKeysPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["sales-invoices:read"]);
  const [newKey, setNewKey] = useState<string | null>(null);

  const query = useQuery({ queryKey: ["api-keys"], queryFn: () => apiKeysApi.list({ pageSize: 100 }) });
  const rows = asList<ApiKey>(query.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["api-keys"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => apiKeysApi.create({ name, scopes }),
    onSuccess: (key) => { toast.success(t("common.success")); setNewKey(key.apiKey ?? null); setName(""); invalidate(); },
    onError,
  });
  const revoke = useMutation({
    mutationFn: (id: string) => apiKeysApi.revoke(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });

  const columns: ColumnDef<ApiKey>[] = [
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "keyPrefix", header: "…", cell: ({ row }) => <span className="font-mono">…{row.original.keyPrefix}</span> },
    { accessorKey: "scopes", header: t("integrations.scopes"), cell: ({ row }) => row.original.scopes.join(", ") },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge>{row.original.status}</Badge> },
    { accessorKey: "lastUsedAt", header: t("integrations.lastUsedAt"), cell: ({ row }) => row.original.lastUsedAt?.slice(0, 19).replace("T", " ") ?? "—" },
    {
      id: "actions", header: t("common.actions"),
      cell: ({ row }) => row.original.status === "ACTIVE" ? (
        <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => revoke.mutate(row.original.id)}>{t("integrations.revoke")}</Button>
      ) : null,
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("integrations.apiKeys")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        {newKey && (
          <Card>
            <CardHeader><CardTitle>{t("integrations.keyShownOnce")}</CardTitle></CardHeader>
            <CardContent><p className="font-mono break-all text-sm" dir="ltr">{newKey}</p></CardContent>
          </Card>
        )}
        <Card>
          <CardHeader><CardTitle>{t("integrations.createKey")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1"><Label>{t("common.name")}</Label><Input className="w-80" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("integrations.scopes")}</Label>
              <div className="flex flex-wrap gap-2">
                {SCOPE_OPTIONS.map((s) => (
                  <Button key={s} size="sm" variant={scopes.includes(s) ? "default" : "outline"} onClick={() => setScopes((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])}>{s}</Button>
                ))}
              </div>
            </div>
            <Button disabled={create.isPending || !name || scopes.length === 0} onClick={() => create.mutate()}>{t("integrations.createKey")}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("integrations.apiKeys")} ({rows.length})</CardTitle></CardHeader>
          <CardContent><DataTable columns={columns} data={rows} /></CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
