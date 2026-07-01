import { HttpException, type ExecutionContext } from "@nestjs/common";
import type { Reflector } from "@nestjs/core";
import type { RedisService } from "../../redis/redis.service";
import { RateLimitGuard } from "./rate-limit.guard";

function contextOf(body?: unknown): ExecutionContext {
  const req = {
    headers: { "x-forwarded-for": "1.2.3.4" },
    ip: "1.2.3.4",
    socket: {},
    body,
  };
  const res = { setHeader: jest.fn() };
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as unknown as ExecutionContext;
}

function makeGuard(redisClient: Partial<Record<string, jest.Mock>>): {
  guard: RateLimitGuard;
  reflector: Reflector;
} {
  const reflector = {
    getAllAndOverride: jest
      .fn()
      .mockReturnValue({ limit: 2, windowSeconds: 60, by: "ip" }),
  } as unknown as Reflector;
  const redis = { client: redisClient } as unknown as RedisService;
  return { guard: new RateLimitGuard(reflector, redis), reflector };
}

describe("RateLimitGuard", () => {
  it("allows requests under the limit", async () => {
    const { guard } = makeGuard({
      incr: jest.fn().mockResolvedValue(1),
      expire: jest.fn(),
    });
    await expect(guard.canActivate(contextOf())).resolves.toBe(true);
  });

  it("rejects once the counter exceeds the limit", async () => {
    const { guard } = makeGuard({
      incr: jest.fn().mockResolvedValue(3), // > limit (2)
      ttl: jest.fn().mockResolvedValue(42),
    });
    await expect(guard.canActivate(contextOf())).rejects.toThrow(HttpException);
  });

  it("fails open when Redis is unavailable", async () => {
    const { guard } = makeGuard({
      incr: jest.fn().mockRejectedValue(new Error("down")),
    });
    await expect(guard.canActivate(contextOf())).resolves.toBe(true);
  });

  it("sets the window TTL only on the first hit", async () => {
    const expire = jest.fn();
    const { guard } = makeGuard({
      incr: jest.fn().mockResolvedValue(1),
      expire,
    });
    await guard.canActivate(contextOf());
    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("can bucket login throttling by normalized email and IP", async () => {
    const incr = jest.fn().mockResolvedValue(1);
    const { guard, reflector } = makeGuard({ incr, expire: jest.fn() });
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue({
      limit: 2,
      windowSeconds: 60,
      by: "ip-email",
    });

    await guard.canActivate(contextOf({ email: " USER@Example.COM " }));

    expect(incr).toHaveBeenCalledWith(
      "ratelimit:Controller.handler:ip-email:1.2.3.4:user@example.com",
    );
  });
});
