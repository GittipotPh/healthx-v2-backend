import { Injectable, Logger, type OnModuleDestroy } from "@nestjs/common";
import { connect, type ChannelModel, type ConfirmChannel, type Options } from "amqplib";
import { backendEnv } from "../../env";

/** Same durable topic exchange the erp-integration consumer binds to. */
export const EVENTS_EXCHANGE = "hx.events";

/**
 * Confirm-channel publisher for the outbox dispatcher. Publisher confirms are
 * the whole point (rabbitmq plan §3): an outbox row is only marked PUBLISHED
 * after the broker acknowledges the message. Connection failures surface as
 * thrown errors — the dispatcher treats "no broker" as "skip this poll",
 * never as a per-row failure.
 */
@Injectable()
export class OutboxPublisher implements OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private connection?: ChannelModel;
  private channelPromise?: Promise<ConfirmChannel>;
  private closing = false;

  /** Overridable in unit tests; production uses the real amqplib connect. */
  connectFn: typeof connect = (...args) => connect(...args);

  /**
   * Connectivity probe for the dispatcher: resolves once a confirm channel
   * exists, throws when the broker is unreachable. Lets the dispatcher tell
   * "broker down" (skip the poll) apart from a per-message failure.
   */
  async ensureChannel(): Promise<void> {
    await this.getChannel();
  }

  async publish(
    routingKey: string,
    content: Buffer,
    options: Options.Publish,
  ): Promise<void> {
    const channel = await this.getChannel();
    await new Promise<void>((resolve, reject) => {
      channel.publish(EVENTS_EXCHANGE, routingKey, content, options, (err) =>
        err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(),
      );
    });
  }

  private getChannel(): Promise<ConfirmChannel> {
    this.channelPromise ??= this.openChannel().catch((error: unknown) => {
      // Failed attempts must not be cached, or the publisher would be
      // permanently broken after one broker outage.
      this.channelPromise = undefined;
      throw error;
    });
    return this.channelPromise;
  }

  private async openChannel(): Promise<ConfirmChannel> {
    const url = backendEnv().RABBITMQ_URL;
    if (!url) throw new Error("RABBITMQ_URL is not configured");

    const connection = await this.connectFn(url);
    connection.on("error", (error: unknown) => {
      this.logger.warn(
        `rabbitmq publisher connection error: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    connection.on("close", () => {
      // Next publish reconnects lazily.
      this.connection = undefined;
      this.channelPromise = undefined;
      if (!this.closing) this.logger.warn("rabbitmq publisher connection closed");
    });

    const channel = await connection.createConfirmChannel();
    // Same declaration as the consumer's assertTopology — idempotent, and it
    // keeps the publisher working even if it starts before any consumer.
    await channel.assertExchange(EVENTS_EXCHANGE, "topic", { durable: true });
    this.connection = connection;
    return channel;
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    try {
      await this.connection?.close();
    } catch {
      // Already closed — nothing to release.
    }
  }
}
