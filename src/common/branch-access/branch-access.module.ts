import { Module } from "@nestjs/common";
import { BranchAccessService } from "./branch-access.service";

@Module({
  providers: [BranchAccessService],
  exports: [BranchAccessService],
})
export class BranchAccessModule {}
