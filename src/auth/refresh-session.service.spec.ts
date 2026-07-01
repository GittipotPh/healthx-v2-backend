import { UnauthorizedException } from "@nestjs/common";
import type { RedisService } from "../redis/redis.service";
import { RefreshSessionService } from "./refresh-session.service";
import { resetBackendEnvForTest } from "../env";

/**
 * In-memory stand-in for Redis that mirrors the ROTATE_LUA compare-and-swap
 * semantics, so we exercise the service's real branching (issue → rotate → reuse).
 */
class FakeRedis {
  store = new Map<string, Record<string, string>>();

  async hset(key: string, obj: Record<string, string>): Promise<number> {
    this.store.set(key, { ...(this.store.get(key) ?? {}), ...obj });
    return 1;
  }
  async expire(key: string): Promise<number> {
    return this.store.has(key) ? 1 : 0;
  }
  async del(key: string): Promise<number> {
    const had = this.store.has(key);
    this.store.delete(key);
    return had ? 1 : 0;
  }
  async eval(
    _script: string,
    _numKeys: number,
    key: string,
    presented: string,
    newHash: string,
  ): Promise<string> {
    const hash = this.store.get(key)?.tokenHash;
    if (hash === undefined) return "MISSING";
    if (hash !== presented) {
      this.store.delete(key); // reuse → destroy the family
      return "REUSE";
    }
    const row = this.store.get(key)!;
    row.tokenHash = newHash;
    return row.email;
  }
}

function makeService(): { svc: RefreshSessionService; redis: FakeRedis } {
  const redis = new FakeRedis();
  const svc = new RefreshSessionService({
    client: redis,
  } as unknown as RedisService);
  return { svc, redis };
}

describe("RefreshSessionService", () => {
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

  it("issues a token that rotates to a new single-use token for the same session", async () => {
    const { svc } = makeService();
    const first = await svc.issue("a@b.com");
    const sid = first.split(".")[0];

    const rotated = await svc.rotate(first);
    expect(rotated.email).toBe("a@b.com");
    expect(rotated.token).not.toBe(first);
    expect(rotated.token.split(".")[0]).toBe(sid); // same session, new secret
  });

  it("detects reuse of an already-rotated token and revokes the whole session", async () => {
    const { svc } = makeService();
    const first = await svc.issue("a@b.com");
    const second = await svc.rotate(first); // first is now spent

    // Replaying the old token = reuse → session destroyed.
    await expect(svc.rotate(first)).rejects.toThrow(UnauthorizedException);
    // ...and the previously-valid rotated token is dead too (family revoked).
    await expect(svc.rotate(second.token)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("rejects malformed and unknown tokens", async () => {
    const { svc } = makeService();
    await expect(svc.rotate(undefined)).rejects.toThrow(UnauthorizedException);
    await expect(svc.rotate("no-dot")).rejects.toThrow(UnauthorizedException);
    await expect(svc.rotate("missing.secret")).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it("revoke makes a live token unusable", async () => {
    const { svc } = makeService();
    const token = await svc.issue("a@b.com");
    await svc.revoke(token);
    await expect(svc.rotate(token)).rejects.toThrow(UnauthorizedException);
  });
});
