import { Module } from "@nestjs/common";
import { OutboxDispatcherService } from "./outbox-dispatcher.service";
import { OutboxPublisher } from "./outbox-publisher";
import { OutboxService } from "./outbox.service";

/**
 * Transactional outbox (plan-latest §4, Phase 4). Feature modules inject
 * OutboxService and enqueue events inside their business transaction; the
 * dispatcher publishes them to RabbitMQ when ERP_OUTBOX_ENABLED=true.
 */
@Module({
  providers: [OutboxService, OutboxPublisher, OutboxDispatcherService],
  exports: [OutboxService],
})
export class OutboxModule {}
