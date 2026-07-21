import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export enum OpdClinicalCatalogCategory {
  MEDICINE = "MEDICINE",
  DRUG = "DRUG",
  TOOL = "TOOL",
  PRODUCT = "PRODUCT",
  CONSUMABLES = "CONSUMABLES",
  COURSE = "COURSE",
}

export enum OpdOrderSourceType {
  PRODUCT = "PRODUCT",
  COURSE_ITEM = "COURSE_ITEM",
}

export class QueryOpdClinicalCatalogDto {
  @ApiPropertyOptional({ maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({
    enum: OpdClinicalCatalogCategory,
    enumName: "OpdClinicalCatalogCategory",
  })
  @IsOptional()
  @IsEnum(OpdClinicalCatalogCategory)
  category?: OpdClinicalCatalogCategory;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize?: number = 20;
}

export class CreateOpdDraftOrderDto {}

export class OpdMedicationInstructionInputDto {
  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dose?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 100, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  route?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  frequency?: string | null;

  @ApiPropertyOptional({ type: String, maxLength: 200, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  timing?: string | null;

  @ApiPropertyOptional({
    type: Number,
    minimum: 0.01,
    maximum: 99_999_999.99,
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  durationValue?: number | null;

  @ApiPropertyOptional({ type: String, maxLength: 30, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  durationUnit?: string | null;

  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  sigText!: string;

  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;
}

export class CreateOpdOrderItemDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number;

  @ApiProperty({
    enum: OpdOrderSourceType,
    enumName: "OpdOrderSourceType",
  })
  @IsEnum(OpdOrderSourceType)
  sourceType!: OpdOrderSourceType;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  sourceId!: string;

  @ApiProperty({ minimum: 0.01, maximum: 99_999_999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  quantity!: number;

  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiPropertyOptional({
    type: OpdMedicationInstructionInputDto,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdMedicationInstructionInputDto)
  medicationInstruction?: OpdMedicationInstructionInputDto | null;
}

export class PatchOpdOrderItemDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedItemVersion!: number;

  @ApiProperty({ minimum: 0.01, maximum: 99_999_999.99 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99_999_999.99)
  quantity!: number;

  @ApiPropertyOptional({ type: String, maxLength: 2000, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string | null;

  @ApiPropertyOptional({
    type: OpdMedicationInstructionInputDto,
    nullable: true,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => OpdMedicationInstructionInputDto)
  medicationInstruction?: OpdMedicationInstructionInputDto | null;
}

export class VoidOpdOrderItemDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedItemVersion!: number;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}
