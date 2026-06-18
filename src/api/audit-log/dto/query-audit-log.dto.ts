import { auditReferenceType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class QueryAuditLogDto {
  @IsOptional()
  @IsString()
  clinicId?: string;

  @IsOptional()
  @IsString()
  branchId?: string;

  @IsOptional()
  @IsEnum(auditReferenceType)
  referenceType?: auditReferenceType;

  @IsOptional()
  @IsString()
  referenceId?: string;

  @IsOptional()
  @IsString()
  actorUserId?: string;

  /** Free-text search across action label, actor name, reference id, notes. */
  @IsOptional()
  @IsString()
  search?: string;

  /** ISO date (inclusive lower bound) on created_at. */
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO date (inclusive upper bound) on created_at. */
  @IsOptional()
  @IsString()
  dateTo?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
