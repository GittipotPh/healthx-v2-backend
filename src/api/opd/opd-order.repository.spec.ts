import { Test } from "@nestjs/testing";
import { Prisma, role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  OpdClinicalCatalogCategory,
  OpdOrderSourceType,
} from "./dto/opd-order.dto";
import type { OpdCatalogRecord } from "./opd-order.mapper";
import { OpdOrderRepository } from "./opd-order.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-07-23T09:00:00.000Z");

describe("OpdOrderRepository", () => {
  it("scopes order reads through encounter, clinic, and branch identity", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        OpdOrderRepository,
        {
          provide: PrismaService,
          useValue: { opd_order: { findFirst } },
        },
      ],
    }).compile();
    const repository = module.get(OpdOrderRepository);

    await repository.findDraftOrder(ENCOUNTER_ID, SCOPE);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        encounter_id: ENCOUNTER_ID,
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
      },
      include: {
        items: {
          orderBy: { display_order: "asc" },
          include: { medication_instruction: true },
        },
        release: {
          include: { prescription_link: true, sale_link: true },
        },
      },
    });
  });

  it("carries both tenant scope and expected aggregate version in recalculation", async () => {
    const aggregate = jest.fn().mockResolvedValue({
      _sum: { gross_amount: null },
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [OpdOrderRepository, { provide: PrismaService, useValue: {} }],
    }).compile();
    const repository = module.get(OpdOrderRepository);
    const tx = {
      opd_order_item: { aggregate },
      opd_order: { updateMany },
    };

    await repository.recalculateAndBumpOrder(
      ORDER_ID,
      ENCOUNTER_ID,
      7,
      SCOPE,
      new Date("2026-07-21T03:00:00.000Z"),
      tx,
    );

    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order_id: ORDER_ID,
          encounter_id: ENCOUNTER_ID,
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          status: "ACTIVE",
        },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order_id: ORDER_ID,
          encounter_id: ENCOUNTER_ID,
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          status: "DRAFT",
          version: 7,
        },
      }),
    );
  });

  it("lets the nested order-item relation derive medication tenant keys", async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ order_item_id: "order-item-1" });
    const module = await Test.createTestingModule({
      providers: [OpdOrderRepository, { provide: PrismaService, useValue: {} }],
    }).compile();
    const repository = module.get(OpdOrderRepository);
    const source: OpdCatalogRecord = {
      sourceType: OpdOrderSourceType.PRODUCT,
      sourceId: "product-1",
      sourceParentId: null,
      code: "MED-001",
      category: OpdClinicalCatalogCategory.MEDICINE,
      name: "Medicine",
      description: null,
      unit: "tablet",
      basePrice: new Prisma.Decimal(12),
      effectivePrice: new Prisma.Decimal(12),
      pricingSource: "BASE",
      taxType: "NO_VAT",
      stockQuantity: new Prisma.Decimal(20),
      stockAlertAt: 5,
      categoryName: "Medicine",
      subCategoryName: "Oral",
      maximumDiscount: null,
      maximumDiscountUnit: null,
      isGlobal: false,
      updatedAt: NOW,
    };

    await repository.createItem(
      ORDER_ID,
      ENCOUNTER_ID,
      1,
      source,
      new Prisma.Decimal(12),
      {
        expectedOrderVersion: 1,
        sourceType: OpdOrderSourceType.PRODUCT,
        sourceId: source.sourceId,
        quantity: 2,
        medicationInstruction: {
          sigText: "Take one tablet daily",
          dose: "10 mg",
        },
      },
      new Prisma.Decimal(24),
      SCOPE,
      NOW,
      {
        opd_order_item: { create },
      } as unknown as Prisma.TransactionClient,
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        encounter_id: ENCOUNTER_ID,
        order_id: ORDER_ID,
        medication_instruction: {
          create: expect.not.objectContaining({
            clinic_id: expect.anything(),
            branch_id: expect.anything(),
            encounter_id: expect.anything(),
            order_id: expect.anything(),
          }),
        },
      }),
    });
  });
});
