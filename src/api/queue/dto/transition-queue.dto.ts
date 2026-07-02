import { statusAppointment } from "@prisma/client";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";
import { STEP_TO_APPOINTMENT_STATUS } from "../queue.constants";

/** The known `ref_queue_step_status.code` values a card may be moved to. */
const QUEUE_STEP_CODES = Object.keys(STEP_TO_APPOINTMENT_STATUS);

/**
 * Records a queue-card transition: optionally moves the card to a new
 * queue_status.current_step (Kanban column) and/or the appointment's
 * status_appointment, and always writes an audit_log entry describing the
 * action. The actor (who performed it) is derived server-side from the
 * authenticated principal/scope, not taken from the client.
 */
export class TransitionQueueDto {
  @IsString()
  @MaxLength(50)
  appointmentId!: string;

  /** Machine action key, e.g. "check-in", "send-to-consulting". */
  @IsString()
  @MaxLength(100)
  action!: string;

  /** Human-readable Thai label, e.g. "มาถึงแล้ว". */
  @IsString()
  @MaxLength(200)
  actionLabel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  toStatus?: string;

  /**
   * A `ref_queue_step_status.code` (e.g. "ARRIVED") to move the Kanban card
   * to. When provided and `appointmentStatus` is omitted, status_appointment
   * is also best-effort synced via STEP_TO_APPOINTMENT_STATUS.
   */
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @IsIn(QUEUE_STEP_CODES)
  step?: string;

  /** When provided, the appointment's status_appointment is updated to this (overrides the step-derived value). */
  @IsOptional()
  @IsEnum(statusAppointment)
  appointmentStatus?: statusAppointment;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  onBehalfOfUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  onBehalfOfName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
