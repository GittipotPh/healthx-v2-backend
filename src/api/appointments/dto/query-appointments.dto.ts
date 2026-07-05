import { ApiPropertyOptional } from "@nestjs/swagger";
import { statusAppointment } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class QueryAppointmentsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ enum: statusAppointment, enumName: "StatusAppointment" })
  @IsOptional()
  @IsEnum(statusAppointment)
  status?: statusAppointment;

  /** date_appointment lower bound (string, e.g. "2026-06-17"). */
  @ApiPropertyOptional({ description: 'date_appointment lower bound (e.g. "2026-06-17")' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** date_appointment upper bound. */
  @ApiPropertyOptional({ description: "date_appointment upper bound" })
  @IsOptional()
  @IsString()
  dateTo?: string;

  /** Exact date_appointment match (convenience for a single-day view). */
  @ApiPropertyOptional({ description: "Exact date_appointment match (single-day view)" })
  @IsOptional()
  @IsString()
  date?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number = 100;
}
