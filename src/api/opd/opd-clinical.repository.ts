import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type api_idempotency,
  type opd_encounter,
  type opd_intake,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import type { OpdExaminationRecord } from "./opd-clinical.mapper";
import type { OpdSymptomSectionRecord } from "./opd-clinical-section.mapper";
import type { QueryOpdExaminationsDto } from "./dto/opd-examination.dto";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

interface LockedIdRow {
  id: string;
}

@Injectable()
export class OpdClinicalRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findEncounter(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd_encounter | null> {
    return client.opd_encounter.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
  }

  async lockEncounter(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "encounter_id"::TEXT AS "id"
      FROM "opd_encounter"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  async lockExamination(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "examination_id"::TEXT AS "id"
      FROM "opd_examination"
      WHERE "examination_id" = ${examinationId}::UUID
        AND "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  async listExaminations(
    encounterId: string,
    scope: RequestScope,
    query: QueryOpdExaminationsDto,
  ): Promise<{
    items: OpdExaminationRecord[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.opd_examinationWhereInput = {
      encounter_id: encounterId,
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.opd_examination.findMany({
        where,
        include: { vital_observation: true },
        orderBy: { examination_number: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opd_examination.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  async findDraft(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdExaminationRecord | null> {
    return client.opd_examination.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
      },
      include: { vital_observation: true },
      orderBy: { examination_number: "desc" },
    });
  }

  async findExamination(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdExaminationRecord | null> {
    return client.opd_examination.findFirst({
      where: {
        examination_id: examinationId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { vital_observation: true },
    });
  }

  async findCorrectionSuccessor(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdExaminationRecord | null> {
    return client.opd_examination.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        supersedes_examination_id: examinationId,
      },
      include: { vital_observation: true },
    });
  }

  async nextExaminationNumber(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const aggregate = await tx.opd_examination.aggregate({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      _max: { examination_number: true },
    });
    return (aggregate._max.examination_number ?? 0) + 1;
  }

  async createExamination(
    encounterId: string,
    examinationNumber: number,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<OpdExaminationRecord> {
    const examination = await tx.opd_examination.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        examination_number: examinationNumber,
        status: "DRAFT",
        version: 1,
        measured_at: now,
        recorder_user_id: scope.userId,
        examiner_user_id: null,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
    await tx.opd_vital_observation.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        examination_id: examination.examination_id,
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
    await tx.opd_symptom_section.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        examination_id: examination.examination_id,
        patient_quote: null,
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
    const created = await this.findExamination(
      encounterId,
      examination.examination_id,
      scope,
      tx,
    );
    if (!created)
      throw new Error("Created OPD examination could not be reloaded");
    return created;
  }

  async createCorrectionExamination(
    source: OpdExaminationRecord,
    intake: opd_intake | null,
    symptoms: OpdSymptomSectionRecord | null,
    examinationNumber: number,
    correctionRootExaminationId: string,
    reason: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<OpdExaminationRecord> {
    const sourceVitals = source.vital_observation;
    if (!sourceVitals) {
      throw new Error("Correction source is missing its vital observation");
    }

    const examination = await tx.opd_examination.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: source.encounter_id,
        examination_number: examinationNumber,
        status: "DRAFT",
        version: 1,
        measured_at: source.measured_at,
        recorder_user_id: source.recorder_user_id,
        examiner_user_id: source.examiner_user_id,
        corrects_examination_id: correctionRootExaminationId,
        supersedes_examination_id: source.examination_id,
        correction_source_version: source.version,
        correction_reason: reason,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });

    await tx.opd_vital_observation.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: source.encounter_id,
        examination_id: examination.examination_id,
        weight_kg: sourceVitals.weight_kg,
        height_cm: sourceVitals.height_cm,
        body_mass_index: sourceVitals.body_mass_index,
        systolic_blood_pressure_mmhg: sourceVitals.systolic_blood_pressure_mmhg,
        diastolic_blood_pressure_mmhg:
          sourceVitals.diastolic_blood_pressure_mmhg,
        pulse_rate_per_minute: sourceVitals.pulse_rate_per_minute,
        temperature_celsius: sourceVitals.temperature_celsius,
        oxygen_saturation_percent: sourceVitals.oxygen_saturation_percent,
        respiratory_rate_per_minute: sourceVitals.respiratory_rate_per_minute,
        dtx_mg_dl: sourceVitals.dtx_mg_dl,
        pain_score: sourceVitals.pain_score,
        reference_rule_version: sourceVitals.reference_rule_version,
        interpretation_snapshot:
          sourceVitals.interpretation_snapshot ?? Prisma.DbNull,
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });

    if (intake) {
      await tx.opd_intake.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          encounter_id: source.encounter_id,
          examination_id: examination.examination_id,
          urinary_status: intake.urinary_status,
          urinary_other_text: intake.urinary_other_text,
          bowel_status: intake.bowel_status,
          bowel_other_text: intake.bowel_other_text,
          version: 1,
          created_by: scope.userId,
          updated_by: scope.userId,
          created_at: now,
          updated_at: now,
        },
      });
    }

    if (symptoms) {
      await tx.opd_symptom_section.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          encounter_id: source.encounter_id,
          examination_id: examination.examination_id,
          patient_quote: symptoms.patient_quote,
          version: 1,
          created_by: scope.userId,
          updated_by: scope.userId,
          created_at: now,
          updated_at: now,
          symptoms: {
            create: symptoms.symptoms.map((symptom) => ({
              clinic_id: scope.clinicId,
              branch_id: scope.branchId,
              encounter_id: source.encounter_id,
              display_order: symptom.display_order,
              main_code: symptom.main_code,
              main_text: symptom.main_text,
              duration_value: symptom.duration_value,
              duration_unit: symptom.duration_unit,
              location: symptom.location,
              laterality: symptom.laterality,
              severity: symptom.severity,
              character: symptom.character,
              modifying_factors: symptom.modifying_factors,
              staff_summary: symptom.staff_summary,
              created_by: scope.userId,
              updated_by: scope.userId,
              created_at: now,
              updated_at: now,
              associations: {
                create: symptom.associations.map((association) => ({
                  clinic_id: scope.clinicId,
                  branch_id: scope.branchId,
                  encounter_id: source.encounter_id,
                  display_order: association.display_order,
                  code: association.code,
                  label: association.label,
                  created_at: now,
                })),
              },
            })),
          },
        },
      });
    }

    const created = await this.findExamination(
      source.encounter_id,
      examination.examination_id,
      scope,
      tx,
    );
    if (!created) {
      throw new Error(
        "Created OPD examination correction could not be reloaded",
      );
    }
    return created;
  }

  async updateVitals(
    vitalObservationId: string,
    examinationId: string,
    expectedVersion: number,
    scope: RequestScope,
    data: Prisma.opd_vital_observationUpdateManyMutationInput,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const updated = await tx.opd_vital_observation.updateMany({
      where: {
        vital_observation_id: vitalObservationId,
        examination_id: examinationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        version: expectedVersion,
      },
      data,
    });
    return updated.count;
  }

  async finalizeExamination(
    encounterId: string,
    examinationId: string,
    expectedVersion: number,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const updated = await tx.opd_examination.updateMany({
      where: {
        examination_id: examinationId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
        version: expectedVersion,
      },
      data: {
        status: "FINAL",
        version: { increment: 1 },
        finalized_at: now,
        finalized_by: scope.userId,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return updated.count;
  }

  async markExaminationCorrected(
    encounterId: string,
    examinationId: string,
    expectedVersion: number,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const updated = await tx.opd_examination.updateMany({
      where: {
        examination_id: examinationId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "FINAL",
        version: expectedVersion,
      },
      data: {
        status: "CORRECTED",
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return updated.count;
  }

  async findIdempotency(
    scope: RequestScope,
    operation: string,
    idempotencyKey: string,
    client: DatabaseClient = this.prisma,
  ): Promise<api_idempotency | null> {
    return client.api_idempotency.findUnique({
      where: {
        clinic_id_branch_id_actor_user_id_operation_idempotency_key: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          actor_user_id: scope.userId,
          operation,
          idempotency_key: idempotencyKey,
        },
      },
    });
  }

  async createIdempotency(
    scope: RequestScope,
    input: {
      operation: string;
      idempotencyKey: string;
      requestHash: string;
      now: Date;
      lockExpiresAt: Date;
      expiresAt: Date;
    },
    tx: Prisma.TransactionClient,
  ): Promise<api_idempotency> {
    return tx.api_idempotency.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        operation: input.operation,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        state: "IN_PROGRESS",
        locked_at: input.now,
        lock_expires_at: input.lockExpiresAt,
        expires_at: input.expiresAt,
        created_at: input.now,
        updated_at: input.now,
      },
    });
  }

  async completeIdempotency(
    idempotencyId: string,
    examinationId: string,
    scope: RequestScope,
    resultSnapshot: Prisma.InputJsonValue,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.api_idempotency.updateMany({
      where: {
        api_idempotency_id: idempotencyId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        state: "IN_PROGRESS",
      },
      data: {
        state: "COMPLETED",
        resource_type: "OPD_EXAMINATION",
        resource_id: examinationId,
        result_snapshot: resultSnapshot,
        response_code: 200,
        completed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        "Unable to complete examination finalization idempotency claim",
      );
    }
  }

  async completeCorrectionIdempotency(
    idempotencyId: string,
    examinationId: string,
    scope: RequestScope,
    resultSnapshot: Prisma.InputJsonValue,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.api_idempotency.updateMany({
      where: {
        api_idempotency_id: idempotencyId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        state: "IN_PROGRESS",
      },
      data: {
        state: "COMPLETED",
        resource_type: "OPD_EXAMINATION_CORRECTION",
        resource_id: examinationId,
        result_snapshot: resultSnapshot,
        response_code: 201,
        completed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error(
        "Unable to complete examination correction idempotency claim",
      );
    }
  }
}
