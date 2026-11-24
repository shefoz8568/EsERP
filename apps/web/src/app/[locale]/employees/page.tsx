"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, hrApi, settingsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { Branch, Department, Employee } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function EmployeesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [hireDate, setHireDate] = useState(new Date().toISOString().slice(0, 10));
  const [basicSar, setBasicSar] = useState("");
  const [housingSar, setHousingSar] = useState("");
  const [transportSar, setTransportSar] = useState("");
  const [nationality, setNationality] = useState("SAUDI");
  const [nationalId, setNationalId] = useState("");
  const [iban, setIban] = useState("");
  const [bankName, setBankName] = useState("");
  const [gosiNumber, setGosiNumber] = useState("");

  const query = useQuery({ queryKey: ["employees"], queryFn: () => hrApi.listEmployees({ pageSize: 100 }) });
  const departments = useQuery({ queryKey: ["departments"], queryFn: () => hrApi.listDepartments({ pageSize: 100 }) });
  const branches = useQuery({ queryKey: ["branches"], queryFn: () => settingsApi.listBranches() });
  const rows = asList<Employee>(query.data);
  const deptList = asList<Department>(departments.data);
  const branchList = asList<Branch>(branches.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["employees"] });
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () =>
      hrApi.createEmployee({
        code, name, jobTitle, departmentId, branchId: branchId || undefined,
        hireDate: `${hireDate}T00:00:00.000Z`,
        basicSalaryMinor: Math.round(Number(basicSar || 0) * 100),
        housingAllowanceMinor: Math.round(Number(housingSar || 0) * 100),
        transportAllowanceMinor: Math.round(Number(transportSar || 0) * 100),
        nationality, nationalId: nationalId || undefined, iban: iban || undefined,
        bankName: bankName || undefined, gosiNumber: gosiNumber || undefined,
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setCode(""); setName(""); setJobTitle(""); setDepartmentId(""); setBranchId("");
      setBasicSar(""); setHousingSar(""); setTransportSar(""); setNationalId(""); setIban(""); setBankName(""); setGosiNumber("");
      invalidate();
    },
    onError,
  });
  const terminate = useMutation({
    mutationFn: (id: string) => hrApi.terminateEmployee(id, { endDate: `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z` }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => hrApi.deleteEmployee(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });

  const columns: ColumnDef<Employee>[] = [
    { accessorKey: "code", header: t("pos.code") },
    { accessorKey: "name", header: t("common.name") },
    { accessorKey: "jobTitle", header: t("hr.jobTitle") },
    { accessorKey: "department", header: t("hr.department"), cell: ({ row }) => row.original.department?.name ?? "—" },
    { accessorKey: "nationality", header: t("hr.nationality"), cell: ({ row }) => row.original.nationality === "SAUDI" ? t("hr.saudi") : t("hr.nonSaudi") },
    { accessorKey: "basicSalaryMinor", header: t("hr.basicSalary"), cell: ({ row }) => formatMoney(row.original.basicSalaryMinor, row.original.currency, locale) },
    { accessorKey: "hireDate", header: t("hr.hireDate"), cell: ({ row }) => row.original.hireDate.slice(0, 10) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "ACTIVE" ? "default" : row.original.status === "TERMINATED" ? "destructive" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          {row.original.status !== "TERMINATED" && <Button size="sm" variant="outline" onClick={() => terminate.mutate(row.original.id)}>{t("hr.terminate")}</Button>}
          {row.original.status === "TERMINATED" && <Button size="sm" variant="outline" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>}
        </div>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("hr.employees")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("hr.addEmployee")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-1"><Label>{t("pos.code")}</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="EMP-001" /></div>
              <div className="space-y-1"><Label>{t("common.name")}</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.jobTitle")}</Label><Input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} /></div>
              <div className="space-y-1">
                <Label>{t("hr.department")}</Label>
                <Select value={departmentId || "none"} onValueChange={(v) => setDepartmentId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("hr.department")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {deptList.map((d) => (<SelectItem key={d.id} value={d.id}>{d.code} — {d.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("hr.branch")}</Label>
                <Select value={branchId || "none"} onValueChange={(v) => setBranchId(v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder={t("hr.branch")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {branchList.map((b) => (<SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>{t("hr.hireDate")}</Label><Input type="date" value={hireDate} onChange={(e) => setHireDate(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.basicSalary")} (SAR)</Label><Input type="number" min={0} value={basicSar} onChange={(e) => setBasicSar(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.housing")} (SAR)</Label><Input type="number" min={0} value={housingSar} onChange={(e) => setHousingSar(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.transport")} (SAR)</Label><Input type="number" min={0} value={transportSar} onChange={(e) => setTransportSar(e.target.value)} /></div>
              <div className="space-y-1">
                <Label>{t("hr.nationality")}</Label>
                <Select value={nationality} onValueChange={setNationality}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SAUDI">{t("hr.saudi")}</SelectItem>
                    <SelectItem value="NON_SAUDI">{t("hr.nonSaudi")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>ID / Iqama</Label><Input value={nationalId} onChange={(e) => setNationalId(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.iban")}</Label><Input value={iban} onChange={(e) => setIban(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.bankName")}</Label><Input value={bankName} onChange={(e) => setBankName(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.gosiNumber")}</Label><Input value={gosiNumber} onChange={(e) => setGosiNumber(e.target.value)} /></div>
            </div>
            <Button disabled={!code || !name || !jobTitle || !departmentId || !hireDate || Number(basicSar) <= 0} onClick={() => create.mutate()}>{t("hr.addEmployee")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("hr.employees")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
