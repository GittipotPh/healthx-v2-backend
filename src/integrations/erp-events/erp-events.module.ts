import { Module } from "@nestjs/common";
import { OutboxModule } from "../outbox/outbox.module";
import { ErpSalesOrderEmitter } from "./erp-sales-order-emitter.service";

/**
 * Domain → ERP event mapping (plan-latest Phase 8). Feature modules import
 * this to enqueue typed ERP events; the raw OutboxService stays an internal
 * transport detail behind these emitters.
 */
@Module({
  imports: [OutboxModule],
  providers: [ErpSalesOrderEmitter],
  exports: [ErpSalesOrderEmitter],
})
export class ErpEventsModule {}
