import { ConflictException, NotFoundException } from "@nestjs/common";
import { auditReferenceType, statusAppointment } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AppointmentsService } from "./appointments.service";
import {
  AppointmentQueueTicketInvariantError,
  AppointmentsRepository,
} from "./appointments.repository";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
import type { AppointmentWithCustomer } from "./appointments.mapper";
import type { AppointmentOptionsRepository } from "./appointment-options.repository";
import type { CustomersService } from "../customers/customers.service";
import type { AuditLogService } from "../audit-log/audit-log.service";
import type { BranchAccessService } from "../../common/branch-access/branch-access.service";
import type { PrismaService } from "../../prisma.service";
import type { RequestScope } from "../../auth/auth.types";
import { INITIAL_QUEUE_STEP } from "../queue/queue.constants";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [],
};

function validDto(
  overrides: Partial<CreateAppointmentDto> = {},
): CreateAppointmentDto {
  return plainToInstance(CreateAppointmentDto, {
    customerId: "cust-1",
    dateAppointment: "2026-07-02",
    timeArrive: "09:00",
    startTime: "09:30",
    endTime: "10:00",
    isConsult: false,
    applyAnesthetic: false,
    ...overrides,
  });
}

function appointmentRow(
  overrides: Partial<AppointmentWithCustomer> = {},
): AppointmentWithCustomer {
  const now = new Date("2026-07-02T02:00:00.000Z");
  return {
    appointment_id: "appt-1",
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    customer_id: "cust-1",
    user_create: SCOPE.userId,
    opd_id: null,
    room: null,
    channel: null,
    date_appointment: "2026-07-02",
    time_arrive: "09:00",
    start_time: "09:30",
    end_time: "10:00",
    is_consult: false,
    apply_anesthetic: false,
    appointment_detail: null,
    status_appointment: statusAppointment.APPOINT,
    created_at: now,
    updated_at: now,
    customer: null,
    ...overrides,
  } as AppointmentWithCustomer;
}

function makeService(options: { opdExists?: boolean } = {}) {
  const repository = {
    create: jest.fn().mockResolvedValue(appointmentRow()),
    opdExistsInScope: jest.fn().mockResolvedValue(options.opdExists ?? false),
    findOne: jest.fn().mockResolvedValue(appointmentRow()),
    reschedule: jest.fn().mockResolvedValue(
      appointmentRow({
        date_appointment: "2026-07-03",
        time_arrive: "11:00",
        start_time: "11:00",
        end_time: "11:30",
      }),
    ),
  } as unknown as AppointmentsRepository;

  const customersService = {
    detail: jest.fn().mockResolvedValue({ customerId: "cust-1" }),
  } as unknown as CustomersService;

  const auditLogService = {
    record: jest.fn().mockResolvedValue(null),
  } as unknown as AuditLogService;

  const branchAccessService = {
    findAccessibleBranches: jest.fn().mockResolvedValue([]),
  } as unknown as BranchAccessService;

  const service = new AppointmentsService(
    repository,
    {} as AppointmentOptionsRepository,
    customersService,
    auditLogService,
    branchAccessService,
  );

  return {
    service,
    repository,
    customersService,
    auditLogService,
    branchAccessService,
  };
}

describe("CreateAppointmentDto", () => {
  it("accepts YYYY-MM-DD dates and zero-padded HH:mm times", async () => {
    await expect(validate(validDto())).resolves.toHaveLength(0);
  });

  it.each([
    ["2026-7-2", "unpadded month/day"],
    ["02/07/2026", "slash format"],
    ["2026-13-01", "month out of range"],
    ["2026-07-32", "day out of range"],
    ["2026-02-29", "non-leap-year day"],
    ["2026-04-31", "day does not exist in month"],
    ["not-a-date", "free text"],
  ])("rejects dateAppointment %p (%s)", async (dateAppointment) => {
    const errors = await validate(validDto({ dateAppointment }));
    expect(errors.map((e) => e.property)).toContain("dateAppointment");
  });

  it.each([
    ["9:00", "unpadded hour breaks lexical VARCHAR comparison"],
    ["24:00", "hour out of range"],
    ["09:60", "minute out of range"],
    ["09.30", "wrong separator"],
    ["", "empty"],
  ])("rejects times %p (%s) on timeArrive/startTime/endTime", async (time) => {
    for (const field of ["timeArrive", "startTime", "endTime"] as const) {
      const errors = await validate(validDto({ [field]: time }));
      expect(errors.map((e) => e.property)).toContain(field);
    }
  });
});

