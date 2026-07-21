import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  OpdClinicalCatalogCategory,
  OpdOrderSourceType,
} from "./dto/opd-order.dto";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import { OpdOrderRepository } from "./opd-order.repository";
import { OpdOrderService } from "./opd-order.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };
const NOW = new Date("2026-07-21T03:00:00.000Z");
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";

const ENCOUNTER = {
  encounter_id: ENCOUNTER_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  workflow_status: "OPEN",
  clinical_record_status: "DRAFT",
  version: 4,
  updated_at: NOW,
};

const MEDICATION_INSTRUCTION = {
  medication_instruction_id: "44444444-4444-4444-8444-444444444444",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  order_id: ORDER_ID,
  order_item_id: ITEM_ID,
  dose: "1 tablet",
  route: "oral",
  frequency: "twice daily",
  timing: "after meals",
  duration_value: new Prisma.Decimal(5),
  duration_unit: "DAY",
  sig_text: "Take one tablet twice daily after meals",
  note: null,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
};

const ITEM = {
  order_item_id: ITEM_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  order_id: ORDER_ID,
  display_order: 1,
  source_type: "PRODUCT",
  source_id: "product-1",
  source_parent_id: null,
  source_code: "MED-001",
  category: "MEDICINE",
  name_snapshot: "Paracetamol 500 mg",
  description_snapshot: null,
  unit_snapshot: "tablet",
  quantity: new Prisma.Decimal(10),
  unit_price_amount: new Prisma.Decimal(2.5),
  pricing_source: "BASE",
  tax_type_snapshot: "NO_VAT",
  gross_amount: new Prisma.Decimal(25),
  discount_amount: new Prisma.Decimal(0),
  tax_amount: new Prisma.Decimal(0),
  net_amount: new Prisma.Decimal(25),
  note: null,
  status: "ACTIVE",
  version: 2,
  void_reason: null,
  voided_by: null,
  voided_at: null,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
  medication_instruction: MEDICATION_INSTRUCTION,
};

const ORDER = {
  order_id: ORDER_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  status: "DRAFT",
  currency: "THB",
  subtotal_amount: new Prisma.Decimal(25),
  discount_total_amount: new Prisma.Decimal(0),
  tax_total_amount: new Prisma.Decimal(0),
  net_total_amount: new Prisma.Decimal(25),
  version: 2,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
  items: [ITEM],
};

const CATALOG_ITEM = {
  sourceType: OpdOrderSourceType.PRODUCT,
  sourceId: "product-1",
  sourceParentId: null,
  code: "MED-001",
  category: OpdClinicalCatalogCategory.MEDICINE,
  name: "Paracetamol 500 mg",
  description: null,
  unit: "tablet",
  basePrice: new Prisma.Decimal("2.50"),
  effectivePrice: new Prisma.Decimal("2.50"),
  pricingSource: "BASE" as const,
  taxType: "NO_VAT" as const,
  stockQuantity: new Prisma.Decimal(100),
  stockAlertAt: 10,
  categoryName: "Medicine",
  subCategoryName: null,
  maximumDiscount: null,
  maximumDiscountUnit: null,
  isGlobal: false,
  updatedAt: NOW,
};

async function makeService() {
  const tx = { id: "transaction-client" };
  const repository = {
    listCatalog: jest
      .fn()
      .mockResolvedValue({ items: [CATALOG_ITEM], total: 1 }),
    findCatalogItem: jest.fn().mockResolvedValue(CATALOG_ITEM),
    findDraftOrder: jest.fn().mockResolvedValue(ORDER),
    lockOrder: jest.fn().mockResolvedValue(true),
    createDraftOrder: jest.fn().mockResolvedValue(ORDER),
    nextItemDisplayOrder: jest.fn().mockResolvedValue(2),
    createItem: jest.fn().mockResolvedValue(ITEM_ID),
    updateItem: jest.fn().mockResolvedValue(true),
    voidItem: jest.fn().mockResolvedValue(true),
    recalculateAndBumpOrder: jest.fn().mockResolvedValue(true),
  };
  const clinicalRepository = {
    findEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
    lockEncounter: jest.fn().mockResolvedValue(true),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue({}) };
  const module = await Test.createTestingModule({
    providers: [
      OpdOrderService,
      { provide: OpdOrderRepository, useValue: repository },
      { provide: OpdClinicalRepository, useValue: clinicalRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLogService },
    ],
  }).compile();
  return {
    service: module.get(OpdOrderService),
    repository,
    clinicalRepository,
    auditLogService,
    tx,
  };
}

