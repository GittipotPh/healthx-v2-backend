import { Module } from "@nestjs/common";
import { BranchAccessModule } from "../../common/branch-access/branch-access.module";
import { CustomersModule } from "../customers/customers.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { AppointmentOptionsRepository } from "./appointment-options.repository";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsRepository } from "./appointments.repository";

@Module({
  imports: [BranchAccessModule, CustomersModule, AuditLogModule],
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsRepository, AppointmentOptionsRepository],
  exports: [AppointmentsService, AppointmentsRepository, AppointmentOptionsRepository],
})
export class AppointmentsModule {}
