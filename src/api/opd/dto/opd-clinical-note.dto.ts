import { ApiProperty } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsIn, IsInt, IsObject, Min, ValidateNested } from "class-validator";

export enum OpdNoteRecordMode {
  FORM = "FORM",
  FREE = "FREE",
}

export enum OpdNoteSectionCode {
  CHIEF_COMPLAINT = "CHIEF_COMPLAINT",
  PHYSICAL_EXAMINATION = "PHYSICAL_EXAMINATION",
  DIAGNOSIS_NARRATIVE = "DIAGNOSIS_NARRATIVE",
  TREATMENT = "TREATMENT",
  TREATMENT_PLAN = "TREATMENT_PLAN",
  ADDITIONAL_NOTES = "ADDITIONAL_NOTES",
  FREE_NOTE = "FREE_NOTE",
}

export class ClinicalRichTextContentDto {
  @ApiProperty({ enum: ["clinical-rich-text-v1"] })
  @IsIn(["clinical-rich-text-v1"])
  schema!: "clinical-rich-text-v1";

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    description:
      "Restricted ProseMirror-compatible document validated against clinical-rich-text-v1",
  })
  @IsObject()
  doc!: object;
}

export class PatchOpdNoteModeDto {
  @ApiProperty({ minimum: 0, description: "Use 0 when no mode row exists yet" })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ enum: OpdNoteRecordMode })
  @IsIn(Object.values(OpdNoteRecordMode))
  selectedMode!: OpdNoteRecordMode;
}

export class PatchOpdNoteSectionDto {
  @ApiProperty({
    minimum: 0,
    description: "Use 0 when this section has not been persisted yet",
  })
  @IsInt()
  @Min(0)
  expectedVersion!: number;

  @ApiProperty({ type: ClinicalRichTextContentDto })
  @ValidateNested()
  @Type(() => ClinicalRichTextContentDto)
  content!: ClinicalRichTextContentDto;
}
