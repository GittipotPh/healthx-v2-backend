import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { AppointmentsController } from "./appointments.controller";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsRepository } from "./appointments.repository";

@Module({
  controllers: [AppointmentsController],
  providers: [AppointmentsService, AppointmentsRepository, PrismaService],
  exports: [AppointmentsService, AppointmentsRepository],
})
export class AppointmentsModule {}
