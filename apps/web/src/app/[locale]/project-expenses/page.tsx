"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, projectsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { ProjectExpense } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const CATEGORIES = ["TRAVEL", "MATERIALS", "SERVICES", "OTHER"];

export default function ProjectExpensesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [filterProject, setFilterProject] = useState("");

  const query = useQuery({ queryKey: ["project-expenses", filterProject], queryFn: () => projectsApi.listExpenses({ pageSize: 100, projectId: filterProject || undefined }) });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => projectsApi.listProjects({ pageSize: 100 }) });
  const rows = asList<ProjectExpense>(query.data);
  const projectRows = asList(projects.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["project-expenses"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => projectsApi.createExpense({ projectId, date: `${date}T00:00:00.000Z`, category, amountMinor: Math.round(Number(amount) * 100), description: description || undefined }),
    onSuccess: () => { toast.success(t("common.success")); setAmount(""); setDescription(""); invalidate(); },
    onError,
  });
  const approve = useMutation({ mutationFn: (id: string) => projectsApi.approveExpense(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const reject = useMutation({ mutationFn: (id: string) => projectsApi.rejectExpense(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<ProjectExpense>[] = [
    { accessorKey: "date", header: t("projects.date"), cell: ({ row }) => row.original.date.slice(0, 10) },
    { accessorKey: "project", header: t("projects.projects"), cell: ({ row }) => row.original.project?.name ?? "—" },
    { accessorKey: "category", header: t("projects.category") },
    { accessorKey: "amountMinor", header: t("projects.amount"), cell: ({ row }) => formatMoney(row.original.amountMinor, row.original.currency, locale) },
    { accessorKey: "description", header: t("projects.description") },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "APPROVED" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => row.original.status === "DRAFT" ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => approve.mutate(row.original.id)}>{t("projects.approve")}</Button>
          <Button size="sm" variant="outline" onClick={() => reject.mutate(row.original.id)}>{t("projects.reject")}</Button>
        </div>
      ) : null,
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("projects.expenses")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("projects.addExpense")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("projects.projects")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{projectRows.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.category")}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.date")}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.amount")} (SAR)</Label><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.description")}</Label><Input value={description} onChange={(e) => setDescription(e.target.value)} /></div>
            <Button className="self-end" disabled={!projectId || !amount || create.isPending} onClick={() => create.mutate()}>{t("common.add")}</Button>
          </CardContent>
        </Card>
        <div className="flex gap-4">
          <Select value={filterProject} onValueChange={setFilterProject}>
            <SelectTrigger className="w-64"><SelectValue placeholder={t("projects.projects")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">All projects</SelectItem>
              {projectRows.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <DataTable columns={columns} data={rows} />
      </div>
    </AppShell>
  );
}
