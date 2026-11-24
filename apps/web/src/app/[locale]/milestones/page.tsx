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
import type { Milestone } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function MilestonesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [amount, setAmount] = useState("");
  const [filterProject, setFilterProject] = useState("");

  const query = useQuery({ queryKey: ["milestones", filterProject], queryFn: () => projectsApi.listMilestones({ pageSize: 100, projectId: filterProject || undefined }) });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => projectsApi.listProjects({ pageSize: 100 }) });
  const rows = asList<Milestone>(query.data);
  const projectRows = asList(projects.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["milestones"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => projectsApi.createMilestone({ projectId, title, dueDate: dueDate ? `${dueDate}T00:00:00.000Z` : null, amountMinor: Math.round(Number(amount || "0") * 100) }),
    onSuccess: () => { toast.success(t("common.success")); setTitle(""); setAmount(""); invalidate(); },
    onError,
  });
  const achieve = useMutation({ mutationFn: (id: string) => projectsApi.achieveMilestone(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<Milestone>[] = [
    { accessorKey: "title", header: t("projects.title") },
    { accessorKey: "project", header: t("projects.projects"), cell: ({ row }) => row.original.project?.name ?? "—" },
    { accessorKey: "dueDate", header: t("projects.dueDate"), cell: ({ row }) => row.original.dueDate?.slice(0, 10) ?? "—" },
    { accessorKey: "amountMinor", header: t("projects.amount"), cell: ({ row }) => formatMoney(row.original.amountMinor, row.original.project?.currency ?? "SAR", locale) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "INVOICED" ? "default" : "secondary"}>{row.original.status}</Badge> },
    { accessorKey: "invoice", header: t("projects.invoice"), cell: ({ row }) => row.original.invoice ? `${row.original.invoice.number} (${row.original.invoice.status})` : "—" },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => row.original.status === "PENDING" ? (
        <Button size="sm" onClick={() => achieve.mutate(row.original.id)}>{t("projects.achieve")}</Button>
      ) : null,
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("projects.milestones")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("projects.addMilestone")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("projects.projects")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{projectRows.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name} ({p.billingType})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.title")}</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.dueDate")}</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.amount")} (SAR)</Label><Input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <Button className="self-end" disabled={!projectId || !title || create.isPending} onClick={() => create.mutate()}>{t("common.add")}</Button>
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
