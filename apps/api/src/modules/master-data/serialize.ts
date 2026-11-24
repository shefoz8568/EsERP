/**
 * Master-data helpers shared by the contacts / items / pricelists modules.
 *
 * Prisma returns BigInt for money/quantity columns, which JSON.stringify
 * cannot serialise — every row leaving a service goes through toJson(),
 * which converts BigInts to plain numbers (amounts are minor units and
 * far below Number.MAX_SAFE_INTEGER for any realistic ERP value).
 * The same helper is used for audit before/after snapshots, which are
 * stored as Prisma Json and likewise reject BigInt.
 */
export function toJson<T>(value: T): T {
  if (typeof value === 'bigint') return Number(value) as T;
  if (value instanceof Date) return value as T;
  if (Array.isArray(value)) return value.map((v) => toJson(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = toJson(v);
    return out as T;
  }
  return value;
}

export interface PageParams {
  page: number;
  pageSize: number;
}

export function parsePageParams(query: { page?: string; pageSize?: string }): PageParams {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

export function pageMeta(total: number, { page, pageSize }: PageParams): { total: number; page: number; pageSize: number; totalPages: number } {
  return { total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}
