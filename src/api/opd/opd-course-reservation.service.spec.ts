import { ConflictException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  Prisma,
  amount_unit,
  operator_type,
  record_status,
  role_enum,
} from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { resetBackendEnvForTest } from "../../env";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { OpdCourseReservationRepository } from "./opd-course-reservation.repository";
import { OpdCourseReservationService } from "./opd-course-reservation.service";

const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const RESERVATION_ID = "22222222-2222-4222-8222-222222222222";
const RESERVATION_ITEM_ID = "33333333-3333-4333-8333-333333333333";
const USAGE_LOG_ID = "usage-log-1";
const LEGACY_USAGE_ITEM_ID = "legacy-usage-item-1";
const EXPIRY = new Date("2099-01-01T00:00:00.000Z");
const NOW = new Date("2026-07-23T03:00:00.000Z");
const TX = { transaction: true };
const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };

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

function entitlement(overrides: Record<string, unknown> = {}) {
  return {
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    customer_id: ENCOUNTER.customer_id,
    sale_order_id: "sale-order-1",
    item_id: "course-item-1",
    amount: new Prisma.Decimal(5),
    expire_date: EXPIRY,
    expire_date_display: EXPIRY,
    created_at: NOW,
    updated_at: NOW,
    sale_order: {
      sale_order_id: "sale-order-1",
      branch_id: SCOPE.branchId,
      clinic_id: SCOPE.clinicId,
      customer_id: ENCOUNTER.customer_id,
      sale_order_status: "PAID",
      status: "ACTIVE",
      date: NOW,
      updated_at: NOW,
    },
    course_item: {
      course_id: "course-1",
      name: "Laser session",
      unit: "session",
      updated_at: NOW,
      course: {
        course_id_display: "COURSE-001",
        course_name: "Laser course",
        updated_at: NOW,
        course_operator: [],
      },
      course_item_product: [],
    },
    ...overrides,
  };
}

function reservationRecord(status: "RESERVED" | "VOIDED" = "RESERVED") {
  return {
    reservation_id: RESERVATION_ID,
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    encounter_id: ENCOUNTER_ID,
    customer_id: ENCOUNTER.customer_id,
    legacy_opd_id: "legacy-opd-1",
    status,
    request_hash: "a".repeat(64),
    idempotency_key_hash: "b".repeat(64),
    source_encounter_version: 4,
    source_balance_manifest: [],
    legacy_service_usage_id: "SU-0001",
    legacy_service_usage_branch_id: SCOPE.branchId,
    legacy_service_usage_status_snapshot: "PENDING",
    reserved_by_user_id: SCOPE.userId,
    reserved_at: NOW,
    voided_by_user_id: status === "VOIDED" ? SCOPE.userId : null,
    voided_at: status === "VOIDED" ? NOW : null,
    void_reason: status === "VOIDED" ? "Entered in error" : null,
    version: status === "VOIDED" ? 2 : 1,
    created_at: NOW,
    updated_at: NOW,
    items: [
      {
        reservation_item_id: RESERVATION_ITEM_ID,
        reservation_id: RESERVATION_ID,
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        encounter_id: ENCOUNTER_ID,
        display_order: 1,
        legacy_service_usage_item_id: LEGACY_USAGE_ITEM_ID,
        legacy_usage_log_id: USAGE_LOG_ID,
        purchase_branch_id: SCOPE.branchId,
        customer_id: ENCOUNTER.customer_id,
        sale_order_id: "sale-order-1",
        course_id: "course-1",
        course_item_id: "course-item-1",
        course_code_snapshot: "COURSE-001",
        course_name_snapshot: "Laser course",
        item_name_snapshot: "Laser session",
        unit_snapshot: "session",
        entitlement_expire_at: EXPIRY,
        display_expire_at: EXPIRY,
        entitlement_amount: new Prisma.Decimal(5),
        before_reserved_amount: new Prisma.Decimal(0),
        before_used_amount: new Prisma.Decimal(0),
        before_remaining_amount: new Prisma.Decimal(5),
        reserved_amount: new Prisma.Decimal(1),
        after_remaining_amount: new Prisma.Decimal(4),
        entitlement_created_at: NOW,
        entitlement_updated_at: NOW,
        sale_order_updated_at: NOW,
        course_updated_at: NOW,
        course_item_updated_at: NOW,
        source_snapshot_hash: "c".repeat(64),
        created_at: NOW,
        components: [],
        operators: [],
      },
    ],
  };
}

