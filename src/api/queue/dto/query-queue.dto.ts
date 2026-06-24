import { IsOptional, IsString } from "class-validator";

export class QueryQueueDto {
  /** Day to show (e.g. "2026-06-17"). Defaults to the server's current date. */
  @IsOptional()
  @IsString()
  date?: string;
}
