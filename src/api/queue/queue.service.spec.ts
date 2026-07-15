import { BadRequestException, ForbiddenException, NotFoundException } from "@nestjs/common";
import { auditReferenceType, role_enum, statusAppointment } from "@prisma/client";
import { QueueService } from "./queue.service";
import type { QueueRepository } from "./queue.repository";
import type { ErpSalesOrderEmitter } from "../../integrations/erp-events/erp-sales-order-emitter.service";
import type { AuditLogService } from "../audit-log/audit-log.service";
import type { AuditLogView } from "../audit-log/audit-log.mapper";
import type { PrismaService } from "../../prisma.service";
import type { Principal, RequestScope } from "../../auth/auth.types";
import type { TransitionQueueDto } from "./dto/transition-queue.dto";
import type { SaveConsultationDto } from "./dto/save-consultation.dto";
import type { SaveAnestheticDto } from "./dto/save-anesthetic.dto";
import type { SaveQueueConfigDto } from "./dto/save-queue-config.dto";
import { DEFAULT_QUEUE_CONFIG } from "./queue-config.defaults";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};

const PRINCIPAL: Principal = { email: "user@example.com", name: "User Example" };

const AUDIT_VIEW = { id: 1, action: "move" } as unknown as AuditLogView;

// Sentinel standing in for the Prisma.TransactionClient handed to the callback.
const TX = { __tx: true };

/**
 * A persisted queue_config row as the repository would return it. Deep-cloned
 * so tests that mutate their row can't pollute DEFAULT_QUEUE_CONFIG (which
 * other tests reach via the no-config-row fallback).
 */
function makeQueueConfigRow(): Record<string, unknown> {
  const config = JSON.parse(JSON.stringify(DEFAULT_QUEUE_CONFIG)) as typeof DEFAULT_QUEUE_CONFIG;
  return {
    queue_config_id: "cfg-1",
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    columns: config.columns,
    sla: config.sla,
    transitions: config.transitions,
    automation: config.automation,
    tracking: config.tracking,
    notifications: config.notifications,
    permissions: config.permissions,
    updated_by: "user-9",
    updated_at: new Date("2026-07-10T00:00:00Z"),
    created_at: new Date("2026-07-01T00:00:00Z"),
  };
}

function makeService(options: { appointment?: object | null; queueConfig?: object | null } = {}) {
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof TX) => Promise<unknown>) => callback(TX),
    ),
  } as unknown as PrismaService;

  const repository = {
    findAppointment: jest
      .fn()
      .mockResolvedValue(options.appointment === undefined ? { appointment_id: "appt-1" } : options.appointment),
    updateAppointmentStatus: jest.fn().mockResolvedValue({}),
    upsertQueueStep: jest.fn().mockResolvedValue({}),
    upsertConsultation: jest.fn().mockResolvedValue({}),
    upsertAnesthetic: jest.fn().mockResolvedValue({}),
    findQueueConfig: jest.fn().mockResolvedValue(options.queueConfig ?? null),
    upsertQueueConfig: jest.fn().mockResolvedValue(makeQueueConfigRow()),
    findQueueStatus: jest.fn().mockResolvedValue(null),
    countActiveCardsInStep: jest.fn().mockResolvedValue(0),
    hasAssignedDoctor: jest.fn().mockResolvedValue(true),
    hasAnesthetic: jest.fn().mockResolvedValue(true),
    hasUnpaidPrescriptions: jest.fn().mockResolvedValue(false),
    hasPrescriptions: jest.fn().mockResolvedValue(true),
    hasUsedCourse: jest.fn().mockResolvedValue(true),
  } as unknown as QueueRepository;

  const auditLogService = {
    create: jest.fn().mockResolvedValue(AUDIT_VIEW),
  } as unknown as AuditLogService;

  const erpSalesOrderEmitter = {
    emitPaidSaleOrdersForOpd: jest.fn().mockResolvedValue(0),
  } as unknown as ErpSalesOrderEmitter;

  return {
    service: new QueueService(prisma, repository, auditLogService, erpSalesOrderEmitter),
    prisma,
    repository,
    auditLogService,
    erpSalesOrderEmitter,
  };
}

function dto(overrides: Partial<TransitionQueueDto> = {}): TransitionQueueDto {
  return {
    appointmentId: "appt-1",
    action: "move",
    actionLabel: "ย้ายขั้นตอน",
    ...overrides,
  } as TransitionQueueDto;
}

