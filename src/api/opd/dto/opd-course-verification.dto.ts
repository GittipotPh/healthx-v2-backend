import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayUnique,
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

export class OpdCourseVerificationLotSelectionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  reservationComponentId!: string;

  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lotId!: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  replacementReason?: string;
}

export class OpdCourseVerificationPreflightDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiPropertyOptional({
    type: [OpdCourseVerificationLotSelectionDto],
    description:
      "Explicit actual lots. Omitted components retain their eligible Phase 3C lot.",
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ArrayUnique(
    (selection: OpdCourseVerificationLotSelectionDto) =>
      selection.reservationComponentId,
  )
  @ValidateNested({ each: true })
  @Type(() => OpdCourseVerificationLotSelectionDto)
  componentSelections?: OpdCourseVerificationLotSelectionDto[];
}

export class VerifyOpdCourseReservationDto {
  @ApiProperty({ minLength: 32, maxLength: 30000 })
  @IsString()
  @MinLength(32)
  @MaxLength(30000)
  preflightToken!: string;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  acknowledgementVersion!: string;

  @ApiProperty({ enum: ["th-TH", "en-US"] })
  @IsIn(["th-TH", "en-US"])
  acknowledgementLocale!: "th-TH" | "en-US";
}

export class RequestOpdCourseCompensationDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @ApiProperty({ minLength: 1, maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  reasonCode!: string;

  @ApiProperty({ minLength: 1, maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  description!: string;
}

export class ReviewOpdCourseCompensationDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedReservationVersion!: number;

  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedRequestVersion!: number;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
