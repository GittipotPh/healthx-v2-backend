import type { Prisma } from "@prisma/client";
import { backendEnv } from "../../env";
import type { OutboxService } from "../outbox/outbox.service";
import {
  ErpSalesOrderEmitter,
  SALES_ORDER_CREATED_EVENT,
} from "./erp-sales-order-emitter.service";

jest.mock("../../env", () => ({ backendEnv: jest.fn() }));

const backendEnvMock = backendEnv as jest.Mock;

const SCOPE = { clinicId: "clinic-1", branchId: "branch-1" };
const OPD_ID = "opd-1";

/** Minimal stand-in for Prisma's Decimal (only toNumber is consumed). */
function dec(value: number): { toNumber: () => number } {
  return { toNumber: () => value };
}

function makeSaleOrder(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sale_order_id: "SO-0001",
    customer_id: "CUST-0001",
    date: new Date("2026-07-15T03:00:00Z"),
    sale_order_item: [
      {
        sale_order_item_id: "SOI-1",
        item_id: "PROD-1",
        course_item_id: null,
        bundle_set_id: null,
        item_name: "ยาชา",
        quantity: dec(2),
        price_per_unit: dec(420.5),
      },
    ],
    ...overrides,
  };
}

function makeEmitter(options: {
  saleOrders?: Record<string, unknown>[];
  existingOutboxRows?: { aggregate_id: string }[];
} = {}) {
  const tx = {
    sale_order: {
      findMany: jest.fn().mockResolvedValue(options.saleOrders ?? []),
    },
    outbox_event: {
      findMany: jest.fn().mockResolvedValue(options.existingOutboxRows ?? []),
    },
  };
  const outbox = {
    enqueue: jest
      .fn()
      .mockResolvedValue({ eventId: "event-1", correlationId: "corr-1" }),
  };
  const emitter = new ErpSalesOrderEmitter(outbox as unknown as OutboxService);
  return { emitter, tx: tx as unknown as Prisma.TransactionClient, txMock: tx, outbox };
}

beforeEach(() => {
  backendEnvMock.mockReturnValue({ ERP_OUTBOX_ENABLED: true });
});

