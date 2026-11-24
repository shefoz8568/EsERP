"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { Button, Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, toast } from "@eserp/ui";
import { contactsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { ErrorState } from "@/components/ErrorState";
import { FormField, FormPageHeader, FormSection, StickySaveBar } from "@/components/FormPage";
import { StatusBadge } from "@/components/StatusBadge";

type Snapshot = {
  displayName: string;
  legalName: string;
  type: string;
  email: string;
  taxNumber: string;
  phone: string;
  city: string;
  status: string;
  paymentTermsDays: string;
};

export default function ContactDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = use(params);
  const t = useTranslations();
  const router = useRouter();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["contacts", id], queryFn: () => contactsApi.get(id) });
  const c = query.data;

  const [displayName, setDisplayName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [type, setType] = useState("CUSTOMER");
  const [email, setEmail] = useState("");
  const [taxNumber, setTaxNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [paymentTermsDays, setPaymentTermsDays] = useState("0");
  const [initial, setInitial] = useState<Snapshot | null>(null);
  const [triedSave, setTriedSave] = useState(false);

  useEffect(() => {
    if (c && !initial) {
      const snap: Snapshot = {
        displayName: c.displayName,
        legalName: c.legalName,
        type: c.type,
        email: c.email ?? "",
        taxNumber: c.taxNumber ?? "",
        phone: c.phone ?? "",
        city: c.city ?? "",
        status: c.status,
        paymentTermsDays: String(c.paymentTermsDays),
      };
      setInitial(snap);
      setDisplayName(snap.displayName);
      setLegalName(snap.legalName);
      setType(snap.type);
      setEmail(snap.email);
      setTaxNumber(snap.taxNumber);
      setPhone(snap.phone);
      setCity(snap.city);
      setStatus(snap.status);
      setPaymentTermsDays(snap.paymentTermsDays);
    }
  }, [c, initial]);

  const current: Snapshot = { displayName, legalName, type, email, taxNumber, phone, city, status, paymentTermsDays };
  const dirty = initial !== null && JSON.stringify(current) !== JSON.stringify(initial);
  const valid = !!displayName.trim() && Number(paymentTermsDays || 0) >= 0;

  const discard = () => {
    if (!initial) return;
    setDisplayName(initial.displayName);
    setLegalName(initial.legalName);
    setType(initial.type);
    setEmail(initial.email);
    setTaxNumber(initial.taxNumber);
    setPhone(initial.phone);
    setCity(initial.city);
    setStatus(initial.status);
    setPaymentTermsDays(initial.paymentTermsDays);
    setTriedSave(false);
  };

  const save = useMutation({
    mutationFn: () =>
      contactsApi.update(id, {
        displayName, legalName, type: type as never, email: email || undefined,
        taxNumber: taxNumber || undefined, phone: phone || undefined, city: city || undefined,
        status: status as never, paymentTermsDays: Number(paymentTermsDays) || 0,
      }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setInitial(current);
      setTriedSave(false);
      void queryClient.invalidateQueries({ queryKey: ["contacts", id] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const remove = useMutation({
    mutationFn: () => contactsApi.delete(id),
    onSuccess: () => { toast.success(t("common.success")); router.push(`/${locale}/contacts`); },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  return (
    <AppShell locale={locale}>
      <div className="space-y-6">
        <FormPageHeader
          title={c?.displayName ?? t("common.loading")}
          subtitle={c ? `${t("masterData.type")}: ${t(`masterData.${c.type === "BOTH" ? "both" : c.type === "CUSTOMER" ? "customer" : "supplier"}` as never)}` : undefined}
          status={c ? <StatusBadge status={c.status} label={c.status === "ACTIVE" ? t("common.active") : t("common.inactive")} /> : undefined}
          onBack={() => router.push(`/${locale}/contacts`)}
          backLabel={t("common.back")}
          actions={
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              {t("common.delete")}
            </Button>
          }
        />
        {query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : !c ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : (
          <>
            <FormSection id="contact-identity" title={t("masterData.displayName")}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("masterData.displayName")} required error={triedSave && !displayName.trim() ? t("common.required") : undefined}>
                  <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.legalName")}>
                  <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.type")} required>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CUSTOMER">{t("masterData.customer")}</SelectItem>
                      <SelectItem value="SUPPLIER">{t("masterData.supplier")}</SelectItem>
                      <SelectItem value="BOTH">{t("masterData.both")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label={t("common.status")}>
                  <Select value={status} onValueChange={setStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">{t("common.active")}</SelectItem>
                      <SelectItem value="INACTIVE">{t("common.inactive")}</SelectItem>
                    </SelectContent>
                  </Select>
                </FormField>
              </div>
            </FormSection>

            <FormSection id="contact-terms" title={`${t("masterData.email")} / ${t("masterData.paymentTerms")}`}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("masterData.email")}>
                  <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.taxNumber")}>
                  <Input value={taxNumber} onChange={(e) => setTaxNumber(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.phone")}>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.city")}>
                  <Input value={city} onChange={(e) => setCity(e.target.value)} />
                </FormField>
                <FormField label={t("masterData.paymentTerms")}>
                  <Input type="number" min="0" value={paymentTermsDays} onChange={(e) => setPaymentTermsDays(e.target.value)} />
                </FormField>
              </div>
            </FormSection>

            <StickySaveBar
              dirty={dirty}
              saving={save.isPending}
              saveDisabled={!valid}
              onSave={() => {
                setTriedSave(true);
                if (valid) save.mutate();
              }}
              onDiscard={discard}
              saveLabel={t("common.save")}
              discardLabel={t("common.discard")}
              unsavedLabel={t("common.unsavedChanges")}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
