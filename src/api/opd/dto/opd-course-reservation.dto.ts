import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class QueryOpdCourseEntitlementsDto {
  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  pageSize = 20;
}

export class OpdCourseComponentLotSelectionDto {
  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  productId!: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lotId!: string;
}

export class OpdCourseEntitlementSelectionDto {
  @ApiProperty({ minLength: 32, maxLength: 4000 })
  @IsString()
  @MinLength(32)
  @MaxLength(4000)
  entitlementToken!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ type: [OpdCourseComponentLotSelectionDto] })
  @IsOptional()
  @IsArray()
  @ArrayUnique(
    (selection: OpdCourseComponentLotSelectionDto) => selection.productId,
  )
  @ValidateNested({ each: true })
  @Type(() => OpdCourseComponentLotSelectionDto)
  components?: OpdCourseComponentLotSelectionDto[];
}

export class OpdCourseReservationPreflightDto {
  @ApiProperty({ type: [OpdCourseEntitlementSelectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ArrayUnique(
    (selection: OpdCourseEntitlementSelectionDto) => selection.entitlementToken,
  )
  @ValidateNested({ each: true })
  @Type(() => OpdCourseEntitlementSelectionDto)
  selections!: OpdCourseEntitlementSelectionDto[];
}

export class CreateOpdCourseReservationDto extends OpdCourseReservationPreflightDto {
  @ApiProperty({ minLength: 32, maxLength: 12000 })
  @IsString()
  @MinLength(32)
  @MaxLength(12000)
  preflightToken!: string;
}

export class VoidOpdCourseReservationDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
