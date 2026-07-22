import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { OpdNoteSectionCode } from "./opd-clinical-note.dto";

export class OpdFinalizationResourceVersionDto {
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  id!: string | null;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  status!: string | null;
}

export class OpdFinalizationNoteSectionVersionDto extends OpdFinalizationResourceVersionDto {
  @ApiProperty({ enum: OpdNoteSectionCode })
  @IsIn(Object.values(OpdNoteSectionCode))
  sectionCode!: OpdNoteSectionCode;
}

export class OpdFinalizationImportedSectionVersionDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  sectionCode!: string;

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  targetResourceId!: string;

  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  currentVersion!: number;

  @ApiProperty({ type: Number, nullable: true, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  reviewedVersion!: number | null;
}

export class OpdFinalizationDraftImportVersionDto {
  @ApiProperty({ type: String, format: "uuid", nullable: true })
  @IsOptional()
  @IsUUID()
  id!: string | null;

  @ApiProperty({ type: [OpdFinalizationImportedSectionVersionDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OpdFinalizationImportedSectionVersionDto)
  sections!: OpdFinalizationImportedSectionVersionDto[];
}

export class OpdFinalizationOrderItemVersionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(20)
  status!: string;
}

export class OpdFinalizationOrderVersionDto extends OpdFinalizationResourceVersionDto {
  @ApiProperty({ type: [OpdFinalizationOrderItemVersionDto] })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => OpdFinalizationOrderItemVersionDto)
  items!: OpdFinalizationOrderItemVersionDto[];
}

export class OpdFinalizationQueueVersionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(30)
  currentStep!: string;
}

export class OpdClinicalFinalizationManifestDto {
  @ApiProperty({ enum: ["opd-clinical-finalization-v1"] })
  @IsIn(["opd-clinical-finalization-v1"])
  schema!: "opd-clinical-finalization-v1";

  @ApiProperty({ format: "uuid" })
  @IsUUID()
  encounterId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  encounterVersion!: number;

  @ApiProperty({ type: OpdFinalizationResourceVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationResourceVersionDto)
  examination!: OpdFinalizationResourceVersionDto;

  @ApiProperty({ type: OpdFinalizationResourceVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationResourceVersionDto)
  vitals!: OpdFinalizationResourceVersionDto;

  @ApiProperty({ type: OpdFinalizationResourceVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationResourceVersionDto)
  intake!: OpdFinalizationResourceVersionDto;

  @ApiProperty({ type: OpdFinalizationResourceVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationResourceVersionDto)
  symptoms!: OpdFinalizationResourceVersionDto;

  @ApiProperty({ type: OpdFinalizationResourceVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationResourceVersionDto)
  diagnoses!: OpdFinalizationResourceVersionDto;

  @ApiProperty({ type: OpdFinalizationResourceVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationResourceVersionDto)
  noteWorkspace!: OpdFinalizationResourceVersionDto;

  @ApiProperty({ type: [OpdFinalizationNoteSectionVersionDto] })
  @IsArray()
  @ArrayMinSize(7)
  @ArrayMaxSize(7)
  @ValidateNested({ each: true })
  @Type(() => OpdFinalizationNoteSectionVersionDto)
  noteSections!: OpdFinalizationNoteSectionVersionDto[];

  @ApiProperty({ type: OpdFinalizationDraftImportVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationDraftImportVersionDto)
  draftImport!: OpdFinalizationDraftImportVersionDto;

  @ApiProperty({ type: OpdFinalizationOrderVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationOrderVersionDto)
  order!: OpdFinalizationOrderVersionDto;

  @ApiProperty({ type: OpdFinalizationQueueVersionDto })
  @ValidateNested()
  @Type(() => OpdFinalizationQueueVersionDto)
  queue!: OpdFinalizationQueueVersionDto;

  @ApiProperty({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  appointmentId!: string | null;
}

export class FinalizeOpdClinicalDto {
  @ApiProperty({ type: OpdClinicalFinalizationManifestDto })
  @ValidateNested()
  @Type(() => OpdClinicalFinalizationManifestDto)
  expectedVersions!: OpdClinicalFinalizationManifestDto;
}

export class AssignOpdAttendingClinicianDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedEncounterVersion!: number;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  attendingUserId!: string;
}