describe("RescheduleAppointmentDto", () => {
  it("rejects a correctly formatted date that does not exist", async () => {
    const dto = plainToInstance(RescheduleAppointmentDto, {
      dateAppointment: "2026-02-29",
      startTime: "11:00",
    });

    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toContain("dateAppointment");
  });
});

describe("AppointmentsService.create", () => {
  it("verifies the customer belongs to the clinic before writing", async () => {
    const { service, customersService, repository } = makeService();

    await service.create(validDto(), SCOPE);

    expect(customersService.detail).toHaveBeenCalledWith(
      "cust-1",
      SCOPE.clinicId,
    );
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("does not write when the customer check throws NotFound", async () => {
    const { service, customersService, repository, auditLogService } =
      makeService();
    (customersService.detail as jest.Mock).mockRejectedValue(
      new NotFoundException("Customer not found"),
    );

    await expect(service.create(validDto(), SCOPE)).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.create).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it("rejects an opdId that does not exist in this clinic/branch", async () => {
    const { service, repository } = makeService({ opdExists: false });

    await expect(
      service.create(validDto({ opdId: "opd-x" }), SCOPE),
    ).rejects.toThrow(NotFoundException);
    expect(repository.opdExistsInScope).toHaveBeenCalledWith("opd-x", SCOPE);
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("accepts an opdId that exists in scope and skips the check when omitted", async () => {
    const withOpd = makeService({ opdExists: true });
    await withOpd.service.create(validDto({ opdId: "opd-1" }), SCOPE);
    expect(withOpd.repository.create).toHaveBeenCalledTimes(1);

    const withoutOpd = makeService();
    await withoutOpd.service.create(validDto(), SCOPE);
    expect(withoutOpd.repository.opdExistsInScope).not.toHaveBeenCalled();
  });

  it("records a server-side audit entry for the created appointment", async () => {
    const { service, auditLogService } = makeService();

    const view = await service.create(validDto(), SCOPE);

    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: SCOPE.clinicId,
        branchId: SCOPE.branchId,
        referenceType: auditReferenceType.APPOINTMENT,
        referenceId: "appt-1",
        action: "create",
        actorUserId: SCOPE.userId,
      }),
    );
    expect(view.appointmentId).toBe("appt-1");
    expect(view.status).toBe(statusAppointment.APPOINT);
  });
});

describe("AppointmentsService.reschedule", () => {
  const dto = plainToInstance(RescheduleAppointmentDto, {
    dateAppointment: "2026-07-03",
    startTime: "11:00",
  });

  it("records the audit only after the appointment and ticket move succeeds", async () => {
    const { service, repository, auditLogService } = makeService();

    const view = await service.reschedule("appt-1", dto, SCOPE);

    expect(repository.reschedule).toHaveBeenCalledWith(
      "appt-1",
      {
        dateAppointment: "2026-07-03",
        startTime: "11:00",
        endTime: "11:30",
      },
      SCOPE,
    );
    expect(auditLogService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        clinicId: SCOPE.clinicId,
        branchId: SCOPE.branchId,
        referenceId: "appt-1",
        action: "reschedule",
        actorUserId: SCOPE.userId,
      }),
    );
    expect(view.dateAppointment).toBe("2026-07-03");
  });

  it("returns a conflict and does not audit when an OPD encounter already exists", async () => {
    const { service, repository, auditLogService } = makeService();
    (repository.reschedule as jest.Mock).mockRejectedValue(
      new AppointmentQueueTicketInvariantError("ENCOUNTER_ALREADY_STARTED"),
    );

    await expect(service.reschedule("appt-1", dto, SCOPE)).rejects.toThrow(
      ConflictException,
    );
    expect(auditLogService.record).not.toHaveBeenCalled();
  });
});

