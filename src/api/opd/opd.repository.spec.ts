import { ConflictException } from "@nestjs/common";
import type { PrismaService } from "../../prisma.service";
import type { RequestScope } from "../../auth/auth.types";
import { role_enum, statusAppointment } from "@prisma/client";
import { OpdRepository } from "./opd.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};

describe("OpdRepository Phase 1 start lookups", () => {
  it.each([
    [{ customer_id: "customer-1", customer_status: true }, true],
    [{ customer_id: "customer-1", customer_status: false }, false],
    [null, false],
  ])("accepts only active clinic customers", async (row, expected) => {
    const customer = { findUnique: jest.fn().mockResolvedValue(row) };
    const repository = new OpdRepository({
      customer,
    } as unknown as PrismaService);

    await expect(
      repository.customerExistsInClinic("customer-1", SCOPE.clinicId),
    ).resolves.toBe(expected);
    expect(customer.findUnique).toHaveBeenCalledWith({
      where: {
        customer_id_clinic_id: {
          customer_id: "customer-1",
          clinic_id: SCOPE.clinicId,
        },
      },
      select: { customer_id: true, customer_status: true },
    });
  });

  it("finds only active same-day walk-ins inside the caller scope", async () => {
    const opdEncounter = { findFirst: jest.fn().mockResolvedValue(null) };
    const repository = new OpdRepository({
      opd_encounter: opdEncounter,
    } as unknown as PrismaService);
    const businessDate = new Date("2026-07-18T00:00:00.000Z");

    await repository.findActiveWalkInEncounter(
      "customer-1",
      businessDate,
      SCOPE,
    );

    expect(opdEncounter.findFirst).toHaveBeenCalledWith({
      where: {
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        customer_id: "customer-1",
        appointment_id: null,
        encounter_type: "WALK_IN",
        business_date: businessDate,
        workflow_status: { in: ["OPEN", "POST_VISIT"] },
      },
      orderBy: { created_at: "desc" },
    });
  });
});

describe("OpdRepository.findWorklistTickets", () => {
  const businessDate = "2026-07-18";
  const ticket = {
    queue_ticket_id: "ticket-1",
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    customer_id: "customer-1",
    appointment_id: "appointment-1",
    legacy_queue_status_id: "legacy-queue-1",
    source_type: "APPOINTMENT",
    business_date: new Date("2026-07-18T00:00:00.000Z"),
    current_step: "ARRIVED",
    entered_at: new Date("2026-07-18T02:00:00.000Z"),
    queue_sequence: 1,
    display_number: "Q001",
    version: 1,
    cancelled_at: null,
    cancelled_by: null,
    cancellation_reason: null,
    created_by: SCOPE.userId,
    created_at: new Date("2026-07-18T02:00:00.000Z"),
    updated_at: new Date("2026-07-18T02:00:00.000Z"),
  };
  const appointment = {
    appointment_id: "appointment-1",
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    customer_id: "customer-1",
    room: "Room 1",
    channel: "LINE",
    date_appointment: businessDate,
    time_arrive: "09:00",
    start_time: "09:00",
    end_time: "09:30",
    is_consult: true,
    apply_anesthetic: false,
    appointment_detail: "Consultation",
    status_appointment: statusAppointment.ARRIVED,
    opd_id: null,
    customer: {
      name: "Ticketed",
      lastname: "Patient",
      personal_id: "HN-1",
      nickname: null,
      phone_number: null,
      gender: "FEMALE",
      customer_image: null,
      customer_info: { allergy: null },
    },
    opd: null,
  };
  const legacyQueueStatus = {
    queue_status_id: "legacy-queue-1",
    clinic_id: SCOPE.clinicId,
    branch_id: SCOPE.branchId,
    appointment_id: "appointment-1",
    current_step: "ARRIVED",
  };

  function makeWorklistRepository() {
    const prisma = {
      opd_queue_ticket: { findMany: jest.fn().mockResolvedValue([ticket]) },
      appointment: { findMany: jest.fn().mockResolvedValue([appointment]) },
      queue_status: {
        findMany: jest.fn().mockResolvedValue([legacyQueueStatus]),
      },
      opd_encounter: { findMany: jest.fn().mockResolvedValue([]) },
    };
    return {
      repository: new OpdRepository(prisma as unknown as PrismaService),
      prisma,
    };
  }

  it("excludes ticketless legacy appointments by establishing population from tickets", async () => {
    const { repository, prisma } = makeWorklistRepository();
    prisma.opd_queue_ticket.findMany.mockResolvedValue([]);

    await expect(
      repository.findWorklistTickets(
        SCOPE.clinicId,
        SCOPE.branchId,
        businessDate,
      ),
    ).resolves.toEqual([]);
    expect(prisma.appointment.findMany).not.toHaveBeenCalled();
    expect(prisma.opd_queue_ticket.findMany).toHaveBeenCalledWith({
      where: {
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        source_type: "APPOINTMENT",
        business_date: new Date("2026-07-18T00:00:00.000Z"),
      },
      orderBy: { queue_sequence: "asc" },
    });
  });

  it("hydrates an exact same-scope ticketed appointment", async () => {
    const { repository } = makeWorklistRepository();

    await expect(
      repository.findWorklistTickets(
        SCOPE.clinicId,
        SCOPE.branchId,
        businessDate,
      ),
    ).resolves.toEqual([
      { appointment, ticket, encounterId: null },
    ]);
  });

  it.each([
    ["branch", { branch_id: "branch-foreign" }],
    ["customer", { customer_id: "customer-foreign" }],
    ["date", { date_appointment: "2026-07-19" }],
  ])("rejects a ticket/appointment %s mismatch", async (_label, mismatch) => {
    const { repository, prisma } = makeWorklistRepository();
    prisma.appointment.findMany.mockResolvedValue([
      { ...appointment, ...mismatch },
    ]);

    await expect(
      repository.findWorklistTickets(
        SCOPE.clinicId,
        SCOPE.branchId,
        businessDate,
      ),
    ).rejects.toThrow(ConflictException);
  });
});
