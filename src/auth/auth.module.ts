import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { PrismaService } from "../prisma.service";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { OriginGuard } from "./origin.guard";
import { ScopeGuard } from "./scope.guard";

@Module({
  imports: [
    JwtModule.registerAsync({
      // Factory runs at DI time, after main.ts loads .env into process.env.
      useFactory: () => ({
        secret: process.env.JWT_SECRET ?? "dev-secret-change-me",
        signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? "12h") as `${number}h` },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    PrismaService,
    AuthService,
    // Order matters: reject forged origins (CSRF), then authenticate (JWT),
    // then authorize scope.
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: ScopeGuard },
  ],
})
export class AuthModule {}
