"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Input, Label, toast } from "@eserp/ui";
import { settingsApi, tenantsApi } from "@/lib/api";
import { ErrorState } from "@/components/ErrorState";

/**
 * Company profile form. Field names follow the real API
 * (CompanyProfile: legalName / tradeName / addressLine1 / city …).
 * The default currency lives on the tenant (GET/PATCH /tenants/me),
 * so it is loaded and saved separately.
 */
const schema = z.object({
  legalName: z.string().min(1).optional().or(z.literal("")),
  tradeName: z.string().min(1).optional().or(z.literal("")),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  city: z.string().optional(),
  taxNumber: z.string().optional(),
  defaultCurrency: z.string().min(3).max(3),
});

export function CompanyTab() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const company = useQuery({
    queryKey: ["company"],
    queryFn: () => settingsApi.getCompany(),
  });
  const tenant = useQuery({
    queryKey: ["tenant-me"],
    queryFn: () => tenantsApi.getMe(),
  });

  const { register, handleSubmit, reset, formState: { isSubmitting } } =
    useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (company.data) {
      reset({
        legalName: company.data.legalName ?? "",
        tradeName: company.data.tradeName ?? "",
        email: company.data.email ?? "",
        phone: company.data.phone ?? "",
        addressLine1: company.data.addressLine1 ?? "",
        city: company.data.city ?? "",
        taxNumber: company.data.taxNumber ?? "",
        defaultCurrency: tenant.data?.defaultCurrency ?? "SAR",
      });
    }
  }, [company.data, tenant.data, reset]);

  const save = useMutation({
    mutationFn: async (values: z.infer<typeof schema>) => {
      const { defaultCurrency, ...profile } = values;
      await settingsApi.updateCompany(profile);
      await tenantsApi.updateMe({ defaultCurrency });
    },
    onSuccess: () => {
      toast.success(t("common.success"));
      void queryClient.invalidateQueries({ queryKey: ["company"] });
      void queryClient.invalidateQueries({ queryKey: ["tenant-me"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  if (company.isLoading || tenant.isLoading)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (company.isError || !company.data)
    return <ErrorState onRetry={() => void company.refetch()} />;

  return (
    <form onSubmit={handleSubmit((v) => save.mutate(v))} className="max-w-xl space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company-legal">{t("settings.company.name")}</Label>
          <Input id="company-legal" {...register("legalName")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-trade">{t("settings.company.name")} (trade)</Label>
          <Input id="company-trade" {...register("tradeName")} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company-email">{t("settings.company.email")}</Label>
          <Input id="company-email" type="email" {...register("email")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-phone">{t("settings.company.phone")}</Label>
          <Input id="company-phone" {...register("phone")} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company-address">{t("settings.company.address")}</Label>
          <Input id="company-address" {...register("addressLine1")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-city">{t("settings.warehouse.city")}</Label>
          <Input id="company-city" {...register("city")} />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="company-tax">{t("settings.company.taxNumber")}</Label>
          <Input id="company-tax" {...register("taxNumber")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="company-currency">{t("settings.company.currency")}</Label>
          <Input id="company-currency" maxLength={3} className="uppercase" {...register("defaultCurrency")} />
        </div>
      </div>
      <Button type="submit" disabled={isSubmitting || save.isPending}>
        {t("common.save")}
      </Button>
    </form>
  );
}
