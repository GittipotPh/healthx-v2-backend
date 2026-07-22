import { createHash, randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  auditReferenceType,
  Prisma,
  type api_idempotency,
} from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  QueueTreatmentCompletionService,
  type QueueTreatmentCompletionBlockerCode,
} from "../queue/queue-treatment-completion.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  type AssignOpdAttendingClinicianDto,
  type FinalizeOpdClinicalDto,
  type OpdClinicalFinalizationManifestDto,
  type OpdFinalizationResourceVersionDto,
} from "./dto/opd-clinical-finalization.dto";
import { OPD_NOTE_SECTION_ORDER } from "./opd-clinical-note.mapper";
import {
  OpdAttendingClinicianResult,
  OpdClinicalFinalizationResult,
  OpdClinicalReadinessView,
  type OpdFinalizationBlockerCode,
  type OpdFinalizationBlockerView,
  type OpdFinalizationTarget,
  OpdPostVisitView,
} from "./opd-clinical-finalization.mapper";
import {
  canonicalFinalizationManifest,
  finalizationManifestHash,
  finalizationManifestJson,
  manifestsEqual,
  OPD_CLINICAL_FINALIZATION_MANIFEST_SCHEMA,
} from "./opd-clinical-finalization.manifest";
import {
  OpdClinicalFinalizationRepository,
  type OpdFinalizationAggregate,
} from "./opd-clinical-finalization.repository";

const FINALIZE_OPERATION = "OPD_CLINICAL_FINALIZE";

