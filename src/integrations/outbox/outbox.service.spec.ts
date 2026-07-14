import type { Prisma } from "@prisma/client";
import { OutboxService } from "./outbox.service";

describe("OutboxService", () => {
  const create = jest.fn().mockResolvedValue({ id: "11111111-2222-3333-4444-555555555555" });
  const tx = { outbox_event: { create } } as unknown as Prisma.TransactionClient;
  const service = new OutboxService();

  beforeEach(() => create.mockClear());

  it("inserts the event through the caller's transaction client", async () => {
    const result = await service.enqueue(tx, {
      eventType: "erp.sales-order.created",
      aggregateType: "sale_order",
      aggregateId: "SO-1",
      clinicId: "CL-1",
      branchId: "BR-1",
      payload: { documentNo: "SO-1" },
      correlationId: "corr-1",
    });

    expect(result).toEqual({
      eventId: "11111111-2222-3333-4444-555555555555",
      correlationId: "corr-1",
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        event_type: "erp.sales-order.created",
        aggregate_type: "sale_order",
        aggregate_id: "SO-1",
        clinic_id: "CL-1",
        branch_id: "BR-1",
        payload: { documentNo: "SO-1" },
        correlation_id: "corr-1",
      },
      select: { id: true },
    });
  });

  it("generates a correlation id when the caller has none", async () => {
    const result = await service.enqueue(tx, {
      eventType: "erp.sales-order.created",
      aggregateType: "sale_order",
      aggregateId: "SO-2",
      clinicId: "CL-1",
      payload: {},
    });

    expect(result.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    const data = create.mock.calls[0][0].data as { branch_id: string | null; correlation_id: string };
    expect(data.branch_id).toBeNull();
    expect(data.correlation_id).toBe(result.correlationId);
  });
});
