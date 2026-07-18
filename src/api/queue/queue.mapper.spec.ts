import { statusAppointment } from "@prisma/client";
import { toQueueItemView, type AppointmentForQueue } from "./queue.mapper";

describe("toQueueItemView identity compatibility", () => {
  it("keeps id as appointmentId while exposing the canonical V2 ticket separately", () => {
    const appointment: AppointmentForQueue = {
      appointment_id: "appointment-1",
      clinic_id: "clinic-1",
      branch_id: "branch-1",
      customer_id: "customer-1",
      room: null,
      channel: null,
      date_appointment: "2026-07-18",
      time_arrive: "09:00",
      start_time: "09:00",
      end_time: "09:30",
      is_consult: false,
      apply_anesthetic: false,
      appointment_detail: null,
      status_appointment: statusAppointment.ARRIVED,
      opd_id: "opd-1",
      customer: {
        name: "Ada",
        lastname: "Lovelace",
        personal_id: "",
        nickname: null,
        phone_number: null,
        gender: "FEMALE",
        customer_image: null,
        customer_info: null,
      },
      opd: { status_opd: "PENDING" },
    };

    const view = toQueueItemView(appointment, 0, undefined, {
      legacyQueueStatusId: "legacy-queue-1",
      currentStep: "IN_SERVICE",
      queueTicketId: "ticket-1",
      encounterId: "encounter-1",
      displayNumber: "Q001",
      enteredAt: new Date("2026-07-18T03:00:00.000Z"),
    });

    expect(view.id).toBe("appointment-1");
    expect(view.appointmentId).toBe("appointment-1");
    expect(view.queueTicketId).toBe("ticket-1");
    expect(view.encounterId).toBe("encounter-1");
  });
});
