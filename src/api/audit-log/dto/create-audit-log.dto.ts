import { auditReferenceType } from "@prisma/client";
import {
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export class CreateAuditLogDto {
  @IsEnum(auditReferenceType)
  referenceType!: auditReferenceType;

  @IsString()
  @MaxLength(50)
  referenceId!: string;

  @IsString()
  @MaxLength(100)
  action!: string;

  @IsString()
  @MaxLength(200)
  actionLabel!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  fromStatus?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  toStatus?: string;

  @IsString()
  @MaxLength(50)
  actorUserId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  actorRole?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  onBehalfOfUserId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  onBehalfOfName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationSec?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  ipAddress?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
