import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  auditReferenceType,
  type api_idempotency,
  type opd_encounter,
} from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type {
  CreateOpdExaminationCorrectionDto,
  FinalizeOpdExaminationDto,
  PatchOpdVitalObservationDto,
  QueryOpdExaminationsDto,
} from "./dto/opd-examination.dto";
import {
  CreateOpdExaminationCorrectionResult,
  CreateOpdExaminationResult,
  OpdExaminationListResult,
  OpdExaminationView,
  type OpdExaminationRecord,
  toOpdExaminationView,
} from "./opd-clinical.mapper";
import { OpdClinicalIntakeRepository } from "./opd-clinical-intake.repository";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import { OpdClinicalSectionRepository } from "./opd-clinical-section.repository";

const FINALIZE_OPERATION = "OPD_EXAMINATION_FINALIZE";
const CORRECTION_OPERATION = "OPD_EXAMINATION_CORRECTION_CREATE";
const IDEMPOTENCY_LOCK_MS = 30_000;
const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const VITAL_FIELD_NAMES = [
  "weightKg",
  "heightCm",
  "systolicBloodPressureMmHg",
  "diastolicBloodPressureMmHg",
  "pulseRatePerMinute",
  "temperatureCelsius",
  "oxygenSaturationPercent",
  "respiratoryRatePerMinute",
  "dtxMgDl",
  "painScore",
] as const;

type VitalFieldName = (typeof VITAL_FIELD_NAMES)[number];

interface FinalizeSnapshot {
  examinationId: string;
  examinationVersion: number;
  vitalVersion: number;
  intakeId?: string;
  intakeVersion?: number;
  symptomSectionId?: string;
  symptomVersion?: number;
  supersededExaminationId?: string;
  supersededExaminationVersion?: number;
  status: string;
}

interface CorrectionSnapshot {
  examinationId: string;
  sourceExaminationId: string;
  correctionRootExaminationId: string;
}

