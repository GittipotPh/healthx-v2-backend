import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { PrismaModule } from "./prisma.module";
import { RedisModule } from "./redis/redis.module";
import { StorageModule } from "./common/storage/storage.module";
import { AuthModule } from "./auth/auth.module";
import { ClinicModule } from "./api/clinic/clinic.module";
import { AuditLogModule } from "./api/audit-log/audit-log.module";
import { CustomersModule } from "./api/customers/customers.module";
import { AppointmentsModule } from "./api/appointments/appointments.module";
import { OpdModule } from "./api/opd/opd.module";
import { QueueModule } from "./api/queue/queue.module";
import { HealthModule } from "./health/health.module";

@Module({
  imports: [
    // Structured JSON logging (OWASP A09). Stdout is streamed by the platform
    // (Azure Container Apps → Log Analytics), which is the off-site, DB-independent
    // copy of every security event — keep security-relevant logs going through
    // this logger, never console.*. Tokens must never be logged: the auth cookie
    // and Authorization header are redacted at the transport level.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? "info",
        redact: {
          paths: [
            "req.headers.authorization",
            "req.headers.cookie",
            'res.headers["set-cookie"]',
          ],
          remove: true,
        },
        // Per-request access logs for API routes; health probes only add noise.
        autoLogging: {
          ignore: (req) => req.url?.includes("/health") ?? false,
        },
      },
    }),
    PrismaModule,
    RedisModule,
    StorageModule,
    AuthModule,
    ClinicModule,
    AuditLogModule,
    CustomersModule,
    AppointmentsModule,
    OpdModule,
    QueueModule,
    HealthModule,
  ],
})
export class AppModule {}
