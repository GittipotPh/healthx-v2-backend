import { BadRequestException, NotFoundException } from "@nestjs/common";
import { auditReferenceType, role_enum, statusAppointment } from "@prisma/client";
import { QueueService } from "./queue.service";
import type { QueueRepository } from "./queue.repository";
import type { AuditLogService } from "../audit-log/audit-log.service";
import type { AuditLogView } from "../audit-log/audit-log.mapper";
import type { PrismaService } from "../../prisma.service";
import type { Principal, RequestScope } from "../../auth/auth.types";
import type { TransitionQueueDto } from "./dto/transition-queue.dto";
import type { SaveConsultationDto } from "./dto/save-consultation.dto";
import type { SaveAnestheticDto } from "./dto/save-anesthetic.dto";

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

function makeService(options: { appointment?: object | null } = {}) {
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
  } as unknown as QueueRepository;

  const auditLogService = {
    create: jest.fn().mockResolvedValue(AUDIT_VIEW),
  } as unknown as AuditLogService;

  return {
    service: new QueueService(prisma, repository, auditLogService),
    prisma,
    repository,
    auditLogService,
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
