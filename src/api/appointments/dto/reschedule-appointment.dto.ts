import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";

const DATE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RescheduleAppointmentDto {
  @ApiProperty({ description: "YYYY-MM-DD (zero-padded, lexically sortable)", example: "2026-07-01" })
  @IsString()
  @Matches(DATE_PATTERN, { message: "dateAppointment must match YYYY-MM-DD" })
  dateAppointment!: string;

  @ApiProperty({ description: "HH:mm (24-hour, zero-padded)", example: "10:00" })
  @IsString()
  @Matches(TIME_PATTERN, { message: "startTime must match HH:mm (24-hour, zero-padded)" })
  startTime!: string;
}
