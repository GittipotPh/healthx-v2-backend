/**
 * Trusted frontend origins for both CORS and CSRF origin checks.
 *
 * Configurable via `CORS_ORIGINS` (comma-separated). Defaults cover the local
 * dev frontend and the production app origin. Never use `*` with cookie auth.
 */
export function allowedOrigins(): string[] {
  const configured = process.env.CORS_ORIGINS?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  const origins = configured?.length
    ? configured
    : [
        process.env.WEB_BASE_URL ?? "http://localhost:3000",
        "https://app.healthx-pro.com",
      ];

  return Array.from(new Set(origins));
}
