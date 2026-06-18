import { Module } from "@nestjs/common";
import { PrismaService } from "../../prisma.service";
import { AuditLogController } from "./audit-log.controller";
import { AuditLogService } from "./audit-log.service";
import { AuditLogRepository } from "./audit-log.repository";

@Module({
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogRepository, PrismaService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
