import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";
import { IsBusinessDate } from "./business-date.validator";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class RescheduleAppointmentDto {
  @ApiProperty({
    description: "YYYY-MM-DD (zero-padded, lexically sortable)",
    example: "2026-07-01",
  })
  @IsString()
  @IsBusinessDate({
    message:
      "dateAppointment must be a real calendar date in YYYY-MM-DD format",
  })
  dateAppointment!: string;

  @ApiProperty({
    description: "HH:mm (24-hour, zero-padded)",
    example: "10:00",
  })
  @IsString()
  @Matches(TIME_PATTERN, {
    message: "startTime must match HH:mm (24-hour, zero-padded)",
  })
  startTime!: string;
}
