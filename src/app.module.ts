import { Module } from "@nestjs/common";
import { AuditLogModule } from "./api/audit-log/audit-log.module";
import { CustomersModule } from "./api/customers/customers.module";
import { AppointmentsModule } from "./api/appointments/appointments.module";
import { OpdModule } from "./api/opd/opd.module";
import { QueueModule } from "./api/queue/queue.module";

@Module({
  imports: [AuditLogModule, CustomersModule, AppointmentsModule, OpdModule, QueueModule],
})
export class AppModule {}
