"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, contactsApi, projectsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { Project, ProjectCosting } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const BILLING_TYPES = ["FIXED_PRICE", "TIME_AND_MATERIALS", "MILESTONE"];
const STATUSES = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "CANCELLED"];

export default function ProjectsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [billingType, setBillingType] = useState("FIXED_PRICE");
  const [budget, setBudget] = useState("0");
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("");

  const query = useQuery({ queryKey: ["projects"], queryFn: () => projectsApi.listProjects({ pageSize: 100 }) });
  const customers = useQuery({ queryKey: ["contacts", "customers"], queryFn: () => contactsApi.list({ pageSize: 100, type: "CUSTOMER" }) });
  const costing = useQuery({ queryKey: ["project-costing", selectedId], queryFn: () => projectsApi.costing(selectedId), enabled: !!selectedId });
  const rows = asList<Project>(query.data);
  const customerRows = asList(customers.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["projects"] }); if (selectedId) void queryClient.invalidateQueries({ queryKey: ["project-costing", selectedId] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => projectsApi.createProject({ code, name, customerId: customerId || null, billingType, budgetMinor: Math.round(Number(budget) * 100) }),
    onSuccess: () => { toast.success(t("common.success")); setCode(""); setName(""); setBudget("0"); invalidate(); },
    onError,
  });
  const updateStatus = useMutation({
    mutationFn: (id: string) => projectsApi.updateProject(id, { status }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });

  const columns: ColumnDef<Project>[] = [
    { accessorKey: "code", header: t("projects.code") },
    { accessorKey: "name", header: t("projects.name") },
    { accessorKey: "customer", header: t("projects.customer"), cell: ({ row }) => row.original.customer?.displayName ?? "—" },
    { accessorKey: "billingType", header: t("projects.billingType") },
    { accessorKey: "budgetMinor", header: t("projects.budget"), cell: ({ row }) => formatMoney(row.original.budgetMinor, row.original.currency, locale) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "COMPLETED" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelectedId(row.original.id)}>{t("projects.costing")}</Button>
          {row.original.status !== "COMPLETED" && row.original.status !== "CANCELLED" && (
            <Select value={status} onValueChange={(v) => { setStatus(v); updateStatus.mutate(row.original.id); }}>
              <SelectTrigger className="h-8 w-32"><SelectValue placeholder={t("projects.status")} /></SelectTrigger>
              <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          )}
        </div>
      ),
    },
  ];

  const c: ProjectCosting | undefined = costing.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("projects.projects")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("projects.addProject")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("projects.code")}</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PRJ-001" /></div>
            <div className="space-y-1"><Label>{t("projects.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.customer")}</Label>
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{customerRows.map((cu) => <SelectItem key={cu.id} value={cu.id}>{cu.displayName}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.billingType")}</Label>
              <Select value={billingType} onValueChange={setBillingType}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>{BILLING_TYPES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.budget")} (SAR)</Label><Input type="number" min="0" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
            <Button className="self-end" disabled={!code || !name || create.isPending} onClick={() => create.mutate()}>{t("common.add")}</Button>
          </CardContent>
        </Card>
        <DataTable columns={columns} data={rows} />
        {c && (
          <Card>
            <CardHeader><CardTitle>{t("projects.costing")} — {c.project.code} · {c.project.name}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div><div className="text-sm text-muted-foreground">{t("projects.budget")}</div><div className="font-bold">{formatMoney(c.budgetMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.actual")}</div><div className="font-bold">{formatMoney(c.actualMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.revenue")}</div><div className="font-bold">{formatMoney(c.revenueMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.profit")}</div><div className="font-bold">{formatMoney(c.profitMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.labour")}</div><div>{formatMoney(c.labourMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.expenses")}</div><div>{formatMoney(c.expensesMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.remaining")}</div><div>{formatMoney(c.remainingMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.burnRate")}</div><div>{formatMoney(c.burnRateMinorPerDay, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.margin")}</div><div>{c.marginBps === null ? "—" : `${(c.marginBps / 100).toFixed(1)}%`}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.percentUsed")}</div><div>{c.percentUsedBps === null ? "—" : `${(c.percentUsedBps / 100).toFixed(1)}%`}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.projectedTotal")}</div><div>{c.projectedTotalMinor === null ? "—" : formatMoney(c.projectedTotalMinor, c.project.currency, locale)}</div></div>
                <div><div className="text-sm text-muted-foreground">{t("projects.projectedOverrun")}</div><div>{c.projectedOverrunMinor === null ? "—" : formatMoney(c.projectedOverrunMinor, c.project.currency, locale)}</div></div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
