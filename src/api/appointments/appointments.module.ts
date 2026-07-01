import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { BranchAccessModule } from "../../common/branch-access/branch-access.module";
import { AppointmentOptionsRepository } from "./appointment-options.repository";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsRepository } from "./appointments.repository";

@Module({
  imports: [BranchAccessModule],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    AppointmentsRepository,
    AppointmentOptionsRepository,
    PrismaService,
  ],
  exports: [AppointmentsService, AppointmentsRepository, AppointmentOptionsRepository],
})
export class AppointmentsModule {}
