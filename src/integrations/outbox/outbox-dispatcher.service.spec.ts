import type { PrismaService } from "../../prisma.service";
import type { OutboxPublisher } from "./outbox-publisher";
import {
  OutboxDispatcherService,
  PARK_AFTER_ATTEMPTS,
} from "./outbox-dispatcher.service";

interface OutboxRowFixture {
  id: string;
  event_type: string;
  payload: unknown;
  correlation_id: string;
  attempts: number;
  created_at: Date;
}

function makeRow(overrides: Partial<OutboxRowFixture> = {}): OutboxRowFixture {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    event_type: "erp.sales-order.created",
    payload: { documentNo: "SO-1" },
    correlation_id: "corr-1",
    attempts: 0,
    created_at: new Date("2026-07-11T09:00:00Z"),
    ...overrides,
  };
}

describe("OutboxDispatcherService", () => {
  let rows: OutboxRowFixture[];
  let updateMany: jest.Mock;
  let prisma: PrismaService;
  let publisher: { ensureChannel: jest.Mock; publish: jest.Mock };
  let dispatcher: OutboxDispatcherService;

  beforeEach(() => {
    rows = [];
    updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = {
      $queryRaw: jest.fn().mockImplementation(() => Promise.resolve(rows)),
      outbox_event: { updateMany },
    };
    prisma = {
      $transaction: jest.fn(
        (fn: (client: typeof tx) => Promise<void>) => fn(tx),
      ),
    } as unknown as PrismaService;
    publisher = {
      ensureChannel: jest.fn().mockResolvedValue(undefined),
      publish: jest.fn().mockResolvedValue(undefined),
    };
    dispatcher = new OutboxDispatcherService(
      prisma,
      publisher as unknown as OutboxPublisher,
    );
  });

  it("skips the whole poll without touching rows when the broker is unreachable", async () => {
    publisher.ensureChannel.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ selected: 0, published: 0, failed: 0, parked: 0 });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("publishes the envelope with confirms and marks the row PUBLISHED", async () => {
    rows.push(makeRow());

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ selected: 1, published: 1, failed: 0, parked: 0 });
    const [routingKey, content, options] = publisher.publish.mock.calls[0];
    expect(routingKey).toBe("erp.sales-order.created");
    expect(JSON.parse((content as Buffer).toString("utf8"))).toEqual({
      eventId: "11111111-1111-1111-1111-111111111111",
      eventType: "erp.sales-order.created",
      occurredAt: "2026-07-11T09:00:00.000Z",
      correlationId: "corr-1",
      payload: { documentNo: "SO-1" },
    });
    expect(options).toMatchObject({
      persistent: true,
      messageId: "11111111-1111-1111-1111-111111111111",
      correlationId: "corr-1",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["11111111-1111-1111-1111-111111111111"] } },
      data: { status: "PUBLISHED", published_at: expect.any(Date) },
    });
  });

  it("increments attempts and leaves the row PENDING on a publish failure", async () => {
    rows.push(makeRow());
    publisher.publish.mockRejectedValueOnce(new Error("channel closed"));

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ selected: 1, published: 0, failed: 1, parked: 0 });
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["11111111-1111-1111-1111-111111111111"] } },
      data: { attempts: { increment: 1 } },
    });
  });

  it("parks a row once its publish failures reach the cap", async () => {
    rows.push(makeRow({ attempts: PARK_AFTER_ATTEMPTS - 1 }));
    publisher.publish.mockRejectedValueOnce(new Error("still failing"));

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ selected: 1, published: 0, failed: 0, parked: 1 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["11111111-1111-1111-1111-111111111111"] } },
      data: { status: "PARKED", attempts: { increment: 1 } },
    });
  });

  it("handles a mixed batch: confirmed rows publish even when another row fails", async () => {
    rows.push(
      makeRow(),
      makeRow({ id: "22222222-2222-2222-2222-222222222222", correlation_id: "corr-2" }),
    );
    publisher.publish
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("nacked"));

    const summary = await dispatcher.dispatchBatch();

    expect(summary).toEqual({ selected: 2, published: 1, failed: 1, parked: 0 });
  });
});