describe("AppointmentsRepository.create", () => {
  it("creates the appointment, legacy queue row, and stable ticket in one $transaction", async () => {
    const row = appointmentRow();
    const enteredAt = new Date("2026-07-02T02:00:00.000Z");
    const tx = {
      appointment: { create: jest.fn().mockResolvedValue(row) },
      queue_status: {
        create: jest.fn().mockResolvedValue({
          queue_status_id: "11111111-1111-1111-1111-111111111111",
          current_step: INITIAL_QUEUE_STEP,
          entered_at: enteredAt,
        }),
      },
      opd_number_sequence: {
        upsert: jest.fn().mockResolvedValue({ next_value: 8n }),
      },
      opd_queue_ticket: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const repository = new AppointmentsRepository(prisma);

    const created = await repository.create(validDto(), SCOPE);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.appointment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          customer_id: "cust-1",
          user_create: SCOPE.userId,
          status_appointment: statusAppointment.APPOINT,
        }),
      }),
    );

    const appointmentId = (
      tx.appointment.create.mock.calls[0][0] as {
        data: { appointment_id: string };
      }
    ).data.appointment_id;
    expect(tx.queue_status.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          appointment_id: appointmentId,
          current_step: INITIAL_QUEUE_STEP,
        }),
      }),
    );
    expect(tx.opd_number_sequence.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          clinic_id_branch_id_number_kind_period_key: {
            clinic_id: SCOPE.clinicId,
            branch_id: SCOPE.branchId,
            number_kind: "QUEUE",
            period_key: "20260702",
          },
        },
      }),
    );
    expect(tx.opd_queue_ticket.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        customer_id: "cust-1",
        appointment_id: appointmentId,
        legacy_queue_status_id: "11111111-1111-1111-1111-111111111111",
        source_type: "APPOINTMENT",
        business_date: new Date("2026-07-02T00:00:00.000Z"),
        current_step: INITIAL_QUEUE_STEP,
        entered_at: enteredAt,
        queue_sequence: 7,
        display_number: "Q007",
        created_by: SCOPE.userId,
      }),
    });
    expect(created).toBe(row);
  });

  it("stores optional appointment detail extras in the app-owned side table", async () => {
    const row = appointmentRow();
    const extra = {
      appointment_id: "appt-1",
      campaign: "new-year-campaign",
      numbing_time: 30,
      preparation: "Avoid vitamins",
      internal_note: "VIP customer",
    };
    const tx = {
      appointment: { create: jest.fn().mockResolvedValue(row) },
      appointment_detail_extra: { create: jest.fn().mockResolvedValue(extra) },
      queue_status: {
        create: jest.fn().mockResolvedValue({
          queue_status_id: "11111111-1111-1111-1111-111111111111",
          current_step: INITIAL_QUEUE_STEP,
          entered_at: new Date("2026-07-02T02:00:00.000Z"),
        }),
      },
      opd_number_sequence: {
        upsert: jest.fn().mockResolvedValue({ next_value: 2n }),
      },
      opd_queue_ticket: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx),
      ),
    } as unknown as PrismaService;
    const repository = new AppointmentsRepository(prisma);

    const created = await repository.create(
      validDto({
        campaign: "new-year-campaign",
        numbingTime: 30,
        preparation: "Avoid vitamins",
        internalNote: "VIP customer",
      }),
      SCOPE,
    );

    const appointmentId = (
      tx.appointment.create.mock.calls[0][0] as {
        data: { appointment_id: string };
      }
    ).data.appointment_id;
    expect(tx.appointment_detail_extra.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appointment_id: appointmentId,
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          campaign: "new-year-campaign",
          numbing_time: 30,
          preparation: "Avoid vitamins",
          internal_note: "VIP customer",
          created_by: SCOPE.userId,
        }),
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        campaign: "new-year-campaign",
        numbing_time: 30,
        preparation: "Avoid vitamins",
        internal_note: "VIP customer",
      }),
    );
  });
});

