import { Transform } from "class-transformer";
import { IsString, MaxLength, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class CreateCustomerNoteDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;
}
