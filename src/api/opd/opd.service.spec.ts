import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, role_enum, statusAppointment } from "@prisma/client";
import type { AuditLogService } from "../audit-log/audit-log.service";
import type { Principal, RequestScope } from "../../auth/auth.types";
import type { PrismaService } from "../../prisma.service";
import type { OpdRepository } from "./opd.repository";
import { OpdService } from "./opd.service";
import type { QueueService } from "../queue/queue.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.ADMIN],
};
const PRINCIPAL: Principal = { email: "admin@example.com", name: "Admin User" };
const TX = { transaction: true } as unknown as Prisma.TransactionClient;
const BUSINESS_DATE = new Date("2026-07-18T00:00:00.000Z");

const ENCOUNTER = {
  encounter_id: "encounter-1",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  customer_id: "customer-1",
  appointment_id: "appointment-1",
  queue_ticket_id: "ticket-1",
  legacy_opd_id: "OPDV2-20260718-000001",
  attending_user_id: null,
  encounter_type: "APPOINTMENT",
  workflow_status: "OPEN",
  clinical_record_status: "DRAFT",
  reconciliation_status: "RECONCILED",
  business_date: BUSINESS_DATE,
  started_at: new Date("2026-07-17T18:30:00.000Z"),
  started_by: SCOPE.userId,
  finalized_at: null,
  finalized_by: null,
  closed_at: null,
  closed_by: null,
  cancelled_at: null,
  cancelled_by: null,
  close_reason: null,
  cancellation_reason: null,
  version: 1,
  created_at: new Date("2026-07-17T18:30:00.000Z"),
  updated_at: new Date("2026-07-17T18:30:00.000Z"),
};

function makeService() {
  const repository = {
    findMany: jest.fn(),
    findHistoryByCustomer: jest.fn(),
    findIdempotency: jest.fn().mockResolvedValue(null),
    createIdempotency: jest
      .fn()
      .mockResolvedValue({ api_idempotency_id: "claim-1" }),
    completeIdempotency: jest.fn().mockResolvedValue(undefined),
    findAppointmentForStart: jest.fn().mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: null,
      date_appointment: "2026-07-18",
      start_time: "09:00",
      room: "room-1",
      status_appointment: statusAppointment.ARRIVED,
    }),
    customerExistsInClinic: jest.fn().mockResolvedValue(true),
    findEncounterByAppointment: jest.fn().mockResolvedValue(null),
    findEncounterByTicket: jest.fn().mockResolvedValue(null),
    findActiveWalkInEncounter: jest.fn().mockResolvedValue(null),
    findQueueTicketById: jest.fn().mockResolvedValue(null),
    findQueueTicketByAppointment: jest.fn().mockResolvedValue(null),
    findLegacyQueueStatus: jest.fn().mockResolvedValue({
      queue_status_id: "legacy-queue-1",
      current_step: "ARRIVED",
      entered_at: new Date("2026-07-17T18:20:00.000Z"),
    }),
    createLegacyQueueStatus: jest.fn(),
    allocateNumber: jest.fn().mockResolvedValue(1),
    createQueueTicket: jest.fn().mockResolvedValue({
      queue_ticket_id: "ticket-1",
      customer_id: "customer-1",
      appointment_id: "appointment-1",
      source_type: "APPOINTMENT",
      business_date: BUSINESS_DATE,
      cancelled_at: null,
    }),
    findLegacyOpd: jest.fn().mockResolvedValue(null),
    createLegacyOpd: jest.fn().mockResolvedValue({}),
    linkAppointmentToLegacyOpd: jest.fn().mockResolvedValue(true),
    createEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
    findWorkspace: jest.fn().mockResolvedValue(null),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        callback(TX),
    ),
  } as unknown as PrismaService;
  const auditLogService = {
    create: jest.fn().mockResolvedValue({}),
  } as unknown as AuditLogService;
  const queueService = {
    startEncounter: jest.fn().mockResolvedValue(undefined),
  } as unknown as QueueService;
  const service = new OpdService(
    repository as unknown as OpdRepository,
    prisma,
    auditLogService,
    queueService,
  );
  return { service, repository, prisma, auditLogService, queueService };
}

