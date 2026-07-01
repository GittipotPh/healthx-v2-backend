import { Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "crypto";
import { RedisService } from "../redis/redis.service";
import { refreshTtlSeconds } from "./auth.cookie";

/**
 * Rotating refresh-token store backed by Redis.
 *
 * A refresh token is `${sessionId}.${secret}`. Redis holds only the SHA-256 of
 * the secret (raw token never stored), keyed by session id, with a TTL equal to
 * the refresh lifetime. Every successful refresh ROTATES the secret, so a token
 * is single-use.
 *
 * Reuse-detection: if a token is presented whose hash doesn't match the current
 * stored hash (i.e. an already-rotated/stolen token), the whole session is
 * destroyed — a real reuse means either the legitimate token or the attacker's
 * copy was replayed, and we can't tell which, so we revoke and force re-login.
 * The compare-and-swap runs as a single Lua script so concurrent refreshes can't
 * race past each other.
 */
@Injectable()
export class RefreshSessionService {
  constructor(private readonly redis: RedisService) {}

  private key(sessionId: string): string {
    return `refresh:${sessionId}`;
  }

  private hash(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
  }

  private parse(rawToken: string | undefined): { sessionId: string; secret: string } | null {
    if (!rawToken) return null;
    const dot = rawToken.indexOf(".");
    if (dot <= 0 || dot === rawToken.length - 1) return null;
    return { sessionId: rawToken.slice(0, dot), secret: rawToken.slice(dot + 1) };
  }

  /** Creates a new session for `email` and returns the raw refresh token. */
  async issue(email: string): Promise<string> {
    const sessionId = randomUUID();
    const secret = randomBytes(32).toString("hex");
    await this.redis.client.hset(this.key(sessionId), {
      email,
      tokenHash: this.hash(secret),
      createdAt: Date.now().toString(),
    });
    await this.redis.client.expire(this.key(sessionId), refreshTtlSeconds());
    return `${sessionId}.${secret}`;
  }

  /**
   * Validates + rotates a refresh token. Returns the owning email and a fresh
   * token. Throws Unauthorized on missing/expired/reused tokens (reuse also
   * destroys the session).
   */
  async rotate(rawToken: string | undefined): Promise<{ email: string; token: string }> {
    const parsed = this.parse(rawToken);
    if (!parsed) throw new UnauthorizedException("Invalid refresh token");

    const newSecret = randomBytes(32).toString("hex");
    // Atomic compare-and-swap: only rotate if the presented hash is current.
    const result = (await this.redis.client.eval(
      ROTATE_LUA,
      1,
      this.key(parsed.sessionId),
      this.hash(parsed.secret),
      this.hash(newSecret),
      String(refreshTtlSeconds()),
    )) as string;

    if (result === "MISSING") throw new UnauthorizedException("Refresh session not found");
    if (result === "REUSE") {
      throw new UnauthorizedException("Refresh token reuse detected — session revoked");
    }
    return { email: result, token: `${parsed.sessionId}.${newSecret}` };
  }

  /** Revokes a session (logout). Best-effort: an already-gone session is fine. */
  async revoke(rawToken: string | undefined): Promise<void> {
    const parsed = this.parse(rawToken);
    if (!parsed) return;
    await this.redis.client.del(this.key(parsed.sessionId));
  }
}

/**
 * KEYS[1] = refresh:{sessionId}
 * ARGV[1] = presented token hash, ARGV[2] = new token hash, ARGV[3] = ttl seconds
 * Returns: owning email on success | "MISSING" | "REUSE" (and destroys the key).
 */
const ROTATE_LUA = `
local data = redis.call('HGET', KEYS[1], 'tokenHash')
if not data then return 'MISSING' end
if data ~= ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 'REUSE'
end
redis.call('HSET', KEYS[1], 'tokenHash', ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[3])
return redis.call('HGET', KEYS[1], 'email')
`;
