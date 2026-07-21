import { ApiProperty } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";

export type OpdExaminationRecord = Prisma.opd_examinationGetPayload<{
  include: { vital_observation: true };
}>;

type ExaminationStatus = "DRAFT" | "FINAL" | "CORRECTED" | "VOID";

function examinationStatus(value: string): ExaminationStatus {
  switch (value) {
    case "DRAFT":
    case "FINAL":
    case "CORRECTED":
    case "VOID":
      return value;
    default:
      throw new Error(`Unknown OPD examination status: ${value}`);
  }
}

function decimalNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

export class OpdVitalObservationView {
  @ApiProperty()
  vitalObservationId!: string;

  @ApiProperty()
  examinationId!: string;

  @ApiProperty({ type: Number, nullable: true })
  weightKg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  heightCm!: number | null;

  @ApiProperty({
    type: Number,
    nullable: true,
    description: "Server-derived when weight and height are both positive",
  })
  bodyMassIndex!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  systolicBloodPressureMmHg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  diastolicBloodPressureMmHg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  pulseRatePerMinute!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  temperatureCelsius!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  oxygenSaturationPercent!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  respiratoryRatePerMinute!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  dtxMgDl!: number | null;

  @ApiProperty({ type: Number, nullable: true, minimum: 0, maximum: 10 })
  painScore!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Null until an approved reference-rule catalog is published",
  })
  referenceRuleVersion!: string | null;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class OpdExaminationView {
  @ApiProperty()
  examinationId!: string;

  @ApiProperty()
  encounterId!: string;

  @ApiProperty()
  examinationNumber!: number;

  @ApiProperty({
    enum: ["DRAFT", "FINAL", "CORRECTED", "VOID"],
    enumName: "OpdExaminationStatus",
  })
  status!: ExaminationStatus;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  measuredAt!: string;

  @ApiProperty()
  recorderUserId!: string;

  @ApiProperty({ type: String, nullable: true })
  examinerUserId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Root finalized examination corrected by this revision",
  })
  correctsExaminationId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Immediate finalized examination superseded by this revision",
  })
  supersedesExaminationId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  correctionReason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  finalizedAt!: string | null;

  @ApiProperty({ type: String, nullable: true })
  finalizedBy!: string | null;

  @ApiProperty()
  createdBy!: string;

  @ApiProperty()
  updatedBy!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;

  @ApiProperty({ type: OpdVitalObservationView })
  vitals!: OpdVitalObservationView;
}

export class OpdExaminationListResult {
  @ApiProperty({ type: [OpdExaminationView] })
  items!: OpdExaminationView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;
}

export class CreateOpdExaminationResult {
  @ApiProperty({ type: OpdExaminationView })
  examination!: OpdExaminationView;

  @ApiProperty({
    description: "True when an existing active draft was resumed",
  })
  resumed!: boolean;
}

export class CreateOpdExaminationCorrectionResult {
  @ApiProperty({ type: OpdExaminationView })
  examination!: OpdExaminationView;

  @ApiProperty()
  sourceExaminationId!: string;

  @ApiProperty()
  correctionRootExaminationId!: string;
}

export function toOpdVitalObservationView(
  row: NonNullable<OpdExaminationRecord["vital_observation"]>,
): OpdVitalObservationView {
  return {
    vitalObservationId: row.vital_observation_id,
    examinationId: row.examination_id,
    weightKg: decimalNumber(row.weight_kg),
    heightCm: decimalNumber(row.height_cm),
    bodyMassIndex: decimalNumber(row.body_mass_index),
    systolicBloodPressureMmHg: row.systolic_blood_pressure_mmhg,
    diastolicBloodPressureMmHg: row.diastolic_blood_pressure_mmhg,
    pulseRatePerMinute: row.pulse_rate_per_minute,
    temperatureCelsius: decimalNumber(row.temperature_celsius),
    oxygenSaturationPercent: decimalNumber(row.oxygen_saturation_percent),
    respiratoryRatePerMinute: row.respiratory_rate_per_minute,
    dtxMgDl: decimalNumber(row.dtx_mg_dl),
    painScore: row.pain_score,
    referenceRuleVersion: row.reference_rule_version,
    version: row.version,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function toOpdExaminationView(
  row: OpdExaminationRecord,
): OpdExaminationView {
  if (!row.vital_observation) {
    throw new Error(
      "OPD examination is missing its required vital observation",
    );
  }
  return {
    examinationId: row.examination_id,
    encounterId: row.encounter_id,
    examinationNumber: row.examination_number,
    status: examinationStatus(row.status),
    version: row.version,
    measuredAt: row.measured_at.toISOString(),
    recorderUserId: row.recorder_user_id,
    examinerUserId: row.examiner_user_id,
    correctsExaminationId: row.corrects_examination_id,
    supersedesExaminationId: row.supersedes_examination_id,
    correctionReason: row.correction_reason,
    finalizedAt: row.finalized_at?.toISOString() ?? null,
    finalizedBy: row.finalized_by,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    vitals: toOpdVitalObservationView(row.vital_observation),
  };
}
