import type {
  AppUser,
  AuditLog,
  Branch,
  ChartAccount,
  CompanySettings,
  Contact,
  CostCenter,
  CsvPreviewResult,
  Currency,
  FiscalPeriod,
  GeneralLedger,
  Item,
  ItemCategory,
  JournalEntry,
  LoginResponse,
  NotificationItem,
  NumberingSeries,
  OnboardingState,
  Paginated,
  PriceList,
  PriceListItem,
  RawAuthUser,
  RegisterResponse,
  Role,
  Tax,
  Tenant,
  TokenPair,
  TrialBalance,
  Unit,
  VatSummary,
  Warehouse,
} from "./types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001/api/v1";

/**
 * Token storage (Bug 2 fix — locale switch logged the user out).
 *
 * Root cause: tokens lived in module-level variables only, and the
 * [locale] layout owns <html>/<body> plus <Providers>/<AuthProvider>.
 * Switching en ⇄ ar (LanguageSwitcher does router.push to the same path
 * under the other locale) remounts that layout subtree, and a full
 * reload discards the JS module state entirely — so the remounted
 * AuthProvider found no refresh token and RequireAuth bounced the user
 * to /[locale]/login.
 *
 * Fix: persist the token pair in localStorage so it survives both the
 * locale-switch remount and a full page reload. On mount, AuthProvider
 * restores the session from the stored refresh token (POST /auth/refresh
 * rotates it server-side; see authApi.refresh).
 *
 * SECURITY TRADEOFF (dev-grade, deliberate): the API does NOT set an
 * httpOnly refresh cookie — POST /auth/refresh takes { refreshToken } in
 * the body (apps/api/src/modules/auth/auth.controller.ts) — so there is
 * no cookie-backed refresh flow to wire up. Storing tokens in
 * localStorage makes them readable by any script running on this origin
 * (XSS risk), unlike httpOnly cookies. Mitigations in place: refresh
 * tokens are single-use and rotated on every refresh, revoked on
 * logout, and stored server-side only as argon2 hashes with a 30-day
 * expiry; tokens are never put in URLs or logged. The proper
 * production fix is for the API to issue the refresh token as an
 * httpOnly, Secure, SameSite cookie and for this client to drop
 * localStorage — until then, do not deploy this to untrusted origins
 * and keep third-party scripts out of the app.
 */
const TOKEN_STORAGE_KEY = "eserp.tokens";

function readStoredTokens(): TokenPair | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as TokenPair).accessToken === "string" &&
      typeof (parsed as TokenPair).refreshToken === "string"
    ) {
      return parsed as TokenPair;
    }
    return null;
  } catch {
    // Corrupt / unreadable storage: treat as logged out, never crash.
    return null;
  }
}

function writeStoredTokens(tokens: TokenPair | null): void {
  if (typeof window === "undefined") return;
  try {
    if (tokens) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // Storage full / unavailable (e.g. private mode): session still
    // works in memory for this page, it just won't survive a reload.
  }
}

// Hydrate the in-memory tokens from storage at module load (client
// only) so API calls made before AuthProvider mounts already carry the
// restored access token, and a locale-switch remount keeps working.
const storedTokens = readStoredTokens();
let accessToken: string | null = storedTokens?.accessToken ?? null;
let refreshToken: string | null = storedTokens?.refreshToken ?? null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
  // Only persist a complete pair; clearing just the access token must
  // not wipe the stored refresh token (it is what restores the session).
  if (token && refreshToken) {
    writeStoredTokens({ accessToken: token, refreshToken });
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setTokens(tokens: TokenPair | null): void {
  accessToken = tokens?.accessToken ?? null;
  refreshToken = tokens?.refreshToken ?? null;
  // Persist (or clear) alongside the in-memory copy: this is what
  // makes the session survive a locale switch and a page reload.
  writeStoredTokens(tokens);
}

export function getRefreshToken(): string | null {
  return refreshToken;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

type FetchOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  /** Set false for /auth/refresh itself to avoid a refresh loop. */
  retryOn401?: boolean;
};

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorFrom(res: Response, body: unknown): ApiError {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    // Real API error envelope: { error: { code, message } }.
    const nested = b.error as Record<string, unknown> | undefined;
    const message =
      (nested && typeof nested.message === "string" && nested.message) ||
      (typeof b.message === "string" ? b.message : undefined) ||
      (Array.isArray(b.message) ? (b.message as string[]).join(", ") : undefined);
    const code =
      (nested && typeof nested.code === "string" && nested.code) ||
      (typeof b.code === "string" ? b.code : undefined);
    if (message) return new ApiError(res.status, message, code);
  }
  if (typeof body === "string" && body) return new ApiError(res.status, body);
  return new ApiError(res.status, `Request failed (${res.status})`);
}

/**
 * Typed fetch client. Attaches the in-memory Bearer token and, on a 401,
 * refreshes once via POST /auth/refresh { refreshToken } and retries.
 */
