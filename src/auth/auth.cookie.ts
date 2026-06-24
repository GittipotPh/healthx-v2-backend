import type { CookieOptions, Response } from "express";

/** Name of the HttpOnly session cookie carrying the access token. */
export const AUTH_COOKIE_NAME = "hx_token";

/** Cookie lifetime, aligned with the JWT (`JWT_EXPIRES_IN`, default 12h). */
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/**
 * Cookie options shared by login (set) and logout (clear) so the two match
 * exactly — a mismatch would leave a stale cookie that the browser won't clear.
 *
 * - `httpOnly`: JS can never read the token.
 * - `secure`: HTTPS-only in production.
 * - `sameSite: "lax"`: sent on top-level navigations, blocks cross-site POST.
 * - `domain`: configurable via `AUTH_COOKIE_DOMAIN` (e.g. `.healthx-pro.com` in
 *   production); omitted in local dev so the cookie binds to `localhost`.
 */
export function authCookieOptions(): CookieOptions {
  const isProd = process.env.NODE_ENV === "production";
  const domain = process.env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain,
  };
}

/** Sets the session cookie with the access token. */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, { ...authCookieOptions(), maxAge: TWELVE_HOURS_MS });
}

/** Clears the session cookie using options that match how it was set. */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
}
