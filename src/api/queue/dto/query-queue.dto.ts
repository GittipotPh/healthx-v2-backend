import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, Matches } from "class-validator";

const BUSINESS_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class QueryQueueDto {
  /** Day to show (e.g. "2026-06-17"). Defaults to the server's current date. */
  @ApiPropertyOptional({
    description:
      "Day to show (YYYY-MM-DD); defaults to the server's current date",
  })
  @IsOptional()
  @IsString()
  @Matches(BUSINESS_DATE_PATTERN, { message: "date must match YYYY-MM-DD" })
  date?: string;
}
