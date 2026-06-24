import { statusAppointment } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

/**
 * Records a queue-card status transition: optionally advances the appointment
 * status and always writes an audit_log entry describing the action.
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

  /** When provided, the appointment's status_appointment is updated to this. */
  @IsOptional()
  @IsEnum(statusAppointment)
  appointmentStatus?: statusAppointment;

  @IsString()
  @MaxLength(50)
  actorUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  actorRole?: string;

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
