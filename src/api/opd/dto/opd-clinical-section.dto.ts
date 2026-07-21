import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { OpdNoteSectionCode } from "./opd-clinical-note.dto";

export class CreateOpdClinicalSectionDto {}

export class OpdSymptomAssociationInputDto {
  @ApiPropertyOptional({ type: String, maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string | null;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  label!: string;
}

export class OpdSymptomInputDto {
  @ApiPropertyOptional({ type: String, maxLength: 50, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  mainCode?: string | null;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  mainText!: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 99_999_999.99,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999.99)
  durationValue?: number | null;

  @ApiPropertyOptional({ type: String, maxLength: 30, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  durationUnit?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string | null;

  @ApiPropertyOptional({
    enum: ["UNSPECIFIED", "LEFT", "RIGHT", "BILATERAL", "MIDLINE"],
    nullable: true,
  })
  @IsOptional()
  @IsIn(["UNSPECIFIED", "LEFT", "RIGHT", "BILATERAL", "MIDLINE"])
  laterality?:
    | "UNSPECIFIED"
    | "LEFT"
    | "RIGHT"
    | "BILATERAL"
    | "MIDLINE"
    | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    minimum: 0,
    maximum: 10,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  severity?: number | null;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  character?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 1000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  modifyingFactors?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  staffSummary?: string | null;

  @ApiProperty({ type: [OpdSymptomAssociationInputDto], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OpdSymptomAssociationInputDto)
  associations!: OpdSymptomAssociationInputDto[];
}

export class PatchOpdSymptomSectionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({ type: String, maxLength: 4000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  patientQuote?: string | null;

  @ApiProperty({ type: [OpdSymptomInputDto], maxItems: 20 })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OpdSymptomInputDto)
  items!: OpdSymptomInputDto[];
}

export class OpdDiagnosisInputDto {
  @ApiProperty({ maxLength: 30, default: "ICD-10" })
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  codeSystem!: string;

  @ApiPropertyOptional({ type: String, maxLength: 30, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  codeEdition?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 30, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  code?: string | null;

  @ApiProperty({ maxLength: 300 })
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  label!: string;

  @ApiProperty()
  @IsBoolean()
  isPrimary!: boolean;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  onsetText?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class PatchOpdDiagnosisSectionDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ type: [OpdDiagnosisInputDto], maxItems: 30 })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => OpdDiagnosisInputDto)
  items!: OpdDiagnosisInputDto[];
}

export class OpdExpectedResourceVersionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  id!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class OpdExpectedNoteSectionVersionDto extends OpdExpectedResourceVersionDto {
  @ApiProperty({ enum: OpdNoteSectionCode })
  @IsIn(Object.values(OpdNoteSectionCode))
  sectionCode!: OpdNoteSectionCode;
}

export class OpdDraftExpectedVersionsDto {
  @ApiProperty({ type: OpdExpectedResourceVersionDto })
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  encounter!: OpdExpectedResourceVersionDto;

  @ApiPropertyOptional({ type: OpdExpectedResourceVersionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  examination?: OpdExpectedResourceVersionDto;

  @ApiPropertyOptional({ type: OpdExpectedResourceVersionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  vitals?: OpdExpectedResourceVersionDto;

  @ApiPropertyOptional({ type: OpdExpectedResourceVersionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  intake?: OpdExpectedResourceVersionDto;

  @ApiPropertyOptional({ type: OpdExpectedResourceVersionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  symptoms?: OpdExpectedResourceVersionDto;

  @ApiPropertyOptional({ type: OpdExpectedResourceVersionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  diagnoses?: OpdExpectedResourceVersionDto;

  @ApiPropertyOptional({ type: OpdExpectedResourceVersionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  order?: OpdExpectedResourceVersionDto;

  @ApiPropertyOptional({ type: OpdExpectedResourceVersionDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdExpectedResourceVersionDto)
  noteWorkspace?: OpdExpectedResourceVersionDto;

  @ApiProperty({ type: [OpdExpectedNoteSectionVersionDto], maxItems: 7 })
  @IsArray()
  @ArrayMaxSize(7)
  @ArrayUnique((item: OpdExpectedNoteSectionVersionDto) => item.sectionCode)
  @ValidateNested({ each: true })
  @Type(() => OpdExpectedNoteSectionVersionDto)
  noteSections!: OpdExpectedNoteSectionVersionDto[];
}

export class CreateOpdDraftCheckpointDto {
  @ApiProperty({ type: OpdDraftExpectedVersionsDto })
  @ValidateNested()
  @Type(() => OpdDraftExpectedVersionsDto)
  expectedVersions!: OpdDraftExpectedVersionsDto;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