describe("AppointmentsRepository.reschedule", () => {
  function makeRepository(
    options: {
      ticketDate?: string;
      encounterId?: string | null;
    } = {},
  ) {
    const updatedRow = appointmentRow({
      date_appointment: "2026-07-03",
      time_arrive: "11:00",
      start_time: "11:00",
      end_time: "11:30",
    });
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([
        {
          queue_ticket_id: "22222222-2222-2222-2222-222222222222",
          business_date: options.ticketDate ?? "2026-07-02",
        },
      ]),
      opd_encounter: {
        findUnique: jest
          .fn()
          .mockResolvedValue(
            options.encounterId === undefined || options.encounterId === null
              ? null
              : { encounter_id: options.encounterId },
          ),
      },
      appointment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findFirst: jest.fn().mockResolvedValue(updatedRow),
      },
      opd_number_sequence: {
        upsert: jest.fn().mockResolvedValue({ next_value: 12n }),
      },
      opd_queue_ticket: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (callback: (client: typeof tx) => Promise<unknown>) =>
          callback(tx),
      ),
      appointment_detail_extra: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;
    return { repository: new AppointmentsRepository(prisma), prisma, tx };
  }

  it("preserves the ticket ID while moving it to a newly allocated daily number", async () => {
    const { repository, tx } = makeRepository();

    await repository.reschedule(
      "appt-1",
      {
        dateAppointment: "2026-07-03",
        startTime: "11:00",
        endTime: "11:30",
      },
      SCOPE,
    );

    const lockQuery = tx.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(lockQuery.values).toEqual([
      SCOPE.clinicId,
      SCOPE.branchId,
      "appt-1",
    ]);
    expect(tx.appointment.updateMany).toHaveBeenCalledWith({
      where: {
        appointment_id: "appt-1",
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
      },
      data: expect.objectContaining({
        date_appointment: "2026-07-03",
        start_time: "11:00",
        time_arrive: "11:00",
        end_time: "11:30",
      }),
    });
    expect(tx.opd_queue_ticket.updateMany).toHaveBeenCalledWith({
      where: {
        queue_ticket_id: "22222222-2222-2222-2222-222222222222",
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        appointment_id: "appt-1",
        source_type: "APPOINTMENT",
      },
      data: expect.objectContaining({
        business_date: new Date("2026-07-03T00:00:00.000Z"),
        queue_sequence: 11,
        display_number: "Q011",
        version: { increment: 1 },
      }),
    });
  });

  it("does not consume another number for a time-only reschedule on the same date", async () => {
    const { repository, tx } = makeRepository({ ticketDate: "2026-07-03" });

    await repository.reschedule(
      "appt-1",
      {
        dateAppointment: "2026-07-03",
        startTime: "11:00",
        endTime: "11:30",
      },
      SCOPE,
    );

    expect(tx.opd_number_sequence.upsert).not.toHaveBeenCalled();
    expect(tx.opd_queue_ticket.updateMany).not.toHaveBeenCalled();
    expect(tx.appointment.updateMany).toHaveBeenCalledTimes(1);
  });

  it("rejects before changing anything when the ticket already has an encounter", async () => {
    const { repository, tx } = makeRepository({ encounterId: "encounter-1" });

    await expect(
      repository.reschedule(
        "appt-1",
        {
          dateAppointment: "2026-07-03",
          startTime: "11:00",
          endTime: "11:30",
        },
        SCOPE,
      ),
    ).rejects.toMatchObject({
      reason: "ENCOUNTER_ALREADY_STARTED",
    });
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.opd_encounter.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.appointment.updateMany).not.toHaveBeenCalled();
    expect(tx.opd_queue_ticket.updateMany).not.toHaveBeenCalled();
  });
});
