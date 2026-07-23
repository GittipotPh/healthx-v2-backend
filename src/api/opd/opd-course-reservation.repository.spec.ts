import { Test } from "@nestjs/testing";
import {
  Prisma,
  amount_unit,
  operator_type,
  role_enum,
  usage_log_status,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  type CreateCourseReservationInput,
  OpdCourseReservationRepository,
} from "./opd-course-reservation.repository";

const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const RESERVATION_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const COMPONENT_ID = "44444444-4444-4444-8444-444444444444";
const OPERATOR_ID = "55555555-5555-4555-8555-555555555555";
const EXPIRY = new Date("2099-01-01T00:00:00.000Z");
const NOW = new Date("2026-07-23T03:00:00.000Z");
const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};

function input(): CreateCourseReservationInput {
  return {
    reservationId: RESERVATION_ID,
    encounterId: ENCOUNTER_ID,
    customerId: "customer-1",
    legacyOpdId: "legacy-opd-1",
    legacyServiceUsageId: "SU-0001",
    requestHash: "a".repeat(64),
    idempotencyKeyHash: "b".repeat(64),
    sourceEncounterVersion: 4,
    sourceBalanceManifest: [],
    items: [
      {
        reservationItemId: RESERVATION_ITEM_ID,
        legacyServiceUsageItemId: "service-usage-item-1",
        legacyUsageLogId: "usage-log-1",
        displayOrder: 1,
        purchaseBranchId: SCOPE.branchId,
        customerId: "customer-1",
        saleOrderId: "sale-order-1",
        courseId: "course-1",
        courseItemId: "course-item-1",
        courseCode: "COURSE-001",
        courseName: "Laser course",
        itemName: "Laser session",
        unit: "session",
        entitlementExpireAt: EXPIRY,
        displayExpireAt: EXPIRY,
        entitlementAmount: new Prisma.Decimal(5),
        beforeReservedAmount: new Prisma.Decimal(1),
        beforeUsedAmount: new Prisma.Decimal(1),
        beforeRemainingAmount: new Prisma.Decimal(3),
        reservedAmount: new Prisma.Decimal(1),
        afterRemainingAmount: new Prisma.Decimal(2),
        entitlementCreatedAt: NOW,
        entitlementUpdatedAt: NOW,
        saleOrderUpdatedAt: NOW,
        courseUpdatedAt: NOW,
        courseItemUpdatedAt: NOW,
        sourceSnapshotHash: "c".repeat(64),
        components: [
          {
            reservationComponentId: COMPONENT_ID,
            productId: "product-1",
            productCode: "PRODUCT-001",
            productName: "Gel",
            unit: "tube",
            configuredQuantity: new Prisma.Decimal(2),
            totalQuantity: new Prisma.Decimal(2),
            lotId: "LOT-1",
            expiryAt: EXPIRY,
            stockObservedQuantity: new Prisma.Decimal(10),
            sourceUpdatedAt: NOW,
          },
        ],
        operators: [
          {
            reservationOperatorId: OPERATOR_ID,
            userId: "operator-1",
            roleId: role_enum.DOCTOR,
            operatorType: operator_type.OPERATOR,
            commissionAmount: new Prisma.Decimal(100),
            commissionUnit: amount_unit.AMOUNT,
            sourceUserUpdatedAt: NOW,
          },
        ],
      },
    ],
  };
}

