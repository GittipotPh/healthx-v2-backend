import {
  authCookieOptions,
  AUTH_COOKIE_NAME,
  clearAuthCookie,
  refreshTtlSeconds,
  setAuthCookie,
} from "./auth.cookie";
import { resetBackendEnvForTest } from "../env";

describe("auth cookie", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.DATABASE_URL =
      "postgresql://user:pass@localhost:5432/healthx_test";
    process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters";
    resetBackendEnvForTest();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    resetBackendEnvForTest();
  });

  it("is HttpOnly, SameSite=Lax, path=/ and not secure in dev", () => {
    delete process.env.NODE_ENV;
    delete process.env.AUTH_COOKIE_DOMAIN;
    const options = authCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe("lax");
    expect(options.path).toBe("/");
    expect(options.secure).toBe(false);
    expect(options.domain).toBeUndefined();
  });

  it("is secure and domain-scoped in production", () => {
    process.env.NODE_ENV = "production";
    process.env.AUTH_COOKIE_DOMAIN = ".healthx-pro.com";
    process.env.CORS_ORIGINS = "https://app.healthx-pro.com";
    resetBackendEnvForTest();
    const options = authCookieOptions();
    expect(options.secure).toBe(true);
    expect(options.domain).toBe(".healthx-pro.com");
  });

  it("set and clear use matching options", () => {
    const cookie = jest.fn();
    const clearCookie = jest.fn();
    const res = { cookie, clearCookie } as never;

    setAuthCookie(res, "tok123");
    expect(cookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      "tok123",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        // Cookie is durable transport; freshness comes from the JWT exp, so its
        // maxAge tracks the refresh lifetime (not the short access TTL).
        maxAge: refreshTtlSeconds() * 1000,
      }),
    );

    clearAuthCookie(res);
    expect(clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
});
