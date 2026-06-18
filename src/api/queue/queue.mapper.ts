import type { appointment, customer, opd, statusAppointment } from "@prisma/client";

export type AppointmentForQueue = appointment & {
  customer?: customer | null;
  opd?: opd | null;
};

export type QueueStatus =
  | "confirmed"
  | "in-service"
  | "completed"
  | "cancelled"
  | "pending";

export interface QueueItemView {
  id: string;
  appointmentId: string;
  queueNo: string;
  time: string;
  hn: string;
  name: string | null;
  nickname: string | null;
  phone: string | null;
  gender: string | null;
  doctorRoom: string | null;
  channel: string | null;
  status: QueueStatus;
  appointmentStatus: statusAppointment;
  opdId: string | null;
  opdStatus: string | null;
  isConsult: boolean;
  applyAnesthetic: boolean;
}

function deriveStatus(status: statusAppointment): QueueStatus {
  switch (status) {
    case "CANCEL":
      return "cancelled";
    case "SUCCESS":
      return "completed";
    case "IN_SERVICE":
      return "in-service";
    case "CONFIRM":
      return "confirmed";
    case "APPOINT":
    default:
      return "pending";
  }
}

export function toQueueItemView(row: AppointmentForQueue, index: number): QueueItemView {
  const name = row.customer ? `${row.customer.name} ${row.customer.lastname}`.trim() : null;
  const queueNo = `Q${String(index + 1).padStart(3, "0")}`;

  return {
    id: row.appointment_id,
    appointmentId: row.appointment_id,
    queueNo,
    time: row.start_time,
    hn: row.customer?.personal_id ?? row.customer_id,
    name,
    nickname: row.customer?.nickname ?? null,
    phone: row.customer?.phone_number ?? null,
    gender: row.customer?.gender ?? null,
    doctorRoom: row.room,
    channel: row.channel,
    status: deriveStatus(row.status_appointment),
    appointmentStatus: row.status_appointment,
    opdId: row.opd_id,
    opdStatus: row.opd ? row.opd.status_opd : null,
    isConsult: row.is_consult,
    applyAnesthetic: row.apply_anesthetic,
  };
}