@Injectable()
export class OpdClinicalFinalizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: OpdClinicalFinalizationRepository,
    private readonly queueCompletion: QueueTreatmentCompletionService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async readiness(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdClinicalReadinessView> {
    const aggregate = await this.repository.findAggregate(encounterId, scope);
    if (!aggregate) this.throwEncounterNotFound();
    return this.buildReadiness(aggregate, scope);
  }

  async assignAttendingClinician(
    encounterId: string,
    dto: AssignOpdAttendingClinicianDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdAttendingClinicianResult> {
    return this.prisma.$transaction(
      async (tx) => {
        const locked = await this.repository.lockAggregate(
          encounterId,
          scope,
          tx,
        );
        if (!locked) this.throwEncounterNotFound();
        const aggregate = await this.repository.findAggregate(
          encounterId,
          scope,
          tx,
        );
        if (!aggregate) this.throwEncounterNotFound();
        if (
          aggregate.workflow_status !== "OPEN" ||
          aggregate.clinical_record_status !== "DRAFT"
        ) {
          this.throwConflict(
            "CLINICAL_RECORD_NOT_EDITABLE",
            "The attending clinician can only be changed on an open draft encounter",
          );
        }
        if (aggregate.version !== dto.expectedEncounterVersion) {
          this.throwEncounterVersionConflict(aggregate);
        }
        const valid = await this.repository.isValidAttendingDoctor(
          dto.attendingUserId,
          scope,
          tx,
        );
        if (!valid) {
          throw new BadRequestException({
            message:
              "The selected attending clinician is not an active doctor in this branch",
            code: "ATTENDING_DOCTOR_INVALID",
          });
        }
        const now = new Date();
        const updated = await this.repository.assignAttendingClinician(
          encounterId,
          dto.attendingUserId,
          dto.expectedEncounterVersion,
          scope,
          now,
          tx,
        );
        if (updated !== 1) this.throwEncounterVersionConflict(aggregate);
        await this.auditLogService.create(
          {
            clinicId: scope.clinicId,
            branchId: scope.branchId,
            referenceType: auditReferenceType.OPD,
            referenceId: encounterId,
            action: "attending-clinician.assign",
            actionLabel: "Assign OPD attending clinician",
            actorUserId: scope.userId,
            actorName: principal.name,
            actorRole: this.actorRole(scope),
            metadata: {
              previousAttendingUserId: aggregate.attending_user_id,
              attendingUserId: dto.attendingUserId,
              expectedEncounterVersion: dto.expectedEncounterVersion,
              resultEncounterVersion: dto.expectedEncounterVersion + 1,
            },
          },
          tx,
        );
        return {
          encounterId,
          attendingUserId: dto.attendingUserId,
          encounterVersion: dto.expectedEncounterVersion + 1,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 15_000,
      },
    );
  }

  async finalize(
    encounterId: string,
    dto: FinalizeOpdClinicalDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdClinicalFinalizationResult> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const requestHash = this.sha256(
      `${encounterId}\n${canonicalFinalizationManifest(dto.expectedVersions)}`,
    );
    return this.finalizeWithRetry(
      encounterId,
      dto,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  async postVisit(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdPostVisitView> {
    const aggregate = await this.repository.findAggregate(encounterId, scope);
    if (!aggregate) this.throwEncounterNotFound();
    if (
      !["POST_VISIT", "CLOSED"].includes(aggregate.workflow_status) ||
      aggregate.clinical_record_status !== "FINALIZED" ||
      !aggregate.clinical_finalization
    ) {
      this.throwConflict(
        "POST_VISIT_NOT_AVAILABLE",
        "Post-visit is available only after committed clinical finalization",
      );
    }
    const context = await this.repository.findPostVisitContext(
      aggregate,
      scope,
    );
    const examination = aggregate.examinations.find(
      (item) => item.status === "FINAL",
    );
    if (
      !context.patient ||
      !context.branch ||
      !context.doctor ||
      !context.legacyOpd ||
      !examination
    ) {
      this.throwConflict(
        "POST_VISIT_PROJECTION_INCOMPLETE",
        "Committed post-visit source data is incomplete",
      );
    }
    const finalization = aggregate.clinical_finalization;
    const vitals = examination.vital_observation;
    const intake = examination.intake;
    const symptomSection = examination.symptom_section;
    const releasedOrder = aggregate.orders.find(
      (order) => order.status === "RELEASED" && order.release !== null,
    );
    const medications =
      releasedOrder?.release?.items.map((item) => ({
        id: item.release_item_id,
        name: item.name_snapshot,
        quantity: this.decimalNumber(item.quantity) ?? 0,
        unit: item.unit_snapshot,
        sigText: item.sig_text,
        lotId: item.lot_id,
        expiryAt: item.expiry_at.toISOString(),
      })) ?? [];
    const doctorName = this.personName(context.doctor);
    const patientName = this.personName(context.patient);
    const finalizerName = context.finalizer
      ? this.personName(context.finalizer) || context.finalizer.email
      : null;

    return {
      context: {
        encounterId: aggregate.encounter_id,
        legacyOpdId: context.legacyOpd.opd_id,
        appointmentId: aggregate.appointment_id,
        businessDate: this.dateOnly(aggregate.business_date),
        workflowStatus: aggregate.workflow_status,
        clinicalRecordStatus: aggregate.clinical_record_status,
        encounterVersion: aggregate.version,
        patient: {
          id: context.patient.customer_id,
          name: patientName,
          nickname: context.patient.nickname,
          phone: context.patient.phone_number,
          gender: context.patient.gender || null,
          birthDate: context.patient.birth_date,
          imageUrl: context.patient.customer_image,
          hn: context.patient.personal_id || null,
        },
        doctor: {
          id: context.doctor.user_id,
          name: doctorName,
        },
        branch: {
          id: context.branch.branch_id,
          name: context.branch.branch_name,
        },
      },
      finalization: {
        id: finalization.clinical_finalization_id,
        finalizedAt: finalization.finalized_at.toISOString(),
        finalizedBy: {
          id: finalization.finalized_by,
          name: finalizerName,
        },
        manifestHash: finalization.manifest_hash,
      },
      clinical: {
        examination: {
          id: examination.examination_id,
          version: examination.version,
          measuredAt: examination.measured_at.toISOString(),
          status: examination.status,
        },
        vitals: vitals
          ? {
              weightKg: this.decimalNumber(vitals.weight_kg),
              heightCm: this.decimalNumber(vitals.height_cm),
              bodyMassIndex: this.decimalNumber(vitals.body_mass_index),
              systolicBloodPressureMmhg: vitals.systolic_blood_pressure_mmhg,
              diastolicBloodPressureMmhg: vitals.diastolic_blood_pressure_mmhg,
              pulseRatePerMinute: vitals.pulse_rate_per_minute,
              temperatureCelsius: this.decimalNumber(
                vitals.temperature_celsius,
              ),
              oxygenSaturationPercent: this.decimalNumber(
                vitals.oxygen_saturation_percent,
              ),
              respiratoryRatePerMinute: vitals.respiratory_rate_per_minute,
              painScore: vitals.pain_score,
            }
          : null,
        intake: intake
          ? {
              urinaryStatus: intake.urinary_status,
              urinaryOtherText: intake.urinary_other_text,
              bowelStatus: intake.bowel_status,
              bowelOtherText: intake.bowel_other_text,
            }
          : null,
        patientQuote: symptomSection?.patient_quote ?? null,
        symptoms:
          symptomSection?.symptoms.map((symptom) => ({
            code: symptom.main_code,
            text: symptom.main_text,
            duration:
              symptom.duration_value !== null
                ? `${symptom.duration_value.toString()}${symptom.duration_unit ? ` ${symptom.duration_unit}` : ""}`
                : null,
            location: symptom.location,
            laterality: symptom.laterality,
            severity: symptom.severity,
          })) ?? [],
        diagnoses:
          aggregate.diagnosis_section?.diagnoses.map((diagnosis) => ({
            code: diagnosis.code,
            label: diagnosis.label,
            isPrimary: diagnosis.is_primary,
            note: diagnosis.note,
          })) ?? [],
        notes:
          aggregate.note_workspace?.sections.map((section) => ({
            sectionCode: section.section_code,
            plainText: section.plain_text,
          })) ?? [],
      },
      medications,
      capabilities: this.postVisitCapabilities(medications.length),
      lastUpdatedAt: aggregate.updated_at.toISOString(),
    };
  }

  private async finalizeWithRetry(
    encounterId: string,
    dto: FinalizeOpdClinicalDto,
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetrySerialization: boolean,
  ): Promise<OpdClinicalFinalizationResult> {
    const existing = await this.repository.findIdempotency(
      FINALIZE_OPERATION,
      idempotencyKey,
      scope,
    );
    if (existing) {
      return this.replayFinalization(existing, requestHash, encounterId, scope);
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const claim = await this.repository.createIdempotency(
            FINALIZE_OPERATION,
            idempotencyKey,
            requestHash,
            encounterId,
            scope,
            now,
            tx,
          );
          const locked = await this.repository.lockAggregate(
            encounterId,
            scope,
            tx,
          );
          if (!locked) this.throwEncounterNotFound();
          const aggregate = await this.repository.findAggregate(
            encounterId,
            scope,
            tx,
          );
          if (!aggregate) this.throwEncounterNotFound();
          const readiness = await this.buildReadiness(aggregate, scope, tx);
          if (
            !manifestsEqual(dto.expectedVersions, readiness.expectedVersions)
          ) {
            throw new ConflictException({
              message:
                "Clinical resources changed; refresh readiness before retrying",
              code: "CLINICAL_RESOURCE_VERSION_STALE",
              currentVersions: readiness.expectedVersions,
            });
          }
          if (!readiness.ready) {
            throw new ConflictException({
              message: "Clinical finalization is blocked",
              code: "FINALIZATION_BLOCKED",
              blockers: readiness.blockers,
              currentVersions: readiness.expectedVersions,
            });
          }

          const legacyOpdId = aggregate.legacy_opd_id;
          if (!legacyOpdId) {
            this.throwConflict(
              "LEGACY_OPD_LINK_MISSING",
              "The encounter has no linked legacy OPD record",
            );
          }
          const queueResult = await this.queueCompletion.complete(
            {
              queueTicketId: aggregate.queue_ticket_id,
              encounterId: aggregate.encounter_id,
              customerId: aggregate.customer_id,
              appointmentId: aggregate.appointment_id,
              legacyOpdId,
              expectedVersion: readiness.expectedVersions.queue.version,
            },
            scope,
            principal,
            tx,
          );
          await this.repository.finalizeClinicalResources(
            aggregate,
            scope,
            now,
            tx,
          );
          const finalizationId = randomUUID();
          await this.repository.createClinicalFinalization(
            {
              clinicalFinalizationId: finalizationId,
              encounterId,
              sourceEncounterVersion: aggregate.version,
              resultEncounterVersion: aggregate.version + 1,
              queueTicketId: queueResult.queueTicketId,
              sourceQueueTicketVersion: queueResult.sourceVersion,
              resultQueueTicketVersion: queueResult.resultVersion,
              manifest: finalizationManifestJson(readiness.expectedVersions),
              manifestHash: finalizationManifestHash(
                readiness.expectedVersions,
              ),
              idempotencyKeyHash: this.sha256(idempotencyKey),
            },
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
              action: "clinical.finalize",
              actionLabel: "Finalize OPD clinical record",
              fromStatus: "OPEN/DRAFT",
              toStatus: "POST_VISIT/FINALIZED",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                clinicalFinalizationId: finalizationId,
                manifestHash: finalizationManifestHash(
                  readiness.expectedVersions,
                ),
                sourceEncounterVersion: aggregate.version,
                resultEncounterVersion: aggregate.version + 1,
                queueTicketId: queueResult.queueTicketId,
                sourceQueueTicketVersion: queueResult.sourceVersion,
                resultQueueTicketVersion: queueResult.resultVersion,
              },
            },
            tx,
          );
          const result: OpdClinicalFinalizationResult = {
            clinicalFinalizationId: finalizationId,
            encounterId,
            workflowStatus: "POST_VISIT",
            clinicalRecordStatus: "FINALIZED",
            encounterVersion: aggregate.version + 1,
            finalizedAt: now.toISOString(),
            finalizedBy: scope.userId,
            queueTicketId: queueResult.queueTicketId,
            queueFromStep: "IN_SERVICE",
            queueStep: "DISPENSING",
            queueTicketVersion: queueResult.resultVersion,
            appointmentStatus: queueResult.appointmentStatus,
            replayed: false,
          };
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            finalizationId,
            this.resultSnapshot(result),
            now,
            tx,
          );
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      );
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const replay = await this.repository.findIdempotency(
          FINALIZE_OPERATION,
          idempotencyKey,
          scope,
        );
        if (replay) {
          return this.replayFinalization(
            replay,
            requestHash,
            encounterId,
            scope,
          );
        }
      }
      if (
        canRetrySerialization &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return this.finalizeWithRetry(
          encounterId,
          dto,
          idempotencyKey,
          requestHash,
          scope,
          principal,
          false,
        );
      }
      throw error;
    }
  }

  private async buildReadiness(
    aggregate: OpdFinalizationAggregate,
    scope: RequestScope,
    client?: Prisma.TransactionClient,
  ): Promise<OpdClinicalReadinessView> {
    const manifest = this.buildManifest(aggregate);
    const blockers: OpdFinalizationBlockerView[] = [];
    const add = (
      code: OpdFinalizationBlockerCode,
      target: OpdFinalizationTarget,
      resourceType: string | null = null,
      resourceId: string | null = null,
    ): void => {
      if (!blockers.some((item) => item.code === code)) {
        blockers.push({
          code,
          target,
          resourceType,
          resourceId,
          severity: "BLOCKING",
        });
      }
    };

    if (aggregate.workflow_status !== "OPEN") {
      add(
        "ENCOUNTER_NOT_OPEN",
        "ENCOUNTER",
        "OPD_ENCOUNTER",
        aggregate.encounter_id,
      );
    }
    if (aggregate.clinical_record_status !== "DRAFT") {
      add(
        "CLINICAL_RECORD_NOT_DRAFT",
        "ENCOUNTER",
        "OPD_ENCOUNTER",
        aggregate.encounter_id,
      );
    }
    if (aggregate.reconciliation_status !== "RECONCILED") {
      add(
        "ENCOUNTER_NOT_RECONCILED",
        "ENCOUNTER",
        "OPD_ENCOUNTER",
        aggregate.encounter_id,
      );
    }
    const legacyValid = aggregate.legacy_opd_id
      ? await this.repository.hasScopedLegacyOpd(
          aggregate.legacy_opd_id,
          aggregate.customer_id,
          scope,
          client,
        )
      : false;
    if (!legacyValid) {
      add(
        "LEGACY_OPD_LINK_MISSING",
        "ENCOUNTER",
        "OPD_ENCOUNTER",
        aggregate.encounter_id,
      );
    }

    const permissions = await this.repository.findEffectivePermissions(
      ["OPD_EDIT", "OPD_FINALIZE"],
      scope,
      client,
    );
    if (!permissions.has("OPD_EDIT") || !permissions.has("OPD_FINALIZE")) {
      add("FINALIZATION_PERMISSION_REQUIRED", "ENCOUNTER");
    }

    const attendingValid = aggregate.attending_user_id
      ? await this.repository.isValidAttendingDoctor(
          aggregate.attending_user_id,
          scope,
          client,
        )
      : false;
    if (!attendingValid) {
      add(
        "ATTENDING_DOCTOR_REQUIRED",
        "DOCTOR",
        "USER",
        aggregate.attending_user_id,
      );
    }

    const finalExaminations = aggregate.examinations.filter(
      (examination) => examination.status === "FINAL",
    );
    const draftExaminations = aggregate.examinations.filter(
      (examination) => examination.status === "DRAFT",
    );
    if (finalExaminations.length === 0) {
      add("FINAL_EXAMINATION_REQUIRED", "EXAMINATION");
    }
    if (draftExaminations.length > 0) {
      add(
        "EXAMINATION_DRAFT_PENDING",
        "EXAMINATION",
        "OPD_EXAMINATION",
        draftExaminations[0]?.examination_id ?? null,
      );
    }

    const diagnoses = aggregate.diagnosis_section?.diagnoses ?? [];
    if (
      diagnoses.length > 0 &&
      diagnoses.filter((diagnosis) => diagnosis.is_primary).length !== 1
    ) {
      add(
        "DIAGNOSIS_INVARIANT_INVALID",
        "DIAGNOSES",
        "OPD_DIAGNOSIS_SECTION",
        aggregate.diagnosis_section?.diagnosis_section_id ?? null,
      );
    }

    const order = aggregate.orders[0];
    if (order?.status === "DRAFT") {
      add("ORDER_DRAFT_PENDING", "ORDER", "OPD_ORDER", order.order_id);
    }
    if (order && !["DRAFT", "RELEASED", "VOIDED"].includes(order.status)) {
      add("UNSUPPORTED_COURSE_STATE", "ORDER", "OPD_ORDER", order.order_id);
    }
    if (
      order &&
      order.status !== "VOIDED" &&
      order.items.some(
        (item) =>
          item.status === "ACTIVE" && item.source_type === "COURSE_ITEM",
      )
    ) {
      add("UNSUPPORTED_COURSE_STATE", "ORDER", "OPD_ORDER", order.order_id);
    }

    const draftImport = aggregate.draft_imports[0];
    if (draftImport) {
      for (const section of draftImport.sections) {
        const currentVersion = this.importedResourceVersion(
          aggregate,
          section.target_resource_type,
          section.target_resource_id,
        );
        if (currentVersion === null) {
          add(
            "CLINICAL_RESOURCE_VERSION_STALE",
            this.importTarget(section.target_resource_type),
            section.target_resource_type,
            section.target_resource_id,
          );
        }
        if (
          currentVersion === null ||
          section.review_status !== "REVIEWED" ||
          section.reviewed_target_version !== currentVersion
        ) {
          add(
            "COPIED_SECTION_REVIEW_REQUIRED",
            this.importTarget(section.target_resource_type),
            section.target_resource_type,
            section.target_resource_id,
          );
        }
      }
    }

    const queueInspection = await this.queueCompletion.inspect(
      {
        queueTicketId: aggregate.queue_ticket_id,
        encounterId: aggregate.encounter_id,
        customerId: aggregate.customer_id,
        appointmentId: aggregate.appointment_id,
        legacyOpdId: aggregate.legacy_opd_id ?? "",
      },
      scope,
      client,
    );
    for (const code of queueInspection.blockers) {
      add(
        code as QueueTreatmentCompletionBlockerCode,
        "QUEUE",
        "OPD_QUEUE_TICKET",
        aggregate.queue_ticket_id,
      );
    }

    return {
      stage: "CLINICAL_FINALIZATION",
      ready: blockers.length === 0,
      encounterVersion: aggregate.version,
      expectedVersions: manifest,
      blockers,
    };
  }

  private buildManifest(
    aggregate: OpdFinalizationAggregate,
  ): OpdClinicalFinalizationManifestDto {
    const examination =
      aggregate.examinations.find((item) => item.status === "DRAFT") ??
      aggregate.examinations.find((item) => item.status === "FINAL") ??
      null;
    const resource = (
      id: string | null,
      version: number,
      status: string | null = null,
    ): OpdFinalizationResourceVersionDto => ({ id, version, status });
    const noteSections = new Map(
      (aggregate.note_workspace?.sections ?? []).map((section) => [
        section.section_code,
        section,
      ]),
    );
    const draftImport = aggregate.draft_imports[0] ?? null;
    const order = aggregate.orders[0] ?? null;
    return {
      schema: OPD_CLINICAL_FINALIZATION_MANIFEST_SCHEMA,
      encounterId: aggregate.encounter_id,
      encounterVersion: aggregate.version,
      examination: examination
        ? resource(
            examination.examination_id,
            examination.version,
            examination.status,
          )
        : resource(null, 0),
      vitals: examination?.vital_observation
        ? resource(
            examination.vital_observation.vital_observation_id,
            examination.vital_observation.version,
          )
        : resource(null, 0),
      intake: examination?.intake
        ? resource(examination.intake.intake_id, examination.intake.version)
        : resource(null, 0),
      symptoms: examination?.symptom_section
        ? resource(
            examination.symptom_section.symptom_section_id,
            examination.symptom_section.version,
          )
        : resource(null, 0),
      diagnoses: aggregate.diagnosis_section
        ? resource(
            aggregate.diagnosis_section.diagnosis_section_id,
            aggregate.diagnosis_section.version,
            aggregate.diagnosis_section.status,
          )
        : resource(null, 0),
      noteWorkspace: aggregate.note_workspace
        ? resource(
            aggregate.note_workspace.note_workspace_id,
            aggregate.note_workspace.version,
          )
        : resource(null, 0),
      noteSections: OPD_NOTE_SECTION_ORDER.map((sectionCode) => {
        const section = noteSections.get(sectionCode);
        return section
          ? {
              sectionCode,
              id: section.note_section_id,
              version: section.version,
              status: section.status,
            }
          : { sectionCode, id: null, version: 0, status: null };
      }),
      draftImport: draftImport
        ? {
            id: draftImport.draft_import_id,
            sections: draftImport.sections.map((section) => ({
              sectionCode: section.section_code,
              targetResourceId: section.target_resource_id,
              currentVersion:
                this.importedResourceVersion(
                  aggregate,
                  section.target_resource_type,
                  section.target_resource_id,
                ) ?? 0,
              reviewedVersion: section.reviewed_target_version,
            })),
          }
        : { id: null, sections: [] },
      order: order
        ? {
            id: order.order_id,
            version: order.version,
            status: order.status,
            items: order.items.map((item) => ({
              id: item.order_item_id,
              version: item.version,
              status: item.status,
            })),
          }
        : { id: null, version: 0, status: null, items: [] },
      queue: {
        id: aggregate.queue_ticket.queue_ticket_id,
        version: aggregate.queue_ticket.version,
        currentStep: aggregate.queue_ticket.current_step,
      },
      appointmentId: aggregate.appointment_id,
    };
  }

  private importedResourceVersion(
    aggregate: OpdFinalizationAggregate,
    resourceType: string,
    resourceId: string,
  ): number | null {
    if (resourceType === "OPD_INTAKE") {
      return (
        aggregate.examinations.find(
          (item) => item.intake?.intake_id === resourceId,
        )?.intake?.version ?? null
      );
    }
    if (resourceType === "OPD_SYMPTOM_SECTION") {
      return (
        aggregate.examinations.find(
          (item) => item.symptom_section?.symptom_section_id === resourceId,
        )?.symptom_section?.version ?? null
      );
    }
    if (resourceType === "OPD_DIAGNOSIS_SECTION") {
      return aggregate.diagnosis_section?.diagnosis_section_id === resourceId
        ? aggregate.diagnosis_section.version
        : null;
    }
    if (resourceType === "OPD_NOTE_SECTION") {
      return (
        aggregate.note_workspace?.sections.find(
          (section) => section.note_section_id === resourceId,
        )?.version ?? null
      );
    }
    return null;
  }

  private importTarget(resourceType: string): OpdFinalizationTarget {
    if (resourceType === "OPD_DIAGNOSIS_SECTION") return "DIAGNOSES";
    if (resourceType === "OPD_NOTE_SECTION") return "NOTES";
    return "EXAMINATION";
  }

  private async replayFinalization(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdClinicalFinalizationResult> {
    if (claim.request_hash !== requestHash) {
      this.throwConflict(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used with a different finalization request",
      );
    }
    if (claim.state !== "COMPLETED") {
      this.throwConflict(
        "IDEMPOTENCY_IN_PROGRESS",
        "Clinical finalization is already in progress",
      );
    }
    const finalization = claim.resource_id
      ? await this.repository.findFinalizationById(claim.resource_id, scope)
      : null;
    if (!finalization || finalization.encounter_id !== encounterId) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The committed finalization result cannot be replayed",
      );
    }
    const aggregate = await this.repository.findAggregate(encounterId, scope);
    if (!aggregate) this.throwEncounterNotFound();
    return {
      clinicalFinalizationId: finalization.clinical_finalization_id,
      encounterId: finalization.encounter_id,
      workflowStatus: "POST_VISIT",
      clinicalRecordStatus: "FINALIZED",
      encounterVersion: finalization.result_encounter_version,
      finalizedAt: finalization.finalized_at.toISOString(),
      finalizedBy: finalization.finalized_by,
      queueTicketId: finalization.queue_ticket_id,
      queueFromStep: "IN_SERVICE",
      queueStep: "DISPENSING",
      queueTicketVersion: finalization.result_queue_ticket_version,
      appointmentStatus: aggregate.appointment_id ? "DISPENSING" : null,
      replayed: true,
    };
  }

  private resultSnapshot(
    result: OpdClinicalFinalizationResult,
  ): Prisma.InputJsonObject {
    return {
      clinicalFinalizationId: result.clinicalFinalizationId,
      encounterId: result.encounterId,
      encounterVersion: result.encounterVersion,
      finalizedAt: result.finalizedAt,
      queueTicketId: result.queueTicketId,
      queueTicketVersion: result.queueTicketVersion,
    };
  }

  private postVisitCapabilities(medicationCount: number) {
    return [
      {
        code: "TREATMENT_SUMMARY",
        state: "AVAILABLE" as const,
        reason: null,
        targetAction: null,
      },
      {
        code: "TAKE_HOME_MEDICATION",
        state:
          medicationCount > 0 ? ("AVAILABLE" as const) : ("EMPTY" as const),
        reason: medicationCount > 0 ? null : "NO_RELEASED_MEDICATION",
        targetAction: null,
      },
      {
        code: "MEDICATION_LABEL",
        state: "NOT_IMPLEMENTED" as const,
        reason: "LABEL_RENDERING_LATER_PHASE",
        targetAction: null,
      },
      {
        code: "FINANCIAL_DOCUMENTS",
        state: "NOT_IMPLEMENTED" as const,
        reason: "FINANCIAL_SOURCE_NOT_CONTRACTED",
        targetAction: null,
      },
      {
        code: "MEDICAL_CERTIFICATE",
        state: "NOT_IMPLEMENTED" as const,
        reason: "DOCUMENT_TEMPLATES_NOT_IMPLEMENTED",
        targetAction: null,
      },
      {
        code: "CONSENT_DOCUMENTS",
        state: "NOT_IMPLEMENTED" as const,
        reason: "DOCUMENT_SIGNATURE_NOT_IMPLEMENTED",
        targetAction: null,
      },
      {
        code: "FOLLOW_UP",
        state: "NOT_IMPLEMENTED" as const,
        reason: "FOLLOW_UP_CONTRACT_NOT_IMPLEMENTED",
        targetAction: null,
      },
      {
        code: "PRINT_ALL",
        state: "BLOCKED" as const,
        reason: "DOCUMENTS_NOT_READY",
        targetAction: null,
      },
      {
        code: "SEND_TO_CUSTOMER",
        state: "BLOCKED" as const,
        reason: "DELIVERY_NOT_IMPLEMENTED",
        targetAction: null,
      },
      {
        code: "CLOSE_VISIT",
        state: "BLOCKED" as const,
        reason: "VISIT_CLOSE_IS_LATER_PHASE",
        targetAction: null,
      },
    ];
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    const normalized = value?.trim() ?? "";
    if (normalized.length < 8 || normalized.length > 200) {
      throw new BadRequestException({
        message: "Idempotency-Key must contain 8-200 characters",
        code: "IDEMPOTENCY_KEY_INVALID",
      });
    }
    return normalized;
  }

  private sha256(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("hex");
  }

  private actorRole(scope: RequestScope): string | undefined {
    return (
      scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined)
    );
  }

  private decimalNumber(value: { toString(): string } | null): number | null {
    if (value === null) return null;
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : null;
  }

  private dateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private personName(person: {
    title?: string | null;
    name?: string | null;
    lastname?: string | null;
  }): string | null {
    return (
      [person.title, person.name, person.lastname]
        .filter((part): part is string => Boolean(part?.trim()))
        .join(" ") || null
    );
  }

  private throwEncounterVersionConflict(
    aggregate: OpdFinalizationAggregate,
  ): never {
    throw new ConflictException({
      message: "The OPD encounter changed; reload before retrying",
      code: "CLINICAL_VERSION_CONFLICT",
      resourceType: "OPD_ENCOUNTER",
      resourceId: aggregate.encounter_id,
      currentVersion: aggregate.version,
      currentStatus: `${aggregate.workflow_status}/${aggregate.clinical_record_status}`,
    });
  }

  private throwConflict(code: string, message: string): never {
    throw new ConflictException({ message, code });
  }

  private throwEncounterNotFound(): never {
    throw new NotFoundException("OPD encounter not found in the active scope");
  }
}
