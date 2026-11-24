"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Input, Label } from "@eserp/ui";
import { useAuth } from "@/lib/auth";

const schema = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export default function MfaPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { locale } = use(params);
  const { verifyMfa, mfaToken } = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!mfaToken) router.replace(`/${locale}/login`);
  }, [mfaToken, locale, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setServerError(null);
    try {
      await verifyMfa(values.code);
      router.push(`/${locale}/dashboard`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : t("common.error"));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">EsERP</h1>
          <h2 className="text-lg font-semibold">{t("auth.mfaTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("auth.mfaSubtitle")}</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="code">{t("auth.mfaCode")}</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              className="text-center text-lg tracking-[0.5em]"
              {...register("code")}
            />
            {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
          </div>
          {serverError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t("common.loading") : t("auth.verifyMfa")}
          </Button>
        </form>
      </div>
    </div>
  );
}
