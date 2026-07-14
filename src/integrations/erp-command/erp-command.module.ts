import { Module } from "@nestjs/common";
import { ErpCommandController } from "./erp-command.controller";
import { ErpCommandService } from "./erp-command.service";
import { ServiceKeyGuard } from "./service-key.guard";

/** Internal ERP command API (plan-latest §4, Phase 4). */
@Module({
  controllers: [ErpCommandController],
  providers: [ErpCommandService, ServiceKeyGuard],
})
export class ErpCommandModule {}
