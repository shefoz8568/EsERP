"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { Badge, Button, Card, CardContent, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { asList, asTotal, contactsApi } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { AppShell } from "@/components/AppShell";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormSection } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";
import type { Contact } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

const TYPES = ["CUSTOMER", "SUPPLIER", "BOTH"] as const;

type ContactView = "all" | "CUSTOMER" | "SUPPLIER" | "BOTH";

export default function ContactsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("");
  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [newType, setNewType] = useState<string>("CUSTOMER");
  const [email, setEmail] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [page, setPage] = useState(1);
  const [view, setView] = useState<ContactView>("all");
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    setPage(1);
  }, [search, type, view]);

  const query = useQuery({
    queryKey: ["contacts", search, type, view, page],
    queryFn: () =>
      contactsApi.list({
        search: search || undefined,
        type: type || (view === "all" ? undefined : view),
        page,
        pageSize: 10,
      }),
  });
  const contacts = asList<Contact>(query.data);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ["contacts"] });

  const create = useMutation({
    mutationFn: () =>
      contactsApi.create({
        type: newType as Contact["type"],
        legalName: legalName || displayName,
        displayName,
        email: email || undefined,
        taxNumber: taxNumber || undefined,
        phone: phone || undefined,
        creditLimitMinor: creditLimit ? Math.round(Number(creditLimit) * 100) : 0,
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setDisplayName(""); setLegalName(""); setEmail(""); setTaxNumber(""); setPhone(""); setCreditLimit("");
      setTriedSave(false);
      invalidate();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => contactsApi.delete(id),
    onSuccess: () => { toast.success(t("common.success")); invalidate(); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const columns: ColumnDef<Contact>[] = [
    {
      accessorKey: "displayName",
      header: t("common.name"),
      cell: ({ row }) => (
        <Link href={`/${locale}/contacts/${row.original.id}`} className="font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {row.original.displayName}
        </Link>
      ),
    },
    {
      accessorKey: "type",
      header: t("masterData.type"),
      cell: ({ row }) => (
        <Badge variant="secondary">
          {t(`masterData.${row.original.type === "BOTH" ? "both" : row.original.type === "CUSTOMER" ? "customer" : "supplier"}` as never)}
        </Badge>
      ),
    },
    { accessorKey: "email", header: t("masterData.email") },
    { accessorKey: "taxNumber", header: t("masterData.taxNumber") },
    {
      accessorKey: "creditLimitMinor",
      header: t("masterData.creditLimit"),
      meta: { numeric: true },
      cell: ({ row }) => formatMoney(row.original.creditLimitMinor, row.original.creditLimitCurrency, locale),
    },
    {
      accessorKey: "status",
      header: t("common.status"),
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          label={row.original.status === "ACTIVE" ? t("common.active") : t("common.inactive")}
        />
      ),
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button variant="destructive" size="sm" onClick={() => remove.mutate(row.original.id)}>
          {t("common.delete")}
        </Button>
      ),
    },
  ];

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-bold">{t("masterData.contacts")}</h1>
          <span className="text-sm text-muted-foreground">{asTotal(query.data)}</span>
        </div>

        <Card>
          <CardContent className="pt-6">
            <FormSection id="add-contact" title={t("masterData.addContact")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <FormField label={t("masterData.displayName")} required error={triedSave && !displayName ? t("common.required") : undefined}>
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.legalName")}>
                  <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.type")} required>
                  <Select value={newType} onValueChange={setNewType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{TYPES.map((ty) => <SelectItem key={ty} value={ty}>{t(`masterData.${ty === "BOTH" ? "both" : ty === "CUSTOMER" ? "customer" : "supplier"}` as never)}</SelectItem>)}</SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("masterData.email")}>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.taxNumber")}>
                  <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} placeholder="300000000000003" />
                </FormField>
                <FormField label={t("masterData.phone")}>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </FormField>
                <FormField label={`${t("masterData.creditLimit")} (SAR)`}>
                  <Input type="number" min="0" step="0.01" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} />
                </FormField>
              </div>
              <Button
                className="mt-4"
                disabled={create.isPending}
                onClick={() => {
                  setTriedSave(true);
                  if (displayName) create.mutate();
                }}
              >
                {t("masterData.addContact")}
              </Button>
              {triedSave && !displayName && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {t("common.required")}
                </p>
              )}
            </FormSection>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Input className="max-w-xs" placeholder={t("common.search")} value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select value={type || "ALL"} onValueChange={(v) => setType(v === "ALL" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("masterData.type")}</SelectItem>
              {TYPES.map((ty) => <SelectItem key={ty} value={ty}>{ty}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : query.isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <DataTable
            id="contacts"
            columns={columns}
            data={contacts}
            ariaLabel={t("masterData.contacts")}
            enableSelection
            bulkActions={[
              {
                id: "delete",
                label: t("common.delete"),
                variant: "destructive",
                onClick: (rows) => rows.forEach((r) => remove.mutate(r.id)),
              },
            ]}
            savedViews={[
              { id: "all", label: t("common.showAll") },
              { id: "CUSTOMER", label: t("masterData.customer") },
              { id: "SUPPLIER", label: t("masterData.supplier") },
              { id: "BOTH", label: t("masterData.both") },
            ]}
            activeViewId={view}
            onSelectView={(viewId) => setView(viewId as ContactView)}
            serverPagination={{ page, pageSize: 10, total: asTotal(query.data), onPageChange: setPage }}
          />
        )}
      </div>
    </AppShell>
  );
}
