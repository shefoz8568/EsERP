"use client";

import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  X,
} from "lucide-react";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  cn,
} from "@eserp/ui";
import { EmptyState } from "./EmptyState";

/**
 * EsERP standard data table (research #4 / #14).
 *
 * Fiori List Report / Acumatica grid bundle: sticky header + sticky first
 * column, sortable columns with a visible indicator, right-aligned
 * `tabular-nums` numeric columns (opt in per column via
 * `meta: { numeric: true }`), column show/hide persisted to localStorage,
 * server pagination, hover row actions (the `actions` column fades in on
 * row hover / focus), checkbox selection with a bulk-action bar, and named
 * saved filter views.
 *
 * Sorting is client-side over the rows currently loaded. When
 * `serverPagination` is used the sort therefore applies to the loaded
 * page only; the server still owns paging/filtering.
 *
 * Backwards compatible with the previous signature: only `columns` and
 * `data` are required, and the old client-side pagination still works.
 */
export interface DataTableSavedView {
  id: string;
  label: string;
}

export interface DataTableBulkAction<T> {
  id: string;
  label: string;
  onClick: (rows: T[]) => void;
  /** Return true to disable the action for the current selection. */
  disabled?: (rows: T[]) => boolean;
  variant?: "default" | "outline" | "destructive";
}

export interface DataTableServerPagination {
  /** 1-based page number. */
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  pageSize?: number;
  emptyMessage?: string;
  /** Storage key suffix for persisted column visibility, e.g. "sales-invoices". */
  id?: string;
  ariaLabel?: string;
  enableSelection?: boolean;
  onSelectionChange?: (rows: T[]) => void;
  bulkActions?: DataTableBulkAction<T>[];
  /** Named saved filter views (#14). The page owns the filter state; selecting a view just reports its id. */
  savedViews?: DataTableSavedView[];
  activeViewId?: string;
  onSelectView?: (id: string) => void;
  /** When provided, a "save current view" name field is shown. */
  onSaveView?: (name: string) => void;
  serverPagination?: DataTableServerPagination;
  /** Called on Enter/Space on a focused row; also makes rows keyboard-focusable. */
  onRowActivate?: (row: T) => void;
}

function storageKey(id: string) {
  return `eserp:datatable:${id}`;
}

function loadHiddenColumns(id?: string): VisibilityState {
  if (!id || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(storageKey(id));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { hidden?: unknown }).hidden)) {
      const hidden = (parsed as { hidden: unknown[] }).hidden.filter(
        (c): c is string => typeof c === "string",
      );
      return Object.fromEntries(hidden.map((c) => [c, false]));
    }
  } catch {
    /* Corrupt storage: fall through to showing all columns. */
  }
  return {};
}