function validLegacyState() {
  return {
    serviceUsage: {
      service_usage_id: "SU-0001",
      branch_id: SCOPE.branchId,
      clinic_id: SCOPE.clinicId,
      customer_id: ENCOUNTER.customer_id,
      customer_owner_id: ENCOUNTER.customer_id,
      status: "ACTIVE",
      service_usage_status: "PENDING",
      verify_at: null,
      verify_by: null,
      document_url: null,
      service_usage_request_cancel: null,
      service_usage_item: [
        {
          service_usage_item_id: LEGACY_USAGE_ITEM_ID,
          course_id: "course-item-1",
          item_id: null,
          quantity: new Prisma.Decimal(1),
          expire_date: EXPIRY,
          service_usage_item_product: [],
          service_usage_item_commission: [],
        },
      ],
      course_operator_user: [],
    },
    usageLogs: [
      {
        id: USAGE_LOG_ID,
        service_usage_id: "SU-0001",
        customer_id: ENCOUNTER.customer_id,
        branch_id: SCOPE.branchId,
        clinic_id: SCOPE.clinicId,
        item_id: "course-item-1",
        amount: new Prisma.Decimal(1),
        status: "RESERVED",
        expire_date: EXPIRY,
        course_usage_type: "SERVICE_USAGE",
      },
    ],
    legacyOpd: { management_item: "SU-0001" },
    inventoryMovementCount: 0,
  };
}

function completedClaim(requestHash: string) {
  return {
    api_idempotency_id: "claim-1",
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    actor_user_id: SCOPE.userId,
    operation: "opd.course-entitlement.reserve.v1",
    idempotency_key: "reserve-key-1",
    request_hash: requestHash,
    state: "COMPLETED",
    locked_at: NOW,
    lock_expires_at: NOW,
    resource_type: "OPD_COURSE_RESERVATION",
    resource_id: RESERVATION_ID,
    result_snapshot: {},
    response_code: 201,
    completed_at: NOW,
    expires_at: EXPIRY,
    created_at: NOW,
    updated_at: NOW,
  };
}