@Injectable()
export class OpdClinicalService {
  constructor(
    private readonly repository: OpdClinicalRepository,
    private readonly intakeRepository: OpdClinicalIntakeRepository,
    private readonly sectionRepository: OpdClinicalSectionRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listExaminations(
    encounterId: string,
    query: QueryOpdExaminationsDto,
    scope: RequestScope,
  ): Promise<OpdExaminationListResult> {
    const encounter = await this.repository.findEncounter(encounterId, scope);
    if (!encounter) this.throwEncounterNotFound();
    const result = await this.repository.listExaminations(
      encounterId,
      scope,
      query,
    );
    return {
      items: result.items.map(toOpdExaminationView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async examination(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
  ): Promise<OpdExaminationView> {
    const row = await this.repository.findExamination(
      encounterId,
      examinationId,
      scope,
    );
    if (!row) this.throwExaminationNotFound();
    return toOpdExaminationView(row);
  }

  async createExamination(
    encounterId: string,
    scope: RequestScope,
    principal: Principal,
  ): Promise<CreateOpdExaminationResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.lockEncounter(
        encounterId,
        scope,
        tx,
      );
      if (!locked) this.throwEncounterNotFound();
      const encounter = await this.repository.findEncounter(
        encounterId,
        scope,
        tx,
      );
      if (!encounter) this.throwEncounterNotFound();
      this.assertEncounterEditable(encounter);

      const existing = await this.repository.findDraft(encounterId, scope, tx);
      if (existing) {
        return { examination: toOpdExaminationView(existing), resumed: true };
      }

      const examinationNumber = await this.repository.nextExaminationNumber(
        encounterId,
        scope,
        tx,
      );
      const now = new Date();
      const created = await this.repository.createExamination(
        encounterId,
        examinationNumber,
        scope,
        now,
        tx,
      );
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "examination.create",
          actionLabel: "Create OPD vital examination draft",
          toStatus: "DRAFT",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            examinationId: created.examination_id,
            examinationNumber,
            version: created.version,
          },
        },
        tx,
      );
      return { examination: toOpdExaminationView(created), resumed: false };
    });
  }

  async patchVitals(
    encounterId: string,
    examinationId: string,
    dto: PatchOpdVitalObservationDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdExaminationView> {
    const changedFields = this.changedVitalFields(dto);
    if (changedFields.length === 0) {
      throw new BadRequestException(
        "At least one vital field must be supplied",
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const locked = await this.repository.lockExamination(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!locked) this.throwExaminationNotFound();
      const encounter = await this.repository.findEncounter(
        encounterId,
        scope,
        tx,
      );
      if (!encounter) this.throwEncounterNotFound();
      this.assertEncounterEditable(encounter);
      const examination = await this.repository.findExamination(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!examination) this.throwExaminationNotFound();
      this.assertDraftExamination(examination);
      const vitals = examination.vital_observation;
      if (!vitals)
        throw new Error("OPD examination is missing its vital observation");
      if (vitals.version !== dto.expectedVersion) {
        this.throwVitalVersionConflict(examination);
      }

      const now = new Date();
      const update = this.vitalUpdate(dto, examination, now, scope.userId);
      const updatedCount = await this.repository.updateVitals(
        vitals.vital_observation_id,
        examinationId,
        dto.expectedVersion,
        scope,
        update,
        tx,
      );
      if (updatedCount !== 1) {
        const current = await this.repository.findExamination(
          encounterId,
          examinationId,
          scope,
          tx,
        );
        if (current) this.throwVitalVersionConflict(current);
        this.throwExaminationNotFound();
      }

      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "vitals.update",
          actionLabel: "Update OPD vital observation draft",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            examinationId,
            vitalObservationId: vitals.vital_observation_id,
            changedFields,
            previousVersion: dto.expectedVersion,
            resultVersion: dto.expectedVersion + 1,
          },
        },
        tx,
      );

      const updated = await this.repository.findExamination(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!updated)
        throw new Error("Updated OPD examination could not be reloaded");
      return toOpdExaminationView(updated);
    });
  }

  async createExaminationCorrection(
    encounterId: string,
    sourceExaminationId: string,
    dto: CreateOpdExaminationCorrectionDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<CreateOpdExaminationCorrectionResult> {
    const reason = this.normalizeCorrectionReason(dto.reason);
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          encounterId,
          sourceExaminationId,
          expectedExaminationVersion: dto.expectedExaminationVersion,
          expectedVitalVersion: dto.expectedVitalVersion,
          ...(dto.expectedIntakeVersion !== undefined
            ? { expectedIntakeVersion: dto.expectedIntakeVersion }
            : {}),
          ...(dto.expectedSymptomVersion !== undefined
            ? { expectedSymptomVersion: dto.expectedSymptomVersion }
            : {}),
          reason,
        }),
      )
      .digest("hex");
    const existing = await this.repository.findIdempotency(
      scope,
      CORRECTION_OPERATION,
      idempotencyKey,
    );
    if (existing) {
      return this.replayCorrection(
        existing,
        requestHash,
        encounterId,
        sourceExaminationId,
        scope,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claim = await this.repository.createIdempotency(
          scope,
          {
            operation: CORRECTION_OPERATION,
            idempotencyKey,
            requestHash,
            now,
            lockExpiresAt: new Date(now.getTime() + IDEMPOTENCY_LOCK_MS),
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
          tx,
        );
        const encounterLocked = await this.repository.lockEncounter(
          encounterId,
          scope,
          tx,
        );
        if (!encounterLocked) this.throwEncounterNotFound();
        const encounter = await this.repository.findEncounter(
          encounterId,
          scope,
          tx,
        );
        if (!encounter) this.throwEncounterNotFound();
        this.assertEncounterEditable(encounter);

        const sourceLocked = await this.repository.lockExamination(
          encounterId,
          sourceExaminationId,
          scope,
          tx,
        );
        if (!sourceLocked) this.throwExaminationNotFound();
        const source = await this.repository.findExamination(
          encounterId,
          sourceExaminationId,
          scope,
          tx,
        );
        if (!source) this.throwExaminationNotFound();
        if (source.status !== "FINAL") {
          throw new ConflictException(
            "Only the current finalized examination can begin a correction",
          );
        }
        if (source.version !== dto.expectedExaminationVersion) {
          this.throwExaminationVersionConflict(source);
        }
        const sourceVitals = source.vital_observation;
        if (!sourceVitals) {
          throw new Error("Correction source is missing its vital observation");
        }
        if (sourceVitals.version !== dto.expectedVitalVersion) {
          this.throwVitalVersionConflict(source);
        }
        const sourceIntake = await this.intakeRepository.findIntake(
          encounterId,
          sourceExaminationId,
          scope,
          tx,
        );
        this.assertExpectedIntakeVersion(
          sourceIntake,
          dto.expectedIntakeVersion,
          source.status,
        );
        const sourceSymptoms = await this.sectionRepository.findSymptomSection(
          encounterId,
          sourceExaminationId,
          scope,
          tx,
        );
        this.assertExpectedSymptomVersion(
          sourceSymptoms,
          dto.expectedSymptomVersion,
          source.status,
        );

        const activeDraft = await this.repository.findDraft(
          encounterId,
          scope,
          tx,
        );
        if (activeDraft) {
          throw new ConflictException(
            "Finish or discard the active examination draft before starting a correction",
          );
        }
        const successor = await this.repository.findCorrectionSuccessor(
          encounterId,
          sourceExaminationId,
          scope,
          tx,
        );
        if (successor) {
          throw new ConflictException(
            "This finalized examination already has a correction revision",
          );
        }

        const examinationNumber = await this.repository.nextExaminationNumber(
          encounterId,
          scope,
          tx,
        );
        const correctionRootExaminationId =
          source.corrects_examination_id ?? source.examination_id;
        const created = await this.repository.createCorrectionExamination(
          source,
          sourceIntake,
          sourceSymptoms,
          examinationNumber,
          correctionRootExaminationId,
          reason,
          scope,
          now,
          tx,
        );
        await this.auditLogService.create(
          {
            clinicId: scope.clinicId,
            branchId: scope.branchId,
            referenceType: auditReferenceType.OPD,
            referenceId: encounterId,
            action: "examination.correction.create",
            actionLabel: "Create OPD examination correction draft",
            fromStatus: source.status,
            toStatus: "DRAFT",
            actorUserId: scope.userId,
            actorName: principal.name,
            actorRole: this.actorRole(scope),
            metadata: {
              sourceExaminationId,
              sourceExaminationVersion: source.version,
              sourceVitalVersion: sourceVitals.version,
              ...(sourceIntake
                ? {
                    sourceIntakeId: sourceIntake.intake_id,
                    sourceIntakeVersion: sourceIntake.version,
                  }
                : {}),
              ...(sourceSymptoms
                ? {
                    sourceSymptomSectionId: sourceSymptoms.symptom_section_id,
                    sourceSymptomVersion: sourceSymptoms.version,
                  }
                : {}),
              correctionExaminationId: created.examination_id,
              correctionRootExaminationId,
              examinationNumber,
              reason,
            },
          },
          tx,
        );
        const snapshot: Prisma.InputJsonObject = {
          examinationId: created.examination_id,
          sourceExaminationId,
          correctionRootExaminationId,
        };
        await this.repository.completeCorrectionIdempotency(
          claim.api_idempotency_id,
          created.examination_id,
          scope,
          snapshot,
          now,
          tx,
        );
        return {
          examination: toOpdExaminationView(created),
          sourceExaminationId,
          correctionRootExaminationId,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.repository.findIdempotency(
          scope,
          CORRECTION_OPERATION,
          idempotencyKey,
        );
        if (replay) {
          return this.replayCorrection(
            replay,
            requestHash,
            encounterId,
            sourceExaminationId,
            scope,
          );
        }
      }
      throw error;
    }
  }

  async finalizeExamination(
    encounterId: string,
    examinationId: string,
    dto: FinalizeOpdExaminationDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdExaminationView> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          encounterId,
          examinationId,
          expectedExaminationVersion: dto.expectedExaminationVersion,
          expectedVitalVersion: dto.expectedVitalVersion,
          ...(dto.expectedIntakeVersion !== undefined
            ? { expectedIntakeVersion: dto.expectedIntakeVersion }
            : {}),
          ...(dto.expectedSymptomVersion !== undefined
            ? { expectedSymptomVersion: dto.expectedSymptomVersion }
            : {}),
        }),
      )
      .digest("hex");
    const existing = await this.repository.findIdempotency(
      scope,
      FINALIZE_OPERATION,
      idempotencyKey,
    );
    if (existing) {
      return this.replayFinalization(
        existing,
        requestHash,
        encounterId,
        examinationId,
        scope,
      );
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const now = new Date();
        const claim = await this.repository.createIdempotency(
          scope,
          {
            operation: FINALIZE_OPERATION,
            idempotencyKey,
            requestHash,
            now,
            lockExpiresAt: new Date(now.getTime() + IDEMPOTENCY_LOCK_MS),
            expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS),
          },
          tx,
        );
        const locked = await this.repository.lockExamination(
          encounterId,
          examinationId,
          scope,
          tx,
        );
        if (!locked) this.throwExaminationNotFound();
        const encounter = await this.repository.findEncounter(
          encounterId,
          scope,
          tx,
        );
        if (!encounter) this.throwEncounterNotFound();
        this.assertEncounterEditable(encounter);
        const examination = await this.repository.findExamination(
          encounterId,
          examinationId,
          scope,
          tx,
        );
        if (!examination) this.throwExaminationNotFound();
        this.assertDraftExamination(examination);
        if (examination.version !== dto.expectedExaminationVersion) {
          throw new VersionConflictException({
            resourceType: "OPD_EXAMINATION",
            resourceId: examination.examination_id,
            currentVersion: examination.version,
            currentStatus: examination.status,
            updatedAt: examination.updated_at.toISOString(),
          });
        }
        const vitals = examination.vital_observation;
        if (!vitals)
          throw new Error("OPD examination is missing its vital observation");
        if (vitals.version !== dto.expectedVitalVersion) {
          this.throwVitalVersionConflict(examination);
        }
        const intake = await this.intakeRepository.findIntake(
          encounterId,
          examinationId,
          scope,
          tx,
        );
        this.assertExpectedIntakeVersion(
          intake,
          dto.expectedIntakeVersion,
          examination.status,
        );
        const symptoms = await this.sectionRepository.findSymptomSection(
          encounterId,
          examinationId,
          scope,
          tx,
        );
        this.assertExpectedSymptomVersion(
          symptoms,
          dto.expectedSymptomVersion,
          examination.status,
        );
        if (!this.hasMeasuredVital(examination)) {
          throw new BadRequestException(
            "At least one vital measurement is required before finalization",
          );
        }

        let superseded: OpdExaminationRecord | null = null;
        if (examination.supersedes_examination_id) {
          const supersededLocked = await this.repository.lockExamination(
            encounterId,
            examination.supersedes_examination_id,
            scope,
            tx,
          );
          if (!supersededLocked) {
            throw new ConflictException(
              "The correction source examination is no longer available",
            );
          }
          superseded = await this.repository.findExamination(
            encounterId,
            examination.supersedes_examination_id,
            scope,
            tx,
          );
          if (!superseded) {
            throw new ConflictException(
              "The correction source examination is no longer available",
            );
          }
          if (
            superseded.status !== "FINAL" ||
            examination.correction_source_version === null
          ) {
            throw new ConflictException(
              "The correction source is no longer the current finalized examination",
            );
          }
          if (superseded.version !== examination.correction_source_version) {
            this.throwExaminationVersionConflict(superseded);
          }
        }

        const updatedCount = await this.repository.finalizeExamination(
          encounterId,
          examinationId,
          dto.expectedExaminationVersion,
          scope,
          now,
          tx,
        );
        if (updatedCount !== 1) {
          throw new VersionConflictException({
            resourceType: "OPD_EXAMINATION",
            resourceId: examinationId,
            currentVersion: examination.version,
            currentStatus: examination.status,
            updatedAt: examination.updated_at.toISOString(),
          });
        }
        if (superseded) {
          const correctedCount = await this.repository.markExaminationCorrected(
            encounterId,
            superseded.examination_id,
            superseded.version,
            scope,
            now,
            tx,
          );
          if (correctedCount !== 1) {
            this.throwExaminationVersionConflict(superseded);
          }
        }
        await this.auditLogService.create(
          {
            clinicId: scope.clinicId,
            branchId: scope.branchId,
            referenceType: auditReferenceType.OPD,
            referenceId: encounterId,
            action: superseded
              ? "examination.correction.finalize"
              : "examination.finalize",
            actionLabel: superseded
              ? "Finalize OPD examination correction"
              : "Finalize OPD vital examination",
            fromStatus: "DRAFT",
            toStatus: "FINAL",
            actorUserId: scope.userId,
            actorName: principal.name,
            actorRole: this.actorRole(scope),
            metadata: {
              examinationId,
              examinationNumber: examination.examination_number,
              previousVersion: dto.expectedExaminationVersion,
              resultVersion: dto.expectedExaminationVersion + 1,
              vitalVersion: vitals.version,
              ...(intake
                ? {
                    intakeId: intake.intake_id,
                    intakeVersion: intake.version,
                  }
                : {}),
              ...(symptoms
                ? {
                    symptomSectionId: symptoms.symptom_section_id,
                    symptomVersion: symptoms.version,
                  }
                : {}),
              ...(superseded
                ? {
                    supersededExaminationId: superseded.examination_id,
                    supersededPreviousVersion: superseded.version,
                    supersededResultVersion: superseded.version + 1,
                    correctionRootExaminationId:
                      examination.corrects_examination_id,
                    correctionReason: examination.correction_reason,
                  }
                : {}),
            },
          },
          tx,
        );
        const snapshot: Prisma.InputJsonObject = {
          examinationId,
          examinationVersion: dto.expectedExaminationVersion + 1,
          vitalVersion: vitals.version,
          ...(intake
            ? {
                intakeId: intake.intake_id,
                intakeVersion: intake.version,
              }
            : {}),
          ...(symptoms
            ? {
                symptomSectionId: symptoms.symptom_section_id,
                symptomVersion: symptoms.version,
              }
            : {}),
          ...(superseded
            ? {
                supersededExaminationId: superseded.examination_id,
                supersededExaminationVersion: superseded.version + 1,
              }
            : {}),
          status: "FINAL",
        };
        await this.repository.completeIdempotency(
          claim.api_idempotency_id,
          examinationId,
          scope,
          snapshot,
          now,
          tx,
        );
        const updated = await this.repository.findExamination(
          encounterId,
          examinationId,
          scope,
          tx,
        );
        if (!updated)
          throw new Error("Finalized OPD examination could not be reloaded");
        return toOpdExaminationView(updated);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.repository.findIdempotency(
          scope,
          FINALIZE_OPERATION,
          idempotencyKey,
        );
        if (replay) {
          return this.replayFinalization(
            replay,
            requestHash,
            encounterId,
            examinationId,
            scope,
          );
        }
      }
      throw error;
    }
  }

  private changedVitalFields(
    dto: PatchOpdVitalObservationDto,
  ): VitalFieldName[] {
    return VITAL_FIELD_NAMES.filter((field) => dto[field] !== undefined);
  }

  private vitalUpdate(
    dto: PatchOpdVitalObservationDto,
    examination: OpdExaminationRecord,
    now: Date,
    actorUserId: string,
  ): Prisma.opd_vital_observationUpdateManyMutationInput {
    const current = examination.vital_observation;
    if (!current)
      throw new Error("OPD examination is missing its vital observation");
    const weight =
      dto.weightKg !== undefined
        ? dto.weightKg
        : this.decimalNumber(current.weight_kg);
    const height =
      dto.heightCm !== undefined
        ? dto.heightCm
        : this.decimalNumber(current.height_cm);
    const bodyMassIndex =
      weight !== null && weight > 0 && height !== null && height > 0
        ? Math.round((weight / (height / 100) ** 2) * 100) / 100
        : null;
    if (bodyMassIndex !== null && bodyMassIndex > 999.99) {
      throw new BadRequestException(
        "Computed BMI exceeds the supported storage range",
      );
    }
    return {
      ...(dto.weightKg !== undefined ? { weight_kg: dto.weightKg } : {}),
      ...(dto.heightCm !== undefined ? { height_cm: dto.heightCm } : {}),
      ...(dto.systolicBloodPressureMmHg !== undefined
        ? { systolic_blood_pressure_mmhg: dto.systolicBloodPressureMmHg }
        : {}),
      ...(dto.diastolicBloodPressureMmHg !== undefined
        ? { diastolic_blood_pressure_mmhg: dto.diastolicBloodPressureMmHg }
        : {}),
      ...(dto.pulseRatePerMinute !== undefined
        ? { pulse_rate_per_minute: dto.pulseRatePerMinute }
        : {}),
      ...(dto.temperatureCelsius !== undefined
        ? { temperature_celsius: dto.temperatureCelsius }
        : {}),
      ...(dto.oxygenSaturationPercent !== undefined
        ? { oxygen_saturation_percent: dto.oxygenSaturationPercent }
        : {}),
      ...(dto.respiratoryRatePerMinute !== undefined
        ? { respiratory_rate_per_minute: dto.respiratoryRatePerMinute }
        : {}),
      ...(dto.dtxMgDl !== undefined ? { dtx_mg_dl: dto.dtxMgDl } : {}),
      ...(dto.painScore !== undefined ? { pain_score: dto.painScore } : {}),
      body_mass_index: bodyMassIndex,
      reference_rule_version: null,
      interpretation_snapshot: Prisma.DbNull,
      version: { increment: 1 },
      updated_by: actorUserId,
      updated_at: now,
    };
  }

  private async replayCorrection(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    sourceExaminationId: string,
    scope: RequestScope,
  ): Promise<CreateOpdExaminationCorrectionResult> {
    if (claim.request_hash !== requestHash) {
      throw new ConflictException(
        "Idempotency-Key was already used with a different correction request",
      );
    }
    if (claim.state !== "COMPLETED") {
      throw new ConflictException(
        "Examination correction creation is already in progress",
      );
    }
    const snapshot = this.correctionSnapshot(claim.result_snapshot);
    if (!snapshot || snapshot.sourceExaminationId !== sourceExaminationId) {
      throw new ConflictException("Stored correction result is invalid");
    }
    const examination = await this.repository.findExamination(
      encounterId,
      snapshot.examinationId,
      scope,
    );
    if (
      !examination ||
      examination.supersedes_examination_id !== sourceExaminationId ||
      examination.corrects_examination_id !==
        snapshot.correctionRootExaminationId
    ) {
      throw new ConflictException(
        "Stored correction result no longer matches the resource",
      );
    }
    return {
      examination: toOpdExaminationView(examination),
      sourceExaminationId,
      correctionRootExaminationId: snapshot.correctionRootExaminationId,
    };
  }

  private correctionSnapshot(
    value: Prisma.JsonValue | null,
  ): CorrectionSnapshot | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const examinationId = value.examinationId;
    const sourceExaminationId = value.sourceExaminationId;
    const correctionRootExaminationId = value.correctionRootExaminationId;
    if (
      typeof examinationId !== "string" ||
      typeof sourceExaminationId !== "string" ||
      typeof correctionRootExaminationId !== "string"
    ) {
      return null;
    }
    return {
      examinationId,
      sourceExaminationId,
      correctionRootExaminationId,
    };
  }

  private async replayFinalization(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
  ): Promise<OpdExaminationView> {
    if (claim.request_hash !== requestHash) {
      throw new ConflictException(
        "Idempotency-Key was already used with a different finalization request",
      );
    }
    if (claim.state !== "COMPLETED") {
      throw new ConflictException(
        "Examination finalization is already in progress",
      );
    }
    const snapshot = this.finalizeSnapshot(claim.result_snapshot);
    if (!snapshot || snapshot.examinationId !== examinationId) {
      throw new ConflictException("Stored finalization result is invalid");
    }
    const examination = await this.repository.findExamination(
      encounterId,
      examinationId,
      scope,
    );
    if (
      !examination ||
      examination.status !== snapshot.status ||
      examination.version !== snapshot.examinationVersion ||
      examination.vital_observation?.version !== snapshot.vitalVersion
    ) {
      throw new ConflictException(
        "Stored finalization result no longer matches the resource",
      );
    }
    if (snapshot.intakeVersion !== undefined) {
      const intake = await this.intakeRepository.findIntake(
        encounterId,
        examinationId,
        scope,
      );
      if (
        !intake ||
        intake.intake_id !== snapshot.intakeId ||
        intake.version !== snapshot.intakeVersion
      ) {
        throw new ConflictException(
          "Stored finalization result no longer matches the intake section",
        );
      }
    }
    if (snapshot.symptomVersion !== undefined) {
      const symptoms = await this.sectionRepository.findSymptomSection(
        encounterId,
        examinationId,
        scope,
      );
      if (
        !symptoms ||
        symptoms.symptom_section_id !== snapshot.symptomSectionId ||
        symptoms.version !== snapshot.symptomVersion
      ) {
        throw new ConflictException(
          "Stored finalization result no longer matches the symptom section",
        );
      }
    }
    if (snapshot.supersededExaminationId !== undefined) {
      const superseded = await this.repository.findExamination(
        encounterId,
        snapshot.supersededExaminationId,
        scope,
      );
      if (
        !superseded ||
        superseded.status !== "CORRECTED" ||
        superseded.version !== snapshot.supersededExaminationVersion
      ) {
        throw new ConflictException(
          "Stored finalization result no longer matches the correction source",
        );
      }
    }
    return toOpdExaminationView(examination);
  }

  private finalizeSnapshot(
    value: Prisma.JsonValue | null,
  ): FinalizeSnapshot | null {
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    const examinationId = value.examinationId;
    const examinationVersion = value.examinationVersion;
    const vitalVersion = value.vitalVersion;
    const intakeId = value.intakeId;
    const intakeVersion = value.intakeVersion;
    const symptomSectionId = value.symptomSectionId;
    const symptomVersion = value.symptomVersion;
    const supersededExaminationId = value.supersededExaminationId;
    const supersededExaminationVersion = value.supersededExaminationVersion;
    const status = value.status;
    if (
      typeof examinationId !== "string" ||
      typeof examinationVersion !== "number" ||
      typeof vitalVersion !== "number" ||
      typeof status !== "string"
    ) {
      return null;
    }
    if (
      (symptomSectionId !== undefined &&
        typeof symptomSectionId !== "string") ||
      (intakeId !== undefined && typeof intakeId !== "string") ||
      (intakeVersion !== undefined && typeof intakeVersion !== "number") ||
      (intakeVersion !== undefined && intakeId === undefined) ||
      (intakeId !== undefined && intakeVersion === undefined) ||
      (symptomVersion !== undefined && typeof symptomVersion !== "number") ||
      (symptomVersion !== undefined && symptomSectionId === undefined) ||
      (symptomSectionId !== undefined && symptomVersion === undefined) ||
      (supersededExaminationId !== undefined &&
        typeof supersededExaminationId !== "string") ||
      (supersededExaminationVersion !== undefined &&
        typeof supersededExaminationVersion !== "number") ||
      (supersededExaminationVersion !== undefined &&
        supersededExaminationId === undefined) ||
      (supersededExaminationId !== undefined &&
        supersededExaminationVersion === undefined)
    ) {
      return null;
    }
    return {
      examinationId,
      examinationVersion,
      vitalVersion,
      ...(intakeId !== undefined && intakeVersion !== undefined
        ? { intakeId, intakeVersion }
        : {}),
      ...(symptomSectionId !== undefined && symptomVersion !== undefined
        ? { symptomSectionId, symptomVersion }
        : {}),
      ...(supersededExaminationId !== undefined &&
      supersededExaminationVersion !== undefined
        ? { supersededExaminationId, supersededExaminationVersion }
        : {}),
      status,
    };
  }

  private assertEncounterEditable(encounter: opd_encounter): void {
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      throw new ConflictException(
        "Clinical vitals can only be edited on an open draft encounter",
      );
    }
  }

  private assertDraftExamination(examination: OpdExaminationRecord): void {
    if (examination.status !== "DRAFT") {
      throw new ConflictException(
        "Finalized, corrected, or void examinations are immutable",
      );
    }
  }

  private assertExpectedSymptomVersion(
    section: {
      symptom_section_id: string;
      version: number;
      updated_at: Date;
    } | null,
    expectedVersion: number | undefined,
    examinationStatus: string,
  ): void {
    if (section) {
      if (expectedVersion === undefined) {
        throw new BadRequestException(
          "expectedSymptomVersion is required when the examination has a symptom section",
        );
      }
      if (section.version !== expectedVersion) {
        this.throwSymptomVersionConflict(section, examinationStatus);
      }
    } else if (expectedVersion !== undefined) {
      throw new BadRequestException(
        "The examination does not have a symptom section",
      );
    }
  }

  private assertExpectedIntakeVersion(
    intake: {
      intake_id: string;
      version: number;
      updated_at: Date;
    } | null,
    expectedVersion: number | undefined,
    examinationStatus: string,
  ): void {
    if (intake) {
      if (expectedVersion === undefined) {
        throw new BadRequestException(
          "expectedIntakeVersion is required when the examination has intake data",
        );
      }
      if (intake.version !== expectedVersion) {
        this.throwIntakeVersionConflict(intake, examinationStatus);
      }
    } else if (expectedVersion !== undefined) {
      throw new BadRequestException(
        "The examination does not have an intake section",
      );
    }
  }

  private hasMeasuredVital(examination: OpdExaminationRecord): boolean {
    const vital = examination.vital_observation;
    if (!vital) return false;
    return [
      vital.weight_kg,
      vital.height_cm,
      vital.systolic_blood_pressure_mmhg,
      vital.diastolic_blood_pressure_mmhg,
      vital.pulse_rate_per_minute,
      vital.temperature_celsius,
      vital.oxygen_saturation_percent,
      vital.respiratory_rate_per_minute,
      vital.dtx_mg_dl,
      vital.pain_score,
    ].some((value) => value !== null);
  }

  private throwVitalVersionConflict(examination: OpdExaminationRecord): never {
    const vital = examination.vital_observation;
    if (!vital)
      throw new Error("OPD examination is missing its vital observation");
    throw new VersionConflictException({
      resourceType: "OPD_VITAL_OBSERVATION",
      resourceId: vital.vital_observation_id,
      currentVersion: vital.version,
      currentStatus: examination.status,
      updatedAt: vital.updated_at.toISOString(),
    });
  }

  private throwExaminationVersionConflict(
    examination: OpdExaminationRecord,
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_EXAMINATION",
      resourceId: examination.examination_id,
      currentVersion: examination.version,
      currentStatus: examination.status,
      updatedAt: examination.updated_at.toISOString(),
    });
  }

  private throwSymptomVersionConflict(
    section: {
      symptom_section_id: string;
      version: number;
      updated_at: Date;
    },
    currentStatus = "DRAFT",
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_SYMPTOM_SECTION",
      resourceId: section.symptom_section_id,
      currentVersion: section.version,
      currentStatus,
      updatedAt: section.updated_at.toISOString(),
    });
  }

  private throwIntakeVersionConflict(
    intake: {
      intake_id: string;
      version: number;
      updated_at: Date;
    },
    currentStatus = "DRAFT",
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_INTAKE",
      resourceId: intake.intake_id,
      currentVersion: intake.version,
      currentStatus,
      updatedAt: intake.updated_at.toISOString(),
    });
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    const key = value?.trim() ?? "";
    if (key.length < 8 || key.length > 200) {
      throw new BadRequestException(
        "Idempotency-Key header must contain 8 to 200 characters",
      );
    }
    return key;
  }

  private normalizeCorrectionReason(value: string): string {
    const reason = value.trim();
    if (!reason) {
      throw new BadRequestException("A correction reason is required");
    }
    if (reason.length > 500) {
      throw new BadRequestException(
        "Correction reason must contain at most 500 characters",
      );
    }
    return reason;
  }

  private decimalNumber(value: { toString(): string } | null): number | null {
    if (value === null) return null;
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }

  private actorRole(scope: RequestScope): string | undefined {
    return (
      scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined)
    );
  }

  private throwEncounterNotFound(): never {
    throw new NotFoundException(
      "OPD encounter not found for this clinic/branch",
    );
  }

  private throwExaminationNotFound(): never {
    throw new NotFoundException(
      "OPD examination not found for this encounter and scope",
    );
  }
}
