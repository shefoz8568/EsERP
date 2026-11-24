"use client";

import { useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button, Input, Label } from "@eserp/ui";
import { asList, asTotal, auditApi } from "@/lib/api";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { AuditLog } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const PAGE_SIZE = 20;

export function AuditLogTab({ locale }: { locale: string }) {
  const t = useTranslations();
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [applied, setApplied] = useState({ entityType: "", action: "" });

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit-logs", page, applied],
    queryFn: () =>
      auditApi.list({ page, pageSize: PAGE_SIZE, entityType: applied.entityType || undefined, action: applied.action || undefined }),
  });

  const logs = asList<AuditLog>(data);
  const total = asTotal(data);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const columns: ColumnDef<AuditLog>[] = [
    {
      accessorKey: "createdAt",
      header: t("settings.audit.date"),
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(locale),
    },
    {
      accessorKey: "actorId",
      header: t("settings.audit.user"),
      cell: ({ row }) => row.original.actorId ?? "—",
    },
    { accessorKey: "action", header: t("settings.audit.action") },
    { accessorKey: "entityType", header: t("settings.audit.entityType") },
    { accessorKey: "entityId", header: t("settings.audit.entityId") },
  ];

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (isError) return <ErrorState onRetry={() => void refetch()} />;

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setApplied({ entityType, action });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="audit-entity">{t("settings.audit.filterEntity")}</Label>
          <Input id="audit-entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="audit-action">{t("settings.audit.filterAction")}</Label>
          <Input id="audit-action" value={action} onChange={(e) => setAction(e.target.value)} />
        </div>
        <Button type="submit" variant="outline">{t("common.search")}</Button>
      </form>

      <DataTable columns={columns} data={logs} pageSize={PAGE_SIZE} emptyMessage={t("common.noData")} />

      {pageCount > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            {page} / {pageCount}
          </span>
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t("common.back")}
          </Button>
          <Button variant="outline" size="sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
            {t("common.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
