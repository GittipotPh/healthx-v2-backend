import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Prisma, role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { resetBackendEnvForTest } from "../../env";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { VersionConflictException } from "../../common/version-conflict.exception";
import type { ReleaseOpdOrderDto } from "./dto/opd-order-release.dto";
import {
  OpdClinicalCatalogCategory,
  OpdOrderSourceType,
} from "./dto/opd-order.dto";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import type { OpdOrderReleaseRecord } from "./opd-order-release.mapper";
import { OpdOrderReleaseRepository } from "./opd-order-release.repository";
import { OpdOrderReleaseService } from "./opd-order-release.service";
import type { OpdOrderRecord } from "./opd-order.mapper";
import { OpdOrderRepository } from "./opd-order.repository";

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
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };
const TX = { transaction: true };

const ENCOUNTER = {
  encounter_id: ENCOUNTER_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  appointment_id: "appointment-1",
  customer_id: "customer-1",
  legacy_opd_id: "legacy-opd-1",
  attending_user_id: "doctor-1",
  workflow_status: "OPEN",
  clinical_record_status: "DRAFT",
  version: 4,
  started_by: SCOPE.userId,
  started_at: NOW,
  created_at: NOW,
  updated_at: NOW,
};

const MEDICATION_INSTRUCTION: NonNullable<
  OpdOrderRecord["items"][number]["medication_instruction"]