export async function apiFetch<T>(
  path: string,
  { body, retryOn401 = true, headers, ...init }: FetchOptions = {},
): Promise<T> {
  const doFetch = async (token: string | null): Promise<Response> =>
    fetch(`${API_BASE}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  let res = await doFetch(accessToken);

  if (res.status === 401 && retryOn401 && !path.startsWith("/auth/refresh")) {
    if (refreshToken) {
      try {
        const refreshed = await apiFetch<TokenPair>("/auth/refresh", {
          method: "POST",
          body: { refreshToken },
          retryOn401: false,
        });
        setTokens(refreshed);
        res = await doFetch(refreshed.accessToken);
      } catch {
        setTokens(null);
        throw errorFrom(res, await parseBody(res.clone()).catch(() => null));
      }
    } else {
      setTokens(null);
      throw errorFrom(res, await parseBody(res.clone()).catch(() => null));
    }
  }

  const payload = await parseBody(res);
  if (!res.ok) throw errorFrom(res, payload);
  return payload as T;
}

/** List endpoints may return a bare array or a { data, meta } envelope — normalise both. */
export function asList<T>(res: T[] | Paginated<T> | { items: T[] } | null | undefined): T[] {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray((res as Paginated<T>).data)) return (res as Paginated<T>).data;
  if (Array.isArray((res as { items: T[] }).items)) return (res as { items: T[] }).items;
  return [];
}

export function asTotal<T>(res: T[] | Paginated<T> | { items: T[] } | null | undefined): number {
  if (!res) return 0;
  if (Array.isArray(res)) return res.length;
  const meta = (res as Paginated<T>).meta;
  if (meta && typeof meta.total === "number") return meta.total;
  return asList(res).length;
}

const get = <T>(path: string) => apiFetch<T>(path, { method: "GET" });
const post = <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "POST", body });
const patch = <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: "PATCH", body });
const del = <T>(path: string) => apiFetch<T>(path, { method: "DELETE" });

/** Download a file (CSV export / snapshot) via the Bearer token and trigger a browser save. */
export async function downloadFile(path: string, filename: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------- normalisation */

type RawAuthResponse = {
  accessToken?: string;
  refreshToken?: string;
  tokens?: TokenPair;
  user?: RawAuthUser;
  tenant?: Tenant;
  mfaRequired?: boolean;
  mfaToken?: string;
};

/** Accept both the brief's flat shape and the real API's nested `tokens` shape. */
function normalizeAuth(raw: RawAuthResponse): LoginResponse {
  const accessToken = raw.accessToken ?? raw.tokens?.accessToken ?? "";
  const refreshToken = raw.refreshToken ?? raw.tokens?.refreshToken;
  const u = raw.user;
  return {
    accessToken,
    refreshToken,
    mfaRequired: raw.mfaRequired,
    mfaToken: raw.mfaToken,
    user: {
      id: u?.id ?? "",
      email: u?.email ?? "",
      name: [u?.firstName, u?.lastName].filter(Boolean).join(" ") || (u?.email ?? ""),
      tenantId: u?.tenantId ?? "",
      locale: u?.locale ?? "en",
      roles: u?.roles ?? [],
      // Login responses carry no permissions; AuthProvider refetches
      // /auth/me after login so the UI can gate on them. Leave undefined
      // (not []) so permission checks fail open until then.
      permissions: u?.permissions,
    },
  };
}

function normalizeAuthUser(raw: RawAuthUser): import("./types").AuthUser {
  return {
    id: raw.id,
    email: raw.email,
    name: [raw.firstName, raw.lastName].filter(Boolean).join(" ") || raw.email,
    tenantId: raw.tenantId,
    locale: raw.locale ?? "en",
    roles: raw.roles ?? [],
    permissions: raw.permissions,
  };
}

type RawRoleRow = {
  id: string;
  name: string;
  description?: string | null;
  rolePermissions?: Array<{ permission: { name: string } }>;
  permissions?: string[];
};

function normalizeRole(row: RawRoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    permissions: row.permissions ?? (row.rolePermissions ?? []).map((rp) => rp.permission.name),
  };
}

type RawUserRow = {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  roles?: string[];
  isActive?: boolean;
};

function normalizeUser(row: RawUserRow): AppUser {
  const roles = row.roles ?? [];
  return {
    id: row.id,
    email: row.email,
    name: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.email,
    role: roles[0] ?? "",
    roles,
    status: row.isActive === false ? "inactive" : "active",
  };
}

type RawNotificationRow = {
  id: string;
  title: string;
  body?: string | null;
  type?: string;
  createdAt: string;
  readAt?: string | null;
};

function normalizeNotification(row: RawNotificationRow): NotificationItem {
  return { ...row, read: row.readAt != null };
}

/* ------------------------------------------------------------------ auth */

export const authApi = {
  /**
   * Real API register DTO: { tenantName, email, password, firstName?,
   * lastName?, defaultCurrency, defaultLocale }. `companyName` has no
   * register field — it is applied to the company profile afterwards
   * (see AuthProvider.register).
   */
  register: async (body: {
    tenantName: string;
    email: string;
    password: string;
    defaultCurrency?: string;
    defaultLocale?: string;
  }): Promise<RegisterResponse> => {
    const raw = await post<RawAuthResponse & { tenant: Tenant }>("/auth/register", {
      tenantName: body.tenantName,
      email: body.email,
      password: body.password,
      defaultCurrency: body.defaultCurrency ?? "SAR",
      defaultLocale: body.defaultLocale ?? "en",
    });
    const norm = normalizeAuth(raw);
    return { ...norm, tenant: raw.tenant };
  },
  login: async (body: { email: string; password: string }): Promise<LoginResponse> =>
    normalizeAuth(await post<RawAuthResponse>("/auth/login", body)),
  verifyMfa: async (body: { mfaToken: string; code: string }): Promise<LoginResponse> =>
    normalizeAuth(await post<RawAuthResponse>("/auth/mfa/verify", body)),
  refresh: async (): Promise<TokenPair> => {
    if (!refreshToken) throw new ApiError(401, "No refresh token available");
    const refreshed = await post<TokenPair>("/auth/refresh", { refreshToken });
    // The server ROTATES the refresh token on every refresh (the old
    // one is revoked). The new pair must be stored — previously this
    // return value was discarded by AuthProvider's restore effect, so
    // a restored session kept the revoked refresh token and the next
    // 401 (e.g. after the access token expired) logged the user out.
    // setTokens also persists the rotated pair to localStorage.
    setTokens(refreshed);
    return refreshed;
  },
  logout: async (): Promise<void> => {
    if (refreshToken) {
      await post<void>("/auth/logout", { refreshToken });
    }
  },
  /** GET /auth/me returns the user object flat (not wrapped in { user }). */
  me: async () => ({ user: normalizeAuthUser(await get<RawAuthUser>("/auth/me")) }),
};

/* ------------------------------------------------------------- onboarding */

export const onboardingApi = {
  get: () => get<OnboardingState>("/onboarding"),
  step: (step: number, data: Record<string, unknown>) =>
    post<OnboardingState>("/onboarding/step", { step, data }),
  /** Server-side CSV validation; returns row errors + first 10 valid rows. */
  importPreview: (csvText: string) =>
    post<CsvPreviewResult>("/onboarding/import/preview", { csvText }),
  complete: () => post<OnboardingState>("/onboarding/complete"),
};

/* --------------------------------------------------------------- tenants */

export const tenantsApi = {
  getMe: () => get<Tenant>("/tenants/me"),
  updateMe: (body: Partial<Tenant>) => patch<Tenant>("/tenants/me", body),
};

/* --------------------------------------------------------------- settings */

export const settingsApi = {
  getCompany: () => get<CompanySettings>("/settings/company"),
  updateCompany: (body: Partial<CompanySettings>) =>
    patch<CompanySettings>("/settings/company", body),

  listCurrencies: () => get<Currency[] | Paginated<Currency>>("/settings/currencies"),
  createCurrency: (body: { code: string; name: string; symbol?: string; isDefault?: boolean }) =>
    post<Currency>("/settings/currencies", body),
  // NOTE: the API has no PATCH /settings/currencies/:id.
  deleteCurrency: (id: string) => del<void>(`/settings/currencies/${id}`),

  listTaxes: () => get<Tax[] | Paginated<Tax>>("/settings/taxes"),
  createTax: (body: { name: string; rateBps: number; type?: string; isInclusive?: boolean; isDefault?: boolean }) =>
    post<Tax>("/settings/taxes", body),
  updateTax: (id: string, body: Partial<Tax>) => patch<Tax>(`/settings/taxes/${id}`, body),
  deleteTax: (id: string) => del<void>(`/settings/taxes/${id}`),

  listUnits: () => get<Unit[] | Paginated<Unit>>("/settings/units"),
  createUnit: (body: { code: string; name: string; baseUnitCode?: string }) =>
    post<Unit>("/settings/units", body),
  // NOTE: the API has no PATCH/DELETE /settings/units/:id (conversions are
  // a separate POST /settings/units/conversions, not surfaced in Phase 0 UI).
  createUnitConversion: (body: { fromUomId: string; toUomId: string; factorNumerator: number; factorDenominator?: number }) =>
    post<unknown>("/settings/units/conversions", body),

  listNumberingSeries: () =>
    get<NumberingSeries[] | Paginated<NumberingSeries>>("/settings/numbering-series"),
  createNumberingSeries: (body: { code: string; name: string; pattern: string; nextNumber: number; prefix?: string; suffix?: string }) =>
    post<NumberingSeries>("/settings/numbering-series", body),
  updateNumberingSeries: (id: string, body: Partial<NumberingSeries>) =>
    patch<NumberingSeries>(`/settings/numbering-series/${id}`, body),
  // NOTE: the API has no DELETE /settings/numbering-series/:id.

  listWarehouses: () => get<Warehouse[] | Paginated<Warehouse>>("/settings/warehouses"),
  createWarehouse: (body: { name: string; city?: string; address?: string; code?: string; isDefault?: boolean }) =>
    post<Warehouse>("/settings/warehouses", body),
  updateWarehouse: (id: string, body: Partial<Warehouse>) =>
    patch<Warehouse>(`/settings/warehouses/${id}`, body),
  deleteWarehouse: (id: string) => del<void>(`/settings/warehouses/${id}`),

  listBranches: () => get<Branch[] | Paginated<Branch>>("/settings/branches"),
  createBranch: (body: { name: string; city?: string; code?: string; isDefault?: boolean }) =>
    post<Branch>("/settings/branches", body),
  updateBranch: (id: string, body: Partial<Branch>) =>
    patch<Branch>(`/settings/branches/${id}`, body),
  // NOTE: the API has no DELETE /settings/branches/:id.
};

/* ------------------------------------------------------------ users/roles */

export const usersApi = {
  list: async (): Promise<Paginated<AppUser>> => {
    const raw = await get<Paginated<RawUserRow>>("/users");
    return { ...raw, data: raw.data.map(normalizeUser) };
  },
  /** Real invite DTO: { email, roleNames: string[] }. */
  invite: (body: { email: string; role: string }) =>
    post<{ id: string; email: string }>("/users/invite", {
      email: body.email,
      roleNames: [body.role],
    }),
};

export const rolesApi = {
  list: async (): Promise<Role[]> => {
    const raw = await get<RawRoleRow[] | Paginated<RawRoleRow>>("/roles");
    return asList(raw).map(normalizeRole);
  },
  listPermissions: () =>
    get<Array<{ id: string; name: string; module: string; action: string }>>("/roles/permissions"),
  updatePermissions: (id: string, permissions: string[]) =>
    patch<{ roleId: string; permissions: string[] }>(`/roles/${id}/permissions`, { permissions }),
};

/* ------------------------------------------------------- audit + notifs */

export const auditApi = {
  list: (params: { page?: number; pageSize?: number; entityType?: string; action?: string }) => {
    const q = new URLSearchParams();
    if (params.page) q.set("page", String(params.page));
    if (params.pageSize) q.set("pageSize", String(params.pageSize));
    if (params.entityType) q.set("entityType", params.entityType);
    if (params.action) q.set("action", params.action);
    const qs = q.toString();
    return get<AuditLog[] | Paginated<AuditLog>>(`/audit-logs${qs ? `?${qs}` : ""}`);
  },
};

export const notificationsApi = {
  list: async (): Promise<Paginated<NotificationItem>> => {
    const raw = await get<Paginated<RawNotificationRow>>("/notifications");
    return { ...raw, data: raw.data.map(normalizeNotification) };
  },
  markRead: (id: string) => patch<NotificationItem>(`/notifications/${id}/read`, {}),
};

/* ------------------------------------------------------- Phase 1: master data */

function masterDataQuery(params: Record<string, string | number | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") q.set(k, String(v));
  const qs = q.toString();
  return qs ? `?${qs}` : "";
}

export const contactsApi = {
  list: (params: { page?: number; pageSize?: number; search?: string; type?: string; status?: string } = {}) =>
    get<Paginated<Contact>>(`/contacts${masterDataQuery(params)}`),
  get: (id: string) => get<Contact>(`/contacts/${id}`),
  create: (body: Partial<Contact>) => post<Contact>("/contacts", body),
  update: (id: string, body: Partial<Contact>) => patch<Contact>(`/contacts/${id}`, body),
  delete: (id: string) => del<void>(`/contacts/${id}`),
  importPreview: (csvText: string) => post<CsvPreviewResult>("/contacts/import/preview", { csvText }),
};

export const itemsApi = {
  listCategories: () => get<ItemCategory[] | Paginated<ItemCategory>>("/item-categories"),
  createCategory: (body: { code: string; name: string; nameAr?: string; parentId?: string | null }) =>
    post<ItemCategory>("/item-categories", body),
  updateCategory: (id: string, body: Partial<ItemCategory>) => patch<ItemCategory>(`/item-categories/${id}`, body),
  deleteCategory: (id: string) => del<void>(`/item-categories/${id}`),
  list: (params: { page?: number; pageSize?: number; search?: string; categoryId?: string; status?: string } = {}) =>
    get<Paginated<Item>>(`/items${masterDataQuery(params)}`),
  get: (id: string) => get<Item>(`/items/${id}`),
  create: (body: Partial<Item>) => post<Item>("/items", body),
  update: (id: string, body: Partial<Item>) => patch<Item>(`/items/${id}`, body),
  delete: (id: string) => del<void>(`/items/${id}`),
  importPreview: (csvText: string) => post<CsvPreviewResult>("/items/import/preview", { csvText }),
};

export const priceListsApi = {
  list: (params: { page?: number; pageSize?: number; search?: string } = {}) =>
    get<Paginated<PriceList>>(`/pricelists${masterDataQuery(params)}`),
  get: (id: string) => get<PriceList>(`/pricelists/${id}`),
  create: (body: Partial<PriceList>) => post<PriceList>("/pricelists", body),
  update: (id: string, body: Partial<PriceList>) => patch<PriceList>(`/pricelists/${id}`, body),
  delete: (id: string) => del<void>(`/pricelists/${id}`),
  addItem: (id: string, body: { itemId: string; priceMinor: number; minQuantity?: number }) =>
    post<PriceListItem>(`/pricelists/${id}/items`, body),
  removeItem: (id: string, lineId: string) => del<void>(`/pricelists/${id}/items/${lineId}`),
};

/* ------------------------------------------------------------- accounting */

export interface JournalLineInput {
  accountId: string;
  debitMinor: number;
  creditMinor: number;
  costCenterId?: string | null;
  taxRateId?: string | null;
  description?: string;
  lineOrder: number;
}

export const accountingApi = {
  listJournals: (params: { page?: number; pageSize?: number; search?: string; status?: string; fiscalPeriodId?: string } = {}) =>
    get<Paginated<JournalEntry>>(`/journals${masterDataQuery(params)}`),
  getJournal: (id: string) => get<JournalEntry>(`/journals/${id}`),
  createJournal: (body: { entryDate: string; description: string; reference?: string; sourceModule?: string; currency?: string; lines: JournalLineInput[] }) =>
    post<JournalEntry>("/journals", body),
  updateJournal: (id: string, body: { entryDate?: string; description?: string; lines?: JournalLineInput[] }) =>
    patch<JournalEntry>(`/journals/${id}`, body),
  deleteJournal: (id: string) => del<void>(`/journals/${id}`),
  postJournal: (id: string) => post<JournalEntry>(`/journals/${id}/post`, {}),
  reverseJournal: (id: string) => post<JournalEntry>(`/journals/${id}/reverse`, {}),

  listPeriods: (params: { page?: number; pageSize?: number; fiscalYear?: number; status?: string } = {}) =>
    get<Paginated<FiscalPeriod>>(`/fiscal-periods${masterDataQuery(params)}`),
  createPeriod: (body: { fiscalYear: number; periodNumber: number; startDate: string; endDate: string; status?: string }) =>
    post<FiscalPeriod>("/fiscal-periods", body),
  updatePeriodStatus: (id: string, status: string) => patch<FiscalPeriod>(`/fiscal-periods/${id}`, { status }),
  deletePeriod: (id: string) => del<void>(`/fiscal-periods/${id}`),

  listCostCenters: (params: { page?: number; pageSize?: number; search?: string; status?: string } = {}) =>
    get<Paginated<CostCenter>>(`/cost-centers${masterDataQuery(params)}`),
  createCostCenter: (body: { code: string; name: string; nameAr?: string; parentId?: string | null }) =>
    post<CostCenter>("/cost-centers", body),
  updateCostCenter: (id: string, body: Partial<CostCenter>) => patch<CostCenter>(`/cost-centers/${id}`, body),
  deleteCostCenter: (id: string) => del<void>(`/cost-centers/${id}`),

  listChartOfAccounts: () => get<ChartAccount[] | Paginated<ChartAccount>>("/settings/chart-of-accounts"),

  trialBalance: (fiscalPeriodId: string) => get<TrialBalance>(`/reports/trial-balance?fiscalPeriodId=${fiscalPeriodId}`),
  generalLedger: (accountId: string, from?: string, to?: string) => {
    const q = new URLSearchParams({ accountId });
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    return get<GeneralLedger>(`/reports/general-ledger?${q.toString()}`);
  },
  vatSummary: (fiscalPeriodId: string) => get<VatSummary>(`/reports/vat-summary?fiscalPeriodId=${fiscalPeriodId}`),
};

/* ------------------------------------------------------------------ files */

export const filesApi = {
  /** sizeBytes is required by the real presigned-url DTO. */
  presignedUrl: (body: { fileName: string; contentType: string; sizeBytes: number; purpose?: string }) =>
    post<{ url: string; key: string }>("/files/presigned-url", body),
};

/* ------------------------------------------------------------- Phase 3: sales */

export interface ApiDocLineInput {
  itemId: string;
  quantity: number;
  unitPriceMinor: number;
  discountPct?: number;
  taxRateBps?: number;
}

export const salesApi = {
  listLeads: (params: { page?: number; pageSize?: number; search?: string; status?: string; source?: string } = {}) =>
    get<Paginated<import("./types").Lead>>(`/leads${masterDataQuery(params)}`),
  createLead: (body: Partial<import("./types").Lead>) => post<import("./types").Lead>("/leads", body),
  updateLead: (id: string, body: Partial<import("./types").Lead>) => patch<import("./types").Lead>(`/leads/${id}`, body),
  convertLead: (id: string) => post<import("./types").Contact>(`/leads/${id}/convert`, {}),
  deleteLead: (id: string) => del<void>(`/leads/${id}`),

  listOpportunities: (params: { page?: number; pageSize?: number; search?: string; stage?: string; customerId?: string } = {}) =>
    get<Paginated<import("./types").Opportunity>>(`/opportunities${masterDataQuery(params)}`),
  createOpportunity: (body: Record<string, unknown>) => post<import("./types").Opportunity>("/opportunities", body),
  updateOpportunity: (id: string, body: Record<string, unknown>) => patch<import("./types").Opportunity>(`/opportunities/${id}`, body),
  deleteOpportunity: (id: string) => del<void>(`/opportunities/${id}`),

  listQuotes: (params: { page?: number; pageSize?: number; search?: string; status?: string; customerId?: string } = {}) =>
    get<Paginated<import("./types").SalesQuote>>(`/quotes${masterDataQuery(params)}`),
  getQuote: (id: string) => get<import("./types").SalesQuote>(`/quotes/${id}`),
  createQuote: (body: { customerId: string; validFrom: string; validTo: string; currency?: string; notes?: string; lines: ApiDocLineInput[] }) =>
    post<import("./types").SalesQuote>("/quotes", body),
  sendQuote: (id: string) => post<import("./types").SalesQuote>(`/quotes/${id}/send`, {}),
  acceptQuote: (id: string) => post<import("./types").SalesQuote>(`/quotes/${id}/accept`, {}),
  rejectQuote: (id: string) => post<import("./types").SalesQuote>(`/quotes/${id}/reject`, {}),
  deleteQuote: (id: string) => del<void>(`/quotes/${id}`),

  listOrders: (params: { page?: number; pageSize?: number; search?: string; status?: string; customerId?: string } = {}) =>
    get<Paginated<import("./types").SalesOrder>>(`/sales-orders${masterDataQuery(params)}`),
  getOrder: (id: string) => get<import("./types").SalesOrder>(`/sales-orders/${id}`),
  createOrder: (body: { customerId: string; quoteId?: string | null; currency?: string; notes?: string; lines: ApiDocLineInput[] }) =>
    post<import("./types").SalesOrder>("/sales-orders", body),
  confirmOrder: (id: string) => post<import("./types").SalesOrder>(`/sales-orders/${id}/confirm`, {}),
  cancelOrder: (id: string) => post<import("./types").SalesOrder>(`/sales-orders/${id}/cancel`, {}),
  deleteOrder: (id: string) => del<void>(`/sales-orders/${id}`),

  listInvoices: (params: { page?: number; pageSize?: number; search?: string; status?: string; type?: string; customerId?: string; orderId?: string } = {}) =>
    get<Paginated<import("./types").SalesInvoice>>(`/sales-invoices${masterDataQuery(params)}`),
  getInvoice: (id: string) => get<import("./types").SalesInvoice>(`/sales-invoices/${id}`),
  createInvoice: (body: { type?: string; customerId: string; orderId?: string | null; invoiceDate: string; dueDate?: string | null; currency?: string; notes?: string; lines: ApiDocLineInput[] }) =>
    post<import("./types").SalesInvoice>("/sales-invoices", body),
  postInvoice: (id: string) => post<import("./types").SalesInvoice>(`/sales-invoices/${id}/post`, {}),
  voidInvoice: (id: string) => post<import("./types").SalesInvoice>(`/sales-invoices/${id}/void`, {}),
  deleteInvoice: (id: string) => del<void>(`/sales-invoices/${id}`),

  listPayments: (params: { page?: number; pageSize?: number; search?: string; customerId?: string; method?: string } = {}) =>
    get<Paginated<import("./types").CustomerPayment>>(`/customer-payments${masterDataQuery(params)}`),
  createPayment: (body: { customerId: string; method: string; reference?: string; paymentDate: string; currency?: string; amountMinor: number; allocations: { invoiceId: string; amountMinor: number }[] }) =>
    post<import("./types").CustomerPayment>("/customer-payments", body),

  arAging: (asOf?: string) => get<import("./types").ArAging>(`/reports/ar-aging${asOf ? `?asOf=${asOf}` : ""}`),
};

/* --------------------------------------------------------- Phase 4: purchasing */

export const purchasingApi = {
  listOrders: (params: { page?: number; pageSize?: number; search?: string; status?: string; supplierId?: string } = {}) =>
    get<Paginated<import("./types").PurchaseOrder>>(`/purchase-orders${masterDataQuery(params)}`),
  getOrder: (id: string) => get<import("./types").PurchaseOrder>(`/purchase-orders/${id}`),
  createOrder: (body: { supplierId: string; expectedDate?: string | null; currency?: string; notes?: string; lines: ApiDocLineInput[] }) =>
    post<import("./types").PurchaseOrder>("/purchase-orders", body),
  sendOrder: (id: string) => post<import("./types").PurchaseOrder>(`/purchase-orders/${id}/send`, {}),
  confirmOrder: (id: string) => post<import("./types").PurchaseOrder>(`/purchase-orders/${id}/confirm`, {}),
  closeOrder: (id: string) => post<import("./types").PurchaseOrder>(`/purchase-orders/${id}/close`, {}),
  cancelOrder: (id: string) => post<import("./types").PurchaseOrder>(`/purchase-orders/${id}/cancel`, {}),
  deleteOrder: (id: string) => del<void>(`/purchase-orders/${id}`),

  listInvoices: (params: { page?: number; pageSize?: number; search?: string; status?: string; supplierId?: string; purchaseOrderId?: string } = {}) =>
    get<Paginated<import("./types").SupplierInvoice>>(`/supplier-invoices${masterDataQuery(params)}`),
  getInvoice: (id: string) => get<import("./types").SupplierInvoice>(`/supplier-invoices/${id}`),
  createInvoice: (body: { supplierId: string; purchaseOrderId?: string | null; invoiceDate: string; dueDate?: string | null; currency?: string; notes?: string; lines: (ApiDocLineInput & { purchaseOrderLineId?: string | null })[] }) =>
    post<import("./types").SupplierInvoice>("/supplier-invoices", body),
  postInvoice: (id: string) => post<import("./types").SupplierInvoice>(`/supplier-invoices/${id}/post`, {}),
  voidInvoice: (id: string) => post<import("./types").SupplierInvoice>(`/supplier-invoices/${id}/void`, {}),
  deleteInvoice: (id: string) => del<void>(`/supplier-invoices/${id}`),

  listPayments: (params: { page?: number; pageSize?: number; search?: string; supplierId?: string; method?: string } = {}) =>
    get<Paginated<import("./types").SupplierPayment>>(`/supplier-payments${masterDataQuery(params)}`),
  createPayment: (body: { supplierId: string; method: string; reference?: string; paymentDate: string; currency?: string; amountMinor: number; allocations: { invoiceId: string; amountMinor: number }[] }) =>
    post<import("./types").SupplierPayment>("/supplier-payments", body),

  apAging: (asOf?: string) => get<import("./types").ApAging>(`/reports/ap-aging${asOf ? `?asOf=${asOf}` : ""}`),
};

/* ------------------------------------------------- Phase 5 — Inventory */
export const inventoryApi = {
  listStock: (params: { page?: number; pageSize?: number; warehouseId?: string; itemId?: string; search?: string; lowStockOnly?: boolean } = {}) =>
    get<Paginated<import("./types").StockLevel>>(`/inventory/stock${masterDataQuery({ ...params, lowStockOnly: params.lowStockOnly ? "true" : undefined })}`),
  listMovements: (params: { page?: number; pageSize?: number; warehouseId?: string; itemId?: string; type?: string; sourceType?: string; sourceId?: string } = {}) =>
    get<Paginated<import("./types").StockMovement>>(`/inventory/movements${masterDataQuery(params)}`),
  lowStock: (warehouseId?: string) =>
    get<{ data: import("./types").StockLevel[]; meta: { total: number } }>(`/inventory/reports/low-stock${warehouseId ? `?warehouseId=${warehouseId}` : ""}`),

  listReceipts: (params: { page?: number; pageSize?: number; search?: string; status?: string; purchaseOrderId?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").GoodsReceipt>>(`/inventory/goods-receipts${masterDataQuery(params)}`),
  createReceipt: (body: { purchaseOrderId: string; warehouseId: string; receiptDate: string; currency?: string; notes?: string; lines: { purchaseOrderLineId: string; itemId: string; quantity: number; unitCostMinor: number }[] }) =>
    post<import("./types").GoodsReceipt>("/inventory/goods-receipts", body),
  postReceipt: (id: string) => post<import("./types").GoodsReceipt>(`/inventory/goods-receipts/${id}/post`, {}),
  cancelReceipt: (id: string) => post<import("./types").GoodsReceipt>(`/inventory/goods-receipts/${id}/cancel`, {}),

  listDeliveries: (params: { page?: number; pageSize?: number; search?: string; status?: string; salesOrderId?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").DeliveryNote>>(`/inventory/delivery-notes${masterDataQuery(params)}`),
  createDelivery: (body: { salesOrderId: string; warehouseId: string; deliveryDate: string; currency?: string; notes?: string; lines: { salesOrderLineId: string; itemId: string; quantity: number }[] }) =>
    post<import("./types").DeliveryNote>("/inventory/delivery-notes", body),
  postDelivery: (id: string) => post<import("./types").DeliveryNote>(`/inventory/delivery-notes/${id}/post`, {}),
  cancelDelivery: (id: string) => post<import("./types").DeliveryNote>(`/inventory/delivery-notes/${id}/cancel`, {}),

  listAdjustments: (params: { page?: number; pageSize?: number; search?: string; status?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").StockAdjustment>>(`/inventory/adjustments${masterDataQuery(params)}`),
  createAdjustment: (body: { warehouseId: string; adjustmentDate: string; currency?: string; notes?: string; lines: { itemId: string; quantityDelta: number; unitCostMinor?: number; reason: string }[] }) =>
    post<import("./types").StockAdjustment>("/inventory/adjustments", body),
  postAdjustment: (id: string) => post<import("./types").StockAdjustment>(`/inventory/adjustments/${id}/post`, {}),
  cancelAdjustment: (id: string) => post<import("./types").StockAdjustment>(`/inventory/adjustments/${id}/cancel`, {}),

  listTransfers: (params: { page?: number; pageSize?: number; search?: string; status?: string; fromWarehouseId?: string; toWarehouseId?: string } = {}) =>
    get<Paginated<import("./types").StockTransfer>>(`/inventory/transfers${masterDataQuery(params)}`),
  createTransfer: (body: { fromWarehouseId: string; toWarehouseId: string; transferDate: string; currency?: string; notes?: string; lines: { itemId: string; quantity: number }[] }) =>
    post<import("./types").StockTransfer>("/inventory/transfers", body),
  postTransfer: (id: string) => post<import("./types").StockTransfer>(`/inventory/transfers/${id}/post`, {}),
  cancelTransfer: (id: string) => post<import("./types").StockTransfer>(`/inventory/transfers/${id}/cancel`, {}),

  listCounts: (params: { page?: number; pageSize?: number; search?: string; status?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").StockCount>>(`/inventory/counts${masterDataQuery(params)}`),
  createCount: (body: { warehouseId: string; countDate: string; notes?: string; lines: { itemId: string; countedQuantity: number }[] }) =>
    post<import("./types").StockCount>("/inventory/counts", body),
  approveCount: (id: string) => post<import("./types").StockCount>(`/inventory/counts/${id}/approve`, {}),
  cancelCount: (id: string) => post<import("./types").StockCount>(`/inventory/counts/${id}/cancel`, {}),
};

/* ------------------------------------------------------- Phase 6 — POS */
export const posApi = {
  listTerminals: (params: { page?: number; pageSize?: number; search?: string; status?: string; branchId?: string } = {}) =>
    get<Paginated<import("./types").PosTerminal>>(`/pos/terminals${masterDataQuery(params)}`),
  createTerminal: (body: { code: string; name: string; branchId: string; warehouseId: string; status?: string; cashAccountCode?: string; cardAccountCode?: string }) =>
    post<import("./types").PosTerminal>("/pos/terminals", body),
  updateTerminal: (id: string, body: Partial<{ name: string; branchId: string; warehouseId: string; status: string }>) =>
    post<import("./types").PosTerminal>(`/pos/terminals/${id}`, body),

  listShifts: (params: { page?: number; pageSize?: number; terminalId?: string; status?: string } = {}) =>
    get<Paginated<import("./types").PosShift>>(`/pos/shifts${masterDataQuery(params)}`),
  getShift: (id: string) => get<import("./types").PosShift>(`/pos/shifts/${id}`),
  openShift: (body: { terminalId: string; openingFloatMinor: number }) =>
    post<import("./types").PosShift>("/pos/shifts/open", body),
  closeShift: (id: string, body: { countedCashMinor: number }) =>
    post<import("./types").PosShift>(`/pos/shifts/${id}/close`, body),
  zReport: (id: string) => get<import("./types").ZReport>(`/pos/shifts/${id}/z-report`),

  listSales: (params: { page?: number; pageSize?: number; search?: string; status?: string; terminalId?: string; shiftId?: string } = {}) =>
    get<Paginated<import("./types").PosSale>>(`/pos/sales${masterDataQuery(params)}`),
  getSale: (id: string) => get<import("./types").PosSale>(`/pos/sales/${id}`),
  lookup: (terminalId: string, q: string) =>
    get<import("./types").PosLookup>(`/pos/lookup?terminalId=${encodeURIComponent(terminalId)}&q=${encodeURIComponent(q)}`),
  createSale: (body: { terminalId: string; shiftId: string; customerId?: string | null; lines: { itemId: string; quantity: number; unitPriceMinor?: number; discountPct?: number; taxRateBps?: number }[]; payments: { method: string; amountMinor: number; reference?: string }[] }) =>
    post<import("./types").PosSale>("/pos/sales", body),
  voidSale: (id: string) => post<import("./types").PosSale>(`/pos/sales/${id}/void`, {}),
};

/* ------------------------------------------- Phase 7 — Manufacturing */
export const manufacturingApi = {
  listWorkCenters: (params: { page?: number; pageSize?: number; search?: string; status?: string } = {}) =>
    get<Paginated<import("./types").WorkCenter>>(`/manufacturing/work-centers${masterDataQuery(params)}`),
  createWorkCenter: (body: { code: string; name: string; nameAr?: string; standardCostRateMinor?: number; status?: string }) =>
    post<import("./types").WorkCenter>("/manufacturing/work-centers", body),
  updateWorkCenter: (id: string, body: Partial<{ name: string; nameAr: string; standardCostRateMinor: number; status: string }>) =>
    patch<import("./types").WorkCenter>(`/manufacturing/work-centers/${id}`, body),
  deleteWorkCenter: (id: string) => del<void>(`/manufacturing/work-centers/${id}`),

  listBoms: (params: { page?: number; pageSize?: number; search?: string; status?: string; finishedItemId?: string } = {}) =>
    get<Paginated<import("./types").Bom>>(`/manufacturing/boms${masterDataQuery(params)}`),
  getBom: (id: string) => get<import("./types").Bom>(`/manufacturing/boms/${id}`),
  getBomCost: (id: string) => get<import("./types").BomCost>(`/manufacturing/boms/${id}/cost`),
  createBom: (body: { finishedItemId: string; version: number; status?: string; lines: { componentItemId: string; quantityPerUnit: number; scrapBps?: number; workCenterId?: string | null; operationName?: string }[] }) =>
    post<import("./types").Bom>("/manufacturing/boms", body),
  updateBom: (id: string, body: Partial<{ status: string; lines: { componentItemId: string; quantityPerUnit: number; scrapBps?: number; workCenterId?: string | null; operationName?: string }[] }>) =>
    patch<import("./types").Bom>(`/manufacturing/boms/${id}`, body),
  deleteBom: (id: string) => del<void>(`/manufacturing/boms/${id}`),

  listWorkOrders: (params: { page?: number; pageSize?: number; search?: string; status?: string; finishedItemId?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").WorkOrder>>(`/manufacturing/work-orders${masterDataQuery(params)}`),
  getWorkOrder: (id: string) => get<import("./types").WorkOrder>(`/manufacturing/work-orders/${id}`),
  createWorkOrder: (body: { finishedItemId: string; bomId: string; warehouseId: string; qtyPlanned: number; plannedStartDate?: string; dueDate?: string; operations?: { name: string; workCenterId?: string; plannedHours: number }[] }) =>
    post<import("./types").WorkOrder>("/manufacturing/work-orders", body),
  updateWorkOrder: (id: string, body: Partial<{ qtyPlanned: number; plannedStartDate: string; dueDate: string }>) =>
    patch<import("./types").WorkOrder>(`/manufacturing/work-orders/${id}`, body),
  releaseWorkOrder: (id: string) => post<import("./types").WorkOrder>(`/manufacturing/work-orders/${id}/release`, {}),
  completeWorkOrder: (id: string) => post<import("./types").WorkOrder>(`/manufacturing/work-orders/${id}/complete`, {}),
  cancelWorkOrder: (id: string) => post<import("./types").WorkOrder>(`/manufacturing/work-orders/${id}/cancel`, {}),
  deleteWorkOrder: (id: string) => del<void>(`/manufacturing/work-orders/${id}`),
  updateOperation: (workOrderId: string, operationId: string, body: { actualHours?: number; status?: string }) =>
    patch<import("./types").WorkOrderOperation>(`/manufacturing/work-orders/${workOrderId}/operations/${operationId}`, body),

  listIssues: (params: { page?: number; pageSize?: number; search?: string; status?: string; workOrderId?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").MaterialIssue>>(`/manufacturing/material-issues${masterDataQuery(params)}`),
  createIssue: (body: { workOrderId: string; warehouseId: string; issueDate?: string; lines: { workOrderLineId: string; itemId: string; quantity: number }[] }) =>
    post<import("./types").MaterialIssue>("/manufacturing/material-issues", body),
  postIssue: (id: string) => post<import("./types").MaterialIssue>(`/manufacturing/material-issues/${id}/post`, {}),
  cancelIssue: (id: string) => post<import("./types").MaterialIssue>(`/manufacturing/material-issues/${id}/cancel`, {}),
  deleteIssue: (id: string) => del<void>(`/manufacturing/material-issues/${id}`),

  listReceipts: (params: { page?: number; pageSize?: number; search?: string; status?: string; workOrderId?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").ProductionReceipt>>(`/manufacturing/production-receipts${masterDataQuery(params)}`),
  createReceipt: (body: { workOrderId: string; warehouseId: string; receiptDate?: string; quantity: number }) =>
    post<import("./types").ProductionReceipt>("/manufacturing/production-receipts", body),
  postReceipt: (id: string) => post<import("./types").ProductionReceipt>(`/manufacturing/production-receipts/${id}/post`, {}),
  cancelReceipt: (id: string) => post<import("./types").ProductionReceipt>(`/manufacturing/production-receipts/${id}/cancel`, {}),
  deleteReceipt: (id: string) => del<void>(`/manufacturing/production-receipts/${id}`),

  listScrap: (params: { page?: number; pageSize?: number; search?: string; status?: string; workOrderId?: string; warehouseId?: string } = {}) =>
    get<Paginated<import("./types").Scrap>>(`/manufacturing/scrap${masterDataQuery(params)}`),
  createScrap: (body: { workOrderId?: string; kind: string; itemId: string; warehouseId: string; quantity: number; reason: string; scrapDate?: string }) =>
    post<import("./types").Scrap>("/manufacturing/scrap", body),
  postScrap: (id: string) => post<import("./types").Scrap>(`/manufacturing/scrap/${id}/post`, {}),
  cancelScrap: (id: string) => post<import("./types").Scrap>(`/manufacturing/scrap/${id}/cancel`, {}),
  deleteScrap: (id: string) => del<void>(`/manufacturing/scrap/${id}`),

  wipReport: (warehouseId?: string) =>
    get<{ data: import("./types").WipRow[]; meta: { total: number } }>(`/manufacturing/reports/wip${warehouseId ? `?warehouseId=${warehouseId}` : ""}`),
};

/* ------------------------------------------------- Phase 8 — HR/Payroll */
export const hrApi = {
  listDepartments: (params: { page?: number; pageSize?: number; search?: string; status?: string; parentId?: string } = {}) =>
    get<Paginated<import("./types").Department>>(`/hr/departments${masterDataQuery(params)}`),
  createDepartment: (body: { code: string; name: string; nameAr?: string; parentId?: string | null; managerId?: string | null; status?: string }) =>
    post<import("./types").Department>("/hr/departments", body),
  updateDepartment: (id: string, body: Partial<{ name: string; nameAr: string; parentId: string | null; managerId: string | null; status: string }>) =>
    patch<import("./types").Department>(`/hr/departments/${id}`, body),
  deleteDepartment: (id: string) => del<void>(`/hr/departments/${id}`),

  listEmployees: (params: { page?: number; pageSize?: number; search?: string; status?: string; departmentId?: string; nationality?: string } = {}) =>
    get<Paginated<import("./types").Employee>>(`/hr/employees${masterDataQuery(params)}`),
  getEmployee: (id: string) => get<import("./types").Employee>(`/hr/employees/${id}`),
  createEmployee: (body: Record<string, unknown>) => post<import("./types").Employee>("/hr/employees", body),
  updateEmployee: (id: string, body: Record<string, unknown>) => patch<import("./types").Employee>(`/hr/employees/${id}`, body),
  terminateEmployee: (id: string, body: { endDate: string }) => post<import("./types").Employee>(`/hr/employees/${id}/terminate`, body),
  deleteEmployee: (id: string) => del<void>(`/hr/employees/${id}`),

  listLeaveTypes: (params: { page?: number; pageSize?: number; search?: string; status?: string } = {}) =>
    get<Paginated<import("./types").LeaveType>>(`/hr/leave-types${masterDataQuery(params)}`),
  createLeaveType: (body: { code: string; name: string; nameAr?: string; daysPerYear: number; paid?: boolean; status?: string }) =>
    post<import("./types").LeaveType>("/hr/leave-types", body),
  updateLeaveType: (id: string, body: Partial<{ name: string; nameAr: string; daysPerYear: number; paid: boolean; status: string }>) =>
    patch<import("./types").LeaveType>(`/hr/leave-types/${id}`, body),
  deleteLeaveType: (id: string) => del<void>(`/hr/leave-types/${id}`),

  listLeaveRequests: (params: { page?: number; pageSize?: number; employeeId?: string; leaveTypeId?: string; status?: string } = {}) =>
    get<Paginated<import("./types").LeaveRequest>>(`/hr/leave-requests${masterDataQuery(params)}`),
  createLeaveRequest: (body: { employeeId: string; leaveTypeId: string; startDate: string; endDate: string }) =>
    post<import("./types").LeaveRequest>("/hr/leave-requests", body),
  approveLeave: (id: string) => post<import("./types").LeaveRequest>(`/hr/leave-requests/${id}/approve`, {}),
  rejectLeave: (id: string) => post<import("./types").LeaveRequest>(`/hr/leave-requests/${id}/reject`, {}),
  cancelLeave: (id: string) => post<import("./types").LeaveRequest>(`/hr/leave-requests/${id}/cancel`, {}),
  leaveBalances: (employeeId: string, year?: number) =>
    get<{ data: import("./types").LeaveBalanceRow[]; meta: { total: number } }>(`/hr/leave-balances?employeeId=${employeeId}${year ? `&year=${year}` : ""}`),

  listAttendance: (params: { page?: number; pageSize?: number; employeeId?: string; status?: string; from?: string; to?: string } = {}) =>
    get<Paginated<import("./types").AttendanceRecord>>(`/hr/attendance${masterDataQuery(params)}`),
  createAttendance: (body: { employeeId: string; date: string; checkIn?: string; checkOut?: string; status: string; notes?: string }) =>
    post<import("./types").AttendanceRecord>("/hr/attendance", body),
  bulkAttendance: (body: { date: string; records: { employeeId: string; checkIn?: string; checkOut?: string; status: string; notes?: string }[] }) =>
    post<import("./types").AttendanceRecord[]>("/hr/attendance/bulk", body),
  attendanceSummary: (year: number, month: number, employeeId?: string) =>
    get<{ data: import("./types").AttendanceSummaryRow[]; meta: { total: number } }>(`/hr/attendance/summary?year=${year}&month=${month}${employeeId ? `&employeeId=${employeeId}` : ""}`),
  updateAttendance: (id: string, body: Partial<{ checkIn: string; checkOut: string; status: string; notes: string }>) =>
    patch<import("./types").AttendanceRecord>(`/hr/attendance/${id}`, body),
  deleteAttendance: (id: string) => del<void>(`/hr/attendance/${id}`),

  listPayrollRuns: (params: { page?: number; pageSize?: number; status?: string; periodYear?: number; periodMonth?: number } = {}) =>
    get<Paginated<import("./types").PayrollRun>>(`/hr/payroll-runs${masterDataQuery(params)}`),
  getPayrollRun: (id: string) => get<import("./types").PayrollRun>(`/hr/payroll-runs/${id}`),
  createPayrollRun: (body: { periodYear: number; periodMonth: number }) =>
    post<import("./types").PayrollRun>("/hr/payroll-runs", body),
  calculatePayrollRun: (id: string, body: { overrides?: { employeeId: string; overtimeMinor?: number; otherDeductionsMinor?: number }[] } = {}) =>
    post<import("./types").PayrollRun>(`/hr/payroll-runs/${id}/calculate`, body),
  approvePayrollRun: (id: string) => post<import("./types").PayrollRun>(`/hr/payroll-runs/${id}/approve`, {}),
  payPayrollRun: (id: string, body: { bankAccountCode: string; paymentDate: string }) =>
    post<import("./types").PayrollRun>(`/hr/payroll-runs/${id}/pay`, body),
  deletePayrollRun: (id: string) => del<void>(`/hr/payroll-runs/${id}`),
};

export const projectsApi = {
  listProjects: (params: { page?: number; pageSize?: number; search?: string; status?: string; billingType?: string; customerId?: string; managerId?: string } = {}) =>
    get<Paginated<import("./types").Project>>(`/projects${masterDataQuery(params)}`),
  getProject: (id: string) => get<import("./types").Project>(`/projects/${id}`),
  createProject: (body: Record<string, unknown>) => post<import("./types").Project>("/projects", body),
  updateProject: (id: string, body: Record<string, unknown>) => patch<import("./types").Project>(`/projects/${id}`, body),
  deleteProject: (id: string) => del<void>(`/projects/${id}`),
  costing: (id: string) => get<import("./types").ProjectCosting>(`/projects/${id}/costing`),

  listTasks: (params: { page?: number; pageSize?: number; search?: string; projectId?: string; status?: string; assigneeId?: string; priority?: string } = {}) =>
    get<Paginated<import("./types").ProjectTask>>(`/project-tasks${masterDataQuery(params)}`),
  getTask: (id: string) => get<import("./types").ProjectTask>(`/project-tasks/${id}`),
  createTask: (body: Record<string, unknown>) => post<import("./types").ProjectTask>("/project-tasks", body),
  updateTask: (id: string, body: Record<string, unknown>) => patch<import("./types").ProjectTask>(`/project-tasks/${id}`, body),
  deleteTask: (id: string) => del<void>(`/project-tasks/${id}`),

  listTimesheets: (params: { page?: number; pageSize?: number; employeeId?: string; projectId?: string; taskId?: string; status?: string; from?: string; to?: string } = {}) =>
    get<Paginated<import("./types").Timesheet>>(`/timesheets${masterDataQuery(params)}`),
  getTimesheet: (id: string) => get<import("./types").Timesheet>(`/timesheets/${id}`),
  createTimesheet: (body: Record<string, unknown>) => post<import("./types").Timesheet>("/timesheets", body),
  updateTimesheet: (id: string, body: Record<string, unknown>) => patch<import("./types").Timesheet>(`/timesheets/${id}`, body),
  submitTimesheet: (id: string) => post<import("./types").Timesheet>(`/timesheets/${id}/submit`, {}),
  approveTimesheet: (id: string) => post<import("./types").Timesheet>(`/timesheets/${id}/approve`, {}),
  rejectTimesheet: (id: string) => post<import("./types").Timesheet>(`/timesheets/${id}/reject`, {}),
  deleteTimesheet: (id: string) => del<void>(`/timesheets/${id}`),

  listExpenses: (params: { page?: number; pageSize?: number; projectId?: string; status?: string; category?: string; from?: string; to?: string } = {}) =>
    get<Paginated<import("./types").ProjectExpense>>(`/project-expenses${masterDataQuery(params)}`),
  createExpense: (body: Record<string, unknown>) => post<import("./types").ProjectExpense>("/project-expenses", body),
  updateExpense: (id: string, body: Record<string, unknown>) => patch<import("./types").ProjectExpense>(`/project-expenses/${id}`, body),
  approveExpense: (id: string) => post<import("./types").ProjectExpense>(`/project-expenses/${id}/approve`, {}),
  rejectExpense: (id: string) => post<import("./types").ProjectExpense>(`/project-expenses/${id}/reject`, {}),
  deleteExpense: (id: string) => del<void>(`/project-expenses/${id}`),

  listMilestones: (params: { page?: number; pageSize?: number; projectId?: string; status?: string } = {}) =>
    get<Paginated<import("./types").Milestone>>(`/milestones${masterDataQuery(params)}`),
  createMilestone: (body: Record<string, unknown>) => post<import("./types").Milestone>("/milestones", body),
  updateMilestone: (id: string, body: Record<string, unknown>) => patch<import("./types").Milestone>(`/milestones/${id}`, body),
  achieveMilestone: (id: string) => post<import("./types").Milestone>(`/milestones/${id}/achieve`, {}),
  deleteMilestone: (id: string) => del<void>(`/milestones/${id}`),
};

export const analyticsApi = {
  dashboard: (year?: number, month?: number) =>
    get<import("./types").DashboardKpis>(`/analytics/dashboard${year && month ? `?year=${year}&month=${month}` : ""}`),
  profitLoss: (params: { fiscalPeriodId?: string; from?: string; to?: string } = {}) =>
    get<import("./types").ProfitLoss>(`/analytics/profit-loss${masterDataQuery(params)}`),
  balanceSheet: (asOf?: string) =>
    get<import("./types").BalanceSheet>(`/analytics/balance-sheet${asOf ? `?asOf=${asOf}` : ""}`),
  cashFlow: (params: { from?: string; to?: string } = {}) =>
    get<import("./types").CashFlow>(`/analytics/cash-flow${masterDataQuery(params)}`),
  listSnapshots: (params: { page?: number; pageSize?: number; type?: string } = {}) =>
    get<Paginated<import("./types").ReportSnapshot>>(`/analytics/report-snapshots${masterDataQuery(params)}`),
  getSnapshot: (id: string) => get<import("./types").ReportSnapshot>(`/analytics/report-snapshots/${id}`),
  createSnapshot: (body: { type: string; parameters?: Record<string, unknown>; format?: string }) =>
    post<import("./types").ReportSnapshot>("/analytics/report-snapshots", body),
  downloadSnapshot: (id: string, format = "csv") => downloadFile(`/analytics/report-snapshots/${id}/download?format=${format}`, `report-${id.slice(0, 8)}.${format}`),
  downloadExport: (report: string, params: Record<string, string | undefined> = {}) => {
    const qs = Object.entries(params).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`).join("&");
    return downloadFile(`/analytics/exports/${report}.csv${qs ? `?${qs}` : ""}`, `${report}.csv`);
  },
};

