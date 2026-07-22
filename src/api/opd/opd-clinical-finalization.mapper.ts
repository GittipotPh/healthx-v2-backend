import { ApiProperty } from "@nestjs/swagger";
import { OpdClinicalFinalizationManifestDto } from "./dto/opd-clinical-finalization.dto";

export const OPD_FINALIZATION_BLOCKER_CODES = [
  "ENCOUNTER_NOT_OPEN",
  "CLINICAL_RECORD_NOT_DRAFT",
  "ENCOUNTER_NOT_RECONCILED",
  "LEGACY_OPD_LINK_MISSING",
  "ATTENDING_DOCTOR_REQUIRED",
  "FINAL_EXAMINATION_REQUIRED",
  "EXAMINATION_DRAFT_PENDING",
  "CLINICAL_RESOURCE_VERSION_STALE",
  "NOTE_AUTOSAVE_NOT_STABLE",
  "DIAGNOSIS_INVARIANT_INVALID",
  "ORDER_DRAFT_PENDING",
  "UNSUPPORTED_COURSE_STATE",
  "COPIED_SECTION_REVIEW_REQUIRED",
  "FINALIZATION_PERMISSION_REQUIRED",
  "QUEUE_TICKET_LINK_MISMATCH",
  "QUEUE_TICKET_NOT_IN_SERVICE",
  "QUEUE_TICKET_VERSION_STALE",
  "QUEUE_DISPENSING_DISABLED",
  "QUEUE_TRANSITION_PERMISSION_REQUIRED",
  "QUEUE_TRANSITION_BLOCKED",
] as const;

export type OpdFinalizationBlockerCode =
  (typeof OPD_FINALIZATION_BLOCKER_CODES)[number];

export const OPD_FINALIZATION_TARGETS = [
  "EXAMINATION",
  "NOTES",
  "DIAGNOSES",
  "ORDER",
  "DOCTOR",
  "ENCOUNTER",
  "QUEUE",
] as const;

export type OpdFinalizationTarget = (typeof OPD_FINALIZATION_TARGETS)[number];

export class OpdFinalizationBlockerView {
  @ApiProperty({ enum: OPD_FINALIZATION_BLOCKER_CODES })
  code!: OpdFinalizationBlockerCode;

  @ApiProperty({ type: String, nullable: true })
  resourceType!: string | null;

  @ApiProperty({ type: String, nullable: true })
  resourceId!: string | null;

  @ApiProperty({ enum: OPD_FINALIZATION_TARGETS })
  target!: OpdFinalizationTarget;

  @ApiProperty({ enum: ["BLOCKING"] })
  severity!: "BLOCKING";
}

export class OpdClinicalReadinessView {
  @ApiProperty({ enum: ["CLINICAL_FINALIZATION"] })
  stage!: "CLINICAL_FINALIZATION";

  @ApiProperty()
  ready!: boolean;

  @ApiProperty()
  encounterVersion!: number;

  @ApiProperty({ type: OpdClinicalFinalizationManifestDto })
  expectedVersions!: OpdClinicalFinalizationManifestDto;

  @ApiProperty({ type: [OpdFinalizationBlockerView] })
  blockers!: OpdFinalizationBlockerView[];
}

export class OpdAttendingClinicianResult {
  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty()
  attendingUserId!: string;

  @ApiProperty()
  encounterVersion!: number;
}

export class OpdClinicalFinalizationResult {
  @ApiProperty({ format: "uuid" })
  clinicalFinalizationId!: string;

  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty({ enum: ["POST_VISIT"] })
  workflowStatus!: "POST_VISIT";

  @ApiProperty({ enum: ["FINALIZED"] })
  clinicalRecordStatus!: "FINALIZED";

  @ApiProperty()
  encounterVersion!: number;

  @ApiProperty({ description: "ISO timestamp" })
  finalizedAt!: string;

  @ApiProperty()
  finalizedBy!: string;

  @ApiProperty({ format: "uuid" })
  queueTicketId!: string;

  @ApiProperty({ enum: ["IN_SERVICE"] })
  queueFromStep!: "IN_SERVICE";

  @ApiProperty({ enum: ["DISPENSING"] })
  queueStep!: "DISPENSING";

  @ApiProperty()
  queueTicketVersion!: number;

  @ApiProperty({ enum: ["DISPENSING"], nullable: true })
  appointmentStatus!: "DISPENSING" | null;

  @ApiProperty()
  replayed!: boolean;
}

export class OpdPostVisitPersonView {
  @ApiProperty()
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  name!: string | null;
}

export class OpdPostVisitPatientView extends OpdPostVisitPersonView {
  @ApiProperty({ type: String, nullable: true })
  nickname!: string | null;

  @ApiProperty({ type: String, nullable: true })
  phone!: string | null;

  @ApiProperty({ type: String, nullable: true })
  gender!: string | null;

  @ApiProperty({ type: String, nullable: true })
  birthDate!: string | null;

  @ApiProperty({ type: String, nullable: true })
  imageUrl!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: "Display-only unverified legacy personal identifier",
  })
  hn!: string | null;
}

export class OpdPostVisitContextView {
  @ApiProperty({ format: "uuid" })
  encounterId!: string;

