import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from "class-validator";
import { OPD_CHART_TEMPLATE_VERSION } from "../opd-chart-template.registry";

export const OPD_CHART_RASTER_SCHEMA = "opd-chart-raster-v1";

export enum OpdChartArtifactFormat {
  PNG = "png",
  PDF = "pdf",
}

export class OpdChartClinicalMetadataDto {
  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  location!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  character!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  size!: string;

  @ApiProperty({ maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  side!: string;

  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  doctorNote!: string;
}

export class SaveOpdChartDocumentDto
  extends OpdChartClinicalMetadataDto
{
  @ApiProperty({
    minimum: 0,
    description: "Use 0 when this encounter/template has no document yet",
  })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ enum: [OPD_CHART_TEMPLATE_VERSION] })
  @IsIn([OPD_CHART_TEMPLATE_VERSION])
  templateVersion!: typeof OPD_CHART_TEMPLATE_VERSION;

  @ApiProperty({
    format: "uuid",
    description:
      "One client-generated ID for this captured autosave snapshot",
  })
  @IsUUID("4")
  clientMutationId!: string;
}

export class FinalizeOpdChartDocumentDto {
  @ApiProperty({ minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}
