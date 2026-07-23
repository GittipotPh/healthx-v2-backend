import { ConflictException } from "@nestjs/common";
import { Prisma, role_enum } from "@prisma/client";
import { deflateSync } from "node:zlib";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { resetBackendEnvForTest } from "../../env";
import { OpdCourseVerificationService } from "./opd-course-verification.service";

const NOW = new Date("2026-07-23T05:00:00.000Z");
const EXPIRY = new Date("2099-01-01T00:00:00.000Z");
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const RESERVATION_ID = "22222222-2222-4222-8222-222222222222";
const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = {
  email: "doctor@example.com",
  name: "Doctor",
};

function reservationRecord() {
  return {
    reservation_id: RESERVATION_ID,
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    encounter_id: ENCOUNTER_ID,
    customer_id: "customer-1",
    legacy_opd_id: "legacy-opd-1",
    status: "RESERVED",
    request_hash: "a".repeat(64),
    idempotency_key_hash: "b".repeat(64),
    source_encounter_version: 4,
    source_balance_manifest: [],
    legacy_service_usage_id: "service-usage-1",
    legacy_service_usage_branch_id: SCOPE.branchId,
    legacy_service_usage_status_snapshot: "PENDING",
    reserved_by_user_id: SCOPE.userId,
    reserved_at: NOW,
    voided_by_user_id: null,
    voided_at: null,
    void_reason: null,
    used_by_user_id: null,
    used_at: null,
    compensated_by_user_id: null,
    compensated_at: null,
    version: 1,
    created_at: NOW,
    updated_at: NOW,
    verification: null,
    items: [
      {
        reservation_item_id: "33333333-3333-4333-8333-333333333333",
        reservation_id: RESERVATION_ID,
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        encounter_id: ENCOUNTER_ID,
        display_order: 1,
        legacy_service_usage_item_id: "legacy-item-1",
        legacy_usage_log_id: "usage-log-1",
        purchase_branch_id: SCOPE.branchId,
        customer_id: "customer-1",
        sale_order_id: "sale-order-1",
        course_id: "course-1",
        course_item_id: "course-item-1",
        course_code_snapshot: "COURSE-1",
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

function legacyState() {
  return {
    serviceUsage: {
      service_usage_id: "service-usage-1",
      branch_id: SCOPE.branchId,
      clinic_id: SCOPE.clinicId,
      customer_id: "customer-1",
      customer_owner_id: "customer-1",
      status: "ACTIVE",
      service_usage_status: "PENDING",
      verify_at: null,
      verify_by: null,
      document_url: null,
      service_usage_request_cancel: null,
      service_usage_item: [
        {
          service_usage_item_id: "legacy-item-1",
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
    legacyOpd: {
      opd_id: "legacy-opd-1",
      management_item: "service-usage-1",
    },
    usageLogs: [
      {
        id: "usage-log-1",
        service_usage_id: "service-usage-1",
        customer_id: "customer-1",
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        item_id: "course-item-1",
        amount: new Prisma.Decimal(1),
        expire_date: EXPIRY,
        status: "RESERVED",
        course_usage_type: "SERVICE_USAGE",
      },
    ],
    inventoryMovementCount: 0,
  };
}

function serviceHarness() {
  const record = reservationRecord();
  const encounter = {
    encounter_id: ENCOUNTER_ID,
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    customer_id: "customer-1",
    workflow_status: "OPEN",
    clinical_record_status: "DRAFT",
  };
  const reservationRepository = {
    findEncounter: jest.fn().mockResolvedValue(encounter),
    findReservation: jest.fn().mockResolvedValue(record),
    loadLegacyState: jest.fn().mockResolvedValue(legacyState()),
    usageBalance: jest.fn().mockResolvedValue({
      reserved: new Prisma.Decimal(1),
      used: new Prisma.Decimal(0),
    }),
    findEffectivePermissions: jest
      .fn()
      .mockImplementation((permissionIds: string[]) =>
        Promise.resolve(new Set(permissionIds)),
      ),
  };
  const verificationRepository = {
    displayContext: jest.fn().mockResolvedValue({
      clinicName: "Clinic",
      branchName: "Branch",
      customerDisplayName: "Customer",
      operatorDisplayNames: new Map(),
    }),
  };
  const transactionClient = {};
  const prisma = {
    $transaction: jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback(transactionClient),
    ),
  };
  const service = new OpdCourseVerificationService(
    verificationRepository as never,
    reservationRepository as never,
    prisma as never,
    {} as never,
    {} as never,
  );
  return { service, record, reservationRepository };
}

describe("OpdCourseVerificationService", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    process.env = {
      ...originalEnv,
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      JWT_SECRET: "test-secret-that-is-at-least-32-characters",
      OPD_COURSE_RESERVATION_ENABLED: "true",
      OPD_COURSE_VERIFICATION_ENABLED: "true",
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

  it("issues a bounded token only for an exact eligible live preflight", async () => {
    const { service, reservationRepository } = serviceHarness();

    const result = await service.preflight(
      ENCOUNTER_ID,
      RESERVATION_ID,
      { expectedVersion: 1 },
      SCOPE,
    );

    expect(result).toMatchObject({
      capabilityEnabled: true,
      eligible: true,
      reservationId: RESERVATION_ID,
      expectedVersion: 1,
      blockers: [],
      courseUsed: false,
      componentStockDeducted: false,
    });
    expect(result.preflightToken).toEqual(expect.any(String));
    expect(result.expiresAt).toBe(
      new Date(NOW.getTime() + 5 * 60_000).toISOString(),
    );
    expect(reservationRepository.usageBalance).toHaveBeenCalledTimes(1);
  });

  it("keeps preflight read-only and ineligible when the verification gate is off", async () => {
    process.env.OPD_COURSE_VERIFICATION_ENABLED = "false";
    resetBackendEnvForTest();
    const { service } = serviceHarness();

    const result = await service.preflight(
      ENCOUNTER_ID,
      RESERVATION_ID,
      { expectedVersion: 1 },
      SCOPE,
    );

    expect(result.eligible).toBe(false);
    expect(result.preflightToken).toBeNull();
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "COURSE_VERIFICATION_DISABLED" }),
      ]),
    );
  });

  it("projects a permission blocker instead of offering an unusable verify token", async () => {
    const { service, reservationRepository } = serviceHarness();
    reservationRepository.findEffectivePermissions.mockResolvedValue(new Set());

    const result = await service.preflight(
      ENCOUNTER_ID,
      RESERVATION_ID,
      { expectedVersion: 1 },
      SCOPE,
    );

    expect(result.eligible).toBe(false);
    expect(result.preflightToken).toBeNull();
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "COURSE_VERIFICATION_PERMISSION_REQUIRED",
        }),
      ]),
    );
  });

  it("returns a completed same-key replay before revalidating the now-USED reservation", async () => {
    const { service, reservationRepository } = serviceHarness();
    const preflight = await service.preflight(
      ENCOUNTER_ID,
      RESERVATION_ID,
      { expectedVersion: 1 },
      SCOPE,
    );
    const canonical = {
      verificationId: "verification-1",
      reservationId: RESERVATION_ID,
      encounterId: ENCOUNTER_ID,
      status: "USED" as const,
      version: 2,
      verifiedBy: SCOPE.userId,
      verifiedAt: NOW.toISOString(),
      manifestHash: "a".repeat(64),
      acknowledgementVersion: "opd-course-use-ack-v1",
      acknowledgementLocale: "en-US",
      renderTemplate: "opd-course-use-verification-v1",
      renderVersion: 1,
      documentAvailable: true,
      documentHash: "b".repeat(64),
      evidenceSuperseded: false,
      components: [],
      compensation: null,
    };
    const acquire = jest.fn().mockResolvedValue({
      kind: "replay",
      result: canonical,
    });
    (
      service as unknown as {
        acquireVerificationClaim: typeof acquire;
      }
    ).acquireVerificationClaim = acquire;
    reservationRepository.findReservation.mockClear();
    reservationRepository.findReservation.mockRejectedValue(
      new Error("revalidation must not run on replay"),
    );
    jest.setSystemTime(new Date(NOW.getTime() + 10 * 60_000));
    const signatureBytes = signaturePng();
    const signature = {
      buffer: signatureBytes,
      size: signatureBytes.length,
      mimetype: "image/png",
    } as Express.Multer.File;

    await expect(
      service.verify(
        ENCOUNTER_ID,
        RESERVATION_ID,
        {
          preflightToken: preflight.preflightToken ?? "",
          expectedVersion: 1,
          acknowledgementVersion: "opd-course-use-ack-v1",
          acknowledgementLocale: "en-US",
        },
        signature,
        "verify-key-1",
        SCOPE,
        PRINCIPAL,
        {},
      ),
    ).resolves.toEqual(canonical);
    expect(acquire).toHaveBeenCalledTimes(1);
    expect(reservationRepository.findReservation).not.toHaveBeenCalled();
  });

  it("blocks every mutation before evidence handling when the rollout gate is off", async () => {
    process.env.OPD_COURSE_VERIFICATION_ENABLED = "false";
    resetBackendEnvForTest();
    const { service } = serviceHarness();

    await expect(
      service.verify(
        ENCOUNTER_ID,
        RESERVATION_ID,
        {
          preflightToken: "x".repeat(32),
          expectedVersion: 1,
          acknowledgementVersion: "opd-course-use-ack-v1",
          acknowledgementLocale: "en-US",
        },
        undefined,
        "verify-key-1",
        SCOPE,
        PRINCIPAL,
        {},
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "COURSE_VERIFICATION_DISABLED",
      }),
    });
  });

  it("enforces different compensation requester and reviewer actors", () => {
    const { service } = serviceHarness();
    const actorCheck = service as unknown as {
      assertSeparateActor: (requesterId: string, reviewerId: string) => void;
    };

    expect(() =>
      actorCheck.assertSeparateActor("user-1", "user-2"),
    ).not.toThrow();
    expect(() => actorCheck.assertSeparateActor("user-1", "user-1")).toThrow(
      ConflictException,
    );
  });

  it("retries one serializable compensation contention with the same command", async () => {
    const { service } = serviceHarness();
    const contention = new Prisma.PrismaClientKnownRequestError(
      "serialization conflict",
      { code: "P2034", clientVersion: "7.8.0" },
    );
    const command = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(contention)
      .mockResolvedValueOnce("committed");
    const runner = service as unknown as {
      runCourseCommandWithRetry: <T>(callback: () => Promise<T>) => Promise<T>;
    };

    await expect(runner.runCourseCommandWithRetry(command)).resolves.toBe(
      "committed",
    );
    expect(command).toHaveBeenCalledTimes(2);
  });
});

function signaturePng(): Buffer {
  const width = 32;
  const height = 32;
  const rows = Buffer.alloc((width * 3 + 1) * height, 255);
  for (let row = 0; row < height; row += 1) {
    rows[row * (width * 3 + 1)] = 0;
    for (let offset = -1; offset <= 1; offset += 1) {
      const column = Math.max(0, Math.min(width - 1, row + offset));
      const pixel = row * (width * 3 + 1) + 1 + column * 3;
      rows[pixel] = 20;
      rows[pixel + 1] = 20;
      rows[pixel + 2] = 20;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(rows)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuffer = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  typeBuffer.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(
    crc32(Buffer.concat([typeBuffer, data])),
    8 + data.length,
  );
  return output;
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of input) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
