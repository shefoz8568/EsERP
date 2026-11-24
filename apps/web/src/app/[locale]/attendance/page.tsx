"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, hrApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { AttendanceSummaryRow, Employee } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const STATUSES = ["PRESENT", "ABSENT", "LATE", "ON_LEAVE", "HOLIDAY"] as const;

export default function AttendancePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const now = new Date();
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().slice(0, 10));
  const [statuses, setStatuses] = useState<Record<string, string>>({});
  const [sumYear, setSumYear] = useState(String(now.getFullYear()));
  const [sumMonth, setSumMonth] = useState(String(now.getMonth() + 1));

  const employees = useQuery({ queryKey: ["employees"], queryFn: () => hrApi.listEmployees({ pageSize: 200 }) });
  const summary = useQuery({ queryKey: ["attendance-summary", sumYear, sumMonth], queryFn: () => hrApi.attendanceSummary(Number(sumYear), Number(sumMonth)) });
  const employeeList = asList<Employee>(employees.data);
  const summaryRows = (summary.data?.data ?? []) as AttendanceSummaryRow[];
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const bulk = useMutation({
    mutationFn: () =>
      hrApi.bulkAttendance({
        date: `${bulkDate}T00:00:00.000Z`,
        records: employeeList.map((e) => ({ employeeId: e.id, status: statuses[e.id] ?? "PRESENT" })),
      }),
    onSuccess: () => { toast.success(t("common.success")); setStatuses({}); void queryClient.invalidateQueries({ queryKey: ["attendance-summary"] }); },
    onError,
  });

  const columns: ColumnDef<AttendanceSummaryRow>[] = [
    { accessorKey: "employee", header: t("hr.employee"), cell: ({ row }) => `${row.original.employee?.code ?? "—"} — ${row.original.employee?.name ?? ""}` },
    { accessorKey: "workingDays", header: t("hr.workingDays") },
    { accessorKey: "present", header: t("hr.present") },
    { accessorKey: "absent", header: t("hr.absent"), cell: ({ row }) => row.original.absent > 0 ? <Badge variant="destructive">{row.original.absent}</Badge> : 0 },
    { accessorKey: "late", header: t("hr.late") },
    { accessorKey: "onLeave", header: t("hr.onLeave") },
    { accessorKey: "holiday", header: t("hr.holiday") },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("hr.attendance")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("hr.addAttendance")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="w-52 space-y-1"><Label>{t("hr.attendanceDate")}</Label><Input type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} /></div>
            <div className="space-y-2">
              {employeeList.map((e) => (
                <div key={e.id} className="flex items-center gap-3 text-sm">
                  <span className="w-64">{e.code} — {e.name}</span>
                  <Select value={statuses[e.id] ?? "PRESENT"} onValueChange={(v) => setStatuses({ ...statuses, [e.id]: v })}>
                    <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STATUSES.map((s) => (<SelectItem key={s} value={s}>{s === "PRESENT" ? t("hr.present") : s === "ABSENT" ? t("hr.absent") : s === "LATE" ? t("hr.late") : s === "ON_LEAVE" ? t("hr.onLeave") : t("hr.holiday")}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <Button disabled={employeeList.length === 0 || !bulkDate} onClick={() => bulk.mutate()}>{t("hr.addAttendance")}</Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("hr.summary")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-4">
              <div className="w-32 space-y-1"><Label>{t("hr.period")}</Label><Input type="number" value={sumYear} onChange={(e) => setSumYear(e.target.value)} /></div>
              <div className="w-32 space-y-1"><Label>—</Label><Input type="number" min={1} max={12} value={sumMonth} onChange={(e) => setSumMonth(e.target.value)} /></div>
            </div>
            {summary.isError ? (
              <ErrorState onRetry={() => void summary.refetch()} />
            ) : (
              <DataTable columns={columns} data={summaryRows} />
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
