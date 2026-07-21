import { ApiProperty } from "@nestjs/swagger";
import type { Prisma, opd_note_section } from "@prisma/client";
import {
  OpdNoteRecordMode,
  OpdNoteSectionCode,
} from "./dto/opd-clinical-note.dto";
import {
  CLINICAL_RICH_TEXT_SCHEMA,
  emptyClinicalRichTextContent,
} from "./opd-clinical-note.rich-text";

export const OPD_NOTE_SECTION_ORDER = [
  OpdNoteSectionCode.CHIEF_COMPLAINT,
  OpdNoteSectionCode.PHYSICAL_EXAMINATION,
  OpdNoteSectionCode.DIAGNOSIS_NARRATIVE,
  OpdNoteSectionCode.TREATMENT,
  OpdNoteSectionCode.TREATMENT_PLAN,
  OpdNoteSectionCode.ADDITIONAL_NOTES,
  OpdNoteSectionCode.FREE_NOTE,
] as const;

export type OpdNoteWorkspaceRecord = Prisma.opd_note_workspaceGetPayload<{
  include: { sections: true };
}>;

export class OpdNoteSectionView {
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  noteSectionId!: string | null;

  @ApiProperty({ enum: OpdNoteSectionCode })
  sectionCode!: OpdNoteSectionCode;

  @ApiProperty({ enum: [CLINICAL_RICH_TEXT_SCHEMA] })
  contentSchema!: typeof CLINICAL_RICH_TEXT_SCHEMA;

  @ApiProperty({ type: Object, additionalProperties: true })
  content!: Record<string, unknown>;

  @ApiProperty()
  plainText!: string;

  @ApiProperty({ enum: ["DRAFT", "FINAL", "CORRECTED", "VOID"] })
  status!: string;

  @ApiProperty({ minimum: 0 })
  version!: number;

  @ApiProperty({ type: String, nullable: true })
  createdBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  createdAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  updatedAt!: string | null;
}

export class OpdNoteWorkspaceView {
  @ApiProperty({ type: String, nullable: true, format: "uuid" })
  noteWorkspaceId!: string | null;

  @ApiProperty({ enum: OpdNoteRecordMode })
  selectedMode!: OpdNoteRecordMode;

  @ApiProperty({ minimum: 0 })
  version!: number;

  @ApiProperty({ type: [OpdNoteSectionView] })
  sections!: OpdNoteSectionView[];

  @ApiProperty({ type: String, nullable: true })
  updatedBy!: string | null;

  @ApiProperty({ type: String, nullable: true })
  updatedAt!: string | null;
}

export function toOpdNoteWorkspaceView(
  row: OpdNoteWorkspaceRecord | null,
): OpdNoteWorkspaceView {
  const byCode = new Map(
    row?.sections.map((section) => [section.section_code, section]) ?? [],
  );
  return {
    noteWorkspaceId: row?.note_workspace_id ?? null,
    selectedMode:
      row?.selected_mode === OpdNoteRecordMode.FREE
        ? OpdNoteRecordMode.FREE
        : OpdNoteRecordMode.FORM,
    version: row?.version ?? 0,
    sections: OPD_NOTE_SECTION_ORDER.map((sectionCode) =>
      toOpdNoteSectionView(byCode.get(sectionCode) ?? null, sectionCode),
    ),
    updatedBy: row?.updated_by ?? null,
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

export function toOpdNoteSectionView(
  row: opd_note_section | null,
  sectionCode: OpdNoteSectionCode,
): OpdNoteSectionView {
  return {
    noteSectionId: row?.note_section_id ?? null,
    sectionCode,
    contentSchema: CLINICAL_RICH_TEXT_SCHEMA,
    content: row
      ? jsonObject(row.rich_content)
      : emptyClinicalRichTextContent(),
    plainText: row?.plain_text ?? "",
    status: row?.status ?? "DRAFT",
    version: row?.version ?? 0,
    createdBy: row?.created_by ?? null,
    updatedBy: row?.updated_by ?? null,
    createdAt: row?.created_at.toISOString() ?? null,
    updatedAt: row?.updated_at.toISOString() ?? null,
  };
}

function jsonObject(value: Prisma.JsonValue): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new Error("Stored clinical note content is not a JSON object");
  }
  return value;
}
