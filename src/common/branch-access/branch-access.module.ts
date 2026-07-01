import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { BranchAccessService } from "./branch-access.service";

@Module({
  providers: [PrismaService, BranchAccessService],
  exports: [BranchAccessService],
})
export class BranchAccessModule {}
