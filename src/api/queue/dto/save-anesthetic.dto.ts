import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** Allergy-check outcomes recorded when anaesthetic is applied. */
export const ANESTHETIC_ALLERGY_STATUSES = ["none", "has", "unchecked"] as const;

/**
 * Persists the "แปะยาชา" anaesthetic detail fields for an appointment and keeps
 * its queue card on ANESTHETIC. Scope (clinic/branch) and the actor are derived
 * server-side from the request, never taken from this body.
 */
export class SaveAnestheticDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MaxLength(50)
  appointmentId!: string;

  @ApiProperty({
    enum: ANESTHETIC_ALLERGY_STATUSES,
    enumName: "AnestheticAllergyStatus",
    description: '"has" requires allergyNotes (enforced server-side)',
  })
  @IsString()
  @IsIn(ANESTHETIC_ALLERGY_STATUSES)
  allergyStatus!: (typeof ANESTHETIC_ALLERGY_STATUSES)[number];

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  allergyNotes?: string;

  @ApiProperty({ maxLength: 100 })
  @IsString()
  @MaxLength(100)
  nurseRef!: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  room?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  bed?: string;

  @ApiProperty({ minimum: 1, maximum: 240 })
  @IsInt()
  @Min(1)
  @Max(240)
  durationMinutes!: number;

  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
