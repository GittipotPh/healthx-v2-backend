import { PrismaService } from "../src/prisma.service";
import { syncFixtureAppointmentTicket } from "./opd-v2-fixture-ticket-sync";

const FIXTURE_APPOINTMENT_IDS = [
  "APP-FUTURE-RITZ-01",
  "APP-FUTURE-RITZ-02",
  "APP-TODAY-RITZ-02",
  "APP-TODAY-RITZ-03",
] as const;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaService();
  await prisma.$connect();

  try {
    const [tickets, appointments] = await Promise.all([
      prisma.opd_queue_ticket.findMany({
        where: { appointment_id: { in: [...FIXTURE_APPOINTMENT_IDS] } },
        select: {
          queue_ticket_id: true,
          clinic_id: true,
          branch_id: true,
          customer_id: true,
          appointment_id: true,
          business_date: true,
          queue_sequence: true,
          display_number: true,
          encounter: { select: { encounter_id: true } },
        },
      }),
      prisma.appointment.findMany({
        where: { appointment_id: { in: [...FIXTURE_APPOINTMENT_IDS] } },
        select: {
          appointment_id: true,
          clinic_id: true,
          branch_id: true,
          customer_id: true,
          date_appointment: true,
        },
      }),
    ]);
    const ticketByAppointment = new Map(
      tickets.flatMap((ticket) =>
        ticket.appointment_id ? [[ticket.appointment_id, ticket]] : [],
      ),
    );
    const appointmentById = new Map(
      appointments.map((appointment) => [
        appointment.appointment_id,
        appointment,
      ]),
    );
    const preview = FIXTURE_APPOINTMENT_IDS.map((appointmentId) => {
      const ticket = ticketByAppointment.get(appointmentId);
      const appointment = appointmentById.get(appointmentId);
      return {
        appointmentId,
        queueTicketId: ticket?.queue_ticket_id ?? null,
        ticketBusinessDate:
          ticket?.business_date.toISOString().slice(0, 10) ?? null,
        appointmentBusinessDate: appointment?.date_appointment ?? null,
        encounterId: ticket?.encounter?.encounter_id ?? null,
        needsRepair:
          Boolean(ticket && appointment) &&
          ticket?.business_date.toISOString().slice(0, 10) !==
            appointment?.date_appointment,
      };
    });
    process.stdout.write(
      `${JSON.stringify({ mode: apply ? "apply" : "dry-run", preview }, null, 2)}\n`,
    );

    if (!apply) return;
    const blocked = preview.filter(
      (row) =>
        !row.queueTicketId ||
        !row.appointmentBusinessDate ||
        row.encounterId !== null,
    );
    if (blocked.length > 0) {
      throw new Error(
        `Fixture ticket repair preflight failed for ${blocked.map((row) => row.appointmentId).join(", ")}`,
      );
    }

    const results = await prisma.$transaction(async (tx) => {
      const synced = [];
      for (const appointmentId of FIXTURE_APPOINTMENT_IDS) {
        const ticket = ticketByAppointment.get(appointmentId);
        const appointment = appointmentById.get(appointmentId);
        if (!ticket || !appointment) {
          throw new Error(`Missing repair identity for ${appointmentId}`);
        }
        if (
          ticket.clinic_id !== appointment.clinic_id ||
          ticket.branch_id !== appointment.branch_id ||
          ticket.customer_id !== appointment.customer_id
        ) {
          throw new Error(
            `Fixture ticket ${ticket.queue_ticket_id} has a non-date identity mismatch`,
          );
        }
        synced.push(
          await syncFixtureAppointmentTicket(tx, {
            clinicId: ticket.clinic_id,
            branchId: ticket.branch_id,
            appointmentId,
            customerId: ticket.customer_id,
            businessDate: appointment.date_appointment,
          }),
        );
      }
      return synced;
    });
    process.stdout.write(`${JSON.stringify({ repaired: results }, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