export const aiApi = {
  insights: () => get<import("./types").AiInsightsResponse>("/ai/insights"),
  ask: (question: string) => post<{ source: string; intent: string; answer: string }>("/ai/ask", { question }),
};

export const zatcaApi = {
  list: (params: { page?: number; pageSize?: number; status?: string; type?: string; invoiceId?: string } = {}) =>
    get<Paginated<import("./types").ZatcaDocument>>(`/zatca/documents${masterDataQuery(params)}`),
  get: (id: string) => get<import("./types").ZatcaDocument>(`/zatca/documents/${id}`),
  generate: (body: { invoiceId: string; type?: string }) => post<import("./types").ZatcaDocument>("/zatca/documents", body),
  submit: (id: string) => post<import("./types").ZatcaDocument>(`/zatca/documents/${id}/submit`, {}),
};

export const webhooksApi = {
  listEndpoints: (params: { page?: number; pageSize?: number; status?: string } = {}) =>
    get<Paginated<import("./types").WebhookEndpoint>>(`/webhooks/endpoints${masterDataQuery(params)}`),
  createEndpoint: (body: Record<string, unknown>) => post<import("./types").WebhookEndpoint>("/webhooks/endpoints", body),
  updateEndpoint: (id: string, body: Record<string, unknown>) => patch<import("./types").WebhookEndpoint>(`/webhooks/endpoints/${id}`, body),
  deleteEndpoint: (id: string) => del<void>(`/webhooks/endpoints/${id}`),
  testEndpoint: (id: string) => post<import("./types").WebhookDelivery>(`/webhooks/endpoints/${id}/test`, {}),
  listDeliveries: (params: { page?: number; pageSize?: number; endpointId?: string; status?: string; eventType?: string } = {}) =>
    get<Paginated<import("./types").WebhookDelivery>>(`/webhooks/deliveries${masterDataQuery(params)}`),
};

