"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, salesApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Lead } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const SOURCES = ["WALK_IN", "REFERRAL", "WEBSITE", "SOCIAL", "OTHER"];
const STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "LOST"];

export default function LeadsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("WALK_IN");
  const [expectedValue, setExpectedValue] = useState("");

  const query = useQuery({
    queryKey: ["leads", search, status],
    queryFn: () => salesApi.listLeads({ search: search || undefined, status: status || undefined }),
  });
  const leads = asList<Lead>(query.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["leads"] });

  const create = useMutation({
    mutationFn: () =>
      salesApi.createLead({
        name,
        company: company || undefined,
        email: email || undefined,
        phone: phone || undefined,
        source,
        expectedValueMinor: Math.round(Number(expectedValue || 0) * 100),
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setName(""); setCompany(""); setEmail(""); setPhone(""); setExpectedValue("");
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const convert = useMutation({
    mutationFn: (id: string) => salesApi.convertLead(id),
    onSuccess: () => { toast.success(t("sales.converted")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, s }: { id: string; s: string }) => salesApi.updateLead(id, { status: s }),
    onSuccess: invalidate,
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<Lead>[] = [
    { accessorKey: "name", header: t("sales.leadName") },
    { accessorKey: "company", header: t("sales.company"), cell: ({ row }) => row.original.company ?? "—" },
    { accessorKey: "email", header: "Email", cell: ({ row }) => row.original.email ?? "—" },
    { accessorKey: "source", header: t("sales.source") },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => (
        <Select value={row.original.status} onValueChange={(v) => updateStatus.mutate({ id: row.original.id, s: v })}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
          </SelectContent>
        </Select>
      ),
    },
    {
      accessorKey: "expectedValueMinor",
      header: t("sales.expectedValue"),
      cell: ({ row }) => `${(row.original.expectedValueMinor / 100).toFixed(2)} ${row.original.expectedValueCurrency}`,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) =>
        row.original.status !== "QUALIFIED" && !row.original.contactId ? (
          <Button size="sm" variant="outline" onClick={() => convert.mutate(row.original.id)}>{t("sales.convert")}</Button>
        ) : (
          <Badge variant="secondary">{t("sales.converted")}</Badge>
        ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("sales.leads")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardHeader><CardTitle>{t("sales.addLead")}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1"><Label>{t("sales.leadName")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("sales.company")}</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} /></div>
              <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1"><Label>Phone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+966…" /></div>
              <div className="space-y-1">
                <Label>{t("sales.source")}</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{SOURCES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("sales.expectedValue")}</Label><Input type="number" min="0" step="0.01" value={expectedValue} onChange={(e) => setExpectedValue(e.target.value)} /></div>
            </div>
            <div className="mt-4">
              <Button disabled={!name || create.isPending} onClick={() => create.mutate()}>{t("common.save")}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="mb-4 flex flex-wrap gap-3">
              <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t("common.status")}</SelectItem>
                  {STATUSES.map((s) => (<SelectItem key={s} value={s}>{s}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            {query.isError ? <ErrorState onRetry={() => void query.refetch()} /> : <DataTable columns={columns} data={leads} />}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