> = {
  medication_instruction_id: "55555555-5555-4555-8555-555555555555",
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

const ITEM: OpdOrderRecord["items"][number] = {
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
  unit_price_amount: new Prisma.Decimal("2.50"),
  pricing_source: "PROMOTION",
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

function orderModel(
  status: "DRAFT" | "RELEASED" | "VOIDED" = "DRAFT",
): OpdOrderReleaseRecord["order"] {
  return {
    order_id: ORDER_ID,
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    encounter_id: ENCOUNTER_ID,
    status,
    currency: "THB",
    subtotal_amount: new Prisma.Decimal(status === "DRAFT" ? 25 : 30),
    discount_total_amount: new Prisma.Decimal(status === "DRAFT" ? 0 : 5),
    tax_total_amount: new Prisma.Decimal(0),
    net_total_amount: new Prisma.Decimal(25),
    version: status === "DRAFT" ? 2 : status === "RELEASED" ? 3 : 4,
    released_by: status === "DRAFT" ? null : SCOPE.userId,
    released_at: status === "DRAFT" ? null : NOW,
    voided_by: status === "VOIDED" ? SCOPE.userId : null,
    voided_at: status === "VOIDED" ? NOW : null,
    void_reason: status === "VOIDED" ? "Entered in error" : null,
    created_by: SCOPE.userId,
    updated_by: SCOPE.userId,
    created_at: NOW,
    updated_at: NOW,
  };
}

function order(
  status: "DRAFT" | "RELEASED" | "VOIDED" = "DRAFT",
): OpdOrderRecord {
  return {
    ...orderModel(status),
    items: [ITEM],
    release: null,
  };
}

const CATALOG_ITEM = {
  sourceType: OpdOrderSourceType.PRODUCT,
  sourceId: "product-1",
  sourceParentId: null,
  code: "MED-001",
  category: OpdClinicalCatalogCategory.MEDICINE,
  name: "Paracetamol 500 mg",
  description: null,
  unit: "tablet",
  basePrice: new Prisma.Decimal(3),
  effectivePrice: new Prisma.Decimal("2.50"),
  pricingSource: "PROMOTION" as const,
  taxType: "NO_VAT" as const,
  stockQuantity: new Prisma.Decimal(20),
  stockAlertAt: 5,
  categoryName: "Medicine",
  subCategoryName: null,
  maximumDiscount: null,
  maximumDiscountUnit: null,
  isGlobal: false,
  updatedAt: NOW,
};

function releaseRecord(
  status: "RELEASED" | "VOIDED" = "RELEASED",
): OpdOrderReleaseRecord {
  return {
    release_id: RELEASE_ID,
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    encounter_id: ENCOUNTER_ID,
    order_id: ORDER_ID,
    request_hash: "a".repeat(64),
    idempotency_key_hash: "b".repeat(64),
    source_order_version: 2,
    result_order_version: 3,
    item_version_manifest: [{ orderItemId: ITEM_ID, version: 2 }],
    currency: "THB",
    subtotal_amount: new Prisma.Decimal(30),
    promotion_discount_amount: new Prisma.Decimal(5),
    tax_amount: new Prisma.Decimal(0),
    net_total_amount: new Prisma.Decimal(25),
    pricing_policy: "opd-medication-release-price-v1",
    tax_policy: "opd-medication-no-vat-v1",
    safety_source: "LEGACY_CUSTOMER_INFO_UNVERIFIED",
    safety_snapshot_hash: "c".repeat(64),
    safety_acknowledged_by: SCOPE.userId,
    safety_acknowledged_at: NOW,
    prescriber_user_id: "doctor-1",
    released_by: SCOPE.userId,
    released_at: NOW,
    created_at: NOW,
    order: orderModel(status),
    items: [],
    prescription_link: {
      prescription_link_id: "77777777-7777-4777-8777-777777777777",
      clinic_id: SCOPE.clinicId,
      branch_id: SCOPE.branchId,
      encounter_id: ENCOUNTER_ID,
      order_id: ORDER_ID,
      release_id: RELEASE_ID,
      legacy_prescribe_id: "prescription-1",
      legacy_opd_id: "legacy-opd-1",
      customer_id: "customer-1",
      prescription_status_snapshot: "WAITING",
      created_at: NOW,
    },
    sale_link: {
      sale_link_id: "88888888-8888-4888-8888-888888888888",
      clinic_id: SCOPE.clinicId,
      branch_id: SCOPE.branchId,
      encounter_id: ENCOUNTER_ID,
      order_id: ORDER_ID,
      release_id: RELEASE_ID,
      legacy_sale_order_id: "SO-0001",
      customer_id: "customer-1",
      sale_order_status_snapshot: "PENDING",
      created_at: NOW,
    },
  };
}

function claim(overrides: Record<string, unknown> = {}) {
  return {
    api_idempotency_id: "66666666-6666-4666-8666-666666666666",
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    actor_user_id: SCOPE.userId,
    operation: "opd.order.medication.release.v1",
    idempotency_key: "release-key-1",
    request_hash: "a".repeat(64),
    state: "IN_PROGRESS",
    locked_at: NOW,
    lock_expires_at: NOW,
    resource_type: "OPD_ORDER_RELEASE",
    resource_id: ORDER_ID,
    result_snapshot: null,
    response_code: null,
    completed_at: null,
    expires_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

async function makeService(initialOrder: OpdOrderRecord = order()) {
  let lastIdempotencyRequestHash: string | null = null;
  const repository = {
    findIdempotency: jest.fn().mockResolvedValue(null),
    createIdempotency: jest
      .fn()
      .mockImplementation((input: { requestHash: string }) => {
        lastIdempotencyRequestHash = input.requestHash;
        return Promise.resolve(claim());
      }),
    completeIdempotency: jest.fn().mockResolvedValue(undefined),
    lockActiveItems: jest.fn().mockResolvedValue([ITEM_ID]),
    lockSourceProducts: jest.fn().mockResolvedValue(1),
    findAllergyText: jest.fn().mockResolvedValue({ allergy: "Penicillin" }),
    findLegacyOpd: jest.fn().mockResolvedValue({ opd_id: "legacy-opd-1" }),
    hasExistingLegacyPrescription: jest.fn().mockResolvedValue(false),
    isValidAttendingDoctor: jest.fn().mockResolvedValue(true),
    findReleaseByOrder: jest.fn().mockResolvedValue(null),
    findLots: jest.fn().mockResolvedValue([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(20),
        expiryCount: 1,
        expiryAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    ]),
    allocateSaleOrderNumber: jest.fn().mockResolvedValue("SO-0001"),
    createRelease: jest.fn().mockResolvedValue(RELEASE_ID),
    markOrderReleased: jest.fn().mockResolvedValue(true),
    lockRelease: jest.fn().mockResolvedValue(true),
    lockLegacyDownstream: jest.fn().mockResolvedValue(undefined),
    downstreamProgression: jest.fn().mockResolvedValue({
      prescriptionStatus: "WAITING",
      saleOrderStatus: "PENDING",
      saleRecordStatus: "ACTIVE",
      receiptCount: 0,
      inventoryMovementCount: 0,
      customerCourseCount: 0,
      saleDocumentCount: 0,
      saleUserCount: 0,
    }),
    voidDownstreamAndOrder: jest.fn().mockResolvedValue(true),
  };
  const orderRepository = {
    findDraftOrder: jest.fn().mockResolvedValue(initialOrder),
    findCatalogItem: jest.fn().mockResolvedValue(CATALOG_ITEM),
    lockOrder: jest.fn().mockResolvedValue(true),
  };
  const clinicalRepository = {
    findEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
    lockEncounter: jest.fn().mockResolvedValue(true),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof TX) => Promise<unknown>) => callback(TX),
    ),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue({}) };
  const module = await Test.createTestingModule({
    providers: [
      OpdOrderReleaseService,
      { provide: OpdOrderReleaseRepository, useValue: repository },
      { provide: OpdOrderRepository, useValue: orderRepository },
      { provide: OpdClinicalRepository, useValue: clinicalRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLogService },
    ],
  }).compile();
  return {
    service: module.get(OpdOrderReleaseService),
    repository,
    orderRepository,
    clinicalRepository,
    prisma,
    auditLogService,
    getLastIdempotencyRequestHash: () => lastIdempotencyRequestHash,
  };
}

function preflightDto() {
  return {
    expectedOrderVersion: 2,
    itemVersions: [{ orderItemId: ITEM_ID, version: 2 }],
    selectedLots: [{ orderItemId: ITEM_ID, lotId: "LOT-1" }],
  };
}

async function eligibleRelease(
  fixture: Awaited<ReturnType<typeof makeService>>,
): Promise<ReleaseOpdOrderDto> {
  const preflight = await fixture.service.preflight(
    ENCOUNTER_ID,
    ORDER_ID,
    preflightDto(),
    SCOPE,
  );
  if (!preflight.preflightToken) throw new Error("Expected eligible preflight");
  return {
    ...preflightDto(),
    preflightToken: preflight.preflightToken,
    safetyAcknowledgement: {
      safetySnapshotHash: preflight.safety.safetySnapshotHash,
      acknowledged: true,
    },
  };
}

function conflictResponse(error: unknown): Record<string, unknown> {
  if (!(error instanceof ConflictException)) throw error;
  const response = error.getResponse();
  if (
    typeof response !== "object" ||
    response === null ||
    Array.isArray(response)
  ) {
    throw new Error("Expected a structured conflict response");
  }
  return Object.fromEntries(Object.entries(response));
}

describe("OpdOrderReleaseService", () => {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const previousJwtSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
    process.env.JWT_SECRET = "test-secret-that-is-at-least-32-characters";
    resetBackendEnvForTest();
  });

  afterAll(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
    if (previousJwtSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousJwtSecret;
    resetBackendEnvForTest();
  });

  it("returns server-priced promotion totals, lot evidence, and an explicit no-reservation warning", async () => {
    const fixture = await makeService();

    const result = await fixture.service.preflight(
      ENCOUNTER_ID,
      ORDER_ID,
      preflightDto(),
      SCOPE,
    );

    expect(result).toMatchObject({
      eligible: true,
      blockers: [],
      totals: {
        currency: "THB",
        subtotalAmount: 30,
        promotionDiscountAmount: 5,
        taxAmount: 0,
        netTotalAmount: 25,
      },
      selectedLots: [{ orderItemId: ITEM_ID, lotId: "LOT-1" }],
      inventoryReserved: false,
      safety: {
        allergyText: "Penicillin",
        acknowledgementRequired: true,
        isDrugInteractionCheck: false,
      },
    });
    expect(result.preflightToken).toEqual(expect.any(String));
    expect(fixture.repository.findLots).toHaveBeenCalledWith(
      "product-1",
      SCOPE,
      TX,
    );
  });

  it("conceals out-of-scope encounters and wrong order identities before any release write", async () => {
    const outOfScope = await makeService();
    outOfScope.clinicalRepository.findEncounter.mockResolvedValue(null);

    await expect(
      outOfScope.service.preflight(
        ENCOUNTER_ID,
        ORDER_ID,
        preflightDto(),
        SCOPE,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const wrongOrder = await makeService();
    await expect(
      wrongOrder.service.preflight(
        ENCOUNTER_ID,
        "99999999-9999-4999-8999-999999999999",
        preflightDto(),
        SCOPE,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(outOfScope.repository.createRelease).not.toHaveBeenCalled();
    expect(wrongOrder.repository.createRelease).not.toHaveBeenCalled();
  });

  it("returns explicit blockers for unsupported medication content and stale manifests", async () => {
    const unsupported = await makeService({
      ...order(),
      items: [
        {
          ...ITEM,
          source_type: "COURSE_ITEM",
          category: "COURSE",
          medication_instruction: null,
        },
      ],
    });
    const unsupportedResult = await unsupported.service.preflight(
      ENCOUNTER_ID,
      ORDER_ID,
      preflightDto(),
      SCOPE,
    );

    expect(unsupportedResult).toMatchObject({
      eligible: false,
      preflightToken: null,
      blockers: [expect.objectContaining({ code: "UNSUPPORTED_ITEM" })],
    });

    const stale = await makeService();
    const staleResult = await stale.service.preflight(
      ENCOUNTER_ID,
      ORDER_ID,
      {
        ...preflightDto(),
        expectedOrderVersion: 1,
        itemVersions: [{ orderItemId: ITEM_ID, version: 1 }],
      },
      SCOPE,
    );

    expect(staleResult.eligible).toBe(false);
    expect(staleResult.preflightToken).toBeNull();
    expect(staleResult.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "ORDER_VERSION_CONFLICT" }),
        expect.objectContaining({ code: "ITEM_VERSION_MANIFEST_MISMATCH" }),
      ]),
    );
  });

  it.each([
    {
      name: "missing expiry",
      lot: { inStock: 20, expiryCount: 0, expiryAt: null },
      code: "LOT_EXPIRY_MISSING",
    },
    {
      name: "ambiguous expiry",
      lot: {
        inStock: 20,
        expiryCount: 2,
        expiryAt: new Date("2099-01-01T00:00:00.000Z"),
      },
      code: "LOT_EXPIRY_AMBIGUOUS",
    },
    {
      name: "expired stock",
      lot: {
        inStock: 20,
        expiryCount: 1,
        expiryAt: new Date("2000-01-01T00:00:00.000Z"),
      },
      code: "LOT_EXPIRED",
    },
    {
      name: "insufficient stock",
      lot: {
        inStock: 5,
        expiryCount: 1,
        expiryAt: new Date("2099-01-01T00:00:00.000Z"),
      },
      code: "INSUFFICIENT_STOCK",
    },
  ])("blocks a selected lot with $name", async ({ lot, code }) => {
    const fixture = await makeService();
    fixture.repository.findLots.mockResolvedValue([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(lot.inStock),
        expiryCount: lot.expiryCount,
        expiryAt: lot.expiryAt,
      },
    ]);

    const result = await fixture.service.preflight(
      ENCOUNTER_ID,
      ORDER_ID,
      preflightDto(),
      SCOPE,
    );

    expect(result.eligible).toBe(false);
    expect(result.preflightToken).toBeNull();
    expect(result.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  });

  it("creates the release, downstream rows, audit, and canonical result in one transaction", async () => {
    const fixture = await makeService();
    const dto = await eligibleRelease(fixture);
    fixture.repository.findReleaseByOrder.mockReset();
    fixture.repository.findReleaseByOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(releaseRecord());

    const result = await fixture.service.release(
      ENCOUNTER_ID,
      ORDER_ID,
      dto,
      "release-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toMatchObject({
      releaseId: RELEASE_ID,
      orderStatus: "RELEASED",
      orderVersion: 3,
      prescriptionId: "prescription-1",
      prescriptionStatus: "WAITING",
      saleOrderId: "SO-0001",
      saleOrderStatus: "PENDING",
      inventoryReserved: false,
      inventoryDeducted: false,
    });
    expect(fixture.repository.createRelease).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        legacyOpdId: "legacy-opd-1",
        sourceOrderVersion: 2,
        subtotalAmount: new Prisma.Decimal(30),
        promotionDiscountAmount: new Prisma.Decimal(5),
        netTotalAmount: new Prisma.Decimal(25),
      }),
      SCOPE,
      expect.any(Date),
      TX,
    );
    expect(fixture.repository.markOrderReleased).toHaveBeenCalledWith(
      expect.any(Object),
      SCOPE,
      expect.any(Date),
      TX,
    );
    expect(fixture.auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "order.medication.release",
        fromStatus: "DRAFT",
        toStatus: "RELEASED",
      }),
      TX,
    );
    expect(fixture.repository.completeIdempotency).toHaveBeenCalledWith(
      expect.any(String),
      RELEASE_ID,
      expect.any(Object),
      201,
      expect.any(Date),
      TX,
    );
  });

  it("replays the canonical success and rejects a reused key with a different request", async () => {
    const fixture = await makeService();
    const dto = await eligibleRelease(fixture);
    fixture.repository.findReleaseByOrder.mockReset();
    fixture.repository.findReleaseByOrder
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(releaseRecord());
    await fixture.service.release(
      ENCOUNTER_ID,
      ORDER_ID,
      dto,
      "release-key-1",
      SCOPE,
      PRINCIPAL,
    );
    const requestHash = fixture.getLastIdempotencyRequestHash();
    if (requestHash === null) {
      throw new Error("Expected the release command to claim idempotency");
    }
    fixture.repository.findIdempotency.mockResolvedValue(
      claim({
        state: "COMPLETED",
        request_hash: requestHash,
        resource_id: RELEASE_ID,
      }),
    );
    fixture.repository.findReleaseByOrder
      .mockReset()
      .mockResolvedValue(releaseRecord());

    const replay = await fixture.service.release(
      ENCOUNTER_ID,
      ORDER_ID,
      dto,
      "release-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(replay.releaseId).toBe(RELEASE_ID);
    expect(fixture.repository.createRelease).toHaveBeenCalledTimes(1);

    let reusedKeyError: unknown;
    try {
      await fixture.service.release(
        ENCOUNTER_ID,
        ORDER_ID,
        { ...dto, preflightToken: `${dto.preflightToken}changed` },
        "release-key-1",
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      reusedKeyError = error;
    }
    expect(conflictResponse(reusedKeyError)).toMatchObject({
      code: "IDEMPOTENCY_KEY_REUSED",
    });
  });

  it("returns replacement totals and performs no release when the promotion changes", async () => {
    const fixture = await makeService();
    const dto = await eligibleRelease(fixture);
    fixture.orderRepository.findCatalogItem.mockResolvedValue({
      ...CATALOG_ITEM,
      effectivePrice: new Prisma.Decimal(2),
    });

    let thrown: unknown;
    try {
      await fixture.service.release(
        ENCOUNTER_ID,
        ORDER_ID,
        dto,
        "release-key-1",
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      thrown = error;
    }

    expect(conflictResponse(thrown)).toMatchObject({
      code: "REPRICE_REQUIRED",
      details: {
        blockers: [{ code: "REPRICE_REQUIRED", orderItemId: ITEM_ID }],
        replacementTotals: {
          subtotalAmount: 30,
          promotionDiscountAmount: 10,
          netTotalAmount: 20,
        },
      },
    });
    expect(fixture.repository.createRelease).not.toHaveBeenCalled();
    expect(fixture.repository.completeIdempotency).not.toHaveBeenCalled();
  });

  it("rejects stale order and item versions without creating downstream rows", async () => {
    const staleOrder = await makeService();
    const staleOrderDto = await eligibleRelease(staleOrder);

    await expect(
      staleOrder.service.release(
        ENCOUNTER_ID,
        ORDER_ID,
        { ...staleOrderDto, expectedOrderVersion: 1 },
        "release-key-1",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(VersionConflictException);
    expect(staleOrder.repository.createRelease).not.toHaveBeenCalled();

    const staleItem = await makeService();
    const staleItemDto = await eligibleRelease(staleItem);
    await expect(
      staleItem.service.release(
        ENCOUNTER_ID,
        ORDER_ID,
        {
          ...staleItemDto,
          itemVersions: [{ orderItemId: ITEM_ID, version: 1 }],
        },
        "release-key-2",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(VersionConflictException);
    expect(staleItem.repository.createRelease).not.toHaveBeenCalled();
  });

  it("requires a fresh safety acknowledgement when legacy allergy text changes", async () => {
    const fixture = await makeService();
    const dto = await eligibleRelease(fixture);
    fixture.repository.findAllergyText.mockResolvedValue({ allergy: "Latex" });

    let thrown: unknown;
    try {
      await fixture.service.release(
        ENCOUNTER_ID,
        ORDER_ID,
        dto,
        "release-key-1",
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      thrown = error;
    }

    expect(conflictResponse(thrown)).toMatchObject({
      code: "SAFETY_REVIEW_REQUIRED",
      details: { safetySnapshotHash: expect.any(String) },
    });
    expect(fixture.repository.createRelease).not.toHaveBeenCalled();
    expect(fixture.repository.completeIdempotency).not.toHaveBeenCalled();
  });

  it("revalidates stock inside release and rejects a lot that became insufficient", async () => {
    const fixture = await makeService();
    const dto = await eligibleRelease(fixture);
    fixture.repository.findLots.mockResolvedValue([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(5),
        expiryCount: 1,
        expiryAt: new Date("2099-01-01T00:00:00.000Z"),
      },
    ]);

    let thrown: unknown;
    try {
      await fixture.service.release(
        ENCOUNTER_ID,
        ORDER_ID,
        dto,
        "release-key-1",
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      thrown = error;
    }

    expect(conflictResponse(thrown)).toMatchObject({
      code: "RELEASE_BLOCKED",
      details: {
        blockers: [expect.objectContaining({ code: "INSUFFICIENT_STOCK" })],
      },
    });
    expect(fixture.repository.createRelease).not.toHaveBeenCalled();
  });

  it("propagates audit failure so the transaction cannot complete idempotency", async () => {
    const fixture = await makeService();
    const dto = await eligibleRelease(fixture);
    fixture.auditLogService.create.mockRejectedValue(
      new Error("audit write failed"),
    );

    await expect(
      fixture.service.release(
        ENCOUNTER_ID,
        ORDER_ID,
        dto,
        "release-key-1",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow("audit write failed");

    expect(fixture.repository.createRelease).toHaveBeenCalled();
    expect(fixture.repository.completeIdempotency).not.toHaveBeenCalled();
    expect(fixture.auditLogService.create).toHaveBeenCalledWith(
      expect.any(Object),
      TX,
    );
  });

  it("converges a concurrent idempotency claim on the one canonical release", async () => {
    const fixture = await makeService();
    const dto = await eligibleRelease(fixture);
    const duplicateClaim = new Prisma.PrismaClientKnownRequestError(
      "Concurrent idempotency claim",
      {
        code: "P2002",
        clientVersion: "test",
        meta: { target: ["api_idempotency_operation_key_uq"] },
      },
    );
    let racedRequestHash: string | null = null;
    fixture.repository.createIdempotency.mockImplementation(
      (input: { requestHash: string }) => {
        racedRequestHash = input.requestHash;
        return Promise.reject(duplicateClaim);
      },
    );
    fixture.repository.findIdempotency
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockImplementation(() =>
        Promise.resolve(
          racedRequestHash
            ? claim({
                state: "COMPLETED",
                request_hash: racedRequestHash,
                resource_id: RELEASE_ID,
              })
            : null,
        ),
      );
    fixture.repository.findReleaseByOrder.mockResolvedValue(releaseRecord());

    const result = await fixture.service.release(
      ENCOUNTER_ID,
      ORDER_ID,
      dto,
      "release-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result.releaseId).toBe(RELEASE_ID);
    expect(fixture.repository.createRelease).not.toHaveBeenCalled();
  });

  it("voids only an untouched release and writes the compensation audit in the same transaction", async () => {
    const fixture = await makeService(order("RELEASED"));
    fixture.repository.findReleaseByOrder
      .mockResolvedValueOnce(releaseRecord())
      .mockResolvedValueOnce(releaseRecord("VOIDED"));

    const result = await fixture.service.voidRelease(
      ENCOUNTER_ID,
      ORDER_ID,
      { expectedOrderVersion: 3, reason: " Entered in error " },
      "void-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toMatchObject({
      releaseId: RELEASE_ID,
      orderStatus: "VOIDED",
      orderVersion: 4,
      prescriptionStatus: "CANCEL",
      saleOrderStatus: "DELETED",
      reason: "Entered in error",
    });
    expect(fixture.repository.voidDownstreamAndOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        orderId: ORDER_ID,
        expectedOrderVersion: 3,
        reason: "Entered in error",
      }),
      SCOPE,
      expect.any(Date),
      TX,
    );
    expect(fixture.auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "order.medication-release.void",
        fromStatus: "RELEASED",
        toStatus: "VOIDED",
      }),
      TX,
    );
  });

  it("requires manual compensation after payment or fulfilment progression", async () => {
    const fixture = await makeService(order("RELEASED"));
    fixture.repository.findReleaseByOrder.mockResolvedValue(releaseRecord());
    fixture.repository.downstreamProgression.mockResolvedValue({
      prescriptionStatus: "SUCCESS",
      saleOrderStatus: "PAID",
      saleRecordStatus: "ACTIVE",
      receiptCount: 1,
      inventoryMovementCount: 1,
      customerCourseCount: 0,
      saleDocumentCount: 0,
      saleUserCount: 0,
    });

    let thrown: unknown;
    try {
      await fixture.service.voidRelease(
        ENCOUNTER_ID,
        ORDER_ID,
        { expectedOrderVersion: 3, reason: "Entered in error" },
        "void-key-1",
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      thrown = error;
    }

    expect(conflictResponse(thrown)).toMatchObject({
      code: "COMPENSATION_REQUIRED",
      details: {
        blockers: [
          "PRESCRIPTION_PROGRESS",
          "SALE_ORDER_PROGRESS",
          "RECEIPT_OR_PAYMENT_EXISTS",
          "INVENTORY_MOVEMENT_EXISTS",
        ],
      },
    });
    expect(fixture.repository.voidDownstreamAndOrder).not.toHaveBeenCalled();
  });
});
