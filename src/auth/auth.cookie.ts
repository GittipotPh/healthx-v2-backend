import type { CookieOptions, Response } from "express";
import { backendEnv } from "../env";

/** Name of the HttpOnly cookie carrying the short-lived access token. */
export const AUTH_COOKIE_NAME = "hx_token";

/** Name of the HttpOnly cookie carrying the long-lived rotating refresh token. */
export const REFRESH_COOKIE_NAME = "hx_refresh";

/**
 * The refresh cookie is path-scoped to the auth controller so it is only ever
 * sent on `/authentication/*` calls (login/refresh/logout) — not attached to
 * every API request like the access cookie. Smaller exposure surface.
 */
export const REFRESH_COOKIE_PATH = "/api/v1/authentication";

/** Access-token lifetime in seconds (`JWT_EXPIRES_IN_SECONDS`, default 15m). */
export function accessTtlSeconds(): number {
  return backendEnv().JWT_EXPIRES_IN_SECONDS;
}

/** Refresh-token lifetime in seconds (`REFRESH_TTL_DAYS`, default 30d). */
export function refreshTtlSeconds(): number {
  return backendEnv().REFRESH_TTL_DAYS * 24 * 60 * 60;
}

/**
 * Cookie options shared by set/clear so the two match exactly — a mismatch would
 * leave a stale cookie the browser won't clear.
 *
 * - `httpOnly`: JS can never read the token.
 * - `secure`: HTTPS-only in production.
 * - `sameSite: "lax"`: sent on top-level navigations, blocks cross-site POST.
 * - `domain`: configurable via `AUTH_COOKIE_DOMAIN` (e.g. `.healthx-pro.com` in
 *   production); omitted in local dev so the cookie binds to `localhost`.
 */
function baseCookieOptions(): CookieOptions {
  const env = backendEnv();
  const isProd = env.NODE_ENV === "production";
  const domain = env.AUTH_COOKIE_DOMAIN?.trim() || undefined;
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    domain,
  };
}

/** Options for the access cookie (root path, all API requests). */
export function authCookieOptions(): CookieOptions {
  return baseCookieOptions();
}

/** Options for the refresh cookie (path-scoped to the auth controller). */
export function refreshCookieOptions(): CookieOptions {
  return { ...baseCookieOptions(), path: REFRESH_COOKIE_PATH };
}

/**
 * Sets the access-token cookie.
 *
 * The cookie's `maxAge` tracks the REFRESH lifetime, not the (short) JWT `exp`.
 * The cookie is only transport: the JWT inside still expires in
 * `accessTtlSeconds` and the backend rejects it once stale (→ client refreshes).
 * Tying the cookie's maxAge to the JWT made the browser DELETE it after ~10 min
 * idle, so the Next.js proxy gate (which checks cookie presence) bounced any
 * navigation to /login even though the session was trivially refreshable. Keeping
 * the cookie alive for the whole session keeps the gate honest; freshness is
 * still enforced by the JWT exp + refresh rotation.
 */
export function setAuthCookie(res: Response, token: string): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...authCookieOptions(),
    maxAge: refreshTtlSeconds() * 1000,
  });
}

/** Sets the refresh-token cookie. */
export function setRefreshCookie(res: Response, token: string): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...refreshCookieOptions(),
    maxAge: refreshTtlSeconds() * 1000,
  });
}

/** Clears the access cookie using options that match how it was set. */
export function clearAuthCookie(res: Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
}

/** Clears the refresh cookie using options that match how it was set. */
export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
}
