import { Test } from "@nestjs/testing";
import { Prisma, role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  type CreateOpdReleaseInput,
  OpdOrderReleaseRepository,
} from "./opd-order-release.repository";

const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const RELEASE_ID = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-07-21T03:00:00.000Z");
const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};

function input(): CreateOpdReleaseInput {
  return {
    encounterId: ENCOUNTER_ID,
    orderId: ORDER_ID,
    legacyOpdId: "legacy-opd-1",
    customerId: "customer-1",
    prescriptionId: "prescription-1",
    saleOrderId: "SO-0001",
    requestHash: "a".repeat(64),
    idempotencyKeyHash: "b".repeat(64),
    sourceOrderVersion: 2,
    itemVersionManifest: [{ orderItemId: ITEM_ID, version: 2 }],
    subtotalAmount: new Prisma.Decimal(30),
    promotionDiscountAmount: new Prisma.Decimal(5),
    taxAmount: new Prisma.Decimal(0),
    netTotalAmount: new Prisma.Decimal(25),
    pricingPolicy: "opd-medication-release-price-v1",
    taxPolicy: "opd-medication-no-vat-v1",
    safetySource: "LEGACY_CUSTOMER_INFO_UNVERIFIED",
    safetySnapshotHash: "c".repeat(64),
    prescriberUserId: "doctor-1",
    lines: [
      {
        orderItemId: ITEM_ID,
        legacyPrescriptionItemId: "prescription-item-1",
        legacySaleOrderItemId: "sale-item-1",
        displayOrder: 1,
        sourceId: "product-1",
        sourceCode: "MED-001",
        category: "MEDICINE",
        name: "Paracetamol 500 mg",
        unit: "tablet",
        quantity: new Prisma.Decimal(10),
        baseUnitPrice: new Prisma.Decimal(3),
        unitPrice: new Prisma.Decimal("2.50"),
        pricingSource: "PROMOTION",
        grossAmount: new Prisma.Decimal(30),
        discountAmount: new Prisma.Decimal(5),
        taxAmount: new Prisma.Decimal(0),
        netAmount: new Prisma.Decimal(25),
        orderItemNote: null,
        dose: "1 tablet",
        route: "oral",
        frequency: "twice daily",
        timing: "after meals",
        durationValue: new Prisma.Decimal(5),
        durationUnit: "DAY",
        sigText: "Take one tablet twice daily after meals",
        medicationNote: null,
        lotId: "LOT-1",
        expiryAt: new Date("2099-01-01T00:00:00.000Z"),
        stockObservedQuantity: new Prisma.Decimal(20),
      },
    ],
  };
}

describe("OpdOrderReleaseRepository", () => {
  it("creates the pending sale before the waiting prescription and keeps every write on the supplied transaction", async () => {
    const calls: string[] = [];
    const track = (name: string, result: unknown = {}) =>
      jest.fn().mockImplementation((_input: unknown) => {
        calls.push(name);
        return Promise.resolve(result);
      });
    const releaseItemsCreate = track("release-items");
    const saleCreate = track("sale-order");
    const saleItemsCreate = track("sale-items");
    const prescriptionCreate = track("prescription");
    const prescriptionItemsCreate = track("prescription-items");
    const tx = {
      opd_order_release: {
        create: track("release", { release_id: RELEASE_ID }),
      },
      opd_order_release_item: { createMany: releaseItemsCreate },
      sale_order: { create: saleCreate },
      sale_order_item: { createMany: saleItemsCreate },
      prescription: { create: prescriptionCreate },
      prescription_item: { createMany: prescriptionItemsCreate },
      opd_order_prescription_link: { create: track("prescription-link") },
      opd_order_sale_link: { create: track("sale-link") },
    };
    const prisma = {
      opd_order_release: {
        create: jest.fn(() => {
          throw new Error("Global client must not be used");
        }),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        OpdOrderReleaseRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    const repository = module.get(OpdOrderReleaseRepository);

    await expect(
      repository.createRelease(input(), SCOPE, NOW, tx),
    ).resolves.toBe(RELEASE_ID);

    expect(calls).toEqual([
      "release",
      "release-items",
      "sale-order",
      "sale-items",
      "prescription",
      "prescription-items",
      "prescription-link",
      "sale-link",
    ]);
    expect(saleCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sale_order_id: "SO-0001",
        sale_order_status: "PENDING",
        status: "ACTIVE",
        promotion_discount: new Prisma.Decimal(5),
        totalDue: new Prisma.Decimal(25),
      }),
    });
    expect(prescriptionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        prescribe_id: "prescription-1",
        sale_order_id: "SO-0001",
        status: "WAITING",
        user_create: "doctor-1",
      }),
    });
    expect(releaseItemsCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          gross_amount: new Prisma.Decimal(30),
          discount_amount: new Prisma.Decimal(5),
          tax_amount: new Prisma.Decimal(0),
          net_amount: new Prisma.Decimal(25),
          lot_id: "LOT-1",
          expiry_at: new Date("2099-01-01T00:00:00.000Z"),
        }),
      ],
    });
    expect(saleItemsCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          price_per_unit: new Prisma.Decimal(3),
          discount: new Prisma.Decimal("0.50"),
          total: new Prisma.Decimal(25),
          net: new Prisma.Decimal("2.50"),
          lot_id: "LOT-1",
        }),
      ],
    });
    expect(prescriptionItemsCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          price: new Prisma.Decimal(3),
          qty: new Prisma.Decimal(10),
          total_price: new Prisma.Decimal(25),
          lot_id: "LOT-1",
          date_exp: new Date("2099-01-01T00:00:00.000Z"),
        }),
      ],
    });
  });

  it("maps only branch inventory lots and preserves missing or ambiguous expiry evidence", async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        lot_id: "LOT-1",
        in_stock: new Prisma.Decimal(12),
        expiry_count: 1n,
        expiry_at: new Date("2099-01-01T00:00:00.000Z"),
      },
      {
        lot_id: "LOT-2",
        in_stock: null,
        expiry_count: 2n,
        expiry_at: null,
      },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        OpdOrderReleaseRepository,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    const repository = module.get(OpdOrderReleaseRepository);

    const lots = await repository.findLots("product-1", SCOPE);

    expect(lots).toEqual([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(12),
        expiryCount: 1,
        expiryAt: new Date("2099-01-01T00:00:00.000Z"),
      },
      {
        lotId: "LOT-2",
        inStock: new Prisma.Decimal(0),
        expiryCount: 2,
        expiryAt: null,
      },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });
});
