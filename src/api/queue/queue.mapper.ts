import type { appointment, customer, customer_info, opd, statusAppointment } from "@prisma/client";

export type AppointmentForQueue = appointment & {
  customer?: (customer & { customer_info?: customer_info | null }) | null;
  opd?: opd | null;
};

/** `ref_queue_step_status.code` (e.g. "PENDING_PAYMENT") -> Kanban column id ("pending-payment"). */
export function stepCodeToColumnId(code: string): string {
  return code.toLowerCase().replace(/_/g, "-");
}

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
  /** Kanban column id from queue_status.current_step (e.g. "pending-payment"); null if no queue_status row exists yet (legacy/pre-bootstrap appointments). */
  step: string | null;
  opdId: string | null;
  opdStatus: string | null;
  isConsult: boolean;
  applyAnesthetic: boolean;
  allergies: string[];
  appointmentDetail: string | null;
  cancelHistory: number;
  lateHistory: number;
  rescheduleHistory: number;
}

// Collapses the granular statusAppointment enum into the coarse 5-value
// QueueStatus. Only used as a fallback for appointments with no queue_status
// row yet (pre-bootstrap); once a card has a `step`, the frontend prefers that.
// The granular in-service steps (CONSULTING/PENDING_PAYMENT/ANESTHETIC/
// DISPENSING/VERIFIED) all bucket to "in-service"; ARRIVED buckets to
// "confirmed" (checked in, not yet in service).
function deriveStatus(status: statusAppointment): QueueStatus {
  switch (status) {
    case "CANCEL":
      return "cancelled";
    case "SUCCESS":
      return "completed";
    case "CONSULTING":
    case "PENDING_PAYMENT":
    case "ANESTHETIC":
    case "IN_SERVICE":
    case "DISPENSING":
    case "VERIFIED":
      return "in-service";
    case "CONFIRM":
    case "ARRIVED":
      return "confirmed";
    case "APPOINT":
    default:
      return "pending";
  }
}

export function toQueueItemView(
  row: AppointmentForQueue,
  index: number,
  history?: { cancelHistory: number; lateHistory: number; rescheduleHistory: number },
  stepCode?: string | null,
): QueueItemView {
  const name = row.customer ? `${row.customer.name} ${row.customer.lastname}`.trim() : null;
  const queueNo = `Q${String(index + 1).padStart(3, "0")}`;

  const rawAllergies = row.customer?.customer_info?.allergy;
  const allergies = rawAllergies
    ? rawAllergies.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

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
    step: stepCode ? stepCodeToColumnId(stepCode) : null,
    opdId: row.opd_id,
    opdStatus: row.opd ? row.opd.status_opd : null,
    isConsult: row.is_consult,
    applyAnesthetic: row.apply_anesthetic,
    allergies,
    appointmentDetail: row.appointment_detail,
    cancelHistory: history?.cancelHistory ?? 0,
    lateHistory: history?.lateHistory ?? 0,
    rescheduleHistory: history?.rescheduleHistory ?? 0,
  };
}
