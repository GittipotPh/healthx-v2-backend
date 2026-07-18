import { Module } from "@nestjs/common";
import { OpdController } from "./opd.controller";
import { OpdService } from "./opd.service";
import { OpdRepository } from "./opd.repository";
import { AuditLogModule } from "../audit-log/audit-log.module";
import { QueueModule } from "../queue/queue.module";
import { OpdV2EnabledGuard } from "./opd-v2-enabled.guard";

@Module({
  imports: [AuditLogModule, QueueModule],
  controllers: [OpdController],
  providers: [OpdService, OpdRepository, OpdV2EnabledGuard],
  exports: [OpdService],
})
export class OpdModule {}
