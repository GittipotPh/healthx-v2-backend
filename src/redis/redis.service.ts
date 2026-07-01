import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";
import { backendEnv } from "../env";

/**
 * Thin wrapper over a single shared ioredis connection.
 *
 * Connects to `REDIS_URL` (e.g. `redis://localhost:6379` in dev via docker-compose,
 * the Azure Cache for Redis connection string in prod). Used for the refresh-session
 * store (rotation + reuse-detection) and the rate limiter — both need state shared
 * across app instances, which an in-memory map can't provide once we scale out.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor() {
    const url = backendEnv().REDIS_URL;
    this.client = new Redis(url, {
      // Auth is security-critical: fail fast rather than queue commands forever.
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    this.client.on("error", (err) =>
      this.logger.error(`Redis error: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }
}
