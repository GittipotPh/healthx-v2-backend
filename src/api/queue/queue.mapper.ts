import { ApiProperty } from "@nestjs/swagger";
import { statusAppointment, type customer_info, type queue_config } from "@prisma/client";
import { QUEUE_STEP_COLUMNS, stepCodeToColumnId } from "./queue.constants";
import {
  QueueAutomationSettingDto,
  QueueColumnSettingDto,
  QueueNotificationsSettingDto,
  QueueSlaSettingDto,
  QueueTrackingSettingDto,
  QueueTransitionsSettingDto,
  type SaveQueueConfigDto,
} from "./dto/save-queue-config.dto";

// Re-exported for existing consumers; the definitions moved to queue.constants
// so DTOs can use them without importing this mapper (avoids an import cycle).
export { QUEUE_STEP_COLUMNS, stepCodeToColumnId };

export interface AppointmentRecord {
  appointment_id: string;
  clinic_id: string;
  branch_id: string;
  customer_id: string;
  room: string | null;
  channel: string | null;
  date_appointment: string;
  time_arrive: string;
  start_time: string;
  end_time: string;
  is_consult: boolean;
  apply_anesthetic: boolean;
  appointment_detail: string | null;
  status_appointment: statusAppointment;
  opd_id: string | null;
}

export interface AppointmentForQueue extends AppointmentRecord {
  customer?: {
    name: string;
    lastname: string;
    personal_id: string;
    nickname: string | null;
    phone_number: string | null;
    gender: string;
    customer_image: string | null;
    customer_info?: Pick<customer_info, "allergy"> | null;
  } | null;
  opd?: { status_opd: string } | null;
}

export const QUEUE_STATUSES = [
  "confirmed",
  "in-service",
  "completed",
  "cancelled",
  "pending",
] as const;

export type QueueStatus = (typeof QUEUE_STATUSES)[number];

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

/**
 * API view of a branch's queue configuration. `queueConfigId`/timestamps are
 * null when serving the built-in defaults (no row persisted yet). Section
 * shapes reuse the save DTO classes so the wire contract is single-sourced.
 */
export class QueueConfigView {
  @ApiProperty({ type: String, nullable: true, description: "null when serving unsaved defaults" })
  queueConfigId!: string | null;

  @ApiProperty()
  clinicId!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ type: [QueueColumnSettingDto] })
  columns!: QueueColumnSettingDto[];

  @ApiProperty({ type: [QueueSlaSettingDto] })
  sla!: QueueSlaSettingDto[];

  @ApiProperty({ type: QueueTransitionsSettingDto })
  transitions!: QueueTransitionsSettingDto;

  @ApiProperty({ type: QueueAutomationSettingDto })
  automation!: QueueAutomationSettingDto;

  @ApiProperty({ type: QueueTrackingSettingDto })
  tracking!: QueueTrackingSettingDto;

  @ApiProperty({ type: QueueNotificationsSettingDto })
  notifications!: QueueNotificationsSettingDto;

  @ApiProperty({
    type: "object",
    additionalProperties: { type: "array", items: { type: "string" } },
    description: "Column id -> roles allowed to act on that column",
  })
  permissions!: Record<string, string[]>;

  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "ISO timestamp; null for unsaved defaults" })
  updatedAt!: string | null;

  @ApiProperty({ type: String, nullable: true, description: "ISO timestamp; null for unsaved defaults" })
  createdAt!: string | null;
}

export function toQueueConfigView(row: queue_config): QueueConfigView {
  return {
    queueConfigId: row.queue_config_id,
    clinicId: row.clinic_id,
    branchId: row.branch_id,
    // Json columns: rows are only written through the validated SaveQueueConfigDto,
    // so these casts restate the write-side contract rather than invent one.
    columns: row.columns as unknown as QueueColumnSettingDto[],
    sla: row.sla as unknown as QueueSlaSettingDto[],
    transitions: row.transitions as unknown as QueueTransitionsSettingDto,
    automation: row.automation as unknown as QueueAutomationSettingDto,
    tracking: row.tracking as unknown as QueueTrackingSettingDto,
    notifications: row.notifications as unknown as QueueNotificationsSettingDto,
    permissions: row.permissions as unknown as Record<string, string[]>,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

/** The built-in defaults presented as a (non-persisted) view for GET. */
export function defaultQueueConfigView(
  clinicId: string,
  branchId: string,
  defaults: SaveQueueConfigDto,
): QueueConfigView {
  return {
    queueConfigId: null,
    clinicId,
    branchId,
    columns: defaults.columns,
    sla: defaults.sla,
    transitions: defaults.transitions,
    automation: defaults.automation,
    tracking: defaults.tracking,
    notifications: defaults.notifications,
    permissions: defaults.permissions,
    updatedBy: null,
    updatedAt: null,
    createdAt: null,
  };
}
