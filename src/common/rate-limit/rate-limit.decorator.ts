import { SetMetadata } from "@nestjs/common";

export const RATE_LIMIT_KEY = "rate_limit";

/** Bucket the counter by client IP, authenticated principal, or login email + IP. */
export type RateLimitBy = "ip" | "principal" | "ip-email";

export interface RateLimitOptions {
  /** Max requests allowed within the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** What to key the bucket on (default "ip"). */
  by?: RateLimitBy;
}

/**
 * Per-route override of the global rate limit. Apply to sensitive endpoints
 * (e.g. login/refresh) to blunt brute-force / credential-stuffing.
 */
export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);
