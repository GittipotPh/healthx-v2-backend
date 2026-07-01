import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request, Response } from "express";
import { RedisService } from "../../redis/redis.service";
import type { Principal } from "../../auth/auth.types";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./rate-limit.decorator";

/** Applied to every route lacking an explicit @RateLimit. */
const GLOBAL_DEFAULT: RateLimitOptions = {
  limit: 300,
  windowSeconds: 60,
  by: "ip",
};

/**
 * Fixed-window rate limiter backed by Redis (shared across app instances, unlike
 * an in-memory counter). Routes inherit {@link GLOBAL_DEFAULT}; sensitive ones
 * tighten it with `@RateLimit(...)`. Runs first in the guard chain.
 *
 * Fails OPEN: if Redis is unreachable we allow the request rather than take the
 * whole API down — availability over strictness for the limiter itself. Auth
 * correctness still depends on Redis elsewhere; this only affects throttling.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const handler = context.getHandler();
    const controller = context.getClass();

    const options =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
        handler,
        controller,
      ]) ?? GLOBAL_DEFAULT;

    const request = context
      .switchToHttp()
      .getRequest<Request & { principal?: Principal }>();
    const response = context.switchToHttp().getResponse<Response>();

    const identifier = this.identifier(request, options.by ?? "ip");
    const bucket = `ratelimit:${controller.name}.${handler.name}:${identifier}`;

    let count: number;
    try {
      count = await this.redis.client.incr(bucket);
      if (count === 1)
        await this.redis.client.expire(bucket, options.windowSeconds);
    } catch (error) {
      this.logger.warn(
        `Rate-limit check skipped (Redis unavailable): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true; // fail open
    }

    if (count > options.limit) {
      const retryAfter = await this.ttl(bucket, options.windowSeconds);
      response.setHeader("Retry-After", String(retryAfter));
      throw new HttpException(
        "Too many requests",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private async ttl(bucket: string, fallback: number): Promise<number> {
    try {
      const ttl = await this.redis.client.ttl(bucket);
      return ttl > 0 ? ttl : fallback;
    } catch {
      return fallback;
    }
  }

  private identifier(
    request: Request & { principal?: Principal },
    by: "ip" | "principal" | "ip-email",
  ): string {
    if (by === "ip-email") {
      const email = this.bodyEmail(request);
      return email
        ? `ip-email:${this.clientIp(request)}:${email}`
        : `ip:${this.clientIp(request)}`;
    }
    if (by === "principal" && request.principal?.email)
      return `user:${request.principal.email}`;
    return `ip:${this.clientIp(request)}`;
  }

  private bodyEmail(request: Request): string | undefined {
    const body = request.body as { email?: unknown } | undefined;
    if (typeof body?.email !== "string") return undefined;
    const email = body.email.trim().toLowerCase();
    return email || undefined;
  }

  /** Real client IP — trusts the first X-Forwarded-For hop set by the platform proxy. */
  private clientIp(request: Request): string {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.length > 0) {
      return forwarded.split(",")[0].trim();
    }
    return request.ip ?? request.socket.remoteAddress ?? "unknown";
  }
}
