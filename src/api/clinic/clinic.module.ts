import { Module } from "@nestjs/common";
import { BranchAccessModule } from "../../common/branch-access/branch-access.module";
import { ClinicController } from "./clinic.controller";
import { ClinicService } from "./clinic.service";

@Module({
  imports: [BranchAccessModule],
  controllers: [ClinicController],
  providers: [ClinicService],
})
export class ClinicModule {}