describe("ErpSalesOrderEmitter.emitPaidSaleOrdersForOpd", () => {
  it("is a no-op while ERP_OUTBOX_ENABLED=false", async () => {
    backendEnvMock.mockReturnValue({ ERP_OUTBOX_ENABLED: false });
    const { emitter, tx, txMock, outbox } = makeEmitter({
      saleOrders: [makeSaleOrder()],
    });

    await expect(emitter.emitPaidSaleOrdersForOpd(tx, SCOPE, OPD_ID)).resolves.toBe(0);
    expect(txMock.sale_order.findMany).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("enqueues one mapped event per PAID sale order on the caller's transaction", async () => {
    const { emitter, tx, txMock, outbox } = makeEmitter({
      saleOrders: [makeSaleOrder()],
    });

    const enqueued = await emitter.emitPaidSaleOrdersForOpd(tx, SCOPE, OPD_ID);

    expect(enqueued).toBe(1);
    // Only PAID, non-deleted orders reachable from this OPD's prescriptions,
    // scoped to the caller's clinic/branch.
    expect(txMock.sale_order.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          sale_order_status: "PAID",
          status: { not: "DELETED" },
          prescription: { some: { opd_id: OPD_ID } },
        }),
      }),
    );
    expect(outbox.enqueue).toHaveBeenCalledWith(tx, {
      eventType: SALES_ORDER_CREATED_EVENT,
      aggregateType: "sale_order",
      aggregateId: "SO-0001",
      clinicId: SCOPE.clinicId,
      branchId: SCOPE.branchId,
      payload: {
        documentNo: "SO-0001",
        customerNumber: "CUST-0001",
        orderDate: "2026-07-15",
        externalDocumentNo: OPD_ID,
        lines: [{ itemNo: "PROD-1", quantity: 2, unitPrice: 420.5 }],
      },
    });
  });

  it("omits orderDate when the sale order has no date", async () => {
    const { emitter, tx, outbox } = makeEmitter({
      saleOrders: [makeSaleOrder({ date: null })],
    });

    await emitter.emitPaidSaleOrdersForOpd(tx, SCOPE, OPD_ID);

    const payload = outbox.enqueue.mock.calls[0][1].payload as Record<string, unknown>;
    expect(payload).not.toHaveProperty("orderDate");
  });

  it("falls back item_id -> course_item_id -> bundle_set_id for the BC item reference", async () => {
    const { emitter, tx, outbox } = makeEmitter({
      saleOrders: [
        makeSaleOrder({
          sale_order_item: [
            {
              sale_order_item_id: "SOI-1",
              item_id: null,
              course_item_id: "CRS-1",
              bundle_set_id: null,
              item_name: "คอร์สหน้าใส",
              quantity: dec(1),
              price_per_unit: dec(1500),
            },
            {
              sale_order_item_id: "SOI-2",
              item_id: null,
              course_item_id: null,
              bundle_set_id: "BND-1",
              item_name: "เซ็ตดูแลผิว",
              quantity: dec(1),
              price_per_unit: dec(990),
            },
          ],
        }),
      ],
    });

    await emitter.emitPaidSaleOrdersForOpd(tx, SCOPE, OPD_ID);

    const payload = outbox.enqueue.mock.calls[0][1].payload as {
      lines: { itemNo: string }[];
    };
    expect(payload.lines.map((line) => line.itemNo)).toEqual(["CRS-1", "BND-1"]);
  });

  it("drops unmappable lines and skips an order whose lines are all unmappable", async () => {
    const unmappableLine = {
      sale_order_item_id: "SOI-X",
      item_id: null,
      course_item_id: null,
      bundle_set_id: null,
      item_name: "ค่าบริการอื่น",
      quantity: dec(1),
      price_per_unit: dec(100),
    };
    const mappableLine = {
      sale_order_item_id: "SOI-1",
      item_id: "PROD-1",
      course_item_id: null,
      bundle_set_id: null,
      item_name: "ยาชา",
      quantity: dec(2),
      price_per_unit: dec(420.5),
    };
    const { emitter, tx, outbox } = makeEmitter({
      saleOrders: [
        makeSaleOrder({
          sale_order_id: "SO-MIXED",
          sale_order_item: [unmappableLine, mappableLine],
        }),
        makeSaleOrder({ sale_order_id: "SO-EMPTY", sale_order_item: [unmappableLine] }),
      ],
    });

    const enqueued = await emitter.emitPaidSaleOrdersForOpd(tx, SCOPE, OPD_ID);

    // SO-MIXED goes out with only its mappable line; SO-EMPTY is skipped
    // entirely rather than sent as a lineless (BC-invalid) document.
    expect(enqueued).toBe(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    const payload = outbox.enqueue.mock.calls[0][1].payload as {
      documentNo: string;
      lines: unknown[];
    };
    expect(payload.documentNo).toBe("SO-MIXED");
    expect(payload.lines).toHaveLength(1);
  });

  it("does not re-enqueue a sale order that already has an outbox event", async () => {
    const { emitter, tx, txMock, outbox } = makeEmitter({
      saleOrders: [makeSaleOrder(), makeSaleOrder({ sale_order_id: "SO-0002" })],
      existingOutboxRows: [{ aggregate_id: "SO-0001" }],
    });

    const enqueued = await emitter.emitPaidSaleOrdersForOpd(tx, SCOPE, OPD_ID);

    expect(txMock.outbox_event.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          event_type: SALES_ORDER_CREATED_EVENT,
          branch_id: SCOPE.branchId,
          aggregate_id: { in: ["SO-0001", "SO-0002"] },
        }),
      }),
    );
    expect(enqueued).toBe(1);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    expect(outbox.enqueue.mock.calls[0][1].aggregateId).toBe("SO-0002");
  });

  it("returns 0 without a dedup query when the visit has no PAID sale orders", async () => {
    const { emitter, tx, txMock, outbox } = makeEmitter({ saleOrders: [] });

    await expect(emitter.emitPaidSaleOrdersForOpd(tx, SCOPE, OPD_ID)).resolves.toBe(0);
    expect(txMock.outbox_event.findMany).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