export const apiKeysApi = {
  list: (params: { page?: number; pageSize?: number; status?: string } = {}) =>
    get<Paginated<import("./types").ApiKey>>(`/api-keys${masterDataQuery(params)}`),
  create: (body: { name: string; scopes: string[]; expiresAt?: string }) => post<import("./types").ApiKey>("/api-keys", body),
  revoke: (id: string) => post<import("./types").ApiKey>(`/api-keys/${id}/revoke`, {}),
};

export const exportsApi = {
  listJobs: (params: { page?: number; pageSize?: number; type?: string; status?: string } = {}) =>
    get<Paginated<import("./types").ExportJob>>(`/exports/jobs${masterDataQuery(params)}`),
  createJob: (body: { type: string; format?: string }) => post<import("./types").ExportJob>("/exports/jobs", body),
  download: (type: string, format = "csv") => downloadFile(`/exports/${type}?format=${format}`, `${type}.${format}`),
};

export const providersApi = {
  status: () => get<import("./types").ProviderStatus>("/providers/status"),
  simulateCharge: (body: { amountMinor: number; currency?: string; description?: string }) =>
    post<{ provider: string; simulated: boolean; status: string; transactionId: string; amountMinor: number; currency: string; message: string }>("/providers/payments/simulate-charge", body),
  simulateSms: (body: { to: string; message: string }) =>
    post<{ provider: string; simulated: boolean; status: string; messageId: string }>("/providers/sms/simulate-send", body),
};
