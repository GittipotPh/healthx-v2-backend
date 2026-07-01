import { backendEnv } from "../env";

/**
 * Trusted frontend origins for both CORS and CSRF origin checks.
 *
 * Configurable via `CORS_ORIGINS` (comma-separated). If omitted outside
 * production, falls back to `WEB_BASE_URL`. Production must inject CORS_ORIGINS
 * explicitly (for example via Terraform). Never use `*` with cookie auth.
 */
export function allowedOrigins(): string[] {
  const env = backendEnv();
  const configured = env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins = configured?.length ? configured : [env.WEB_BASE_URL];

  return Array.from(new Set(origins));
}
