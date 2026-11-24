"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, hrApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { Employee, LeaveBalanceRow, LeaveRequest, LeaveType } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function LeavePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [typeCode, setTypeCode] = useState("");
  const [typeName, setTypeName] = useState("");
  const [daysPerYear, setDaysPerYear] = useState("30");
  const [employeeId, setEmployeeId] = useState("");
  const [leaveTypeId, setLeaveTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [balanceEmployeeId, setBalanceEmployeeId] = useState("");
  const [balanceYear, setBalanceYear] = useState(String(new Date().getFullYear()));

  const types = useQuery({ queryKey: ["leave-types"], queryFn: () => hrApi.listLeaveTypes({ pageSize: 100 }) });
  const requests = useQuery({ queryKey: ["leave-requests"], queryFn: () => hrApi.listLeaveRequests({ pageSize: 100 }) });
  const employees = useQuery({ queryKey: ["employees"], queryFn: () => hrApi.listEmployees({ pageSize: 200 }) });
  const balances = useQuery({ queryKey: ["leave-balances", balanceEmployeeId, balanceYear], queryFn: () => hrApi.leaveBalances(balanceEmployeeId, Number(balanceYear)), enabled: !!balanceEmployeeId });
  const typeList = asList<LeaveType>(types.data);
  const requestList = asList<LeaveRequest>(requests.data);
  const employeeList = asList<Employee>(employees.data);
  const balanceRows = (balances.data?.data ?? []) as LeaveBalanceRow[];
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["leave-types"] }); void queryClient.invalidateQueries({ queryKey: ["leave-requests"] }); void queryClient.invalidateQueries({ queryKey: ["leave-balances"] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const createType = useMutation({
    mutationFn: () => hrApi.createLeaveType({ code: typeCode, name: typeName, daysPerYear: Number(daysPerYear), paid: true }),
    onSuccess: () => { toast.success(t("common.success")); setTypeCode(""); setTypeName(""); setDaysPerYear("30"); invalidate(); },
    onError,
  });
  const createRequest = useMutation({
    mutationFn: () => hrApi.createLeaveRequest({ employeeId, leaveTypeId, startDate: `${startDate}T00:00:00.000Z`, endDate: `${endDate}T00:00:00.000Z` }),
    onSuccess: () => { toast.success(t("common.success")); setEmployeeId(""); setLeaveTypeId(""); setStartDate(""); setEndDate(""); invalidate(); },
    onError,
  });
  const approve = useMutation({ mutationFn: (id: string) => hrApi.approveLeave(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const reject = useMutation({ mutationFn: (id: string) => hrApi.rejectLeave(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const cancel = useMutation({ mutationFn: (id: string) => hrApi.cancelLeave(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const typeColumns: ColumnDef<LeaveType>[] = [
    { accessorKey: "code", header: t("pos.code") },
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "daysPerYear", header: t("hr.daysPerYear") },
    { accessorKey: "paid", header: t("hr.paid"), cell: ({ row }) => (row.original.paid ? t("common.yes") : t("common.no")) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "ACTIVE" ? "default" : "secondary"}>{row.original.status}</Badge> },
  ];

  const requestColumns: ColumnDef<LeaveRequest>[] = [
    { accessorKey: "employee", header: t("hr.employee"), cell: ({ row }) => `${row.original.employee?.code ?? "—"} — ${row.original.employee?.name ?? ""}` },
    { accessorKey: "leaveType", header: t("hr.leaveType"), cell: ({ row }) => row.original.leaveType?.name ?? "—" },
    { accessorKey: "startDate", header: t("hr.startDate"), cell: ({ row }) => row.original.startDate.slice(0, 10) },
    { accessorKey: "endDate", header: t("hr.endDate"), cell: ({ row }) => row.original.endDate.slice(0, 10) },
    { accessorKey: "days", header: t("hr.days") },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "APPROVED" ? "default" : row.original.status === "REJECTED" ? "destructive" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {row.original.status === "PENDING" && <Button size="sm" onClick={() => approve.mutate(row.original.id)}>{t("hr.approve")}</Button>}
          {row.original.status === "PENDING" && <Button size="sm" variant="outline" onClick={() => reject.mutate(row.original.id)}>{t("hr.reject")}</Button>}
          {(row.original.status === "PENDING" || row.original.status === "APPROVED") && <Button size="sm" variant="outline" onClick={() => cancel.mutate(row.original.id)}>{t("manufacturing.cancel")}</Button>}
        </div>
      ),
    },
  ];

  const balanceColumns: ColumnDef<LeaveBalanceRow>[] = [
    { accessorKey: "leaveType", header: t("hr.leaveType"), cell: ({ row }) => row.original.leaveType?.name ?? "—" },
    { accessorKey: "entitlement", header: t("hr.entitlement") },
    { accessorKey: "approvedDaysTaken", header: t("hr.taken") },
    { accessorKey: "balance", header: t("hr.balance") },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("hr.leave")}</h1>
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle>{t("hr.addLeaveType")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1"><Label>{t("pos.code")}</Label><Input value={typeCode} onChange={(e) => setTypeCode(e.target.value)} placeholder="ANNUAL" /></div>
                <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={typeName} onChange={(e) => setTypeName(e.target.value)} /></div>
                <div className="space-y-1"><Label>{t("hr.daysPerYear")}</Label><Input type="number" min={0} value={daysPerYear} onChange={(e) => setDaysPerYear(e.target.value)} /></div>
              </div>
              <Button disabled={!typeCode || !typeName} onClick={() => createType.mutate()}>{t("hr.addLeaveType")}</Button>
              <DataTable columns={typeColumns} data={typeList} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>{t("hr.balances")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label>{t("hr.employee")}</Label>
                  <Select value={balanceEmployeeId || "none"} onValueChange={(v) => setBalanceEmployeeId(v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue placeholder={t("hr.employee")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {employeeList.map((e) => (<SelectItem key={e.id} value={e.id}>{e.code} — {e.name}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1"><Label>{t("hr.period")}</Label><Input type="number" value={balanceYear} onChange={(e) => setBalanceYear(e.target.value)} /></div>
              </div>
              {balanceEmployeeId && <DataTable columns={balanceColumns} data={balanceRows} />}
            </CardContent>
          </Card>
        </div>
        <Card>
          <CardHeader><CardTitle>{t("hr.addLeaveRequest")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1">
                <Label>{t("hr.employee")}</Label>
                <Select value={employeeId || "none"} onValueChange={(v) => setEmployeeId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("hr.employee")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {employeeList.map((e) => (<SelectItem key={e.id} value={e.id}>{e.code} — {e.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("hr.leaveType")}</Label>
                <Select value={leaveTypeId || "none"} onValueChange={(v) => setLeaveTypeId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("hr.leaveType")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {typeList.map((lt) => (<SelectItem key={lt.id} value={lt.id}>{lt.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("hr.startDate")}</Label><Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.endDate")}</Label><Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            </div>
            <Button disabled={!employeeId || !leaveTypeId || !startDate || !endDate} onClick={() => createRequest.mutate()}>{t("hr.addLeaveRequest")}</Button>
          </CardContent>
        </Card>
        {requests.isError ? (
          <ErrorState onRetry={() => void requests.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("hr.leaveRequests")} ({requestList.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={requestColumns} data={requestList} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
