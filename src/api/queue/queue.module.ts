import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";
import { QueueRepository } from "./queue.repository";

@Module({
  imports: [AuditLogModule],
  controllers: [QueueController],
  providers: [QueueService, QueueRepository],
})
export class QueueModule {}
