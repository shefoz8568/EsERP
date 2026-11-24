"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { use, useState } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, toast } from "@eserp/ui";
import { asList, hrApi } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { formatMoney } from "@/lib/money";
import type { PayrollLine, PayrollRun } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export default function PayrollRunsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  // Approve and Pay both require payroll:approve on the API; HR has
  // payroll:manage but not payroll:approve, so hide them instead of
  // letting the click land on a 403 toast.
  const { user } = useAuth();
  const canApprove = hasPermission(user?.permissions, "payroll:approve");
  const now = new Date();
  const [periodYear, setPeriodYear] = useState(String(now.getFullYear()));
  const [periodMonth, setPeriodMonth] = useState(String(now.getMonth() + 1));
  const [selectedId, setSelectedId] = useState("");
  const [bankAccountCode, setBankAccountCode] = useState("1020");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));

  const query = useQuery({ queryKey: ["payroll-runs"], queryFn: () => hrApi.listPayrollRuns({ pageSize: 100 }) });
  const detail = useQuery({ queryKey: ["payroll-run", selectedId], queryFn: () => hrApi.getPayrollRun(selectedId), enabled: !!selectedId });
  const rows = asList<PayrollRun>(query.data);
  const invalidate = () => { void queryClient.invalidateQueries({ queryKey: ["payroll-runs"] }); if (selectedId) void queryClient.invalidateQueries({ queryKey: ["payroll-run", selectedId] }); };
  const onError = (err: unknown) => toast.error(err instanceof Error ? err.message : t("common.error"));

  const create = useMutation({
    mutationFn: () => hrApi.createPayrollRun({ periodYear: Number(periodYear), periodMonth: Number(periodMonth) }),
    onSuccess: (run) => { toast.success(t("common.success")); setSelectedId(run.id); invalidate(); },
    onError,
  });
  const calculate = useMutation({ mutationFn: (id: string) => hrApi.calculatePayrollRun(id, { overrides: [] }), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const approve = useMutation({ mutationFn: (id: string) => hrApi.approvePayrollRun(id), onSuccess: () => { toast.success(t("common.success")); invalidate(); }, onError });
  const pay = useMutation({
    mutationFn: (id: string) => hrApi.payPayrollRun(id, { bankAccountCode, paymentDate: `${paymentDate}T00:00:00.000Z` }),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError,
  });
  const remove = useMutation({ mutationFn: (id: string) => hrApi.deletePayrollRun(id), onSuccess: () => { toast.success(t("common.success")); setSelectedId(""); invalidate(); }, onError });

  const columns: ColumnDef<PayrollRun>[] = [
    { accessorKey: "period", header: t("hr.period"), cell: ({ row }) => `${row.original.periodYear}-${String(row.original.periodMonth).padStart(2, "0")}` },
    { accessorKey: "grossMinor", header: t("hr.gross"), cell: ({ row }) => formatMoney(row.original.grossMinor, row.original.currency, locale) },
    { accessorKey: "deductionsMinor", header: t("hr.deductions"), cell: ({ row }) => formatMoney(row.original.deductionsMinor, row.original.currency, locale) },
    { accessorKey: "netMinor", header: t("hr.net"), cell: ({ row }) => formatMoney(row.original.netMinor, row.original.currency, locale) },
    { accessorKey: "gosiEmployerMinor", header: t("hr.gosiEmployer"), cell: ({ row }) => formatMoney(row.original.gosiEmployerMinor, row.original.currency, locale) },
    { accessorKey: "eosbMinor", header: t("hr.eosb"), cell: ({ row }) => formatMoney(row.original.eosbMinor, row.original.currency, locale) },
    { accessorKey: "status", header: t("common.status"), cell: ({ row }) => <Badge variant={row.original.status === "PAID" ? "default" : row.original.status === "APPROVED" ? "default" : "secondary"}>{row.original.status}</Badge> },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setSelectedId(row.original.id)}>{t("common.viewAll")}</Button>
          {(row.original.status === "DRAFT" || row.original.status === "CALCULATED") && <Button size="sm" onClick={() => calculate.mutate(row.original.id)}>{t("hr.calculate")}</Button>}
          {canApprove && row.original.status === "CALCULATED" && <Button size="sm" onClick={() => approve.mutate(row.original.id)}>{t("hr.approve")}</Button>}
          {canApprove && row.original.status === "APPROVED" && <Button size="sm" onClick={() => pay.mutate(row.original.id)}>{t("hr.pay")}</Button>}
          {row.original.status === "DRAFT" && <Button size="sm" variant="outline" onClick={() => remove.mutate(row.original.id)}>{t("common.delete")}</Button>}
        </div>
      ),
    },
  ];

  const lineColumns: ColumnDef<PayrollLine>[] = [
    { accessorKey: "employee", header: t("hr.employee"), cell: ({ row }) => `${row.original.employee?.code ?? "—"} — ${row.original.employee?.name ?? ""}` },
    { accessorKey: "grossMinor", header: t("hr.gross"), cell: ({ row }) => formatMoney(row.original.grossMinor, "SAR", locale) },
    { accessorKey: "gosiEmployeeMinor", header: t("hr.gosiEmployee"), cell: ({ row }) => formatMoney(row.original.gosiEmployeeMinor, "SAR", locale) },
    { accessorKey: "otherDeductionsMinor", header: t("hr.otherDeductions"), cell: ({ row }) => formatMoney(row.original.otherDeductionsMinor, "SAR", locale) },
    { accessorKey: "netMinor", header: t("hr.net"), cell: ({ row }) => formatMoney(row.original.netMinor, "SAR", locale) },
    { accessorKey: "gosiEmployerMinor", header: t("hr.gosiEmployer"), cell: ({ row }) => formatMoney(row.original.gosiEmployerMinor, "SAR", locale) },
    { accessorKey: "eosbAccrualMinor", header: t("hr.eosb"), cell: ({ row }) => formatMoney(row.original.eosbAccrualMinor, "SAR", locale) },
    { accessorKey: "absentDays", header: t("hr.absent") },
  ];

  const d = detail.data;

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">{t("hr.payrollRuns")}</h1>
        <Card>
          <CardHeader><CardTitle>{t("hr.addPayrollRun")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <div className="space-y-1"><Label>{t("hr.period")}</Label><Input type="number" value={periodYear} onChange={(e) => setPeriodYear(e.target.value)} /></div>
              <div className="space-y-1"><Label>—</Label><Input type="number" min={1} max={12} value={periodMonth} onChange={(e) => setPeriodMonth(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.bankAccount")}</Label><Input value={bankAccountCode} onChange={(e) => setBankAccountCode(e.target.value)} /></div>
              <div className="space-y-1"><Label>{t("hr.paymentDate")}</Label><Input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} /></div>
            </div>
            <Button onClick={() => create.mutate()}>{t("hr.addPayrollRun")}</Button>
          </CardContent>
        </Card>
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          <Card>
            <CardHeader><CardTitle>{t("hr.payrollRuns")} ({rows.length})</CardTitle></CardHeader>
            <CardContent><DataTable columns={columns} data={rows} /></CardContent>
          </Card>
        )}
        {d && (
          <Card>
            <CardHeader><CardTitle>{d.periodYear}-{String(d.periodMonth).padStart(2, "0")} — {d.status}</CardTitle></CardHeader>
            <CardContent>
              <DataTable columns={lineColumns} data={d.lines ?? []} />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
