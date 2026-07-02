import { IsBoolean, IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Minimal create-appointment payload: enough fields to satisfy the legacy
 * `appointment` schema and bootstrap the new Kanban queue_status row.
 * Operator/assistant/procedure assignment (legacy user_appointment /
 * operation_appointment) is intentionally out of scope here — the full
 * ComprehensiveAppointmentModal wiring is a separate, larger task.
 */
export class CreateAppointmentDto {
  @IsString()
  @MaxLength(50)
  customerId!: string;

  /** e.g. "2026-07-01". */
  @IsString()
  @MaxLength(50)
  dateAppointment!: string;

  @IsString()
  @MaxLength(20)
  timeArrive!: string;

  @IsString()
  @MaxLength(20)
  startTime!: string;

  @IsString()
  @MaxLength(20)
  endTime!: string;

  @IsBoolean()
  isConsult!: boolean;

  @IsBoolean()
  applyAnesthetic!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  room?: string;

  @IsOptional()
  @IsString()
  detail?: string;

  @IsOptional()
  @IsString()
  opdId?: string;
}