describe("OpdOrderService", () => {
  it("returns only the scoped catalog page with server-owned orderability", async () => {
    const { service, repository } = await makeService();

    const result = await service.catalog(
      { search: "para", page: 2, pageSize: 10 },
      SCOPE,
    );

    expect(repository.listCatalog).toHaveBeenCalledWith(
      { search: "para", page: 2, pageSize: 10 },
      SCOPE,
    );
    expect(result).toEqual(
      expect.objectContaining({
        total: 1,
        page: 2,
        pageSize: 10,
        pricingPolicy: "catalog-snapshot-v1",
        releaseAvailable: true,
      }),
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({ canOrder: true, effectivePrice: 2.5 }),
    );
  });

  it("resumes the single encounter order without creating or auditing twice", async () => {
    const { service, repository, auditLogService } = await makeService();

    const result = await service.createDraftOrder(
      ENCOUNTER_ID,
      SCOPE,
      PRINCIPAL,
    );

    expect(result.resumed).toBe(true);
    expect(result.order.orderId).toBe(ORDER_ID);
    expect(repository.createDraftOrder).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("creates and audits a new order in the encounter transaction", async () => {
    const { service, repository, auditLogService, tx } = await makeService();
    repository.findDraftOrder.mockResolvedValueOnce(null);

    const result = await service.createDraftOrder(
      ENCOUNTER_ID,
      SCOPE,
      PRINCIPAL,
    );

    expect(result.resumed).toBe(false);
    expect(repository.createDraftOrder).toHaveBeenCalledWith(
      ENCOUNTER_ID,
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "order.draft.create" }),
      tx,
    );
  });

  it("snapshots catalog pricing and audits a medication item atomically", async () => {
    const { service, repository, auditLogService, tx } = await makeService();
    const dto = {
      expectedOrderVersion: 2,
      sourceType: OpdOrderSourceType.PRODUCT,
      sourceId: "product-1",
      quantity: 10,
      medicationInstruction: {
        sigText: "Take one tablet twice daily after meals",
        durationValue: 5,
        durationUnit: "DAY",
      },
    };

    await service.addItem(ENCOUNTER_ID, ORDER_ID, dto, SCOPE, PRINCIPAL);

    expect(repository.createItem).toHaveBeenCalledWith(
      ORDER_ID,
      ENCOUNTER_ID,
      2,
      CATALOG_ITEM,
      expect.any(Prisma.Decimal),
      dto,
      expect.any(Prisma.Decimal),
      SCOPE,
      expect.any(Date),
      tx,
    );
    const createCall = repository.createItem.mock.calls[0];
    expect(createCall[4].toFixed(2)).toBe("2.50");
    expect(createCall[6].toFixed(2)).toBe("25.00");
    expect(repository.recalculateAndBumpOrder).toHaveBeenCalledWith(
      ORDER_ID,
      ENCOUNTER_ID,
      2,
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "order.item.create" }),
      tx,
    );
  });

  it("rejects medication items without an instruction before writing", async () => {
    const { service, repository } = await makeService();

    await expect(
      service.addItem(
        ENCOUNTER_ID,
        ORDER_ID,
        {
          expectedOrderVersion: 2,
          sourceType: OpdOrderSourceType.PRODUCT,
          sourceId: "product-1",
          quantity: 1,
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.createItem).not.toHaveBeenCalled();
  });

  it("returns stable order conflict metadata for a stale aggregate write", async () => {
    const { service, repository } = await makeService();

    let caught: unknown;
    try {
      await service.addItem(
        ENCOUNTER_ID,
        ORDER_ID,
        {
          expectedOrderVersion: 1,
          sourceType: OpdOrderSourceType.PRODUCT,
          sourceId: "product-1",
          quantity: 1,
          medicationInstruction: { sigText: "Take once" },
        },
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VersionConflictException);
    if (!(caught instanceof VersionConflictException)) throw caught;
    expect(caught.getResponse()).toEqual(
      expect.objectContaining({
        resourceType: "OPD_ORDER",
        resourceId: ORDER_ID,
        currentVersion: 2,
      }),
    );
    expect(repository.findCatalogItem).not.toHaveBeenCalled();
  });

  it("rejects an independently stale order item version", async () => {
    const { service, repository } = await makeService();

    await expect(
      service.patchItem(
        ENCOUNTER_ID,
        ORDER_ID,
        ITEM_ID,
        {
          expectedOrderVersion: 2,
          expectedItemVersion: 1,
          quantity: 20,
          medicationInstruction: { sigText: "Take once" },
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(VersionConflictException);
    expect(repository.updateItem).not.toHaveBeenCalled();
  });

  it("voids an active item, recalculates the aggregate, and preserves audit", async () => {
    const { service, repository, auditLogService, tx } = await makeService();

    await service.voidItem(
      ENCOUNTER_ID,
      ORDER_ID,
      ITEM_ID,
      {
        expectedOrderVersion: 2,
        expectedItemVersion: 2,
        reason: " changed treatment plan ",
      },
      SCOPE,
      PRINCIPAL,
    );

    expect(repository.voidItem).toHaveBeenCalledWith(
      ORDER_ID,
      ENCOUNTER_ID,
      ITEM_ID,
      2,
      "changed treatment plan",
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "order.item.void" }),
      tx,
    );
  });

  it("conceals an out-of-scope encounter before looking up its order", async () => {
    const { service, repository, clinicalRepository } = await makeService();
    clinicalRepository.lockEncounter.mockResolvedValue(false);

    await expect(
      service.voidItem(
        ENCOUNTER_ID,
        ORDER_ID,
        ITEM_ID,
        { expectedOrderVersion: 2, expectedItemVersion: 2 },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(repository.lockOrder).not.toHaveBeenCalled();
  });

  it("does not mutate an order after the encounter is no longer editable", async () => {
    const { service, repository, clinicalRepository } = await makeService();
    clinicalRepository.findEncounter.mockResolvedValue({
      ...ENCOUNTER,
      workflow_status: "POST_VISIT",
    });

    await expect(
      service.voidItem(
        ENCOUNTER_ID,
        ORDER_ID,
        ITEM_ID,
        { expectedOrderVersion: 2, expectedItemVersion: 2 },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.voidItem).not.toHaveBeenCalled();
  });

  it("surfaces audit failure so the transaction can roll back the item", async () => {
    const { service, auditLogService } = await makeService();
    auditLogService.create.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.voidItem(
        ENCOUNTER_ID,
        ORDER_ID,
        ITEM_ID,
        { expectedOrderVersion: 2, expectedItemVersion: 2 },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow("audit unavailable");
  });
});