describe("OpdCourseReservationRepository", () => {
  it("creates every app-owned and legacy projection on only the supplied transaction", async () => {
    const calls: string[] = [];
    const track = (name: string, result: unknown = {}) =>
      jest.fn().mockImplementation((_args: unknown) => {
        calls.push(name);
        return Promise.resolve(result);
      });
    const componentCreate = track("reservation-components");
    const operatorCreate = track("reservation-operators");
    const legacyUsageCreate = track("service-usage");
    const legacyLogCreate = track("usage-logs");
    const legacyOpdUpdate = track("legacy-opd-link", { count: 1 });
    const tx = {
      opd_course_reservation: { create: track("reservation") },
      opd_course_reservation_item: {
        createMany: track("reservation-items"),
      },
      opd_course_reservation_component: { createMany: componentCreate },
      opd_course_reservation_operator: { createMany: operatorCreate },
      service_usage: { create: legacyUsageCreate },
      service_usage_item: { createMany: track("service-usage-items") },
      service_usage_item_product: {
        createMany: track("service-usage-products"),
      },
      course_operator_user: { createMany: track("course-operator-users") },
      service_usage_item_commission: {
        createMany: track("service-usage-commissions"),
      },
      customer_course_usage_log: { createMany: legacyLogCreate },
      opd: { updateMany: legacyOpdUpdate },
    };
    const globalCreate = jest.fn(() => {
      throw new Error("Global Prisma client must not be used");
    });
    const module = await Test.createTestingModule({
      providers: [
        OpdCourseReservationRepository,
        {
          provide: PrismaService,
          useValue: { service_usage: { create: globalCreate } },
        },
      ],
    }).compile();
    const repository = module.get(OpdCourseReservationRepository);

    await expect(
      repository.createReservation(input(), SCOPE, NOW, tx),
    ).resolves.toBeUndefined();

    expect(calls).toEqual([
      "reservation",
      "reservation-items",
      "reservation-components",
      "reservation-operators",
      "service-usage",
      "service-usage-items",
      "service-usage-products",
      "course-operator-users",
      "service-usage-commissions",
      "usage-logs",
      "legacy-opd-link",
    ]);
    expect(globalCreate).not.toHaveBeenCalled();
    expect(componentCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          reservation_component_id: COMPONENT_ID,
          product_id: "product-1",
          lot_id: "LOT-1",
          stock_observed_quantity: new Prisma.Decimal(10),
        }),
      ],
    });
    expect(operatorCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          reservation_operator_id: OPERATOR_ID,
          user_id: "operator-1",
          commission_amount: new Prisma.Decimal(100),
        }),
      ],
    });
    expect(legacyUsageCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        service_usage_id: "SU-0001",
        status: "ACTIVE",
        service_usage_status: "PENDING",
        verify_at: null,
        verify_by: null,
        document_url: null,
      }),
    });
    expect(legacyLogCreate).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "usage-log-1",
          service_usage_id: "SU-0001",
          amount: new Prisma.Decimal(1),
          status: "RESERVED",
          course_usage_type: "SERVICE_USAGE",
        }),
      ],
    });
    expect(legacyOpdUpdate).toHaveBeenCalledWith({
      where: {
        opd_id: "legacy-opd-1",
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        customer_id: "customer-1",
        management_item: null,
      },
      data: { management_item: "SU-0001", updated_at: NOW },
    });
    expect(tx).not.toHaveProperty("inventory");
    expect(tx).not.toHaveProperty("inventory_log");
  });

  it("calculates balance across all use branches for the exact logical identity", async () => {
    const groupBy = jest.fn().mockResolvedValue([
      {
        status: usage_log_status.RESERVED,
        _sum: { amount: new Prisma.Decimal(2) },
      },
      {
        status: usage_log_status.USED,
        _sum: { amount: new Prisma.Decimal(1) },
      },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        OpdCourseReservationRepository,
        {
          provide: PrismaService,
          useValue: { customer_course_usage_log: { groupBy } },
        },
      ],
    }).compile();
    const repository = module.get(OpdCourseReservationRepository);

    const result = await repository.usageBalance({
      clinicId: SCOPE.clinicId,
      purchaseBranchId: SCOPE.branchId,
      customerId: "customer-1",
      saleOrderId: "sale-order-1",
      courseItemId: "course-item-1",
      entitlementExpireAt: EXPIRY,
    });

    expect(result).toEqual({
      reserved: new Prisma.Decimal(2),
      used: new Prisma.Decimal(1),
    });
    expect(groupBy).toHaveBeenCalledWith({
      by: ["status"],
      where: {
        clinic_id: SCOPE.clinicId,
        customer_id: "customer-1",
        item_id: "course-item-1",
        expire_date: EXPIRY,
        status: { in: ["RESERVED", "USED"] },
      },
      _sum: { amount: true },
    });
    expect(groupBy.mock.calls[0]?.[0].where).not.toHaveProperty("branch_id");
  });

  it("preserves missing and ambiguous lot-expiry evidence for server validation", async () => {
    const queryRaw = jest.fn().mockResolvedValue([
      {
        lot_id: "LOT-1",
        in_stock: new Prisma.Decimal(10),
        expiry_count: 1n,
        expiry_at: EXPIRY,
        inventory_updated_at: NOW,
      },
      {
        lot_id: "LOT-2",
        in_stock: null,
        expiry_count: 2n,
        expiry_at: null,
        inventory_updated_at: null,
      },
    ]);
    const module = await Test.createTestingModule({
      providers: [
        OpdCourseReservationRepository,
        { provide: PrismaService, useValue: { $queryRaw: queryRaw } },
      ],
    }).compile();
    const repository = module.get(OpdCourseReservationRepository);

    await expect(repository.findLots("product-1", SCOPE)).resolves.toEqual([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(10),
        expiryCount: 1,
        expiryAt: EXPIRY,
        inventoryUpdatedAt: NOW,
      },
      {
        lotId: "LOT-2",
        inStock: new Prisma.Decimal(0),
        expiryCount: 2,
        expiryAt: null,
        inventoryUpdatedAt: null,
      },
    ]);
  });
});