async function expectConflict(
  operation: Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await operation;
    throw new Error(`Expected ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(ConflictException);
    if (!(error instanceof ConflictException)) return;
    expect(error.getResponse()).toMatchObject({ code });
  }
}

async function makeService() {
  let currentEntitlement = entitlement();
  let currentReservation = reservationRecord();
  let currentBalance = {
    reserved: new Prisma.Decimal(0),
    used: new Prisma.Decimal(0),
  };
  let currentLots: Array<{
    lotId: string;
    inStock: Prisma.Decimal;
    expiryCount: number;
    expiryAt: Date | null;
    inventoryUpdatedAt: Date | null;
  }> = [];
  let currentAssignments: Array<{
    userId: string;
    displayName: string;
    operatorType: "OPERATOR" | "ASSISTANT";
    roleId: role_enum;
    userUpdatedAt: Date | null;
  }> = [];
  let lastRequestHash: string | null = null;
  const repository = {
    findEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
    lockEncounter: jest.fn().mockResolvedValue(true),
    findLegacyOpd: jest.fn().mockResolvedValue({
      opd_id: "legacy-opd-1",
      customer_id: ENCOUNTER.customer_id,
      status_opd: "PENDING",
      management_item: null,
    }),
    lockLegacyOpd: jest.fn().mockResolvedValue(true),
    listEntitlements: jest
      .fn()
      .mockImplementation(() =>
        Promise.resolve({ rows: [currentEntitlement], total: 1 }),
      ),
    findEntitlement: jest
      .fn()
      .mockImplementation(() => Promise.resolve(currentEntitlement)),
    lockEntitlements: jest.fn().mockResolvedValue(1),
    countLogicalEntitlements: jest.fn().mockResolvedValue(1),
    usageBalance: jest
      .fn()
      .mockImplementation(() => Promise.resolve(currentBalance)),
    findLots: jest.fn().mockImplementation(() => Promise.resolve(currentLots)),
    operatorAssignments: jest
      .fn()
      .mockImplementation(() => Promise.resolve(currentAssignments)),
    findEffectivePermissions: jest
      .fn()
      .mockImplementation((permissionIds: string[]) =>
        Promise.resolve(new Set(permissionIds)),
      ),
    findLatestReservation: jest.fn().mockResolvedValue(null),
    findActiveReservation: jest.fn().mockResolvedValue(null),
    findReservation: jest
      .fn()
      .mockImplementation(() => Promise.resolve(currentReservation)),
    lockActiveReservation: jest.fn().mockResolvedValue(null),
    lockReservation: jest.fn().mockResolvedValue(true),
    findIdempotency: jest.fn().mockResolvedValue(null),
    createIdempotency: jest
      .fn()
      .mockImplementation((input: { requestHash: string }) => {
        lastRequestHash = input.requestHash;
        return Promise.resolve({ api_idempotency_id: "claim-1" });
      }),
    completeIdempotency: jest.fn().mockResolvedValue(undefined),
    allocateServiceUsageNumber: jest.fn().mockResolvedValue("SU-0001"),
    createReservation: jest
      .fn()
      .mockImplementation(
        (input: { reservationId: string; legacyServiceUsageId: string }) => {
          currentReservation = {
            ...reservationRecord(),
            reservation_id: input.reservationId,
            legacy_service_usage_id: input.legacyServiceUsageId,
          };
          return Promise.resolve();
        },
      ),
    loadLegacyState: jest.fn().mockResolvedValue(validLegacyState()),
    lockLegacyState: jest.fn().mockResolvedValue(undefined),
    voidReservation: jest.fn().mockImplementation(() => {
      currentReservation = reservationRecord("VOIDED");
      return Promise.resolve();
    }),
  };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation((callback: (tx: typeof TX) => Promise<unknown>) =>
        callback(TX),
      ),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue(undefined) };
  const module = await Test.createTestingModule({
    providers: [
      OpdCourseReservationService,
      { provide: OpdCourseReservationRepository, useValue: repository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLogService },
    ],
  }).compile();
  return {
    service: module.get(OpdCourseReservationService),
    repository,
    prisma,
    auditLogService,
    setEntitlement: (value: ReturnType<typeof entitlement>) => {
      currentEntitlement = value;
    },
    setBalance: (reserved: number, used = 0) => {
      currentBalance = {
        reserved: new Prisma.Decimal(reserved),
        used: new Prisma.Decimal(used),
      };
    },
    setLots: (value: typeof currentLots) => {
      currentLots = value;
    },
    setAssignments: (value: typeof currentAssignments) => {
      currentAssignments = value;
    },
    setReservation: (value: ReturnType<typeof reservationRecord>) => {
      currentReservation = value;
    },
    lastRequestHash: () => lastRequestHash,
  };
}

describe("OpdCourseReservationService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-that-is-at-least-32-characters",
      OPD_COURSE_RESERVATION_ENABLED: "true",
    };
    resetBackendEnvForTest();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    resetBackendEnvForTest();
  });

  it("keeps entitlements visible but ineligible when the server gate is off", async () => {
    process.env.OPD_COURSE_RESERVATION_ENABLED = "false";
    resetBackendEnvForTest();
    const { service } = await makeService();

    const result = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );

    expect(result.capabilityEnabled).toBe(false);
    expect(result.items[0]).toMatchObject({
      eligible: false,
      balance: { purchased: 5, reserved: 0, used: 0, remaining: 5 },
    });
    expect(result.items[0]?.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "COURSE_RESERVATION_DISABLED" }),
      ]),
    );
  });

  it("projects write capabilities from effective permissions without default grants", async () => {
    const { service, repository } = await makeService();
    repository.findEffectivePermissions.mockResolvedValue(
      new Set(["OPD_READ", "CUSTOMER_COURSE_READ"]),
    );

    const result = await service.current(ENCOUNTER_ID, SCOPE);

    expect(result).toMatchObject({
      verificationAllowed: false,
      compensationRequestAllowed: false,
      compensationReviewAllowed: false,
      evidenceReadAllowed: true,
    });
  });

  it("preflights a fully paid same-branch entitlement without reserving balance or stock", async () => {
    const { service, repository, auditLogService } = await makeService();
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const token = list.items[0]?.entitlementToken;
    expect(token).toBeDefined();

    const result = await service.preflight(
      ENCOUNTER_ID,
      { selections: [{ entitlementToken: token ?? "", quantity: 2 }] },
      SCOPE,
    );

    expect(result).toMatchObject({
      capabilityEnabled: true,
      eligible: true,
      courseBalanceReserved: false,
      componentStockReserved: false,
      items: [
        {
          quantity: 2,
          before: { purchased: 5, reserved: 0, used: 0, remaining: 5 },
          remainingAfterReservation: 3,
        },
      ],
    });
    expect(result.preflightToken).toEqual(expect.any(String));
    expect(repository.createReservation).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "partial payment",
      mutate: () =>
        entitlement({
          sale_order: {
            ...entitlement().sale_order,
            sale_order_status: "PARTAIL",
          },
        }),
      blocker: "COURSE_ENTITLEMENT_PAYMENT_REQUIRED",
    },
    {
      label: "cross-branch ownership",
      mutate: () =>
        entitlement({
          branch_id: "branch-2",
          sale_order: {
            ...entitlement().sale_order,
            branch_id: "branch-2",
          },
        }),
      blocker: "COURSE_ENTITLEMENT_BRANCH_UNSUPPORTED",
    },
    {
      label: "expired display date",
      mutate: () => entitlement({ expire_date_display: NOW }),
      blocker: "COURSE_ENTITLEMENT_EXPIRED",
    },
  ])("blocks $label before any write", async ({ mutate, blocker }) => {
    const { service, repository, setEntitlement } = await makeService();
    setEntitlement(mutate());
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const item = list.items[0];

    expect(item?.eligible).toBe(false);
    expect(item?.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: blocker })]),
    );
    expect(repository.createReservation).not.toHaveBeenCalled();
  });

  it("discovers component lots read-only and requires an explicit valid lot", async () => {
    const { service, setEntitlement, setLots } = await makeService();
    const base = entitlement();
    setEntitlement(
      entitlement({
        course_item: {
          ...base.course_item,
          course_item_product: [
            {
              product_id: "product-1",
              quantity: new Prisma.Decimal(2),
              product: {
                status: record_status.ACTIVE,
                product_id_display: "PRODUCT-001",
                product_name: "Gel",
                unit: "tube",
                updated_at: NOW,
              },
            },
          ],
        },
      }),
    );
    setLots([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(10),
        expiryCount: 1,
        expiryAt: EXPIRY,
        inventoryUpdatedAt: NOW,
      },
    ]);
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const token = list.items[0]?.entitlementToken ?? "";

    const discovery = await service.preflight(
      ENCOUNTER_ID,
      { selections: [{ entitlementToken: token, quantity: 1 }] },
      SCOPE,
    );
    expect(discovery.eligible).toBe(false);
    expect(discovery.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "COURSE_COMPONENT_LOT_REQUIRED" }),
      ]),
    );
    expect(discovery.items[0]?.components[0]).toMatchObject({
      productId: "product-1",
      requiredQuantity: 2,
      selectedLotId: null,
      candidateLots: [
        {
          lotId: "LOT-1",
          availableQuantity: 10,
          eligible: true,
        },
      ],
    });

    const selected = await service.preflight(
      ENCOUNTER_ID,
      {
        selections: [
          {
            entitlementToken: token,
            quantity: 1,
            components: [{ productId: "product-1", lotId: "LOT-1" }],
          },
        ],
      },
      SCOPE,
    );
    expect(selected.eligible).toBe(true);
    expect(selected.componentStockReserved).toBe(false);
  });

  it("rejects a stale component-stock preflight without persistence", async () => {
    const { service, repository, setEntitlement, setLots } =
      await makeService();
    const base = entitlement();
    setEntitlement(
      entitlement({
        course_item: {
          ...base.course_item,
          course_item_product: [
            {
              product_id: "product-1",
              quantity: new Prisma.Decimal(2),
              product: {
                status: record_status.ACTIVE,
                product_id_display: "PRODUCT-001",
                product_name: "Gel",
                unit: "tube",
                updated_at: NOW,
              },
            },
          ],
        },
      }),
    );
    setLots([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(10),
        expiryCount: 1,
        expiryAt: EXPIRY,
        inventoryUpdatedAt: NOW,
      },
    ]);
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const selection = {
      entitlementToken: list.items[0]?.entitlementToken ?? "",
      quantity: 1,
      components: [{ productId: "product-1", lotId: "LOT-1" }],
    };
    const preflight = await service.preflight(
      ENCOUNTER_ID,
      { selections: [selection] },
      SCOPE,
    );
    setLots([
      {
        lotId: "LOT-1",
        inStock: new Prisma.Decimal(1),
        expiryCount: 1,
        expiryAt: EXPIRY,
        inventoryUpdatedAt: NOW,
      },
    ]);

    await expectConflict(
      service.reserve(
        ENCOUNTER_ID,
        {
          selections: [selection],
          preflightToken: preflight.preflightToken ?? "",
        },
        "reserve-key-1",
        SCOPE,
        PRINCIPAL,
      ),
      "COURSE_REPREFLIGHT_REQUIRED",
    );
    expect(repository.createReservation).not.toHaveBeenCalled();
    expect(repository.completeIdempotency).not.toHaveBeenCalled();
  });

  it("requires configured operators to resolve uniquely and never exposes commission", async () => {
    const { service, setEntitlement, setAssignments } = await makeService();
    const base = entitlement();
    setEntitlement(
      entitlement({
        course_item: {
          ...base.course_item,
          course: {
            ...base.course_item.course,
            course_operator: [
              {
                role_id: role_enum.DOCTOR,
                operator_type: operator_type.OPERATOR,
                commission: new Prisma.Decimal(100),
                commission_unit: amount_unit.AMOUNT,
              },
            ],
          },
        },
      }),
    );
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const token = list.items[0]?.entitlementToken ?? "";
    const unresolved = await service.preflight(
      ENCOUNTER_ID,
      { selections: [{ entitlementToken: token, quantity: 1 }] },
      SCOPE,
    );
    expect(unresolved.eligible).toBe(false);
    expect(unresolved.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "COURSE_OPERATOR_UNRESOLVED" }),
      ]),
    );

    setAssignments([
      {
        userId: "operator-1",
        displayName: "Assigned Doctor",
        operatorType: operator_type.OPERATOR,
        roleId: role_enum.DOCTOR,
        userUpdatedAt: NOW,
      },
    ]);
    const resolved = await service.preflight(
      ENCOUNTER_ID,
      { selections: [{ entitlementToken: token, quantity: 1 }] },
      SCOPE,
    );
    expect(resolved.eligible).toBe(true);
    expect(resolved.items[0]?.operators).toEqual([
      {
        userId: "operator-1",
        displayName: "Assigned Doctor",
        roleId: role_enum.DOCTOR,
        operatorType: operator_type.OPERATOR,
      },
    ]);
    expect(resolved.items[0]?.operators[0]).not.toHaveProperty(
      "commissionAmount",
    );
  });

  it("atomically reserves the canonical balance and records no stock effect", async () => {
    const { service, repository, auditLogService } = await makeService();
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const selection = {
      entitlementToken: list.items[0]?.entitlementToken ?? "",
      quantity: 2,
    };
    const preflight = await service.preflight(
      ENCOUNTER_ID,
      { selections: [selection] },
      SCOPE,
    );

    const result = await service.reserve(
      ENCOUNTER_ID,
      {
        selections: [selection],
        preflightToken: preflight.preflightToken ?? "",
      },
      "reserve-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toMatchObject({
      status: "RESERVED",
      legacyServiceUsageId: "SU-0001",
      courseUsed: false,
      componentStockReserved: false,
      componentStockDeducted: false,
    });
    expect(repository.createReservation).toHaveBeenCalledTimes(1);
    expect(repository.createReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceEncounterVersion: 4,
        items: [
          expect.objectContaining({
            courseItemId: "course-item-1",
            reservedAmount: new Prisma.Decimal(2),
            beforeRemainingAmount: new Prisma.Decimal(5),
            afterRemainingAmount: new Prisma.Decimal(3),
          }),
        ],
      }),
      SCOPE,
      NOW,
      TX,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "course.entitlement.reserve",
        metadata: expect.objectContaining({
          courseUsed: false,
          componentStockReserved: false,
          componentStockDeducted: false,
          permissionPath: [
            "OPD_EDIT",
            "TREATMENT_EDIT",
            "PURCHASE-COURSE_CREATE",
          ],
        }),
      }),
      TX,
    );
    expect(repository.completeIdempotency).toHaveBeenCalledTimes(1);
  });

  it("requires fresh preflight when the authoritative balance changes", async () => {
    const { service, repository, setBalance } = await makeService();
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const selection = {
      entitlementToken: list.items[0]?.entitlementToken ?? "",
      quantity: 1,
    };
    const preflight = await service.preflight(
      ENCOUNTER_ID,
      { selections: [selection] },
      SCOPE,
    );
    setBalance(5);

    await expectConflict(
      service.reserve(
        ENCOUNTER_ID,
        {
          selections: [selection],
          preflightToken: preflight.preflightToken ?? "",
        },
        "reserve-key-1",
        SCOPE,
        PRINCIPAL,
      ),
      "COURSE_REPREFLIGHT_REQUIRED",
    );
    expect(repository.createReservation).not.toHaveBeenCalled();
    expect(repository.completeIdempotency).not.toHaveBeenCalled();
  });

  it("maps a malformed preflight token to the stable re-preflight conflict", async () => {
    const { service, repository } = await makeService();
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const selection = {
      entitlementToken: list.items[0]?.entitlementToken ?? "",
      quantity: 1,
    };

    await expectConflict(
      service.reserve(
        ENCOUNTER_ID,
        { selections: [selection], preflightToken: "not-a-signed-token" },
        "reserve-key-1",
        SCOPE,
        PRINCIPAL,
      ),
      "COURSE_REPREFLIGHT_REQUIRED",
    );
    expect(repository.createReservation).not.toHaveBeenCalled();
  });

  it("replays the canonical success while the kill switch is off and rejects a changed hash", async () => {
    const { service, repository, prisma, lastRequestHash } =
      await makeService();
    const list = await service.entitlements(
      ENCOUNTER_ID,
      { page: 1, pageSize: 20 },
      SCOPE,
    );
    const selection = {
      entitlementToken: list.items[0]?.entitlementToken ?? "",
      quantity: 1,
    };
    const preflight = await service.preflight(
      ENCOUNTER_ID,
      { selections: [selection] },
      SCOPE,
    );
    const dto = {
      selections: [selection],
      preflightToken: preflight.preflightToken ?? "",
    };
    await service.reserve(ENCOUNTER_ID, dto, "reserve-key-1", SCOPE, PRINCIPAL);
    const requestHash = lastRequestHash();
    expect(requestHash).not.toBeNull();
    repository.findIdempotency.mockResolvedValue(
      completedClaim(requestHash ?? ""),
    );
    process.env.OPD_COURSE_RESERVATION_ENABLED = "false";
    resetBackendEnvForTest();
    const transactionCalls = prisma.$transaction.mock.calls.length;

    await expect(
      service.reserve(ENCOUNTER_ID, dto, "reserve-key-1", SCOPE, PRINCIPAL),
    ).resolves.toMatchObject({ status: "RESERVED" });
    expect(prisma.$transaction).toHaveBeenCalledTimes(transactionCalls);

    await expectConflict(
      service.reserve(
        ENCOUNTER_ID,
        {
          ...dto,
          selections: [{ ...selection, quantity: 2 }],
        },
        "reserve-key-1",
        SCOPE,
        PRINCIPAL,
      ),
      "IDEMPOTENCY_KEY_REUSED",
    );
  });

  it("voids only untouched PENDING/RESERVED state and retains the snapshots", async () => {
    const { service, repository, auditLogService, setReservation } =
      await makeService();
    setReservation(reservationRecord());

    const result = await service.voidReservation(
      ENCOUNTER_ID,
      RESERVATION_ID,
      { expectedVersion: 1, reason: "Entered in error" },
      "void-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toMatchObject({
      reservationId: RESERVATION_ID,
      status: "VOIDED",
      version: 2,
      courseUsed: false,
      componentStockDeducted: false,
    });
    expect(repository.voidReservation).toHaveBeenCalledWith(
      expect.objectContaining({ reservation_id: RESERVATION_ID }),
      1,
      "Entered in error",
      SCOPE,
      NOW,
      TX,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "course.entitlement-reservation.void",
        metadata: expect.objectContaining({
          sourceVersion: 1,
          resultVersion: 2,
          inventoryChanged: false,
          permissionPath: [
            "OPD_EDIT",
            "TREATMENT_EDIT",
            "PURCHASE-COURSE_DELETE",
          ],
        }),
      }),
      TX,
    );
  });

  it("requires manual compensation after any legacy progression", async () => {
    const { service, repository, setReservation } = await makeService();
    setReservation(reservationRecord());
    repository.loadLegacyState.mockResolvedValue({
      ...validLegacyState(),
      serviceUsage: {
        ...validLegacyState().serviceUsage,
        verify_at: NOW,
      },
    });

    await expectConflict(
      service.voidReservation(
        ENCOUNTER_ID,
        RESERVATION_ID,
        { expectedVersion: 1, reason: "Entered in error" },
        "void-key-1",
        SCOPE,
        PRINCIPAL,
      ),
      "COMPENSATION_REQUIRED",
    );
    expect(repository.voidReservation).not.toHaveBeenCalled();
    expect(repository.completeIdempotency).not.toHaveBeenCalled();
  });
});
