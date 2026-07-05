import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBooleanString, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export class QueryCustomersDto {
  /** Free-text search across name, lastname, nickname, phone, personal id. */
  @ApiPropertyOptional({ description: "Free-text search across name, lastname, nickname, phone, personal id" })
  @IsOptional()
  @IsString()
  search?: string;

  /** "true" | "false" — filter by VIP status. */
  @ApiPropertyOptional({ enum: ["true", "false"], description: "Filter by VIP status" })
  @IsOptional()
  @IsBooleanString()
  vip?: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number = 50;
}
