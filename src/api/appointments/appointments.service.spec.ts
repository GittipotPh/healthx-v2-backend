import { NotFoundException } from "@nestjs/common";
import { auditReferenceType, statusAppointment } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AppointmentsService } from "./appointments.service";
import { AppointmentsRepository } from "./appointments.repository";
import { CreateAppointmentDto } from "./dto/create-appointment.dto";
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

function validDto(overrides: Partial<CreateAppointmentDto> = {}): CreateAppointmentDto {
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

function appointmentRow(overrides: Partial<AppointmentWithCustomer> = {}): AppointmentWithCustomer {
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

  return { service, repository, customersService, auditLogService, branchAccessService };
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

describe("AppointmentsService.create", () => {
  it("verifies the customer belongs to the clinic before writing", async () => {
    const { service, customersService, repository } = makeService();

    await service.create(validDto(), SCOPE);

    expect(customersService.detail).toHaveBeenCalledWith("cust-1", SCOPE.clinicId);
    expect(repository.create).toHaveBeenCalledTimes(1);
  });

  it("does not write when the customer check throws NotFound", async () => {
    const { service, customersService, repository, auditLogService } = makeService();
    (customersService.detail as jest.Mock).mockRejectedValue(
      new NotFoundException("Customer not found"),
    );

    await expect(service.create(validDto(), SCOPE)).rejects.toThrow(NotFoundException);
    expect(repository.create).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it("rejects an opdId that does not exist in this clinic/branch", async () => {
    const { service, repository } = makeService({ opdExists: false });

    await expect(service.create(validDto({ opdId: "opd-x" }), SCOPE)).rejects.toThrow(
      NotFoundException,
    );
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

describe("AppointmentsRepository.create", () => {
  it("creates the appointment and bootstraps its queue_status row in one $transaction", async () => {
    const row = appointmentRow();
    const tx = {
      appointment: { create: jest.fn().mockResolvedValue(row) },
      queue_status: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
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

    const appointmentId = (tx.appointment.create.mock.calls[0][0] as {
      data: { appointment_id: string };
    }).data.appointment_id;
    expect(tx.queue_status.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        appointment_id: appointmentId,
        current_step: INITIAL_QUEUE_STEP,
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
      queue_status: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (t: typeof tx) => Promise<unknown>) => callback(tx)),
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

    const appointmentId = (tx.appointment.create.mock.calls[0][0] as {
      data: { appointment_id: string };
    }).data.appointment_id;
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
