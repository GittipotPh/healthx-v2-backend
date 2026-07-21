import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class OpdOrderItemVersionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  version!: number;
}

export class OpdOrderLotSelectionDto {
  @ApiProperty({ format: "uuid" })
  @IsUUID()
  orderItemId!: string;

  @ApiProperty({ maxLength: 50 })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  lotId!: string;
}

export class OpdOrderReleasePreflightDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number;

  @ApiProperty({ type: [OpdOrderItemVersionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: OpdOrderItemVersionDto) => item.orderItemId)
  @ValidateNested({ each: true })
  @Type(() => OpdOrderItemVersionDto)
  itemVersions!: OpdOrderItemVersionDto[];

  @ApiPropertyOptional({
    type: [OpdOrderLotSelectionDto],
    description:
      "One explicit lot per active medication line. Omit on the first call to discover eligible lots.",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique((item: OpdOrderLotSelectionDto) => item.orderItemId)
  @ValidateNested({ each: true })
  @Type(() => OpdOrderLotSelectionDto)
  selectedLots?: OpdOrderLotSelectionDto[];
}

export class OpdOrderSafetyAcknowledgementDto {
  @ApiProperty({
    description: "Exact SHA-256 safety snapshot hash returned by preflight",
  })
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  safetySnapshotHash!: string;

  @ApiProperty({
    default: true,
    description:
      "Human acknowledgement of unverified legacy allergy text; not a drug-interaction check",
  })
  @IsBoolean()
  @Equals(true)
  acknowledged!: true;
}

export class ReleaseOpdOrderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number;

  @ApiProperty({ type: [OpdOrderItemVersionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: OpdOrderItemVersionDto) => item.orderItemId)
  @ValidateNested({ each: true })
  @Type(() => OpdOrderItemVersionDto)
  itemVersions!: OpdOrderItemVersionDto[];

  @ApiProperty({ type: [OpdOrderLotSelectionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique((item: OpdOrderLotSelectionDto) => item.orderItemId)
  @ValidateNested({ each: true })
  @Type(() => OpdOrderLotSelectionDto)
  selectedLots!: OpdOrderLotSelectionDto[];

  @ApiProperty({ minLength: 32, maxLength: 12_000 })
  @IsString()
  @MinLength(32)
  @MaxLength(12_000)
  preflightToken!: string;

  @ApiProperty({ type: OpdOrderSafetyAcknowledgementDto })
  @ValidateNested()
  @Type(() => OpdOrderSafetyAcknowledgementDto)
  safetyAcknowledgement!: OpdOrderSafetyAcknowledgementDto;
}

export class VoidReleasedOpdOrderDto {
  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  expectedOrderVersion!: number;

  @ApiProperty({ minLength: 1, maxLength: 500 })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
