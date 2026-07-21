import { Prisma } from "@prisma/client";
import { isIsoBusinessDate } from "../src/common/business-date";

interface LockedFixtureTicket {
  queue_ticket_id: string;
  customer_id: string;
  legacy_queue_status_id: string | null;
  business_date: string;
  current_step: string;
}

export interface FixtureAppointmentTicketIdentity {
  clinicId: string;
  branchId: string;
  appointmentId: string;
  customerId: string;
  businessDate: string;
}

export type FixtureTicketSyncResult =
  | { outcome: "NO_TICKET" }
  | {
      outcome: "UNCHANGED" | "REALLOCATED";
      queueTicketId: string;
      previousBusinessDate: string;
      businessDate: string;
      queueSequence?: number;
      displayNumber?: string;
    };

/**
 * Keeps a disposable fixture appointment's stable V2 ticket aligned without
 * replacing its UUID. Call this inside the same transaction as the fixture
 * appointment create/update. Any started encounter makes fixture refresh
 * unsafe and is rejected before a ticket can move to another business date.
 */
export async function syncFixtureAppointmentTicket(
  tx: Prisma.TransactionClient,
  input: FixtureAppointmentTicketIdentity,
): Promise<FixtureTicketSyncResult> {
  if (!isIsoBusinessDate(input.businessDate)) {
    throw new Error(
      `Fixture appointment ${input.appointmentId} has an invalid business date`,
    );
  }

  const [ticket] = await tx.$queryRaw<LockedFixtureTicket[]>(Prisma.sql`
    SELECT
      "queue_ticket_id"::TEXT AS "queue_ticket_id",
      "customer_id",
      "legacy_queue_status_id"::TEXT AS "legacy_queue_status_id",
      "business_date"::TEXT AS "business_date",
      "current_step"
    FROM "opd_queue_ticket"
    WHERE "clinic_id" = ${input.clinicId}
      AND "branch_id" = ${input.branchId}
      AND "appointment_id" = ${input.appointmentId}
      AND "source_type" = 'APPOINTMENT'
    FOR UPDATE
  `);
  if (!ticket) return { outcome: "NO_TICKET" };

  const [appointment, encounter, legacyQueueStatus] = await Promise.all([
    tx.appointment.findFirst({
      where: {
        appointment_id: input.appointmentId,
        clinic_id: input.clinicId,
        branch_id: input.branchId,
      },
      select: { customer_id: true, date_appointment: true },
    }),
    tx.opd_encounter.findUnique({
      where: {
        queue_ticket_id_clinic_id_branch_id: {
          queue_ticket_id: ticket.queue_ticket_id,
          clinic_id: input.clinicId,
          branch_id: input.branchId,
        },
      },
      select: { encounter_id: true },
    }),
    ticket.legacy_queue_status_id
      ? tx.queue_status.findFirst({
          where: {
            queue_status_id: ticket.legacy_queue_status_id,
            appointment_id: input.appointmentId,
            clinic_id: input.clinicId,
            branch_id: input.branchId,
          },
          select: { current_step: true },
        })
      : null,
  ]);

  if (encounter) {
    throw new Error(
      `Refusing to move fixture ticket ${ticket.queue_ticket_id}; encounter ${encounter.encounter_id} already exists`,
    );
  }
  if (
    !appointment ||
    appointment.customer_id !== input.customerId ||
    appointment.date_appointment !== input.businessDate ||
    ticket.customer_id !== input.customerId ||
    !legacyQueueStatus ||
    legacyQueueStatus.current_step !== ticket.current_step
  ) {
    throw new Error(
      `Fixture ticket ${ticket.queue_ticket_id} is not otherwise reconciled`,
    );
  }
  if (ticket.business_date === input.businessDate) {
    return {
      outcome: "UNCHANGED",
      queueTicketId: ticket.queue_ticket_id,
      previousBusinessDate: ticket.business_date,
      businessDate: input.businessDate,
    };
  }

  const periodKey = input.businessDate.replaceAll("-", "");
  const sequence = await tx.opd_number_sequence.upsert({
    where: {
      clinic_id_branch_id_number_kind_period_key: {
        clinic_id: input.clinicId,
        branch_id: input.branchId,
        number_kind: "QUEUE",
        period_key: periodKey,
      },
    },
    create: {
      clinic_id: input.clinicId,
      branch_id: input.branchId,
      number_kind: "QUEUE",
      period_key: periodKey,
      next_value: 2n,
    },
    update: {
      next_value: { increment: 1n },
      version: { increment: 1 },
    },
    select: { next_value: true },
  });
  const allocated = sequence.next_value - 1n;
  if (allocated > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`QUEUE number sequence ${periodKey} exceeded safe range`);
  }
  const queueSequence = Number(allocated);
  const displayNumber = `Q${String(queueSequence).padStart(3, "0")}`;
  const updated = await tx.opd_queue_ticket.updateMany({
    where: {
      queue_ticket_id: ticket.queue_ticket_id,
      clinic_id: input.clinicId,
      branch_id: input.branchId,
      appointment_id: input.appointmentId,
      source_type: "APPOINTMENT",
      business_date: new Date(`${ticket.business_date}T00:00:00.000Z`),
    },
    data: {
      business_date: new Date(`${input.businessDate}T00:00:00.000Z`),
      queue_sequence: queueSequence,
      display_number: displayNumber,
      version: { increment: 1 },
      updated_at: new Date(),
    },
  });
  if (updated.count !== 1) {
    throw new Error(
      `Fixture ticket ${ticket.queue_ticket_id} changed concurrently`,
    );
  }

  return {
    outcome: "REALLOCATED",
    queueTicketId: ticket.queue_ticket_id,
    previousBusinessDate: ticket.business_date,
    businessDate: input.businessDate,
    queueSequence,
    displayNumber,
  };
}
