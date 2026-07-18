import { Module } from "@nestjs/common";
import { ErpEventsModule } from "../../integrations/erp-events/erp-events.module";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { QueueController } from "./queue.controller";
import { QueueService } from "./queue.service";
import { QueueRepository } from "./queue.repository";

@Module({
  imports: [AuditLogModule, ErpEventsModule],
  controllers: [QueueController],
  providers: [QueueService, QueueRepository],
  exports: [QueueService],
})
export class QueueModule {}
