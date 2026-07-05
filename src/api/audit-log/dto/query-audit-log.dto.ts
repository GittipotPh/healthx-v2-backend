import { ApiPropertyOptional } from "@nestjs/swagger";
import { auditReferenceType } from "@prisma/client";
import { Type } from "class-transformer";
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class QueryAuditLogDto {
  @ApiPropertyOptional({ enum: auditReferenceType, enumName: "AuditReferenceType" })
  @IsOptional()
  @IsEnum(auditReferenceType)
  referenceType?: auditReferenceType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  referenceId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  actorUserId?: string;

  /** Free-text search across action label, actor name, reference id, notes. */
  @ApiPropertyOptional({ description: "Free-text search across action label, actor name, reference id, notes" })
  @IsOptional()
  @IsString()
  search?: string;

  /** ISO date (inclusive lower bound) on created_at. */
  @ApiPropertyOptional({ description: "ISO date (inclusive lower bound) on created_at" })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  /** ISO date (inclusive upper bound) on created_at. */
  @ApiPropertyOptional({ description: "ISO date (inclusive upper bound) on created_at" })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
