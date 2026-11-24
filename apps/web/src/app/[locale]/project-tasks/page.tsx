"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, hrApi, projectsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { ProjectTask } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const TASK_STATUSES = ["TODO", "IN_PROGRESS", "DONE", "BLOCKED"];

export default function ProjectTasksPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [projectId, setProjectId] = useState("");
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [estimatedHours, setEstimatedHours] = useState("");
  const [filterProject, setFilterProject] = useState("");
  const [status, setStatus] = useState("");

  const query = useQuery({ queryKey: ["project-tasks", filterProject], queryFn: () => projectsApi.listTasks({ pageSize: 100, projectId: filterProject || undefined }) });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => projectsApi.listProjects({ pageSize: 100 }) });
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => hrApi.listEmployees({ pageSize: 100 }) });
  const rows = asList<ProjectTask>(query.data);
  const projectRows = asList(projects.data);
  const employeeRows = asList(employees.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["project-tasks"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => projectsApi.createTask({ projectId, title, assigneeId: assigneeId || null, estimatedHours: estimatedHours ? Number(estimatedHours) : null }),
    onSuccess: () => { toast.success(t("common.success")); setTitle(""); setEstimatedHours(""); invalidate(); },
    onError,
  });
  const updateStatus = useMutation({
    mutationFn: (id: string) => projectsApi.updateTask(id, { status }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });

  const columns: ColumnDef<ProjectTask>[] = [
    { accessorKey: "title", header: t("projects.title") },
    { accessorKey: "project", header: t("projects.projects"), cell: ({ row }) => row.original.project?.name ?? "—" },
    { accessorKey: "assignee", header: t("projects.assignee"), cell: ({ row }) => row.original.assignee?.name ?? "—" },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "DONE" ? "default" : "secondary"}>{row.original.status}</Badge> },
    { accessorKey: "priority", header: t("projects.priority") },
    { accessorKey: "actualHours", header: t("projects.actualHours"), cell: ({ row }) => `${row.original.actualHours ?? 0}h` },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Select value={status} onValueChange={(v) => { setStatus(v); updateStatus.mutate(row.original.id); }}>
          <SelectTrigger className="h-8 w-36"><SelectValue placeholder={t("projects.status")} /></SelectTrigger>
          <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
        </Select>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("projects.tasks")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("projects.addTask")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("projects.projects")}</Label>
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{projectRows.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.title")}</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.assignee")}</Label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{employeeRows.map((e) => <SelectItem key={e.id} value={e.id}>{e.code} — {e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.estimatedHours")}</Label><Input type="number" min="0" value={estimatedHours} onChange={(e) => setEstimatedHours(e.target.value)} /></div>
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
