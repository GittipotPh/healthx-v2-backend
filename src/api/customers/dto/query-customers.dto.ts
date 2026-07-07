import { ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

export const CUSTOMER_PAYMENT_FILTERS = ["outstanding", "deposit", "clear"] as const;
export type CustomerPaymentFilter = (typeof CUSTOMER_PAYMENT_FILTERS)[number];

export class QueryCustomersDto {
  @ApiPropertyOptional({ description: "Registered branch id" })
  @IsOptional()
  @IsString()
  branchId?: string;

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

  @ApiPropertyOptional({ description: "Customer group id" })
  @IsOptional()
  @IsString()
  groupId?: string;

  @ApiPropertyOptional({ enum: CUSTOMER_PAYMENT_FILTERS, description: "Filter by customer payment summary" })
  @IsOptional()
  @IsIn(CUSTOMER_PAYMENT_FILTERS)
  paymentStatus?: CustomerPaymentFilter;

  @ApiPropertyOptional({ description: "Customer attendant user id" })
  @IsOptional()
  @IsString()
  attendantId?: string;

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
