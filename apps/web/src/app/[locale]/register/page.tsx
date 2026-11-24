"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Input, Label } from "@eserp/ui";
import { useAuth } from "@/lib/auth";
import { locales } from "@eserp/i18n";

const schema = z
  .object({
    tenantName: z.string().min(2),
    companyName: z.string().min(2),
    email: z.string().email(),
    password: z.string().min(8),
    confirmPassword: z.string().min(8),
    locale: z.enum(["en", "ar"]),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: "passwordsDoNotMatch",
    path: ["confirmPassword"],
  });

export default function RegisterPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { register: registerUser } = useAuth();
  const { locale } = use(params);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { locale: locale as "en" | "ar" },
  });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setServerError(null);
    try {
      await registerUser({
        tenantName: values.tenantName,
        companyName: values.companyName,
        email: values.email,
        password: values.password,
        locale: values.locale,
      });
      router.push(`/${values.locale}/onboarding`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t("common.error"));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">EsERP</h1>
          <h2 className="text-lg font-semibold">{t("auth.registerTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("auth.registerSubtitle")}</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tenantName">{t("onboarding.tenantName")}</Label>
            <Input id="tenantName" autoComplete="organization" {...register("tenantName")} />
            {errors.tenantName && <p className="text-xs text-destructive">{errors.tenantName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="companyName">{t("onboarding.companyName")}</Label>
            <Input id="companyName" autoComplete="organization" {...register("companyName")} />
            {errors.companyName && <p className="text-xs text-destructive">{errors.companyName.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="password">{t("auth.password")}</Label>
              <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
              {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                {...register("confirmPassword")}
              />
              {errors.confirmPassword && (
                <p className="text-xs text-destructive">
                  {errors.confirmPassword.message === "passwordsDoNotMatch"
                    ? t("auth.passwordsDoNotMatch")
                    : errors.confirmPassword.message}
                </p>
              )}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="locale">{t("settings.company.language")}</Label>
            <select
              id="locale"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              {...register("locale")}
            >
              {locales.map((l) => (
                <option key={l} value={l}>
                  {l === "ar" ? "العربية" : "English"}
                </option>
              ))}
            </select>
          </div>
          {serverError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t("common.loading") : t("auth.createAccount")}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          <Link className="text-primary hover:underline" href={`/${locale}/login`}>
            {t("auth.alreadyHaveAccount")}
          </Link>
        </p>
      </div>
    </div>
  );
}
