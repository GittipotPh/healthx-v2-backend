import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from "class-validator";

export enum OpdDraftCopySectionCode {
  SYMPTOMS = "SYMPTOMS",
  INTAKE = "INTAKE",
  DIAGNOSES = "DIAGNOSES",
  NOTE_CHIEF_COMPLAINT = "NOTE_CHIEF_COMPLAINT",
  NOTE_PHYSICAL_EXAMINATION = "NOTE_PHYSICAL_EXAMINATION",
  NOTE_DIAGNOSIS_NARRATIVE = "NOTE_DIAGNOSIS_NARRATIVE",
  NOTE_TREATMENT = "NOTE_TREATMENT",
  NOTE_TREATMENT_PLAN = "NOTE_TREATMENT_PLAN",
  NOTE_ADDITIONAL_NOTES = "NOTE_ADDITIONAL_NOTES",
  NOTE_FREE_NOTE = "NOTE_FREE_NOTE",
}

export enum OpdDraftAuthorFilter {
  ALL = "ALL",
  MINE = "MINE",
}

export class QueryReusableOpdDraftsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;

  @ApiPropertyOptional({ enum: OpdDraftAuthorFilter, default: "ALL" })
  @IsOptional()
  @IsIn(Object.values(OpdDraftAuthorFilter))
  author?: OpdDraftAuthorFilter = OpdDraftAuthorFilter.ALL;
}

export class OpdDraftExpectedTargetVersionsDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  encounterVersion!: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  examinationVersion?: number = 0;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  symptomSectionVersion?: number = 0;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  intakeVersion?: number = 0;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  diagnosisSectionVersion?: number = 0;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  noteWorkspaceVersion?: number = 0;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: { type: "integer", minimum: 0 },
    default: {},
  })
  @IsOptional()
  @IsObject()
  noteSections?: Record<string, number> = {};
}

export class ImportOpdDraftDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  sourceSnapshotId!: string;

  @ApiProperty({
    enum: OpdDraftCopySectionCode,
    isArray: true,
    minItems: 1,
    maxItems: 10,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsIn(Object.values(OpdDraftCopySectionCode), { each: true })
  selectedSections!: OpdDraftCopySectionCode[];

  @ApiProperty({ type: OpdDraftExpectedTargetVersionsDto })
  @ValidateNested()
  @Type(() => OpdDraftExpectedTargetVersionsDto)
  expectedTargetVersions!: OpdDraftExpectedTargetVersionsDto;
}

export class ReviewImportedOpdDraftSectionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  targetResourceId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  targetResourceVersion!: number;
}
