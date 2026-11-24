"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Badge, Button, Checkbox, Input, Label, toast } from "@eserp/ui";
import { asList, rolesApi, usersApi } from "@/lib/api";
import { PERMISSION_GROUPS, ROLES } from "@/lib/permissions";
import { DataTable } from "@/components/DataTable";
import { ErrorState } from "@/components/ErrorState";
import type { AppUser, Role } from "@/lib/types";
import type { ColumnDef } from "@tanstack/react-table";

export function UsersRolesTab() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("VIEWER");
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [draftPermissions, setDraftPermissions] = useState<string[]>([]);

  const users = useQuery({ queryKey: ["users"], queryFn: () => usersApi.list() });
  const roles = useQuery({ queryKey: ["roles"], queryFn: () => rolesApi.list() });
  const userList = asList<AppUser>(users.data);
  const roleList = asList<Role>(roles.data);

  const invite = useMutation({
    mutationFn: () => usersApi.invite({ email: inviteEmail, role: inviteRole }),
    onSuccess: () => {
      toast.success(t("common.success"));
      setInviteEmail("");
      void queryClient.invalidateQueries({ queryKey: ["users"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const savePermissions = useMutation({
    mutationFn: () =>
      rolesApi.updatePermissions(selectedRoleId ?? "", draftPermissions),
    onSuccess: () => {
      toast.success(t("common.success"));
      void queryClient.invalidateQueries({ queryKey: ["roles"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : t("common.error")),
  });

  const openRole = (role: Role) => {
    setSelectedRoleId(role.id);
    setDraftPermissions([...role.permissions]);
  };

  const togglePermission = (key: string, checked: boolean) => {
    setDraftPermissions((prev) =>
      checked ? [...prev, key] : prev.filter((p) => p !== key),
    );
  };

  const userColumns: ColumnDef<AppUser>[] = [
    { accessorKey: "name", header: t("settings.user.name") },
    { accessorKey: "email", header: t("settings.user.email") },
    {
      accessorKey: "role",
      header: t("settings.user.role"),
      cell: ({ row }) => <Badge variant="secondary">{row.original.role}</Badge>,
    },
    {
      accessorKey: "status",
      header: t("settings.user.status"),
      cell: ({ row }) => row.original.status ?? "—",
    },
  ];

  const roleColumns: ColumnDef<Role>[] = [
    { accessorKey: "name", header: t("settings.role.name") },
    {
      accessorKey: "permissions",
      header: t("settings.role.permissions"),
      cell: ({ row }) => `${row.original.permissions.length}`,
    },
    {
      id: "actions",
      header: t("common.actions"),
      cell: ({ row }) => (
        <Button variant="outline" size="sm" onClick={() => openRole(row.original)}>
          {t("common.edit")}
        </Button>
      ),
    },
  ];

  const selectedRole = roleList.find((r) => r.id === selectedRoleId) ?? null;

  if (users.isLoading || roles.isLoading)
    return <p className="text-sm text-muted-foreground">{t("common.loading")}</p>;
  if (users.isError || roles.isError)
    return <ErrorState onRetry={() => { void users.refetch(); void roles.refetch(); }} />;

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <h3 className="text-lg font-medium">{t("settings.users")}</h3>
        <DataTable columns={userColumns} data={userList} emptyMessage={t("common.noData")} />
        <form
          className="max-w-xl space-y-4 rounded-lg border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (inviteEmail.trim()) invite.mutate();
          }}
        >
          <h4 className="font-medium">{t("settings.user.inviteUser")}</h4>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email">{t("settings.user.email")}</Label>
              <Input id="invite-email" type="email" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t("settings.user.role")}</Label>
              <select
                id="invite-role"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </div>
          </div>
          <Button type="submit" disabled={invite.isPending}>{t("settings.user.inviteUser")}</Button>
        </form>
      </section>

      <section className="space-y-4">
        <h3 className="text-lg font-medium">{t("settings.roles")}</h3>
        <DataTable columns={roleColumns} data={roleList} emptyMessage={t("common.noData")} />
        {selectedRole && (
          <div className="space-y-4 rounded-lg border p-4">
            <h4 className="font-medium">
              {selectedRole.name} — {t("settings.role.permissions")}
            </h4>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {PERMISSION_GROUPS.map((group) => (
                <fieldset key={group.module} className="rounded-md border p-3">
                  <legend className="px-1 text-sm font-medium">{group.label}</legend>
                  <div className="space-y-2">
                    {group.permissions.map((perm) => (
                      <label key={perm.key} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={draftPermissions.includes(perm.key)}
                          onCheckedChange={(checked) => togglePermission(perm.key, checked === true)}
                        />
                        {perm.label}
                        <span className="text-xs text-muted-foreground">{perm.key}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </div>
            <Button disabled={savePermissions.isPending} onClick={() => savePermissions.mutate()}>
              {t("settings.role.savePermissions")}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
