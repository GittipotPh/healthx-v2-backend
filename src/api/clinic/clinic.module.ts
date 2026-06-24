import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { ClinicController } from "./clinic.controller";
import { ClinicService } from "./clinic.service";

@Module({
  controllers: [ClinicController],
  providers: [PrismaService, ClinicService],
})
export class ClinicModule {}
