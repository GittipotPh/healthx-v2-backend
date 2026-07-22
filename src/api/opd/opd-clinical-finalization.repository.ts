import { Injectable } from "@nestjs/common";
import {
  Prisma,
  record_status,
  type api_idempotency,
  type opd_clinical_finalization,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

const FINALIZATION_INCLUDE = {
  queue_ticket: true,
  examinations: {
    include: {
      vital_observation: true,
      intake: true,
      symptom_section: {
        include: {
          symptoms: {
            include: { associations: { orderBy: { display_order: "asc" } } },
            orderBy: { display_order: "asc" },
          },
        },
      },
    },
    orderBy: [{ examination_number: "desc" }, { created_at: "desc" }],
  },
  diagnosis_section: {
    include: { diagnoses: { orderBy: { display_order: "asc" } } },
  },
  note_workspace: {
    include: { sections: { orderBy: { section_code: "asc" } } },
  },
  orders: {
    include: {
      items: {
        include: { medication_instruction: true },
        orderBy: { display_order: "asc" },
      },
      release: {
        include: {
          items: { orderBy: { display_order: "asc" } },
          prescription_link: true,
        },
      },
    },
  },
  draft_imports: {
    include: { sections: { orderBy: { section_code: "asc" } } },
  },
  clinical_finalization: true,
} satisfies Prisma.opd_encounterInclude;

export type OpdFinalizationAggregate = Prisma.opd_encounterGetPayload<{
  include: typeof FINALIZATION_INCLUDE;
}>;

interface LockedIdRow {
  id: string;
}

export interface CreateClinicalFinalizationInput {
  clinicalFinalizationId: string;
  encounterId: string;
  sourceEncounterVersion: number;
  resultEncounterVersion: number;
  queueTicketId: string;
  sourceQueueTicketVersion: number;
  resultQueueTicketVersion: number;
  manifest: Prisma.InputJsonObject;
  manifestHash: string;
  idempotencyKeyHash: string;
}

@Injectable()
export class OpdClinicalFinalizationRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAggregate(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdFinalizationAggregate | null> {
    return client.opd_encounter.findUnique({
      where: {
        encounter_id_clinic_id_branch_id: {
          encounter_id: encounterId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
        },
      },
      include: FINALIZATION_INCLUDE,
    });
  }

  async lockAggregate(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const encounter = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "encounter_id"::TEXT AS "id"
      FROM "opd_encounter"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    if (encounter.length !== 1) return false;

    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "examination_id"::TEXT AS "id"
      FROM "opd_examination"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      ORDER BY "examination_number"
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "vital_observation_id"::TEXT AS "id"
      FROM "opd_vital_observation"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "intake_id"::TEXT AS "id"
      FROM "opd_intake"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "symptom_section_id"::TEXT AS "id"
      FROM "opd_symptom_section"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "diagnosis_section_id"::TEXT AS "id"
      FROM "opd_diagnosis_section"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "note_workspace_id"::TEXT AS "id"
      FROM "opd_note_workspace"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "note_section_id"::TEXT AS "id"
      FROM "opd_note_section"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      ORDER BY "section_code"
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "order_id"::TEXT AS "id"
      FROM "opd_order"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "order_item_id"::TEXT AS "id"
      FROM "opd_order_item"
      WHERE "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      ORDER BY "display_order"
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "draft_import_id"::TEXT AS "id"
      FROM "opd_draft_import"
      WHERE "target_encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "draft_import_section_id"::TEXT AS "id"
      FROM "opd_draft_import_section"
      WHERE "target_encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      ORDER BY "section_code"
      FOR UPDATE
    `);
    return true;
  }

  async isValidAttendingDoctor(
    attendingUserId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<boolean> {
    const count = await client.user.count({
      where: {
        user_id: attendingUserId,
        clinic_id: scope.clinicId,
        status: record_status.ACTIVE,
        user_branch: {
          some: {
            branch_id: scope.branchId,
            role_id: "DOCTOR",
            status: record_status.ACTIVE,
          },
        },
      },
    });
    return count === 1;
  }

  async findEffectivePermissions(
    permissionIds: string[],
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<Set<string>> {
    if (scope.isClinicRootUser) return new Set(permissionIds);
    if (!scope.branchId || permissionIds.length === 0) return new Set();
    const [overrides, defaults] = await Promise.all([
      client.user_permission.findMany({
        where: {
          branch_id: scope.branchId,
          user_id: scope.userId,
          permission_id: { in: permissionIds },
        },
        select: { permission_id: true, permission: true },
      }),
      scope.roles.length === 0
        ? Promise.resolve([])
        : client.default_permission.findMany({
            where: {
              role_id: { in: scope.roles },
              permission_id: { in: permissionIds },
            },
            select: { permission_id: true },
          }),
    ]);
    const explicit = new Map(
      overrides
        .filter((row) => row.permission !== null)
        .map((row) => [row.permission_id, row.permission === true]),
    );
    const defaultIds = new Set(defaults.map((row) => row.permission_id));
    return new Set(
      permissionIds.filter((id) =>
        explicit.has(id) ? explicit.get(id) === true : defaultIds.has(id),
      ),
    );
  }

  async hasScopedLegacyOpd(
    legacyOpdId: string,
    customerId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<boolean> {
    return (
      (await client.opd.count({
        where: {
          opd_id: legacyOpdId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          customer_id: customerId,
        },
      })) === 1
    );
  }

  async assignAttendingClinician(
    encounterId: string,
    attendingUserId: string,
    expectedVersion: number,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const updated = await tx.opd_encounter.updateMany({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        workflow_status: "OPEN",
        clinical_record_status: "DRAFT",
        version: expectedVersion,
      },
      data: {
        attending_user_id: attendingUserId,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    return updated.count;
  }

  async finalizeClinicalResources(
    aggregate: OpdFinalizationAggregate,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const encounter = await tx.opd_encounter.updateMany({
      where: {
        encounter_id: aggregate.encounter_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        workflow_status: "OPEN",
        clinical_record_status: "DRAFT",
        version: aggregate.version,
      },
      data: {
        workflow_status: "POST_VISIT",
        clinical_record_status: "FINALIZED",
        finalized_at: now,
        finalized_by: scope.userId,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    if (encounter.count !== 1) {
      throw new Error("Encounter changed while finalizing clinical state");
    }

    if (aggregate.diagnosis_section) {
      const diagnosis = await tx.opd_diagnosis_section.updateMany({
        where: {
          diagnosis_section_id:
            aggregate.diagnosis_section.diagnosis_section_id,
          encounter_id: aggregate.encounter_id,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          status: "DRAFT",
          version: aggregate.diagnosis_section.version,
        },
        data: {
          status: "FINAL",
          version: { increment: 1 },
          updated_by: scope.userId,
          updated_at: now,
        },
      });
      if (diagnosis.count !== 1) {
        throw new Error("Diagnosis section changed while finalizing");
      }
    }

    const noteSections = aggregate.note_workspace?.sections ?? [];
    for (const section of noteSections) {
      const updated = await tx.opd_note_section.updateMany({
        where: {
          note_section_id: section.note_section_id,
          encounter_id: aggregate.encounter_id,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          status: "DRAFT",
          version: section.version,
        },
        data: {
          status: "FINAL",
          version: { increment: 1 },
          updated_by: scope.userId,
          updated_at: now,
        },
      });
      if (updated.count !== 1) {
        throw new Error("Clinical note section changed while finalizing");
      }
    }
  }

  createClinicalFinalization(
    input: CreateClinicalFinalizationInput,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_clinical_finalization> {
    return tx.opd_clinical_finalization.create({
      data: {
        clinical_finalization_id: input.clinicalFinalizationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: input.encounterId,
        source_encounter_version: input.sourceEncounterVersion,
        result_encounter_version: input.resultEncounterVersion,
        queue_ticket_id: input.queueTicketId,
        source_queue_ticket_version: input.sourceQueueTicketVersion,
        result_queue_ticket_version: input.resultQueueTicketVersion,
        source_queue_step: "IN_SERVICE",
        result_queue_step: "DISPENSING",
        manifest_schema: "opd-clinical-finalization-v1",
        resource_manifest: input.manifest,
        manifest_hash: input.manifestHash,
        idempotency_key_hash: input.idempotencyKeyHash,
        finalized_by: scope.userId,
        finalized_at: now,
        created_at: now,
      },
    });
  }

  findIdempotency(
    operation: string,
    idempotencyKey: string,
    scope: RequestScope,
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

  createIdempotency(
    operation: string,
    idempotencyKey: string,
    requestHash: string,
    encounterId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<api_idempotency> {
    return tx.api_idempotency.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        operation,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        state: "IN_PROGRESS",
        locked_at: now,
        lock_expires_at: new Date(now.getTime() + 2 * 60_000),
        resource_type: "OPD_CLINICAL_FINALIZATION",
        resource_id: encounterId,
        expires_at: new Date(now.getTime() + 24 * 60 * 60_000),
        created_at: now,
        updated_at: now,
      },
    });
  }

  async completeIdempotency(
    idempotencyId: string,
    finalizationId: string,
    resultSnapshot: Prisma.InputJsonObject,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.api_idempotency.updateMany({
      where: { api_idempotency_id: idempotencyId, state: "IN_PROGRESS" },
      data: {
        state: "COMPLETED",
        resource_id: finalizationId,
        result_snapshot: resultSnapshot,
        response_code: 201,
        completed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Unable to complete clinical-finalization idempotency");
    }
  }

  findFinalizationById(
    finalizationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd_clinical_finalization | null> {
    return client.opd_clinical_finalization.findFirst({
      where: {
        clinical_finalization_id: finalizationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
  }

  async findPostVisitContext(
    aggregate: OpdFinalizationAggregate,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ) {
    const [patient, branch, doctor, finalizer, legacyOpd] = await Promise.all([
      client.customer.findUnique({
        where: {
          customer_id_clinic_id: {
            customer_id: aggregate.customer_id,
            clinic_id: scope.clinicId,
          },
        },
        select: {
          customer_id: true,
          name: true,
          lastname: true,
          nickname: true,
          phone_number: true,
          gender: true,
          birth_date: true,
          personal_id: true,
          customer_image: true,
        },
      }),
      client.branch.findFirst({
        where: { branch_id: scope.branchId, clinic_id: scope.clinicId },
        select: { branch_id: true, branch_name: true },
      }),
      aggregate.attending_user_id
        ? client.user.findFirst({
            where: {
              user_id: aggregate.attending_user_id,
              clinic_id: scope.clinicId,
              user_branch: { some: { branch_id: scope.branchId } },
            },
            select: {
              user_id: true,
              title: true,
              name: true,
              lastname: true,
              nickname: true,
            },
          })
        : null,
      aggregate.finalized_by
        ? client.user.findFirst({
            where: {
              user_id: aggregate.finalized_by,
              clinic_id: scope.clinicId,
            },
            select: { user_id: true, name: true, lastname: true, email: true },
          })
        : null,
      aggregate.legacy_opd_id
        ? client.opd.findFirst({
            where: {
              opd_id: aggregate.legacy_opd_id,
              clinic_id: scope.clinicId,
              branch_id: scope.branchId,
              customer_id: aggregate.customer_id,
            },
            select: { opd_id: true, status_opd: true },
          })
        : null,
    ]);
    return { patient, branch, doctor, finalizer, legacyOpd };
  }
}
