import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * Appointment starts derive the customer from the scoped appointment. A
 * customerId-only request explicitly means walk-in and never creates a
 * synthetic appointment. The service enforces that exactly one field is set.
 */
export class StartOpdDto {
  @ApiPropertyOptional({
    maxLength: 50,
    description:
      "Scoped legacy appointment reference for an appointment-backed visit",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appointmentId?: string;

  @ApiPropertyOptional({
    maxLength: 50,
    description:
      "Scoped legacy customer reference for an explicit walk-in visit",
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  customerId?: string;
}
