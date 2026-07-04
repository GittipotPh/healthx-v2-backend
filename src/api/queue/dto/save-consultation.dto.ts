import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

/** The sales outcome recorded when a card is sent to consult. */
export const CONSULT_OUTCOMES = ["interested", "deciding", "closed"] as const;

/**
 * Persists the "ส่งปรึกษา" consult detail fields for an appointment and advances
 * its queue card to CONSULTING. Scope (clinic/branch) and the actor are derived
 * server-side from the request, never taken from this body.
 */
export class SaveConsultationDto {
  @IsString()
  @MaxLength(50)
  appointmentId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  consultantRef?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budget?: number;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  promotion?: string;

  @IsString()
  @IsIn(CONSULT_OUTCOMES)
  outcome!: (typeof CONSULT_OUTCOMES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  servicesInterested?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}
