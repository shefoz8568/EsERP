"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { use } from "react";
import { Badge, Button, Card, CardContent } from "@eserp/ui";
import { asList, notificationsApi } from "@/lib/api";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/EmptyState";
import { ErrorState } from "@/components/ErrorState";

export default function NotificationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = use(params);
  const t = useTranslations();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["notifications"],
    queryFn: () => notificationsApi.list(),
  });

  const markRead = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const items = asList(data);

  return (
    <AppShell locale={locale}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">{t("notifications.title")}</h1>
          {items.some((n) => !n.read) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                for (const n of items.filter((i) => !i.read)) markRead.mutate(n.id);
              }}
            >
              <CheckCheck className="h-4 w-4" />
              <span className="ms-1">{t("notifications.markAllRead")}</span>
            </Button>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : items.length === 0 ? (
          <EmptyState message={t("notifications.noNotifications")} />
        ) : (
          <ul className="space-y-3">
            {items.map((n) => (
              <li key={n.id}>
                <Card className={n.read ? "opacity-70" : ""}>
                  <CardContent className="flex items-start justify-between gap-4 pt-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{n.title}</p>
                        {!n.read && <Badge variant="default">{t("notifications.unread")}</Badge>}
                      </div>
                      {n.body && <p className="mt-1 text-sm text-muted-foreground">{n.body}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {new Date(n.createdAt).toLocaleString(locale)}
                      </p>
                    </div>
                    {!n.read && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={markRead.isPending}
                        onClick={() => markRead.mutate(n.id)}
                      >
                        {t("notifications.markRead")}
                      </Button>
                    )}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </AppShell>
  );
}
