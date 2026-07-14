import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";

export interface OutboxEventInput {
  /** Routing key on the hx.events exchange, e.g. "erp.sales-order.created". */
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  clinicId: string;
  branchId?: string;
  payload: Record<string, unknown>;
  /** Reuse the request's correlation id when there is one; generated otherwise. */
  correlationId?: string;
}

export interface EnqueuedOutboxEvent {
  eventId: string;
  correlationId: string;
}

/**
 * Transactional outbox producer (plan-latest §4 / rabbitmq plan §3). Callers
 * MUST pass the same transaction client as their business write so the event
 * commits or rolls back atomically with it — never publish to the broker from
 * a request path. The dispatcher picks the row up asynchronously.
 */
@Injectable()
export class OutboxService {
  async enqueue(
    tx: Prisma.TransactionClient,
    input: OutboxEventInput,
  ): Promise<EnqueuedOutboxEvent> {
    const correlationId = input.correlationId ?? randomUUID();
    const row = await tx.outbox_event.create({
      data: {
        event_type: input.eventType,
        aggregate_type: input.aggregateType,
        aggregate_id: input.aggregateId,
        clinic_id: input.clinicId,
        branch_id: input.branchId ?? null,
        payload: input.payload as Prisma.InputJsonValue,
        correlation_id: correlationId,
      },
      select: { id: true },
    });
    return { eventId: row.id, correlationId };
  }
}
