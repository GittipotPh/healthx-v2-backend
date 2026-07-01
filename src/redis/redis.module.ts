import { Global, Module } from "@nestjs/common";
import { RedisService } from "./redis.service";

/**
 * Global so the refresh-session store and rate-limit guard can inject the shared
 * Redis connection without re-importing in every feature module.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