  @ApiProperty()
  legacyOpdId!: string;

  @ApiProperty({ type: String, nullable: true })
  appointmentId!: string | null;

  @ApiProperty()
  businessDate!: string;

  @ApiProperty()
  workflowStatus!: string;

  @ApiProperty()
  clinicalRecordStatus!: string;

  @ApiProperty()
  encounterVersion!: number;

  @ApiProperty({ type: OpdPostVisitPatientView })
  patient!: OpdPostVisitPatientView;

  @ApiProperty({ type: OpdPostVisitPersonView })
  doctor!: OpdPostVisitPersonView;

  @ApiProperty({ type: OpdPostVisitPersonView })
  branch!: OpdPostVisitPersonView;
}

export class OpdPostVisitFinalizationView {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  finalizedAt!: string;

  @ApiProperty({ type: OpdPostVisitPersonView })
  finalizedBy!: OpdPostVisitPersonView;

  @ApiProperty()
  manifestHash!: string;
}

export class OpdPostVisitExaminationView {
  @ApiProperty({ format: "uuid" })
  id!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty()
  measuredAt!: string;

  @ApiProperty()
  status!: string;
}

export class OpdPostVisitVitalsView {
  @ApiProperty({ type: Number, nullable: true })
  weightKg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  heightCm!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  bodyMassIndex!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  systolicBloodPressureMmhg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  diastolicBloodPressureMmhg!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  pulseRatePerMinute!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  temperatureCelsius!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  oxygenSaturationPercent!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  respiratoryRatePerMinute!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  painScore!: number | null;
}

export class OpdPostVisitIntakeView {
  @ApiProperty()
  urinaryStatus!: string;

  @ApiProperty({ type: String, nullable: true })
  urinaryOtherText!: string | null;

  @ApiProperty()
  bowelStatus!: string;

  @ApiProperty({ type: String, nullable: true })
  bowelOtherText!: string | null;
}

export class OpdPostVisitSymptomView {
  @ApiProperty({ type: String, nullable: true })
  code!: string | null;

  @ApiProperty()
  text!: string;

  @ApiProperty({ type: String, nullable: true })
  duration!: string | null;

  @ApiProperty({ type: String, nullable: true })
  location!: string | null;

  @ApiProperty({ type: String, nullable: true })
  laterality!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  severity!: number | null;
}

export class OpdPostVisitDiagnosisView {
  @ApiProperty({ type: String, nullable: true })
  code!: string | null;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ type: String, nullable: true })
  note!: string | null;
}

export class OpdPostVisitNoteView {
  @ApiProperty()
  sectionCode!: string;

  @ApiProperty()
  plainText!: string;
}

export class OpdPostVisitClinicalView {
  @ApiProperty({ type: OpdPostVisitExaminationView })
  examination!: OpdPostVisitExaminationView;

  @ApiProperty({ type: OpdPostVisitVitalsView, nullable: true })
  vitals!: OpdPostVisitVitalsView | null;

  @ApiProperty({ type: OpdPostVisitIntakeView, nullable: true })
  intake!: OpdPostVisitIntakeView | null;

  @ApiProperty({ type: String, nullable: true })
  patientQuote!: string | null;

  @ApiProperty({ type: [OpdPostVisitSymptomView] })
  symptoms!: OpdPostVisitSymptomView[];

  @ApiProperty({ type: [OpdPostVisitDiagnosisView] })
  diagnoses!: OpdPostVisitDiagnosisView[];

  @ApiProperty({ type: [OpdPostVisitNoteView] })
  notes!: OpdPostVisitNoteView[];
}

export class OpdPostVisitMedicationView {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unit!: string;

  @ApiProperty()
  sigText!: string;

  @ApiProperty()
  lotId!: string;

  @ApiProperty()
  expiryAt!: string;
}

export const OPD_POST_VISIT_CAPABILITY_STATES = [
  "AVAILABLE",
  "EMPTY",
  "BLOCKED",
  "NOT_IMPLEMENTED",
] as const;

export class OpdPostVisitCapabilityView {
  @ApiProperty()
  code!: string;

  @ApiProperty({ enum: OPD_POST_VISIT_CAPABILITY_STATES })
  state!: (typeof OPD_POST_VISIT_CAPABILITY_STATES)[number];

  @ApiProperty({ type: String, nullable: true })
  reason!: string | null;

  @ApiProperty({ type: String, nullable: true })
  targetAction!: string | null;
}

export class OpdPostVisitView {
  @ApiProperty({ type: OpdPostVisitContextView })
  context!: OpdPostVisitContextView;

  @ApiProperty({ type: OpdPostVisitFinalizationView })
  finalization!: OpdPostVisitFinalizationView;

  @ApiProperty({ type: OpdPostVisitClinicalView })
  clinical!: OpdPostVisitClinicalView;

  @ApiProperty({ type: [OpdPostVisitMedicationView] })
  medications!: OpdPostVisitMedicationView[];

  @ApiProperty({ type: [OpdPostVisitCapabilityView] })
  capabilities!: OpdPostVisitCapabilityView[];

  @ApiProperty()
  lastUpdatedAt!: string;
}
