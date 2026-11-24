"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, hrApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Department, Employee } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function DepartmentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [nameAr, setNameAr] = useState("");
  const [parentId, setParentId] = useState("");
  const [managerId, setManagerId] = useState("");

  const query = useQuery({ queryKey: ["departments"], queryFn: () => hrApi.listDepartments({ pageSize: 100 }) });
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => hrApi.listEmployees({ pageSize: 200 }) });
  const rows = asList<Department>(query.data);
  const employeeList = asList<Employee>(employees.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["departments"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => hrApi.createDepartment({ code, name, nameAr: nameAr || undefined, parentId: parentId || null, managerId: managerId || null }),
    onSuccess: () => { toast.success(t("common.success")); setCode(""); setName(""); setNameAr(""); setParentId(""); setManagerId(""); invalidate(); },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => hrApi.deleteDepartment(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<Department>[] = [
    { accessorKey: "code", header: t("pos.code") },
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "parent", header: t("hr.parent"), cell: ({ row }) => row.original.parent?.name ?? "—" },
    { accessorKey: "manager", header: t("hr.manager"), cell: ({ row }) => row.original.manager?.name ?? "—" },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "ACTIVE" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button size="sm" variant="outline" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("hr.departments")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("hr.addDepartment")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1"><Label>{t("pos.code")}</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="OPS" /></div>
              <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("common.name")} (AR)</Label><Input value={nameAr} onChange={(e) => setNameAr(e.target.value)} /></div>
              <div className="space-y-1">
                <Label>{t("hr.parent")}</Label>
                <Select value={parentId || "none"} onValueChange={(v) => setParentId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {rows.map((d) => (<SelectItem key={d.id} value={d.id}>{d.code} — {d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("hr.manager")}</Label>
                <Select value={managerId || "none"} onValueChange={(v) => setManagerId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {employeeList.map((e) => (<SelectItem key={e.id} value={e.id}>{e.code} — {e.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button disabled={!code || !name} onClick={() => create.mutate()}>{t("hr.addDepartment")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("hr.departments")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