afterEach(() => {
  jest.useRealTimers();
});

describe("OpdService.start", () => {
  it("requires exactly one source and a valid idempotency key", async () => {
    const { service, prisma } = makeService();

    await expect(
      service.start({}, "valid-key", SCOPE, PRINCIPAL),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.start(
        { appointmentId: "appointment-1", customerId: "customer-1" },
        "valid-key",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "short",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("atomically creates a ticket, mandatory legacy OPD link, encounter, audit, and idempotent result", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-17T18:30:00.000Z"));
    const { service, repository, prisma, auditLogService, queueService } =
      makeService();

    const result = await service.start(
      { appointmentId: "appointment-1" },
      "start-key-0001",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toEqual({
      encounterId: "encounter-1",
      queueTicketId: "ticket-1",
      legacyOpdId: "OPDV2-20260718-000001",
      appointmentId: "appointment-1",
      customerId: "customer-1",
      workflowStatus: "OPEN",
      clinicalRecordStatus: "DRAFT",
      businessDate: "2026-07-18",
      version: 1,
      resumed: false,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(repository.createQueueTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "appointment-1",
        customerId: "customer-1",
        businessDate: BUSINESS_DATE,
        displayNumber: "Q001",
      }),
      SCOPE,
      TX,
    );
    expect(repository.createLegacyOpd).toHaveBeenCalledWith(
      "OPDV2-20260718-000001",
      "customer-1",
      SCOPE,
      expect.any(Date),
      TX,
    );
    expect(repository.linkAppointmentToLegacyOpd).toHaveBeenCalledWith(
      "appointment-1",
      "customer-1",
      "OPDV2-20260718-000001",
      SCOPE,
      expect.any(Date),
      TX,
    );
    expect(repository.createEncounter).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: "appointment-1",
        legacyOpdId: "OPDV2-20260718-000001",
      }),
      SCOPE,
      TX,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: "encounter-1",
        actorUserId: SCOPE.userId,
        actorName: PRINCIPAL.name,
      }),
      TX,
    );
    expect(queueService.startEncounter).toHaveBeenCalledWith(
      {
        queueTicketId: "ticket-1",
        encounterId: "encounter-1",
        appointmentId: "appointment-1",
        legacyOpdId: "OPDV2-20260718-000001",
      },
      SCOPE,
      PRINCIPAL,
      TX,
    );
    expect(repository.completeIdempotency).toHaveBeenCalledWith(
      "claim-1",
      SCOPE,
      "encounter-1",
      expect.objectContaining({ encounterId: "encounter-1" }),
      expect.any(Date),
      TX,
    );
  });

  it("replays a completed command without opening a second transaction", async () => {
    const { service, repository, prisma } = makeService();
    const snapshot = {
      encounterId: "encounter-1",
      queueTicketId: "ticket-1",
      legacyOpdId: "opd-1",
      appointmentId: "appointment-1",
      customerId: "customer-1",
      workflowStatus: "OPEN",
      clinicalRecordStatus: "DRAFT",
      businessDate: "2026-07-18",
      version: 1,
      resumed: false,
    };
    const requestHash = await import("node:crypto").then(({ createHash }) =>
      createHash("sha256")
        .update(
          JSON.stringify({ appointmentId: "appointment-1", customerId: null }),
        )
        .digest("hex"),
    );
    repository.findIdempotency.mockResolvedValue({
      request_hash: requestHash,
      state: "COMPLETED",
      result_snapshot: snapshot,
    });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "start-key-0001",
        SCOPE,
        PRINCIPAL,
      ),
    ).resolves.toEqual(snapshot);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("creates a real walk-in ticket and encounter without creating or linking an appointment", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-17T18:30:00.000Z"));
    const { service, repository } = makeService();
    repository.createQueueTicket.mockResolvedValue({
      queue_ticket_id: "walkin-ticket-1",
      customer_id: "customer-1",
      appointment_id: null,
      source_type: "WALK_IN",
      business_date: BUSINESS_DATE,
      cancelled_at: null,
    });
    repository.createEncounter.mockResolvedValue({
      ...ENCOUNTER,
      encounter_id: "walkin-encounter-1",
      queue_ticket_id: "walkin-ticket-1",
      appointment_id: null,
      encounter_type: "WALK_IN",
    });

    const result = await service.start(
      { customerId: "customer-1" },
      "walkin-key-0001",
      SCOPE,
      PRINCIPAL,
    );

    expect(result.appointmentId).toBeNull();
    expect(repository.createQueueTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: null,
        sourceType: "WALK_IN",
        currentStep: "ARRIVED",
      }),
      SCOPE,
      TX,
    );
    expect(repository.findAppointmentForStart).not.toHaveBeenCalled();
    expect(repository.linkAppointmentToLegacyOpd).not.toHaveBeenCalled();
    expect(repository.createLegacyOpd).toHaveBeenCalledTimes(1);
  });

  it("rejects an inactive customer before creating a walk-in", async () => {
    const { service, repository } = makeService();
    repository.customerExistsInClinic.mockResolvedValue(false);

    await expect(
      service.start(
        { customerId: "customer-inactive" },
        "walkin-key-0002",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(repository.findActiveWalkInEncounter).not.toHaveBeenCalled();
    expect(repository.createQueueTicket).not.toHaveBeenCalled();
    expect(repository.createEncounter).not.toHaveBeenCalled();
  });

  it("resumes the customer's active walk-in for the same Bangkok business date", async () => {
    const { service, repository, queueService, auditLogService } =
      makeService();
    const activeWalkIn = {
      ...ENCOUNTER,
      encounter_id: "walkin-encounter-active",
      queue_ticket_id: "walkin-ticket-active",
      appointment_id: null,
      encounter_type: "WALK_IN",
    };
    repository.findActiveWalkInEncounter.mockResolvedValue(activeWalkIn);
    repository.findQueueTicketById.mockResolvedValue({
      queue_ticket_id: "walkin-ticket-active",
      customer_id: "customer-1",
      appointment_id: null,
      source_type: "WALK_IN",
      business_date: BUSINESS_DATE,
      current_step: "IN_SERVICE",
      cancelled_at: null,
    });
    repository.findLegacyOpd.mockResolvedValue({ status_opd: "PENDING" });

    const result = await service.start(
      { customerId: "customer-1" },
      "walkin-key-0003",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toEqual(
      expect.objectContaining({
        encounterId: "walkin-encounter-active",
        appointmentId: null,
        resumed: true,
      }),
    );
    expect(repository.createQueueTicket).not.toHaveBeenCalled();
    expect(repository.createLegacyOpd).not.toHaveBeenCalled();
    expect(repository.createEncounter).not.toHaveBeenCalled();
    expect(queueService.startEncounter).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("retries a concurrent active walk-in unique conflict and resumes the winner", async () => {
    const { service, repository, prisma, queueService } = makeService();
    const activeWalkIn = {
      ...ENCOUNTER,
      encounter_id: "walkin-encounter-winner",
      queue_ticket_id: "walkin-ticket-winner",
      appointment_id: null,
      encounter_type: "WALK_IN",
    };
    repository.findActiveWalkInEncounter
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeWalkIn);
    repository.createQueueTicket.mockResolvedValue({
      queue_ticket_id: "walkin-ticket-loser",
      customer_id: "customer-1",
      appointment_id: null,
      source_type: "WALK_IN",
      business_date: BUSINESS_DATE,
      current_step: "ARRIVED",
      cancelled_at: null,
    });
    repository.createEncounter.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("active walk-in conflict", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    repository.findQueueTicketById.mockResolvedValue({
      queue_ticket_id: "walkin-ticket-winner",
      customer_id: "customer-1",
      appointment_id: null,
      source_type: "WALK_IN",
      business_date: BUSINESS_DATE,
      current_step: "IN_SERVICE",
      cancelled_at: null,
    });
    repository.findLegacyOpd.mockResolvedValue({ status_opd: "PENDING" });

    await expect(
      service.start(
        { customerId: "customer-1" },
        "walkin-key-0004",
        SCOPE,
        PRINCIPAL,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        encounterId: "walkin-encounter-winner",
        resumed: true,
      }),
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(queueService.startEncounter).not.toHaveBeenCalled();
  });

  it("rejects a terminal pre-existing legacy OPD instead of opening a V2 encounter around it", async () => {
    const { service, repository, auditLogService } = makeService();
    repository.findAppointmentForStart.mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: "legacy-opd-1",
      date_appointment: "2026-07-18",
      start_time: "09:00",
      room: null,
      status_appointment: statusAppointment.ARRIVED,
    });
    repository.findLegacyOpd.mockResolvedValue({ status_opd: "SUCCESS" });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "start-key-0001",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.createEncounter).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("rejects a new encounter for an appointment outside today's Bangkok business date", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-07-17T18:30:00.000Z"));
    const { service, repository } = makeService();
    repository.findAppointmentForStart.mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: null,
      date_appointment: "2026-07-17",
      start_time: "09:00",
      room: null,
      status_appointment: statusAppointment.ARRIVED,
    });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "start-key-0001",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.createQueueTicket).not.toHaveBeenCalled();
    expect(repository.createLegacyOpd).not.toHaveBeenCalled();
  });

  it("resumes a valid historical encounter before applying new-start date and terminal checks", async () => {
    const { service, repository, queueService } = makeService();
    const historicalDate = new Date("2026-07-17T00:00:00.000Z");
    const historicalEncounter = { ...ENCOUNTER, business_date: historicalDate };
    repository.findAppointmentForStart.mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: ENCOUNTER.legacy_opd_id,
      date_appointment: "2026-07-17",
      start_time: "09:00",
      room: null,
      status_appointment: statusAppointment.ARRIVED,
    });
    repository.findEncounterByAppointment.mockResolvedValue(
      historicalEncounter,
    );
    repository.findQueueTicketByAppointment.mockResolvedValue({
      queue_ticket_id: "ticket-1",
      customer_id: "customer-1",
      appointment_id: "appointment-1",
      source_type: "APPOINTMENT",
      business_date: historicalDate,
      cancelled_at: null,
    });
    repository.findLegacyOpd.mockResolvedValue({ status_opd: "PENDING" });

    const result = await service.start(
      { appointmentId: "appointment-1" },
      "resume-key-0001",
      SCOPE,
      PRINCIPAL,
    );

    expect(result.resumed).toBe(true);
    expect(repository.createQueueTicket).not.toHaveBeenCalled();
    expect(repository.createEncounter).not.toHaveBeenCalled();
    expect(queueService.startEncounter).not.toHaveBeenCalled();
  });

  it("rejects an active appointment encounter whose compatibility links diverged", async () => {
    const { service, repository, queueService } = makeService();
    repository.findAppointmentForStart.mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: "legacy-opd-other",
      date_appointment: "2026-07-18",
      start_time: "09:00",
      room: null,
      status_appointment: statusAppointment.ARRIVED,
    });
    repository.findEncounterByAppointment.mockResolvedValue(ENCOUNTER);
    repository.findQueueTicketByAppointment.mockResolvedValue({
      queue_ticket_id: "ticket-1",
      customer_id: "customer-1",
      appointment_id: "appointment-1",
      source_type: "APPOINTMENT",
      business_date: BUSINESS_DATE,
      current_step: "IN_SERVICE",
      cancelled_at: null,
    });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "resume-key-0003",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.createEncounter).not.toHaveBeenCalled();
    expect(queueService.startEncounter).not.toHaveBeenCalled();
  });

  it("rejects resuming an active encounter when the appointment is terminal", async () => {
    const { service, repository } = makeService();
    repository.findAppointmentForStart.mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: ENCOUNTER.legacy_opd_id,
      date_appointment: "2026-07-18",
      start_time: "09:00",
      room: null,
      status_appointment: statusAppointment.SUCCESS,
    });
    repository.findEncounterByAppointment.mockResolvedValue(ENCOUNTER);
    repository.findQueueTicketByAppointment.mockResolvedValue({
      queue_ticket_id: "ticket-1",
      customer_id: "customer-1",
      appointment_id: "appointment-1",
      source_type: "APPOINTMENT",
      business_date: BUSINESS_DATE,
      current_step: "IN_SERVICE",
      cancelled_at: null,
    });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "resume-key-0004",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.createEncounter).not.toHaveBeenCalled();
  });

  it("rejects resuming an active encounter from a terminal queue ticket", async () => {
    const { service, repository } = makeService();
    repository.findAppointmentForStart.mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: ENCOUNTER.legacy_opd_id,
      date_appointment: "2026-07-18",
      start_time: "09:00",
      room: null,
      status_appointment: statusAppointment.ARRIVED,
    });
    repository.findEncounterByAppointment.mockResolvedValue(ENCOUNTER);
    repository.findQueueTicketByAppointment.mockResolvedValue({
      queue_ticket_id: "ticket-1",
      customer_id: "customer-1",
      appointment_id: "appointment-1",
      source_type: "APPOINTMENT",
      business_date: BUSINESS_DATE,
      current_step: "CANCELLED",
      cancelled_at: new Date(),
    });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "resume-key-0005",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.createEncounter).not.toHaveBeenCalled();
  });

  it("rejects resuming an active encounter whose legacy OPD is terminal", async () => {
    const { service, repository } = makeService();
    repository.findAppointmentForStart.mockResolvedValue({
      appointment_id: "appointment-1",
      customer_id: "customer-1",
      opd_id: ENCOUNTER.legacy_opd_id,
      date_appointment: "2026-07-18",
      start_time: "09:00",
      room: null,
      status_appointment: statusAppointment.ARRIVED,
    });
    repository.findEncounterByAppointment.mockResolvedValue(ENCOUNTER);
    repository.findQueueTicketByAppointment.mockResolvedValue({
      queue_ticket_id: "ticket-1",
      customer_id: "customer-1",
      appointment_id: "appointment-1",
      source_type: "APPOINTMENT",
      business_date: BUSINESS_DATE,
      current_step: "IN_SERVICE",
      cancelled_at: null,
    });
    repository.findLegacyOpd.mockResolvedValue({ status_opd: "SUCCESS" });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "resume-key-0006",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.createEncounter).not.toHaveBeenCalled();
  });

  it("rejects resuming a terminal encounter linked to an appointment", async () => {
    const { service, repository, queueService } = makeService();
    repository.findEncounterByAppointment.mockResolvedValue({
      ...ENCOUNTER,
      workflow_status: "CLOSED",
    });

    await expect(
      service.start(
        { appointmentId: "appointment-1" },
        "resume-key-0002",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);

    expect(repository.createQueueTicket).not.toHaveBeenCalled();
    expect(repository.createEncounter).not.toHaveBeenCalled();
    expect(queueService.startEncounter).not.toHaveBeenCalled();
  });

  it("rejects a cross-scope or missing appointment before creating clinical rows", async () => {
    const { service, repository } = makeService();
    repository.findAppointmentForStart.mockResolvedValue(null);

    await expect(
      service.start(
        { appointmentId: "foreign" },
        "start-key-0001",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(repository.createLegacyOpd).not.toHaveBeenCalled();
    expect(repository.createEncounter).not.toHaveBeenCalled();
  });
});

describe("OpdService.workspace", () => {
  it("returns scoped, raw-provenance legacy context without fabricating structured safety data", async () => {
    const { service, repository } = makeService();
    repository.findWorkspace.mockResolvedValue({
      encounter: ENCOUNTER,
      ticket: {
        queue_ticket_id: "ticket-1",
        legacy_queue_status_id: "legacy-queue-1",
        customer_id: "customer-1",
        appointment_id: "appointment-1",
        source_type: "APPOINTMENT",
        business_date: BUSINESS_DATE,
        cancelled_at: null,
        display_number: "Q001",
        current_step: "ARRIVED",
        entered_at: new Date("2026-07-17T18:20:00.000Z"),
        version: 1,
      },
      customer: {
        customer_id: "customer-1",
        name: "Ada",
        lastname: "Lovelace",
        nickname: null,
        phone_number: "0800000000",
        gender: "FEMALE",
        birth_date: "1990-01-01",
        personal_id: "legacy-personal-id",
        customer_image: null,
        customer_info: {
          allergy: "raw, allergy text",
          congenital_disease: "raw, condition text",
        },
      },
      appointment: {
        status_appointment: statusAppointment.ARRIVED,
        date_appointment: "2026-07-18",
        start_time: "09:00",
        room: "room-1",
      },
      legacyOpd: {
        bt: null,
        bp: null,
        pr: null,
        rr: null,
        bmi: null,
        weight: null,
        height: null,
      },
    });

    const view = await service.workspace("encounter-1", SCOPE);

    expect(repository.findWorkspace).toHaveBeenCalledWith("encounter-1", SCOPE);
    expect(view.patient).toEqual(
      expect.objectContaining({
        hn: "legacy-personal-id",
        identifierSource: "LEGACY_PERSONAL_ID_UNVERIFIED",
      }),
    );
    expect(view.safety).toEqual({
      legacyAllergy: "raw, allergy text",
      legacyCondition: "raw, condition text",
      source: "LEGACY_CUSTOMER_INFO_UNVERIFIED",
    });
    expect(view.queue.legacyQueueStatusId).toBe("legacy-queue-1");
    expect(view.latestVitals).toBeNull();
  });

  it.each([
    ["COMPLETED", null, "CLOSED", statusAppointment.SUCCESS],
    [
      "CANCELLED",
      new Date("2026-07-18T04:00:00.000Z"),
      "CANCELLED",
      statusAppointment.CANCEL,
    ],
  ])(
    "keeps a read-only workspace available for a historical %s ticket",
    async (currentStep, cancelledAt, workflowStatus, appointmentStatus) => {
      const { service, repository } = makeService();
      repository.findWorkspace.mockResolvedValue({
        encounter: { ...ENCOUNTER, workflow_status: workflowStatus },
        ticket: {
          queue_ticket_id: "ticket-1",
          legacy_queue_status_id: "legacy-queue-1",
          customer_id: "customer-1",
          appointment_id: "appointment-1",
          source_type: "APPOINTMENT",
          business_date: BUSINESS_DATE,
          cancelled_at: cancelledAt,
          display_number: "Q001",
          current_step: currentStep,
          entered_at: new Date("2026-07-17T18:20:00.000Z"),
          version: 3,
        },
        customer: {
          customer_id: "customer-1",
          name: "Ada",
          lastname: "Lovelace",
          nickname: null,
          phone_number: "0800000000",
          gender: "FEMALE",
          birth_date: "1990-01-01",
          personal_id: "legacy-personal-id",
          customer_image: null,
          customer_info: null,
        },
        appointment: {
          status_appointment: appointmentStatus,
          date_appointment: "2026-07-18",
          start_time: "09:00",
          room: "room-1",
        },
        legacyOpd: {
          bt: null,
          bp: null,
          pr: null,
          rr: null,
          bmi: null,
          weight: null,
          height: null,
        },
      });

      await expect(service.workspace("encounter-1", SCOPE)).resolves.toEqual(
        expect.objectContaining({
          context: expect.objectContaining({ workflowStatus }),
          queue: expect.objectContaining({ currentStep }),
        }),
      );
    },
  );

  it("does not reveal an encounter outside the scoped repository result", async () => {
    const { service } = makeService();
    await expect(service.workspace("foreign", SCOPE)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("rejects workspace data when ticket and encounter identities diverge", async () => {
    const { service, repository } = makeService();
    repository.findWorkspace.mockResolvedValue({
      encounter: ENCOUNTER,
      ticket: {
        queue_ticket_id: "ticket-1",
        customer_id: "other-customer",
        appointment_id: "appointment-1",
        source_type: "APPOINTMENT",
        business_date: BUSINESS_DATE,
        cancelled_at: null,
      },
    });

    await expect(service.workspace("encounter-1", SCOPE)).rejects.toThrow(
      ConflictException,
    );
  });
});
