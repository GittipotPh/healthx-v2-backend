import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { RefreshSessionService } from "./refresh-session.service";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { OriginGuard } from "./guards/origin.guard";
import { ScopeGuard } from "./guards/scope.guard";
import { RateLimitGuard } from "../common/rate-limit/rate-limit.guard";
import { accessTtlSeconds } from "./auth.cookie";
import { backendEnv } from "../env";

@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: backendEnv().JWT_SECRET,
        // Short-lived access token; sessions persist via the rotating refresh token.
        signOptions: { expiresIn: accessTtlSeconds() },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RefreshSessionService,
    // Order matters: rate-limit, then reject forged origins (CSRF), then
    // authenticate (JWT), then authorize scope.
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
})
export class AuthModule {}
