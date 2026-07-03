import { Module } from "@nestjs/common";
import { PrismaModule } from "./prisma.module";
import { RedisModule } from "./redis/redis.module";
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
    PrismaModule,
    RedisModule,
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
