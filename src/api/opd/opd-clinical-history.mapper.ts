import { ApiProperty } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import { OpdVitalTrendMetric } from "./dto/opd-clinical-history.dto";
import {
  OpdSymptomSectionView,
  toOpdSymptomSectionView,
} from "./opd-clinical-section.mapper";
import { OpdIntakeView, toOpdIntakeView } from "./opd-clinical-intake.mapper";
import {
  OpdExaminationView,
  toOpdExaminationView,
} from "./opd-clinical.mapper";

export type OpdExaminationHistoryRecord = Prisma.opd_examinationGetPayload<{
  include: {
    vital_observation: true;
    intake: true;
    symptom_section: {
      include: {
        symptoms: { include: { associations: true } };
      };
    };
    encounter: {
      select: {
        customer_id: true;
        legacy_opd_id: true;
        business_date: true;
      };
    };
  };
}>;

export type OpdVitalTrendRecord = Prisma.opd_examinationGetPayload<{
  include: {
    vital_observation: true;
    encounter: {
      select: {
        customer_id: true;
        legacy_opd_id: true;
        business_date: true;
      };
    };
  };
}>;

export interface OpdClinicalHistoryDisplayContext {
  branchName: string | null;
  userDisplayNames: ReadonlyMap<string, string>;
}

export class OpdHistoryRecorderOptionView {
  @ApiProperty()
  userId!: string;

  @ApiProperty({ type: String, nullable: true })
  displayName!: string | null;
}

export class OpdExaminationHistoryFacetsView {
  @ApiProperty({ type: [OpdHistoryRecorderOptionView] })
  recorders!: OpdHistoryRecorderOptionView[];
}

export class OpdExaminationHistoryItemView {
  @ApiProperty({ type: OpdExaminationView })
  examination!: OpdExaminationView;

  @ApiProperty({ description: "Bangkok business date (YYYY-MM-DD)" })
  businessDate!: string;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  legacyOpdId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  recorderDisplayName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  examinerDisplayName!: string | null;

  @ApiProperty({ type: OpdSymptomSectionView, nullable: true })
  symptoms!: OpdSymptomSectionView | null;

  @ApiProperty({ type: OpdIntakeView, nullable: true })
  intake!: OpdIntakeView | null;
}

export class OpdExaminationHistoryListResult {
  @ApiProperty({ type: [OpdExaminationHistoryItemView] })
  items!: OpdExaminationHistoryItemView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty({ type: OpdExaminationHistoryFacetsView })
  facets!: OpdExaminationHistoryFacetsView;
}

export class OpdVitalTrendReferenceRangeView {
  @ApiProperty()
  series!: string;

  @ApiProperty({ type: Number, nullable: true })
  minimum!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  maximum!: number | null;

  @ApiProperty({ type: String, nullable: true })
  label!: string | null;
}

export class OpdVitalTrendPointView {
  @ApiProperty()
  examinationId!: string;

  @ApiProperty()
  encounterId!: string;

  @ApiProperty({ description: "Bangkok business date (YYYY-MM-DD)" })
  businessDate!: string;

  @ApiProperty()
  measuredAt!: string;

  @ApiProperty({ enum: ["DRAFT", "FINAL"] })
  status!: string;

  @ApiProperty({ type: Number, nullable: true })
  primaryValue!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  secondaryValue!: number | null;

  @ApiProperty()
  recorderUserId!: string;

  @ApiProperty({ type: String, nullable: true })
  recorderDisplayName!: string | null;

  @ApiProperty()
  branchId!: string;

  @ApiProperty({ type: String, nullable: true })
  branchName!: string | null;

  @ApiProperty({ type: String, nullable: true })
  legacyOpdId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  referenceRuleVersion!: string | null;
}

export class OpdVitalTrendResult {
  @ApiProperty({
    enum: OpdVitalTrendMetric,
    enumName: "OpdVitalTrendMetric",
  })
  metric!: OpdVitalTrendMetric;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  primarySeries!: string;

  @ApiProperty({ type: String, nullable: true })
  secondarySeries!: string | null;

  @ApiProperty({ type: [OpdVitalTrendPointView] })
  points!: OpdVitalTrendPointView[];

