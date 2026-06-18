import { statusAppointment } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class QueryAppointmentsDto {
  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsEnum(statusAppointment)
  status?: statusAppointment;

  /** date_appointment lower bound (string, e.g. "2026-06-17"). */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** date_appointment upper bound. */
  @IsOptional()
  @IsString()
  dateTo?: string;

  /** Exact date_appointment match (convenience for a single-day view). */
  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 100;
}
