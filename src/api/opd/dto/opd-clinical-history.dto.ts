import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const EXAMINATION_STATUSES = ["DRAFT", "FINAL", "CORRECTED", "VOID"] as const;

export enum OpdVitalTrendMetric {
  WEIGHT_KG = "WEIGHT_KG",
  BODY_MASS_INDEX = "BODY_MASS_INDEX",
  BLOOD_PRESSURE = "BLOOD_PRESSURE",
  PULSE_RATE = "PULSE_RATE",
  TEMPERATURE = "TEMPERATURE",
  OXYGEN_SATURATION = "OXYGEN_SATURATION",
  RESPIRATORY_RATE = "RESPIRATORY_RATE",
  DTX = "DTX",
  PAIN_SCORE = "PAIN_SCORE",
}

export class QueryCustomerExaminationHistoryDto {
  @ApiPropertyOptional({
    description: "Inclusive Bangkok business-date lower bound (YYYY-MM-DD)",
  })
  @IsOptional()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, {
    message: "dateFrom must match YYYY-MM-DD",
  })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: "Inclusive Bangkok business-date upper bound (YYYY-MM-DD)",
  })
  @IsOptional()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, {
    message: "dateTo must match YYYY-MM-DD",
  })
  dateTo?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  recorderUserId?: string;

  @ApiPropertyOptional({
    enum: EXAMINATION_STATUSES,
    enumName: "OpdExaminationHistoryStatus",
  })
  @IsOptional()
  @IsIn(EXAMINATION_STATUSES)
  status?: (typeof EXAMINATION_STATUSES)[number];

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}

export class QueryCustomerVitalTrendDto {
  @ApiPropertyOptional({
    enum: OpdVitalTrendMetric,
    enumName: "OpdVitalTrendMetric",
    default: OpdVitalTrendMetric.WEIGHT_KG,
  })
  @IsOptional()
  @IsEnum(OpdVitalTrendMetric)
  metric?: OpdVitalTrendMetric = OpdVitalTrendMetric.WEIGHT_KG;

  @ApiPropertyOptional({
    description: "Inclusive Bangkok business-date lower bound (YYYY-MM-DD)",
  })
  @IsOptional()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, {
    message: "dateFrom must match YYYY-MM-DD",
  })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: "Inclusive Bangkok business-date upper bound (YYYY-MM-DD)",
  })
  @IsOptional()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, {
    message: "dateTo must match YYYY-MM-DD",
  })
  dateTo?: string;

  @ApiPropertyOptional({ maxLength: 50 })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  recorderUserId?: string;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 500,
    default: 200,
    description: "Maximum number of newest non-empty points returned",
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 200;
}
