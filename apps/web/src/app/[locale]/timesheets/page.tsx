"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, hrApi, projectsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Timesheet } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function TimesheetsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [taskId, setTaskId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [hours, setHours] = useState("8");
  const [filterProject, setFilterProject] = useState("");

  const query = useQuery({ queryKey: ["timesheets", filterProject], queryFn: () => projectsApi.listTimesheets({ pageSize: 100, projectId: filterProject || undefined }) });
  const projects = useQuery({ queryKey: ["projects"], queryFn: () => projectsApi.listProjects({ pageSize: 100 }) });
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => hrApi.listEmployees({ pageSize: 100 }) });
  const tasks = useQuery({ queryKey: ["project-tasks", projectId], queryFn: () => projectsApi.listTasks({ pageSize: 100, projectId: projectId || undefined }), enabled: !!projectId });
  const rows = asList<Timesheet>(query.data);
  const projectRows = asList(projects.data);
  const employeeRows = asList(employees.data);
  const taskRows = asList(tasks.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["timesheets"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => projectsApi.createTimesheet({ employeeId, projectId, taskId: taskId || null, date: `${date}T00:00:00.000Z`, hours: Number(hours) }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });
  const submit = useMutation({ mutationFn: (id: string) => projectsApi.submitTimesheet(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const approve = useMutation({ mutationFn: (id: string) => projectsApi.approveTimesheet(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const reject = useMutation({ mutationFn: (id: string) => projectsApi.rejectTimesheet(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<Timesheet>[] = [
    { accessorKey: "date", header: t("projects.date"), cell: ({ row }) => row.original.date.slice(0, 10) },
    { accessorKey: "employee", header: t("projects.assignee"), cell: ({ row }) => row.original.employee?.name ?? "—" },
    { accessorKey: "project", header: t("projects.projects"), cell: ({ row }) => row.original.project?.name ?? "—" },
    { accessorKey: "task", header: t("projects.title"), cell: ({ row }) => row.original.task?.title ?? "—" },
    { accessorKey: "hours", header: t("projects.hours") },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "APPROVED" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {row.original.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => submit.mutate(row.original.id)}>{t("projects.submit")}</Button>}
          {(row.original.status === "DRAFT" || row.original.status === "SUBMITTED") && (
            <>
              <Button size="sm" onClick={() => approve.mutate(row.original.id)}>{t("projects.approve")}</Button>
              <Button size="sm" variant="outline" onClick={() => reject.mutate(row.original.id)}>{t("projects.reject")}</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("projects.timesheets")}</h1>
        {query.isError && <ErrorState message={t("common.error")} />}
        <Card>
          <CardHeader><CardTitle>{t("projects.addTimesheet")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-4">
            <div className="space-y-1"><Label>{t("projects.assignee")}</Label>
              <Select value={employeeId} onValueChange={setEmployeeId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{employeeRows.map((e) => <SelectItem key={e.id} value={e.id}>{e.code} — {e.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.projects")}</Label>
              <Select value={projectId} onValueChange={(v) => { setProjectId(v); setTaskId(""); }}>
                <SelectTrigger className="w-56"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{projectRows.map((p) => <SelectItem key={p.id} value={p.id}>{p.code} — {p.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.title")}</Label>
              <Select value={taskId} onValueChange={setTaskId} disabled={!projectId}>
                <SelectTrigger className="w-48"><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>{taskRows.map((tk) => <SelectItem key={tk.id} value={tk.id}>{tk.title}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>{t("projects.date")}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div className="space-y-1"><Label>{t("projects.hours")}</Label><Input type="number" min="0.25" max="24" step="0.25" value={hours} onChange={(e) => setHours(e.target.value)} /></div>
            <Button className="self-end" disabled={!employeeId || !projectId || create.isPending} onClick={() => create.mutate()}>{t("common.add")}</Button>
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
