import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison that does not leak length: both sides are
 * hashed to fixed-size digests before timingSafeEqual. Same helper as the
 * erp-integration service's inbound API-key check.
 */
export function constantTimeEquals(a: string, b: string): boolean {
  const digestA = createHash("sha256").update(a, "utf8").digest();
  const digestB = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(digestA, digestB);
}