export function DataTable<T>({
  columns,
  data,
  pageSize = 10,
  emptyMessage,
  id,
  ariaLabel,
  enableSelection,
  onSelectionChange,
  bulkActions,
  savedViews,
  activeViewId,
  onSelectView,
  onSaveView,
  serverPagination,
  onRowActivate,
}: DataTableProps<T>) {
  const t = useTranslations();
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() =>
    loadHiddenColumns(id),
  );
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [newViewName, setNewViewName] = useState("");
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize });

  // Keep the client page size in sync with the prop.
  useEffect(() => {
    setPagination((p) => ({ ...p, pageSize }));
  }, [pageSize]);

  // A new page of server data invalidates the old selection.
  useEffect(() => {
    setRowSelection({});
  }, [data]);

  // Persist column visibility per table.
  useEffect(() => {
    if (!id || typeof window === "undefined") return;
    try {
      const hidden = Object.entries(columnVisibility)
        .filter(([, visible]) => visible === false)
        .map(([key]) => key);
      window.localStorage.setItem(storageKey(id), JSON.stringify({ hidden }));
    } catch {
      /* Storage unavailable (private mode, quota): visibility just isn't persisted. */
    }
  }, [columnVisibility, id]);

  const tableColumns = useMemo<ColumnDef<T, unknown>[]>(() => {
    if (!enableSelection) return columns;
    const selectColumn: ColumnDef<T, unknown> = {
      id: "select",
      enableSorting: false,
      enableHiding: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={t("common.selectAllRows")}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={t("common.selectRow")}
        />
      ),
    };
    return [selectColumn, ...columns];
  }, [columns, enableSelection, t]);

  const table = useReactTable({
    data,
    columns: tableColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      pagination: serverPagination
        ? { pageIndex: serverPagination.page - 1, pageSize: serverPagination.pageSize }
        : pagination,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: serverPagination
      ? (updater) => {
          const next =
            typeof updater === "function"
              ? updater({ pageIndex: serverPagination.page - 1, pageSize: serverPagination.pageSize })
              : updater;
          serverPagination.onPageChange(next.pageIndex + 1);
        }
      : setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: !!serverPagination,
    pageCount: serverPagination
      ? Math.max(1, Math.ceil(serverPagination.total / serverPagination.pageSize))
      : undefined,
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedCount = selectedRows.length;

  useEffect(() => {
    onSelectionChange?.(selectedRows);
  }, [selectedCount]);

  const hideableColumns = table.getAllColumns().filter((c) => c.getCanHide());
  const pageCount = table.getPageCount();
  const pageIndex = table.getState().pagination.pageIndex;
  const total = serverPagination ? serverPagination.total : data.length;
  const firstRow = total === 0 ? 0 : pageIndex * table.getState().pagination.pageSize + 1;
  const lastRow = serverPagination
    ? Math.min(total, pageIndex * serverPagination.pageSize + data.length)
    : Math.min(total, (pageIndex + 1) * table.getState().pagination.pageSize);

  const focusRow = (e: React.KeyboardEvent, direction: 1 | -1) => {
    const row = e.currentTarget as HTMLElement;
    const sibling = (
      direction === 1 ? row.nextElementSibling : row.previousElementSibling
    ) as HTMLElement | null;
    sibling?.focus();
  };

  return (
    <div className="space-y-3">
      {(savedViews || hideableColumns.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {savedViews && savedViews.length > 0 && (
            <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Saved views">
              {savedViews.map((view) => (
                <Button
                  key={view.id}
                  type="button"
                  size="sm"
                  variant={activeViewId === view.id ? "default" : "outline"}
                  aria-pressed={activeViewId === view.id}
                  onClick={() => onSelectView?.(view.id)}
                >
                  {view.label}
                </Button>
              ))}
            </div>
          )}
          {onSaveView && (
            <div className="flex items-center gap-1">
              <Input
                className="h-8 w-36"
                placeholder={t("common.viewName")}
                aria-label={t("common.viewName")}
                value={newViewName}
                onChange={(e) => setNewViewName(e.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!newViewName.trim()}
                onClick={() => {
                  onSaveView(newViewName.trim());
                  setNewViewName("");
                }}
              >
                {t("common.saveView")}
              </Button>
            </div>
          )}
          {hideableColumns.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm" className="ms-auto">
                  <Columns3 className="h-4 w-4" aria-hidden />
                  {t("common.columns")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-auto">
                <DropdownMenuLabel>{t("common.showHideColumns")}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {hideableColumns.map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(!!value)}
                  >
                    {typeof column.columnDef.header === "string"
                      ? column.columnDef.header
                      : column.id}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      )}

      {data.length === 0 ? (
        <EmptyState message={emptyMessage} />
      ) : (
        <>
          {/* Horizontal scroll on small screens; sticky first column keeps the
              identifying column visible while scrolling (#11). */}
          <div
            className="max-h-[65vh] overflow-auto rounded-md border"
            role="region"
            aria-label={ariaLabel ?? "Data table"}
            tabIndex={0}
          >
            <table className="w-full min-w-[40rem] caption-bottom text-sm">
              <thead className="[&_tr]:border-b">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id} className="border-b">
                    {headerGroup.headers.map((header, headerIndex) => {
                      const isStickyFirst = headerIndex === 0;
                      const sorted = header.column.getIsSorted();
                      const numeric =
                        (header.column.columnDef.meta as { numeric?: boolean } | undefined)
                          ?.numeric === true;
                      return (
                        <th
                          key={header.id}
                          scope="col"
                          aria-sort={
                            header.column.getCanSort()
                              ? sorted === "asc"
                                ? "ascending"
                                : sorted === "desc"
                                  ? "descending"
                                  : "none"
                              : undefined
                          }
                          className={cn(
                            "sticky top-0 z-20 h-10 bg-background px-2 text-start align-middle font-medium text-muted-foreground",
                            numeric && "text-end tabular-nums",
                            isStickyFirst && "start-0 z-30 border-e bg-background",
                          )}
                        >
                          {header.isPlaceholder
                            ? null
                            : header.column.getCanSort() ? (
                                <button
                                  type="button"
                                  onClick={() => header.column.toggleSorting()}
                                  className="inline-flex items-center gap-1 rounded-sm font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  aria-label={t("common.sortBy", { column: typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : header.column.id })}
                                >
                                  {flexRender(
                                    header.column.columnDef.header,
                                    header.getContext(),
                                  )}
                                  {sorted === "asc" ? (
                                    <ArrowUp className="h-3 w-3" aria-hidden />
                                  ) : sorted === "desc" ? (
                                    <ArrowDown className="h-3 w-3" aria-hidden />
                                  ) : (
                                    <ArrowUpDown className="h-3 w-3 opacity-60" aria-hidden />
                                  )}
                                </button>
                              ) : (
                                flexRender(header.column.columnDef.header, header.getContext())
                              )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="[&_tr:last-child]:border-0">
                {table.getRowModel().rows.map((row) => {
                  const isSelected = row.getIsSelected();
                  return (
                    <tr
                      key={row.id}
                      tabIndex={onRowActivate ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowDown") {
                          e.preventDefault();
                          focusRow(e, 1);
                        } else if (e.key === "ArrowUp") {
                          e.preventDefault();
                          focusRow(e, -1);
                        } else if ((e.key === "Enter" || e.key === " ") && onRowActivate) {
                          e.preventDefault();
                          onRowActivate(row.original);
                        }
                      }}
                      className={cn(
                        "group border-b transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        isSelected && "bg-muted data-[state=selected]:bg-muted",
                      )}
                      data-state={isSelected ? "selected" : undefined}
                    >
                      {row.getVisibleCells().map((cell, cellIndex) => {
                        const isStickyFirst = cellIndex === 0;
                        const numeric =
                          (cell.column.columnDef.meta as { numeric?: boolean } | undefined)
                            ?.numeric === true;
                        const isActions = cell.column.id === "actions";
                        return (
                          <td
                            key={cell.id}
                            className={cn(
                              "p-2 align-middle",
                              numeric && "text-end tabular-nums",
                              isStickyFirst &&
                                "sticky start-0 z-10 border-e bg-background group-hover:bg-muted",
                              isSelected && isStickyFirst && "bg-muted",
                            )}
                          >
                            {isActions ? (
                              <div className="flex flex-wrap gap-2 opacity-100 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-within:opacity-100">
                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                              </div>
                            ) : (
                              flexRender(cell.column.columnDef.cell, cell.getContext())
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selectedCount > 0 && (
            <div
              className="sticky bottom-0 z-20 flex flex-wrap items-center gap-2 rounded-md border bg-background p-2 shadow-sm"
              role="toolbar"
              aria-label="Bulk actions"
            >
              <span className="text-sm font-medium" aria-live="polite">
                {selectedCount} {t("common.selected")}
              </span>
              {bulkActions?.map((action) => (
                <Button
                  key={action.id}
                  type="button"
                  size="sm"
                  variant={action.variant ?? "outline"}
                  disabled={action.disabled?.(selectedRows)}
                  onClick={() => action.onClick(selectedRows)}
                >
                  {action.label}
                </Button>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => table.resetRowSelection()}
              >
                <X className="h-4 w-4" aria-hidden />
                {t("common.clearSelection")}
              </Button>
            </div>
          )}

          {pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground" aria-live="polite">
                {firstRow}–{lastRow} {t("common.of")} {total}
              </span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">
                  {pageIndex + 1} / {pageCount}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!table.getCanPreviousPage()}
                  onClick={() => table.previousPage()}
                  aria-label={t("common.previousPage")}
                >
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!table.getCanNextPage()}
                  onClick={() => table.nextPage()}
                  aria-label={t("common.nextPage")}
                >
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" aria-hidden />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
