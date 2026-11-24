import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Bug 2 regression tests: tokens must survive a locale switch / reload.
 * The [locale] layout remounts AuthProvider on en ⇄ ar, and a reload
 * discards the JS module — so tokens are persisted to localStorage by
 * setTokens() and re-hydrated when the api module loads. These tests
 * assert that contract, plus the refresh-rotation store (a rotated pair
 * must replace the revoked one, or the next 401 logs the user out).
 */
describe("token persistence (Bug 2: locale switch must not log out)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("setTokens persists the pair to localStorage and getters read it back", async () => {
    const api = await import("./api");
    api.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" });
    expect(window.localStorage.getItem("eserp.tokens")).toBe(
      JSON.stringify({ accessToken: "access-1", refreshToken: "refresh-1" }),
    );
    expect(api.getAccessToken()).toBe("access-1");
    expect(api.getRefreshToken()).toBe("refresh-1");
  });

  it("setTokens(null) clears both the in-memory tokens and storage (logout)", async () => {
    const api = await import("./api");
    api.setTokens({ accessToken: "access-1", refreshToken: "refresh-1" });
    api.setTokens(null);
    expect(window.localStorage.getItem("eserp.tokens")).toBeNull();
    expect(api.getAccessToken()).toBeNull();
    expect(api.getRefreshToken()).toBeNull();
  });

  it("a fresh module import hydrates tokens from localStorage (reload / locale remount)", async () => {
    window.localStorage.setItem(
      "eserp.tokens",
      JSON.stringify({ accessToken: "access-2", refreshToken: "refresh-2" }),
    );
    const api = await import("./api");
    expect(api.getAccessToken()).toBe("access-2");
    expect(api.getRefreshToken()).toBe("refresh-2");
  });

  it("corrupt stored JSON is treated as logged out, not a crash", async () => {
    window.localStorage.setItem("eserp.tokens", "{not-json");
    const api = await import("./api");
    expect(api.getAccessToken()).toBeNull();
    expect(api.getRefreshToken()).toBeNull();
  });

  it("authApi.refresh() stores the ROTATED pair (old refresh token is revoked server-side)", async () => {
    const api = await import("./api");
    api.setTokens({ accessToken: "old-access", refreshToken: "old-refresh" });
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ accessToken: "new-access", refreshToken: "new-refresh" }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const refreshed = await api.authApi.refresh();
    expect(refreshed).toEqual({ accessToken: "new-access", refreshToken: "new-refresh" });
    // In-memory AND persisted storage must hold the new pair, not the revoked old one.
    expect(api.getAccessToken()).toBe("new-access");
    expect(api.getRefreshToken()).toBe("new-refresh");
    expect(window.localStorage.getItem("eserp.tokens")).toBe(
      JSON.stringify({ accessToken: "new-access", refreshToken: "new-refresh" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/auth/refresh"),
      expect.objectContaining({ body: JSON.stringify({ refreshToken: "old-refresh" }) }),
    );
  });
});
