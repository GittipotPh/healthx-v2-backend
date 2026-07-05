import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from "class-validator";

/**
 * Date/time columns on the legacy `appointment` table are VARCHAR and are
 * compared lexically everywhere (Prisma lte/gte range filters, late detection
 * via time_arrive > start_time), so writes MUST be zero-padded sortable
 * strings: dates as YYYY-MM-DD (legacy `moment().format('YYYY-MM-DD')`) and
 * times as HH:mm (legacy work-schedule validates `/^(\d{2}):(\d{2})$/`).
 */
const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Minimal create-appointment payload: enough fields to satisfy the legacy
 * `appointment` schema and bootstrap the new Kanban queue_status row.
 * Operator/assistant/procedure assignment (legacy user_appointment /
 * operation_appointment) is intentionally out of scope here — the full
 * ComprehensiveAppointmentModal wiring is a separate, larger task.
 */
export class CreateAppointmentDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  customerId!: string;

  /** e.g. "2026-07-01". */
  @ApiProperty({ description: "YYYY-MM-DD (zero-padded, lexically sortable)", example: "2026-07-01" })
  @IsString()
  @Matches(DATE_PATTERN, { message: "dateAppointment must match YYYY-MM-DD" })
  dateAppointment!: string;

  @ApiProperty({ description: "HH:mm (24-hour, zero-padded)", example: "09:30" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "timeArrive must match HH:mm (24-hour, zero-padded)" })
  timeArrive!: string;

  @ApiProperty({ description: "HH:mm (24-hour, zero-padded)", example: "10:00" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "startTime must match HH:mm (24-hour, zero-padded)" })
  startTime!: string;

  @ApiProperty({ description: "HH:mm (24-hour, zero-padded)", example: "11:00" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "endTime must match HH:mm (24-hour, zero-padded)" })
  endTime!: string;

  @ApiProperty()
  @IsBoolean()
  isConsult!: boolean;

  @ApiProperty()
  @IsBoolean()
  applyAnesthetic!: boolean;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  channel?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  room?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  detail?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  opdId?: string;
}
