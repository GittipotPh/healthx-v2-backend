import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";

/** Allergy-check outcomes recorded when anaesthetic is applied. */
export const ANESTHETIC_ALLERGY_STATUSES = ["none", "has", "unchecked"] as const;

/**
 * Persists the "แปะยาชา" anaesthetic detail fields for an appointment and keeps
 * its queue card on ANESTHETIC. Scope (clinic/branch) and the actor are derived
 * server-side from the request, never taken from this body.
 */
export class SaveAnestheticDto {
  @IsString()
  @MaxLength(50)
  appointmentId!: string;

  @IsString()
  @IsIn(ANESTHETIC_ALLERGY_STATUSES)
  allergyStatus!: (typeof ANESTHETIC_ALLERGY_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  allergyNotes?: string;

  @IsString()
  @MaxLength(100)
  nurseRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  room?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  bed?: string;

  @IsInt()
  @Min(1)
  @Max(240)
  durationMinutes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
