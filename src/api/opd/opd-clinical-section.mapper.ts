import { ApiProperty } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";

export type OpdSymptomSectionRecord = Prisma.opd_symptom_sectionGetPayload<{
  include: {
    symptoms: { include: { associations: true } };
  };
}>;

export type OpdDiagnosisSectionRecord = Prisma.opd_diagnosis_sectionGetPayload<{
  include: { diagnoses: true };
}>;

function decimalNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export class OpdSymptomAssociationView {
  @ApiProperty()
  associationId!: string;

  @ApiProperty({ type: String, nullable: true })
  code!: string | null;

  @ApiProperty()
  label!: string;
}

export class OpdSymptomView {
  @ApiProperty()
  symptomId!: string;

  @ApiProperty()
  displayOrder!: number;

  @ApiProperty({ type: String, nullable: true })
  mainCode!: string | null;

  @ApiProperty()
  mainText!: string;

  @ApiProperty({ type: Number, nullable: true })
  durationValue!: number | null;

  @ApiProperty({ type: String, nullable: true })
  durationUnit!: string | null;

  @ApiProperty({ type: String, nullable: true })
  location!: string | null;

  @ApiProperty({ type: String, nullable: true })
  laterality!: string | null;

  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 10 })
  severity!: number | null;

  @ApiProperty({ type: String, nullable: true })
  character!: string | null;

  @ApiProperty({ type: String, nullable: true })
  modifyingFactors!: string | null;

  @ApiProperty({ type: String, nullable: true })
  staffSummary!: string | null;

  @ApiProperty({ type: [OpdSymptomAssociationView] })
  associations!: OpdSymptomAssociationView[];
}

export class OpdSymptomSectionView {
  @ApiProperty()
  symptomSectionId!: string;

  @ApiProperty()
  examinationId!: string;

  @ApiProperty({ type: String, nullable: true })
  patientQuote!: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty({ type: [OpdSymptomView] })
  items!: OpdSymptomView[];

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OpdSymptomSectionResult {
  @ApiProperty({ type: OpdSymptomSectionView, nullable: true })
  section!: OpdSymptomSectionView | null;
}

export class CreateOpdSymptomSectionResult {
  @ApiProperty({ type: OpdSymptomSectionView })
  section!: OpdSymptomSectionView;

  @ApiProperty()
  resumed!: boolean;
}

export class OpdDiagnosisView {
  @ApiProperty()
  diagnosisId!: string;

  @ApiProperty()
  displayOrder!: number;

  @ApiProperty()
  codeSystem!: string;

  @ApiProperty({ type: String, nullable: true })
  codeEdition!: string | null;

  @ApiProperty({ type: String, nullable: true })
  code!: string | null;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ type: String, nullable: true })
  onsetText!: string | null;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

export class OpdDiagnosisSectionView {
  @ApiProperty()
  diagnosisSectionId!: string;

  @ApiProperty({ enum: ["DRAFT", "FINAL", "CORRECTED", "VOID"] })
  status!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ type: [OpdDiagnosisView] })
  items!: OpdDiagnosisView[];

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OpdDiagnosisSectionResult {
  @ApiProperty({ type: OpdDiagnosisSectionView, nullable: true })
  section!: OpdDiagnosisSectionView | null;
}

export class CreateOpdDiagnosisSectionResult {
  @ApiProperty({ type: OpdDiagnosisSectionView })
  section!: OpdDiagnosisSectionView;

  @ApiProperty()
  resumed!: boolean;
}

export class OpdDraftCheckpointView {
  @ApiProperty()
  draftCheckpointId!: string;

  @ApiProperty()
  encounterId!: string;

  @ApiProperty()
  checkpointNumber!: number;

  @ApiProperty({ type: Object, additionalProperties: true })
  resourceVersions!: Record<string, unknown>;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;

  @ApiProperty()
  actorUserId!: string;

  @ApiProperty()
  createdAt!: string;
}

export function toOpdSymptomSectionView(
  row: OpdSymptomSectionRecord,
): OpdSymptomSectionView {
  return {
    symptomSectionId: row.symptom_section_id,
    examinationId: row.examination_id,
    patientQuote: row.patient_quote,
    version: row.version,
    items: [...row.symptoms]
      .sort((left, right) => left.display_order - right.display_order)
      .map((symptom) => ({
        symptomId: symptom.symptom_id,
        displayOrder: symptom.display_order,
        mainCode: symptom.main_code,
        mainText: symptom.main_text,
        durationValue: decimalNumber(symptom.duration_value),
        durationUnit: symptom.duration_unit,
        location: symptom.location,
        laterality: symptom.laterality,
        severity: symptom.severity,
        character: symptom.character,
        modifyingFactors: symptom.modifying_factors,
        staffSummary: symptom.staff_summary,
        associations: [...symptom.associations]
          .sort((left, right) => left.display_order - right.display_order)
          .map((association) => ({
            associationId: association.symptom_association_id,
            code: association.code,
            label: association.label,
          })),
      })),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toOpdDiagnosisSectionView(
  row: OpdDiagnosisSectionRecord,
): OpdDiagnosisSectionView {
  return {
    diagnosisSectionId: row.diagnosis_section_id,
    status: row.status,
    version: row.version,
    items: [...row.diagnoses]
      .sort((left, right) => left.display_order - right.display_order)
      .map((diagnosis) => ({
        diagnosisId: diagnosis.diagnosis_id,
        displayOrder: diagnosis.display_order,
        codeSystem: diagnosis.code_system,
        codeEdition: diagnosis.code_edition,
        code: diagnosis.code,
        label: diagnosis.label,
        isPrimary: diagnosis.is_primary,
        onsetText: diagnosis.onset_text,
        note: diagnosis.note,
      })),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
