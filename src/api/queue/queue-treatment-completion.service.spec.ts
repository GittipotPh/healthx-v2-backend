import { role_enum, type opd_queue_ticket } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import type { AuditLogService } from "../audit-log/audit-log.service";
import { QueueTreatmentCompletionService } from "./queue-treatment-completion.service";
import type { QueueRepository } from "./queue.repository";

const TICKET_ID = "11111111-1111-4111-8111-111111111111";
const ENCOUNTER_ID = "22222222-2222-4222-8222-222222222222";

const ticket = {
  queue_ticket_id: TICKET_ID,
  clinic_id: "clinic-1",
  branch_id: "branch-1",
  customer_id: "customer-1",
  appointment_id: "appointment-1",
  legacy_queue_status_id: null,
  source_type: "APPOINTMENT",
  business_date: new Date("2026-07-22T00:00:00.000Z"),
  current_step: "IN_SERVICE",
  entered_at: new Date("2026-07-22T02:00:00.000Z"),
  queue_sequence: 1,
  display_number: "A001",
  version: 4,
  cancelled_at: null,
  cancelled_by: null,
  cancellation_reason: null,
  created_by: "user-1",
  created_at: new Date("2026-07-22T01:00:00.000Z"),
  updated_at: new Date("2026-07-22T02:00:00.000Z"),
} satisfies opd_queue_ticket;

const scope: RequestScope = {
  userId: "doctor-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};

const input = {
  queueTicketId: TICKET_ID,
  encounterId: ENCOUNTER_ID,
  customerId: "customer-1",
  appointmentId: "appointment-1",
  legacyOpdId: "opd-1",
};

function makeFixture() {
  const repository = {
    findV2QueueTicketById: jest.fn().mockResolvedValue(ticket),
    findV2QueueEncounterIdentity: jest.fn().mockResolvedValue({
      encounterId: ENCOUNTER_ID,
      queueTicketId: TICKET_ID,
      customerId: "customer-1",
      appointmentId: "appointment-1",
    }),
    findQueueConfig: jest.fn().mockResolvedValue(null),
    findAppointment: jest.fn().mockResolvedValue({
      appointment_id: "appointment-1",
      clinic_id: "clinic-1",
      branch_id: "branch-1",
      customer_id: "customer-1",
      opd_id: "opd-1",
    }),
    lockV2QueueTicket: jest.fn().mockResolvedValue(true),
    updateAppointmentStatus: jest.fn().mockResolvedValue(undefined),
    upsertQueueStep: jest.fn().mockResolvedValue({}),
    transitionV2QueueTicket: jest.fn().mockResolvedValue("UPDATED"),
  };
  const auditLogService = {
    create: jest.fn().mockResolvedValue({}),
  };
  const service = new QueueTreatmentCompletionService(
    repository as unknown as QueueRepository,
    auditLogService as unknown as AuditLogService,
  );
  return { service, repository, auditLogService };
}

describe("QueueTreatmentCompletionService", () => {
  it("reports a ready IN_SERVICE ticket when default DISPENSING policy allows the doctor", async () => {
    const { service } = makeFixture();

    await expect(service.inspect(input, scope)).resolves.toEqual({
      ticket,
      blockers: [],
    });
  });

  it("reports stable blockers for a mismatched ticket and disabled target", async () => {
    const { service, repository } = makeFixture();
    repository.findV2QueueTicketById.mockResolvedValue({
      ...ticket,
      customer_id: "other-customer",
      current_step: "ARRIVED",
    });
    repository.findQueueConfig.mockResolvedValue({
      columns: [
        {
          id: "in-service",
          enabled: true,
          order: 1,
          isRequired: false,
          canSkip: false,
        },
        {
          id: "dispensing",
          enabled: false,
          order: 2,
          isRequired: false,
          canSkip: true,
        },
      ],
      permissions: { dispensing: ["DOCTOR"] },
    });

    const result = await service.inspect(input, scope);

    expect(result.blockers).toEqual([
      "QUEUE_TICKET_LINK_MISMATCH",
      "QUEUE_TICKET_NOT_IN_SERVICE",
      "QUEUE_DISPENSING_DISABLED",
    ]);
  });

  it("updates compatibility state, ticket history, and queue audit in one supplied transaction", async () => {
    const { service, repository, auditLogService } = makeFixture();
    const tx = {};

    const result = await service.complete(
      { ...input, expectedVersion: 4 },
      scope,
      { email: "doctor@example.test", name: "Doctor One" },
      tx as never,
    );

    expect(repository.updateAppointmentStatus).toHaveBeenCalledWith(
      "clinic-1",
      "branch-1",
      "appointment-1",
      "DISPENSING",
      tx,
    );
    expect(repository.upsertQueueStep).toHaveBeenCalledWith(
      "clinic-1",
      "branch-1",
      "appointment-1",
      "DISPENSING",
      tx,
    );
    expect(repository.transitionV2QueueTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        queueTicketId: TICKET_ID,
        expectedVersion: 4,
        toStep: "DISPENSING",
      }),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: TICKET_ID,
        fromStatus: "IN_SERVICE",
        toStatus: "DISPENSING",
      }),
      tx,
    );
    expect(result).toEqual({
      queueTicketId: TICKET_ID,
      sourceVersion: 4,
      resultVersion: 5,
      sourceStep: "IN_SERVICE",
      resultStep: "DISPENSING",
      appointmentStatus: "DISPENSING",
    });
  });

  it("rejects a stale expected ticket version before any compatibility write", async () => {
    const { service, repository, auditLogService } = makeFixture();

    await expect(
      service.complete(
        { ...input, expectedVersion: 3 },
        scope,
        { email: "doctor@example.test", name: "Doctor One" },
        {} as never,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: "QUEUE_TICKET_VERSION_STALE" }),
    });

    expect(repository.updateAppointmentStatus).not.toHaveBeenCalled();
    expect(repository.transitionV2QueueTicket).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });
});
