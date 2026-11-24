"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, Input, Label } from "@eserp/ui";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export default function LoginPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const t = useTranslations();
  const router = useRouter();
  const { login } = useAuth();
  const { locale } = use(params);
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: z.infer<typeof schema>) => {
    setServerError(null);
    try {
      const { mfaRequired } = await login(values.email, values.password);
      router.push(mfaRequired ? `/${locale}/mfa` : `/${locale}/dashboard`);
    } catch (err) {
      setServerError(
        err instanceof ApiError && err.status === 401
          ? t("auth.invalidCredentials")
          : err instanceof Error
            ? err.message
            : t("common.error"),
      );
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border bg-card p-6 shadow-sm">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold">EsERP</h1>
          <h2 className="text-lg font-semibold">{t("auth.loginTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("auth.loginSubtitle")}</p>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t("auth.email")}</Label>
            <Input id="email" type="email" autoComplete="email" {...register("email")} />
            {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">{t("auth.password")}</Label>
            <Input id="password" type="password" autoComplete="current-password" {...register("password")} />
            {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
          </div>
          {serverError && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {serverError}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? t("common.loading") : t("auth.login")}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          <Link className="text-primary hover:underline" href={`/${locale}/register`}>
            {t("auth.noAccount")}
          </Link>
        </p>
      </div>
    </div>
  );
}