  @ApiProperty({ type: [OpdVitalTrendReferenceRangeView] })
  referenceRanges!: OpdVitalTrendReferenceRangeView[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  limit!: number;

  @ApiProperty()
  truncated!: boolean;
}

export function toOpdExaminationHistoryItemView(
  row: OpdExaminationHistoryRecord,
  display: OpdClinicalHistoryDisplayContext,
): OpdExaminationHistoryItemView {
  return {
    examination: toOpdExaminationView(row),
    businessDate: dateOnly(row.encounter.business_date),
    branchId: row.branch_id,
    branchName: display.branchName,
    legacyOpdId: row.encounter.legacy_opd_id,
    recorderDisplayName:
      display.userDisplayNames.get(row.recorder_user_id) ?? null,
    examinerDisplayName: row.examiner_user_id
      ? (display.userDisplayNames.get(row.examiner_user_id) ?? null)
      : null,
    symptoms: row.symptom_section
      ? toOpdSymptomSectionView(row.symptom_section)
      : null,
    intake: row.intake ? toOpdIntakeView(row.intake, row.examination_id) : null,
  };
}

export function toOpdVitalTrendPointView(
  row: OpdVitalTrendRecord,
  metric: OpdVitalTrendMetric,
  display: OpdClinicalHistoryDisplayContext,
): OpdVitalTrendPointView {
  const vital = row.vital_observation;
  if (!vital) {
    throw new Error("OPD trend examination is missing its vital observation");
  }
  const values = trendValues(row, metric);
  return {
    examinationId: row.examination_id,
    encounterId: row.encounter_id,
    businessDate: dateOnly(row.encounter.business_date),
    measuredAt: row.measured_at.toISOString(),
    status: row.status,
    primaryValue: values.primary,
    secondaryValue: values.secondary,
    recorderUserId: row.recorder_user_id,
    recorderDisplayName:
      display.userDisplayNames.get(row.recorder_user_id) ?? null,
    branchId: row.branch_id,
    branchName: display.branchName,
    legacyOpdId: row.encounter.legacy_opd_id,
    referenceRuleVersion: vital.reference_rule_version,
  };
}

export function vitalTrendMetadata(metric: OpdVitalTrendMetric): {
  unit: string;
  primarySeries: string;
  secondarySeries: string | null;
} {
  switch (metric) {
    case OpdVitalTrendMetric.WEIGHT_KG:
      return { unit: "kg", primarySeries: "weight", secondarySeries: null };
    case OpdVitalTrendMetric.BODY_MASS_INDEX:
      return { unit: "", primarySeries: "bmi", secondarySeries: null };
    case OpdVitalTrendMetric.BLOOD_PRESSURE:
      return {
        unit: "mmHg",
        primarySeries: "systolic",
        secondarySeries: "diastolic",
      };
    case OpdVitalTrendMetric.PULSE_RATE:
      return { unit: "bpm", primarySeries: "pulse", secondarySeries: null };
    case OpdVitalTrendMetric.TEMPERATURE:
      return {
        unit: "°C",
        primarySeries: "temperature",
        secondarySeries: null,
      };
    case OpdVitalTrendMetric.OXYGEN_SATURATION:
      return { unit: "%", primarySeries: "spo2", secondarySeries: null };
    case OpdVitalTrendMetric.RESPIRATORY_RATE:
      return {
        unit: "/min",
        primarySeries: "respiratory",
        secondarySeries: null,
      };
    case OpdVitalTrendMetric.DTX:
      return { unit: "mg/dL", primarySeries: "dtx", secondarySeries: null };
    case OpdVitalTrendMetric.PAIN_SCORE:
      return { unit: "/10", primarySeries: "painScore", secondarySeries: null };
  }
}

function trendValues(
  row: OpdVitalTrendRecord,
  metric: OpdVitalTrendMetric,
): { primary: number | null; secondary: number | null } {
  const vital = row.vital_observation;
  if (!vital) return { primary: null, secondary: null };
  switch (metric) {
    case OpdVitalTrendMetric.WEIGHT_KG:
      return { primary: decimalNumber(vital.weight_kg), secondary: null };
    case OpdVitalTrendMetric.BODY_MASS_INDEX:
      return { primary: decimalNumber(vital.body_mass_index), secondary: null };
    case OpdVitalTrendMetric.BLOOD_PRESSURE:
      return {
        primary: vital.systolic_blood_pressure_mmhg,
        secondary: vital.diastolic_blood_pressure_mmhg,
      };
    case OpdVitalTrendMetric.PULSE_RATE:
      return { primary: vital.pulse_rate_per_minute, secondary: null };
    case OpdVitalTrendMetric.TEMPERATURE:
      return {
        primary: decimalNumber(vital.temperature_celsius),
        secondary: null,
      };
    case OpdVitalTrendMetric.OXYGEN_SATURATION:
      return {
        primary: decimalNumber(vital.oxygen_saturation_percent),
        secondary: null,
      };
    case OpdVitalTrendMetric.RESPIRATORY_RATE:
      return {
        primary: vital.respiratory_rate_per_minute,
        secondary: null,
      };
    case OpdVitalTrendMetric.DTX:
      return { primary: decimalNumber(vital.dtx_mg_dl), secondary: null };
    case OpdVitalTrendMetric.PAIN_SCORE:
      return { primary: vital.pain_score, secondary: null };
  }
}

function decimalNumber(value: { toString(): string } | null): number | null {
  if (value === null) return null;
  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}
