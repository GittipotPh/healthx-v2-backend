import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { backendEnv } from "../../env";
import { OutboxPublisher } from "./outbox-publisher";

/** Publish failures per row before it is parked for operator inspection. */
export const PARK_AFTER_ATTEMPTS = 10;
export const BATCH_SIZE = 50;

interface OutboxRow {
  id: string;
  event_type: string;
  payload: unknown;
  correlation_id: string;
  attempts: number;
  created_at: Date;
}

export interface DispatchSummary {
  selected: number;
  published: number;
  failed: number;
  parked: number;
}

/**
 * Outbox dispatcher (rabbitmq plan §3): every poll locks a batch of PENDING
 * rows with FOR UPDATE SKIP LOCKED (safe across replicas), publishes each with
 * publisher confirms, and marks confirmed rows PUBLISHED in the same
 * transaction. A crash between broker confirm and commit re-publishes the row
 * on the next poll — the consumer's processed_event dedup absorbs that.
 *
 * "Broker unreachable" skips the whole poll without touching attempts;
 * attempts only count real per-message publish failures, so a plain broker
 * outage can never park rows (verification matrix: outbox absorbs downtime).
 */
@Injectable()
export class OutboxDispatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private timer?: NodeJS.Timeout;
  private polling = false;
  private brokerWasDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly publisher: OutboxPublisher,
  ) {}

  onModuleInit(): void {
    const env = backendEnv();
    if (!env.ERP_OUTBOX_ENABLED) {
      this.logger.log("ERP_OUTBOX_ENABLED=false — outbox dispatcher not started");
      return;
    }
    this.timer = setInterval(() => void this.poll(), env.ERP_OUTBOX_POLL_MS);
    this.logger.log(`outbox dispatcher started (every ${env.ERP_OUTBOX_POLL_MS}ms)`);
  }

  /** Serialized polling: a slow batch must not overlap the next tick. */
  async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.dispatchBatch();
    } catch (error) {
      this.logger.error(
        `outbox dispatch batch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.polling = false;
    }
  }

  /** Public for unit tests: one lock-publish-mark cycle. */
  async dispatchBatch(): Promise<DispatchSummary> {
    const summary: DispatchSummary = { selected: 0, published: 0, failed: 0, parked: 0 };

    // No broker, no batch: leave every row PENDING and untouched.
    try {
      await this.publisher.ensureChannel();
      if (this.brokerWasDown) {
        this.brokerWasDown = false;
        this.logger.log("rabbitmq reachable again; resuming outbox dispatch");
      }
    } catch (error) {
      if (!this.brokerWasDown) {
        this.brokerWasDown = true;
        this.logger.warn(
          `rabbitmq unreachable; outbox rows stay PENDING: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return summary;
    }

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxRow[]>(Prisma.sql`
        SELECT id, event_type, payload, correlation_id, attempts, created_at
          FROM outbox_event
         WHERE status = 'PENDING'
         ORDER BY created_at
         LIMIT ${BATCH_SIZE}
           FOR UPDATE SKIP LOCKED`);
      summary.selected = rows.length;
      if (rows.length === 0) return;

      const publishedIds: string[] = [];
      const retryIds: string[] = [];
      const parkIds: string[] = [];

      for (const row of rows) {
        try {
          await this.publishRow(row);
          publishedIds.push(row.id);
        } catch (error) {
          const willPark = row.attempts + 1 >= PARK_AFTER_ATTEMPTS;
          (willPark ? parkIds : retryIds).push(row.id);
          this.logger.warn(
            `outbox publish failed (attempt ${row.attempts + 1}${willPark ? ", PARKING" : ""}) ` +
              `event=${row.id} type=${row.event_type}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      if (publishedIds.length > 0) {
        await tx.outbox_event.updateMany({
          where: { id: { in: publishedIds } },
          data: { status: "PUBLISHED", published_at: new Date() },
        });
      }
      if (retryIds.length > 0) {
        await tx.outbox_event.updateMany({
          where: { id: { in: retryIds } },
          data: { attempts: { increment: 1 } },
        });
      }
      if (parkIds.length > 0) {
        await tx.outbox_event.updateMany({
          where: { id: { in: parkIds } },
          data: { status: "PARKED", attempts: { increment: 1 } },
        });
        this.logger.error(
          `outbox events parked after ${PARK_AFTER_ATTEMPTS} publish failures: ${parkIds.join(", ")}`,
        );
      }

      summary.published = publishedIds.length;
      summary.failed = retryIds.length;
      summary.parked = parkIds.length;
    });

    return summary;
  }

  /** Envelope shape the erp-integration consumer validates (event-envelope.ts). */
  private async publishRow(row: OutboxRow): Promise<void> {
    const envelope = {
      eventId: row.id,
      eventType: row.event_type,
      occurredAt: row.created_at.toISOString(),
      correlationId: row.correlation_id,
      payload: row.payload,
    };
    await this.publisher.publish(row.event_type, Buffer.from(JSON.stringify(envelope)), {
      persistent: true,
      contentType: "application/json",
      messageId: row.id,
      correlationId: row.correlation_id,
      headers: { "x-correlation-id": row.correlation_id },
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