describe("QueueService.transition", () => {
  it("throws NotFound when the appointment is not in the caller's clinic/branch", async () => {
    const { service, repository, prisma } = makeService({ appointment: null });

    await expect(service.transition(dto(), SCOPE, PRINCIPAL)).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findAppointment).toHaveBeenCalledWith(
      SCOPE.clinicId,
      SCOPE.branchId,
      "appt-1",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("writes status + step + audit inside one $transaction on a step move", async () => {
    const { service, prisma, repository, auditLogService } = makeService();

    const result = await service.transition(dto({ step: "ARRIVED" }), SCOPE, PRINCIPAL);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The step->status map syncs the legacy status, and every write receives
    // the same transaction client the $transaction callback was given.
    expect(repository.updateAppointmentStatus).toHaveBeenCalledWith(
      "appt-1",
      statusAppointment.ARRIVED,
      TX,
    );
    expect(repository.upsertQueueStep).toHaveBeenCalledWith(
      SCOPE.clinicId,
      SCOPE.branchId,
      "appt-1",
      "ARRIVED",
      TX,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: SCOPE.clinicId,
        branchId: SCOPE.branchId,
        referenceType: auditReferenceType.QUEUE,
        referenceId: "appt-1",
        action: "move",
        actorUserId: SCOPE.userId,
        actorName: PRINCIPAL.name,
        actorRole: role_enum.NURSE,
      }),
      TX,
    );
    expect(result).toEqual({ appointmentId: "appt-1", audit: AUDIT_VIEW });
  });

  it("prefers an explicit appointmentStatus over the step->status map", async () => {
    const { service, repository } = makeService();

    await service.transition(
      dto({ step: "ARRIVED", appointmentStatus: statusAppointment.CANCEL }),
      SCOPE,
      PRINCIPAL,
    );

    expect(repository.updateAppointmentStatus).toHaveBeenCalledWith(
      "appt-1",
      statusAppointment.CANCEL,
      TX,
    );
  });

  it("records the audit without touching appointment/queue rows when neither step nor status is given", async () => {
    const { service, repository, auditLogService } = makeService();

    await service.transition(dto(), SCOPE, PRINCIPAL);

    expect(repository.updateAppointmentStatus).not.toHaveBeenCalled();
    expect(repository.upsertQueueStep).not.toHaveBeenCalled();
    expect(auditLogService.create).toHaveBeenCalledTimes(1);
  });

  it("labels clinic-root actors CLINIC_ROOT when they have no branch role", async () => {
    const { service, auditLogService } = makeService();
    const rootScope: RequestScope = {
      ...SCOPE,
      isClinicRootUser: true,
      roles: [],
    };

    await service.transition(dto(), rootScope, PRINCIPAL);

    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "CLINIC_ROOT" }),
      TX,
    );
  });

  it("rejects transitions to disabled columns", async () => {
    const configRow = makeQueueConfigRow();
    (configRow.columns as any)[2].enabled = false; // consulting is index 2

    const { service } = makeService({ queueConfig: configRow });

    await expect(
      service.transition(dto({ step: "CONSULTING" }), SCOPE, PRINCIPAL),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects transitions for unauthorized user roles", async () => {
    const configRow = makeQueueConfigRow();
    // arrived only allows ADMIN
    (configRow.permissions as any).arrived = ["ADMIN"];

    const { service } = makeService({ queueConfig: configRow });

    await expect(
      service.transition(dto({ step: "ARRIVED" }), SCOPE, PRINCIPAL), // SCOPE has role NURSE
    ).rejects.toThrow(ForbiddenException);
  });

  it("rejects transitions that skip required non-skippable columns", async () => {
    const configRow = makeQueueConfigRow();
    // set arrived as required and non-skippable
    (configRow.columns as any)[1].isRequired = true; // arrived is index 1
    (configRow.columns as any)[1].canSkip = false;

    // mock current status as confirmed (index 0)
    const mockRepo = {
      findAppointment: jest.fn().mockResolvedValue({ appointment_id: "appt-1" }),
      findQueueConfig: jest.fn().mockResolvedValue(configRow),
      findQueueStatus: jest.fn().mockResolvedValue({ current_step: "CONFIRMED" }),
    };
    const customService = new QueueService(null as any, mockRepo as any, null as any, null as any);

    await expect(
      customService.transition(dto({ step: "CONSULTING" }), SCOPE, PRINCIPAL), // skips arrived
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects transitions when prerequisites are not met", async () => {
    const configRow = makeQueueConfigRow();
    // completed requires OPD
    (configRow.transitions as any).completed.requiresOPD = true;

    // mock appointment with no opd_id
    const mockRepo = {
      findAppointment: jest.fn().mockResolvedValue({ appointment_id: "appt-1", opd_id: null }),
      findQueueConfig: jest.fn().mockResolvedValue(configRow),
      findQueueStatus: jest.fn().mockResolvedValue({ current_step: "VERIFIED" }),
    };
    const customService = new QueueService(null as any, mockRepo as any, null as any, null as any);

    await expect(
      customService.transition(dto({ step: "COMPLETED" }), SCOPE, PRINCIPAL),
    ).rejects.toThrow(BadRequestException);
  });

  it("emits the visit's ERP sales-order events inside the transaction on a COMPLETED move", async () => {
    const { service, erpSalesOrderEmitter } = makeService({
      appointment: { appointment_id: "appt-1", opd_id: "opd-1" },
    });

    await service.transition(dto({ step: "COMPLETED" }), SCOPE, PRINCIPAL);

    expect(erpSalesOrderEmitter.emitPaidSaleOrdersForOpd).toHaveBeenCalledTimes(1);
    expect(erpSalesOrderEmitter.emitPaidSaleOrdersForOpd).toHaveBeenCalledWith(
      TX,
      { clinicId: SCOPE.clinicId, branchId: SCOPE.branchId },
      "opd-1",
    );
  });

  it("does not emit ERP events on a non-end-step move", async () => {
    const { service, erpSalesOrderEmitter } = makeService({
      appointment: { appointment_id: "appt-1", opd_id: "opd-1" },
    });

    await service.transition(dto({ step: "ARRIVED" }), SCOPE, PRINCIPAL);

    expect(erpSalesOrderEmitter.emitPaidSaleOrdersForOpd).not.toHaveBeenCalled();
  });

  it("does not emit ERP events when the completed visit has no OPD", async () => {
    // requiresOPD/Course/Medicine off so a no-OPD completion is allowed at all.
    // Replace (don't mutate) transitions: makeQueueConfigRow shares references
    // with DEFAULT_QUEUE_CONFIG.
    const configRow = makeQueueConfigRow();
    configRow.transitions = {
      ...(configRow.transitions as object),
      completed: {
        requiresPayment: false,
        requiresOPD: false,
        requiresCourse: false,
        requiresMedicine: false,
      },
    };
    const { service, erpSalesOrderEmitter } = makeService({
      appointment: { appointment_id: "appt-1", opd_id: null },
      queueConfig: configRow,
    });

    await service.transition(dto({ step: "COMPLETED" }), SCOPE, PRINCIPAL);

    expect(erpSalesOrderEmitter.emitPaidSaleOrdersForOpd).not.toHaveBeenCalled();
  });
});

