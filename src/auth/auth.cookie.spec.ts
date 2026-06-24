import { authCookieOptions, AUTH_COOKIE_NAME, clearAuthCookie, setAuthCookie } from "./auth.cookie";

describe("auth cookie", () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
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
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 * 1000 }),
    );

    clearAuthCookie(res);
    expect(clearCookie).toHaveBeenCalledWith(
      AUTH_COOKIE_NAME,
      expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }),
    );
  });
});
