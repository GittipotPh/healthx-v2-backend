import { ApiProperty } from "@nestjs/swagger";
import { statusAppointment, type appointment, type customer, type customer_info, type opd } from "@prisma/client";
import { STEP_TO_APPOINTMENT_STATUS } from "./queue.constants";

export type AppointmentForQueue = appointment & {
  customer?: (customer & { customer_info?: customer_info | null }) | null;
  opd?: opd | null;
};

/** `ref_queue_step_status.code` (e.g. "PENDING_PAYMENT") -> Kanban column id ("pending-payment"). */
export function stepCodeToColumnId(code: string): string {
  return code.toLowerCase().replace(/_/g, "-");
}

export const QUEUE_STATUSES = [
  "confirmed",
  "in-service",
  "completed",
  "cancelled",
  "pending",
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

/** Kanban column ids: the seeded `ref_queue_step_status` catalog, lowercased/dashed. */
export const QUEUE_STEP_COLUMNS = Object.keys(STEP_TO_APPOINTMENT_STATUS).map(stepCodeToColumnId);

export class QueueItemView {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  appointmentId!: string;

  @ApiProperty({ description: 'Display queue number, e.g. "Q001"' })
  queueNo!: string;

  @ApiProperty({ description: "Appointment start time (HH:mm)" })
  time!: string;

  @ApiProperty({ description: 'Customer HN (personal id); "—" placeholder when absent' })
  hn!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;

  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  gender!: string | null;

  @ApiProperty({ type: String, nullable: true })
  doctorRoom!: string | null;

  @ApiProperty({ type: String, nullable: true })
  channel!: string | null;

  @ApiProperty({
    enum: QUEUE_STATUSES,
    enumName: "QueueStatus",
    description: "Coarse 5-value status derived from statusAppointment (fallback when `step` is null)",
  })
  status!: QueueStatus;

  @ApiProperty({ enum: statusAppointment, enumName: "StatusAppointment" })
  appointmentStatus!: statusAppointment;

  @ApiProperty({
    enum: QUEUE_STEP_COLUMNS,
    enumName: "QueueStepColumn",
    nullable: true,
    description:
      'Kanban column id from queue_status.current_step (e.g. "pending-payment"); null if no queue_status row exists yet (legacy/pre-bootstrap appointments).',
  })
  step!: string | null;

  @ApiProperty({ type: String, nullable: true })
  opdId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  opdStatus!: string | null;

  @ApiProperty()
  isConsult!: boolean;

  @ApiProperty()
  applyAnesthetic!: boolean;

  @ApiProperty({ type: String, nullable: true })
  customerImage!: string | null;

  @ApiProperty({ type: [String] })
  allergies!: string[];

  @ApiProperty({ type: String, nullable: true })
  appointmentDetail!: string | null;

  @ApiProperty()
  cancelHistory!: number;

  @ApiProperty()
  lateHistory!: number;

  @ApiProperty()
  rescheduleHistory!: number;
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
    // Never fall back to customer_id here: it's an internal DB id, not an HN,
    // and must not be shown to (or leak into) the client.
    hn: row.customer?.personal_id ?? "—",
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
    customerImage: row.customer?.customer_image ?? null,
    allergies,
    appointmentDetail: row.appointment_detail,
    cancelHistory: history?.cancelHistory ?? 0,
    lateHistory: history?.lateHistory ?? 0,
    rescheduleHistory: history?.rescheduleHistory ?? 0,
  };
}