function anestheticDto(overrides: Partial<SaveAnestheticDto> = {}): SaveAnestheticDto {
  return {
    appointmentId: "appt-1",
    allergyStatus: "none",
    nurseRef: "พยาบาลสุดา",
    durationMinutes: 30,
    ...overrides,
  } as SaveAnestheticDto;
}

describe("QueueService.saveAnesthetic", () => {
  it("throws NotFound when the appointment is not in the caller's clinic/branch", async () => {
    const { service, repository, prisma } = makeService({ appointment: null });

    await expect(service.saveAnesthetic(anestheticDto(), SCOPE, PRINCIPAL)).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findAppointment).toHaveBeenCalledWith(
      SCOPE.clinicId,
      SCOPE.branchId,
      "appt-1",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a recorded allergy without detail before touching the database", async () => {
    const { service, repository, prisma } = makeService();

    await expect(
      service.saveAnesthetic(
        anestheticDto({ allergyStatus: "has", allergyNotes: "   " }),
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.findAppointment).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("upserts anesthetic + status + step + exactly one audit inside one $transaction", async () => {
    const { service, prisma, repository, auditLogService } = makeService();

    const result = await service.saveAnesthetic(
      anestheticDto({
        allergyStatus: "has",
        allergyNotes: "แพ้ lidocaine",
        room: "ห้อง 2",
        bed: "เตียง 1",
        durationMinutes: 45,
        notes: "ทาบาง",
      }),
      SCOPE,
      PRINCIPAL,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The anesthetic row is upserted with the scope-derived owner and the same tx.
    expect(repository.upsertAnesthetic).toHaveBeenCalledWith(
      { clinicId: SCOPE.clinicId, branchId: SCOPE.branchId, userId: SCOPE.userId },
      expect.objectContaining({ appointmentId: "appt-1", nurseRef: "พยาบาลสุดา" }),
      TX,
    );
    // The card stays on ANESTHETIC (status + step) in the same transaction.
    expect(repository.updateAppointmentStatus).toHaveBeenCalledWith(
      "appt-1",
      statusAppointment.ANESTHETIC,
      TX,
    );
    expect(repository.upsertQueueStep).toHaveBeenCalledWith(
      SCOPE.clinicId,
      SCOPE.branchId,
      "appt-1",
      "ANESTHETIC",
      TX,
    );
    // Exactly one audit row, actor derived server-side, with anesthetic metadata.
    expect(auditLogService.create).toHaveBeenCalledTimes(1);
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: SCOPE.clinicId,
        branchId: SCOPE.branchId,
        referenceType: auditReferenceType.QUEUE,
        referenceId: "appt-1",
        action: "apply-anesthetic",
        toStatus: "ANESTHETIC",
        actorUserId: SCOPE.userId,
        actorName: PRINCIPAL.name,
        actorRole: role_enum.NURSE,
        metadata: expect.objectContaining({
          allergyStatus: "has",
          allergyNotes: "แพ้ lidocaine",
          nurseRef: "พยาบาลสุดา",
          room: "ห้อง 2",
          bed: "เตียง 1",
          durationMinutes: 45,
        }),
      }),
      TX,
    );
    expect(result).toEqual({ appointmentId: "appt-1", audit: AUDIT_VIEW });
  });
});

/** A valid full-replace config payload (deep-cloned defaults + overrides). */
function configDto(mutate?: (dto: SaveQueueConfigDto) => void): SaveQueueConfigDto {
  const dto = JSON.parse(JSON.stringify(DEFAULT_QUEUE_CONFIG)) as SaveQueueConfigDto;
  mutate?.(dto);
  return dto;
}

const ADMIN_SCOPE: RequestScope = { ...SCOPE, roles: [role_enum.ADMIN] };
const ROOT_SCOPE: RequestScope = { ...SCOPE, isClinicRootUser: true, roles: [] };

describe("QueueService.getQueueConfig", () => {
  it("returns built-in defaults without writing when no row exists", async () => {
    const { service, repository, prisma } = makeService({ queueConfig: null });

    const view = await service.getQueueConfig(SCOPE);

    expect(view.queueConfigId).toBeNull();
    expect(view.clinicId).toBe(SCOPE.clinicId);
    expect(view.branchId).toBe(SCOPE.branchId);
    expect(view.columns).toEqual(DEFAULT_QUEUE_CONFIG.columns);
    expect(view.updatedAt).toBeNull();
    // GET must never create the row — that's the save's job.
    expect(repository.upsertQueueConfig).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("maps a persisted row to the camelCase view", async () => {
    const { service, repository } = makeService({ queueConfig: makeQueueConfigRow() });

    const view = await service.getQueueConfig(SCOPE);

    expect(repository.findQueueConfig).toHaveBeenCalledWith(SCOPE.clinicId, SCOPE.branchId);
    expect(view.queueConfigId).toBe("cfg-1");
    expect(view.updatedBy).toBe("user-9");
    expect(view.updatedAt).toBe("2026-07-10T00:00:00.000Z");
    expect(view.createdAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("QueueService.updateQueueConfig", () => {
  it("rejects callers who are neither clinic root nor ADMIN before touching the database", async () => {
    const { service, repository, prisma } = makeService();

    await expect(service.updateQueueConfig(configDto(), SCOPE, PRINCIPAL)).rejects.toThrow(
      ForbiddenException,
    );
    expect(repository.upsertQueueConfig).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("saves upsert + audit inside one $transaction for an ADMIN", async () => {
    const { service, prisma, repository, auditLogService } = makeService();

    const view = await service.updateQueueConfig(configDto(), ADMIN_SCOPE, PRINCIPAL);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(repository.upsertQueueConfig).toHaveBeenCalledWith(
      ADMIN_SCOPE.clinicId,
      ADMIN_SCOPE.branchId,
      expect.objectContaining({ automation: expect.objectContaining({ defaultColumn: "arrived" }) }),
      ADMIN_SCOPE.userId,
      TX,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: ADMIN_SCOPE.clinicId,
        branchId: ADMIN_SCOPE.branchId,
        referenceType: auditReferenceType.QUEUE,
        referenceId: ADMIN_SCOPE.branchId,
        action: "update-queue-config",
        actorUserId: ADMIN_SCOPE.userId,
        actorName: PRINCIPAL.name,
        actorRole: role_enum.ADMIN,
      }),
      TX,
    );
    expect(view.queueConfigId).toBe("cfg-1");
  });

  it("allows a clinic root user with no branch role", async () => {
    const { service, auditLogService } = makeService();

    await service.updateQueueConfig(configDto(), ROOT_SCOPE, PRINCIPAL);

    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "CLINIC_ROOT" }),
      TX,
    );
  });

  it.each<[string, (dto: SaveQueueConfigDto) => void]>([
    ["duplicate column ids", (dto) => { dto.columns[1].id = dto.columns[0].id; }],
    ["sla referencing an unknown column", (dto) => { dto.sla[0].columnId = "cancelled"; }],
    ["duplicate sla entries", (dto) => { dto.sla[1].columnId = dto.sla[0].columnId; }],
    ["warning above critical", (dto) => { dto.sla[1].warningMinutes = 99; dto.sla[1].criticalMinutes = 15; }],
    ["defaultColumn pointing at a disabled column", (dto) => { dto.columns[1].enabled = false; }],
    ["permissions keyed by an unknown column", (dto) => { dto.permissions["not-a-column"] = ["ADMIN"]; }],
    ["permissions containing an unknown role", (dto) => { dto.permissions.arrived = ["SUPERUSER"]; }],
  ])("rejects %s before touching the database", async (_label, mutate) => {
    const { service, repository, prisma } = makeService();

    await expect(
      service.updateQueueConfig(configDto(mutate), ADMIN_SCOPE, PRINCIPAL),
    ).rejects.toThrow(BadRequestException);
    expect(repository.upsertQueueConfig).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects saving config if a disabled column contains active cards", async () => {
    const configPayload = configDto();
    configPayload.columns[1].enabled = false; // arrived is index 1

    const { service, repository } = makeService();
    jest.spyOn(repository, "countActiveCardsInStep").mockResolvedValue(5); // 5 cards active

    await expect(
      service.updateQueueConfig(configPayload, ADMIN_SCOPE, PRINCIPAL),
    ).rejects.toThrow(BadRequestException);
  });
});

function consultDto(overrides: Partial<SaveConsultationDto> = {}): SaveConsultationDto {
  return {
    appointmentId: "appt-1",
    outcome: "interested",
    ...overrides,
  } as SaveConsultationDto;
}

describe("QueueService.saveConsultation", () => {
  it("throws NotFound when the appointment is not in the caller's clinic/branch", async () => {
    const { service, repository, prisma } = makeService({ appointment: null });

    await expect(service.saveConsultation(consultDto(), SCOPE, PRINCIPAL)).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findAppointment).toHaveBeenCalledWith(
      SCOPE.clinicId,
      SCOPE.branchId,
      "appt-1",
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("upserts consultation + status + step + exactly one audit inside one $transaction", async () => {
    const { service, prisma, repository, auditLogService } = makeService();

    const result = await service.saveConsultation(
      consultDto({
        consultantRef: "เซลล์ประจำ",
        budget: 15000,
        promotion: "โปรฤดูฝน",
        servicesInterested: ["Botox", "Filler"],
        notes: "ลูกค้าสนใจมาก",
      }),
      SCOPE,
      PRINCIPAL,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // The consult row is upserted with the scope-derived owner and the same tx.
    expect(repository.upsertConsultation).toHaveBeenCalledWith(
      { clinicId: SCOPE.clinicId, branchId: SCOPE.branchId, userId: SCOPE.userId },
      expect.objectContaining({ appointmentId: "appt-1", consultantRef: "เซลล์ประจำ" }),
      TX,
    );
    // The card advances to CONSULTING (status + step) in the same transaction.
    expect(repository.updateAppointmentStatus).toHaveBeenCalledWith(
      "appt-1",
      statusAppointment.CONSULTING,
      TX,
    );
    expect(repository.upsertQueueStep).toHaveBeenCalledWith(
      SCOPE.clinicId,
      SCOPE.branchId,
      "appt-1",
      "CONSULTING",
      TX,
    );
    // Exactly one audit row, actor derived server-side, with consult metadata.
    expect(auditLogService.create).toHaveBeenCalledTimes(1);
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: SCOPE.clinicId,
        branchId: SCOPE.branchId,
        referenceType: auditReferenceType.QUEUE,
        referenceId: "appt-1",
        action: "send-to-consulting",
        toStatus: "CONSULTING",
        actorUserId: SCOPE.userId,
        actorName: PRINCIPAL.name,
        actorRole: role_enum.NURSE,
        metadata: expect.objectContaining({
          consultantRef: "เซลล์ประจำ",
          budget: 15000,
          outcome: "interested",
          servicesInterested: ["Botox", "Filler"],
        }),
      }),
      TX,
    );
    expect(result).toEqual({ appointmentId: "appt-1", audit: AUDIT_VIEW });
  });
});
