import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from "class-validator";

export enum OpdUrinaryStatus {
  NORMAL = "NORMAL",
  DYSURIA = "DYSURIA",
  FREQUENCY = "FREQUENCY",
  RETENTION = "RETENTION",
  OTHER = "OTHER",
}

export enum OpdBowelStatus {
  NORMAL = "NORMAL",
  CONSTIPATION = "CONSTIPATION",
  DIARRHEA = "DIARRHEA",
  NO_BOWEL_MOVEMENT = "NO_BOWEL_MOVEMENT",
  OTHER = "OTHER",
}

export class PatchOpdIntakeDto {
  @ApiProperty({ minimum: 0 })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ enum: OpdUrinaryStatus, enumName: "OpdUrinaryStatus" })
  @IsEnum(OpdUrinaryStatus)
  urinaryStatus!: OpdUrinaryStatus;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  urinaryOtherText?: string | null;

  @ApiProperty({ enum: OpdBowelStatus, enumName: "OpdBowelStatus" })
  @IsEnum(OpdBowelStatus)
  bowelStatus!: OpdBowelStatus;

  @ApiPropertyOptional({ type: String, maxLength: 500, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bowelOtherText?: string | null;
}
