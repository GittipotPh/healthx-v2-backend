import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type api_idempotency,
  type opd_draft_import_section,
  type opd_draft_snapshot,
  type opd_encounter,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  OpdDraftAuthorFilter,
  OpdDraftCopySectionCode,
  type QueryReusableOpdDraftsDto,
} from "./dto/opd-draft-library.dto";
import type { OpdDraftSnapshotSourceRecord } from "./opd-draft-snapshot.mapper";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

export type OpdReusableDraftSnapshotRecord =
  Prisma.opd_draft_snapshotGetPayload<{
    include: { draft_checkpoint: true; source_encounter: true };
  }>;

export type OpdDraftImportRecord = Prisma.opd_draft_importGetPayload<{
  include: { sections: true };
}>;

export type OpdDraftTargetRecord = Prisma.opd_encounterGetPayload<{
  include: {
    queue_ticket: true;
    examinations: {
      include: {
        intake: true;
        symptom_section: {
          include: { symptoms: true };
        };
      };
    };
    diagnosis_section: { include: { diagnoses: true } };
    note_workspace: { include: { sections: true } };
  };
}>;

export interface ReusableDraftListRow {
  draftSnapshotId: string;
  draftCheckpointId: string;
  sourceEncounterId: string;
  sourceVisitAt: Date;
  capturedAt: Date;
  checkpointNumber: number;
  note: string | null;
  capturedByUserId: string;
  availableSections: unknown;
}

interface ReusableDraftSqlRow {
  draft_snapshot_id: string;
  draft_checkpoint_id: string;
  source_encounter_id: string;
  source_visit_at: Date;
  captured_at: Date;
  checkpoint_number: number;
  note: string | null;
  captured_by_user_id: string;
  available_sections: unknown;
  total_count: bigint;
}

export interface OpdDraftAuthorRecord {
  user_id: string;
  name: string | null;
  lastname: string | null;
  nickname: string | null;
  email: string;
}

export interface ImportedTargetResourceVersion {
  id: string;
  version: number;
}

interface LockedIdRow {
  id: string;
}

@Injectable()
export class OpdDraftLibraryRepository {
  constructor(private readonly prisma: PrismaService) {}

  findEncounter(
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

  findTarget(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdDraftTargetRecord | null> {
    return client.opd_encounter.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: {
        queue_ticket: true,
        examinations: {
          where: { status: "DRAFT" },
          orderBy: { examination_number: "desc" },
          take: 1,
          include: {
            intake: true,
            symptom_section: { include: { symptoms: true } },
          },
        },
        diagnosis_section: { include: { diagnoses: true } },
        note_workspace: { include: { sections: true } },
      },
    });
  }

  findSnapshotSource(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<OpdDraftSnapshotSourceRecord | null> {
    return tx.opd_encounter.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: {
        examinations: {
          where: { status: "DRAFT" },
          orderBy: { examination_number: "desc" },
          take: 1,
          include: {
            intake: true,
            symptom_section: {
              include: {
                symptoms: {
                  orderBy: { display_order: "asc" },
                  include: {
                    associations: { orderBy: { display_order: "asc" } },
                  },
                },
              },
            },
          },
        },
        diagnosis_section: {
          include: { diagnoses: { orderBy: { display_order: "asc" } } },
        },
        note_workspace: { include: { sections: true } },
      },
    });
  }

  createSnapshot(
    input: {
      encounter: opd_encounter;
      checkpointId: string;
      schemaVersion: string;
      copyableContent: Prisma.InputJsonObject;
      availableSections: OpdDraftCopySectionCode[];
      contentSha256: string;
    },
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_draft_snapshot> {
    return tx.opd_draft_snapshot.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: input.encounter.customer_id,
        source_encounter_id: input.encounter.encounter_id,
        draft_checkpoint_id: input.checkpointId,
        schema_version: input.schemaVersion,
        copyable_content: input.copyableContent,
        available_sections: input.availableSections,
        content_sha256: input.contentSha256,
        captured_by_user_id: scope.userId,
        captured_at: now,
        created_at: now,
      },
    });
  }

  findCheckpointSnapshot(
    checkpointId: string,
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdReusableDraftSnapshotRecord | null> {
    return client.opd_draft_snapshot.findFirst({
      where: {
        draft_checkpoint_id: checkpointId,
        source_encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { draft_checkpoint: true, source_encounter: true },
    });
  }

  async listReusableSnapshots(
    target: opd_encounter,
    query: QueryReusableOpdDraftsDto,
    scope: RequestScope,
  ): Promise<{
    items: ReusableDraftListRow[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const offset = (page - 1) * pageSize;
    const authorFilter =
      query.author === OpdDraftAuthorFilter.MINE
        ? Prisma.sql`AND snapshot."captured_by_user_id" = ${scope.userId}`
        : Prisma.empty;
    const rows = await this.prisma.$queryRaw<ReusableDraftSqlRow[]>(Prisma.sql`
      WITH ranked AS (
        SELECT
          snapshot."draft_snapshot_id",
          snapshot."draft_checkpoint_id",
          snapshot."source_encounter_id",
          encounter."started_at" AS "source_visit_at",
          snapshot."captured_at",
          checkpoint."checkpoint_number",
          checkpoint."note",
          snapshot."captured_by_user_id",
          snapshot."available_sections",
          ROW_NUMBER() OVER (
            PARTITION BY snapshot."source_encounter_id"
            ORDER BY snapshot."captured_at" DESC, snapshot."draft_snapshot_id" DESC
          ) AS source_rank
        FROM "opd_draft_snapshot" snapshot
        INNER JOIN "opd_encounter" encounter
          ON encounter."encounter_id" = snapshot."source_encounter_id"
          AND encounter."clinic_id" = snapshot."clinic_id"
          AND encounter."branch_id" = snapshot."branch_id"
        INNER JOIN "opd_draft_checkpoint" checkpoint
          ON checkpoint."draft_checkpoint_id" = snapshot."draft_checkpoint_id"
          AND checkpoint."clinic_id" = snapshot."clinic_id"
          AND checkpoint."branch_id" = snapshot."branch_id"
          AND checkpoint."encounter_id" = snapshot."source_encounter_id"
        WHERE snapshot."clinic_id" = ${scope.clinicId}
          AND snapshot."branch_id" = ${scope.branchId}
          AND snapshot."customer_id" = ${target.customer_id}
          AND snapshot."source_encounter_id" <> ${target.encounter_id}::UUID
          AND encounter."workflow_status" = 'OPEN'
          AND encounter."clinical_record_status" = 'DRAFT'
          AND encounter."reconciliation_status" = 'RECONCILED'
          AND JSONB_ARRAY_LENGTH(snapshot."available_sections") > 0
          ${authorFilter}
      )
      SELECT
        "draft_snapshot_id",
        "draft_checkpoint_id",
        "source_encounter_id",
        "source_visit_at",
        "captured_at",
        "checkpoint_number",
        "note",
        "captured_by_user_id",
        "available_sections",
        COUNT(*) OVER () AS "total_count"
      FROM ranked
      WHERE source_rank = 1
      ORDER BY "captured_at" DESC, "draft_snapshot_id" DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    `);
    return {
      items: rows.map((row) => ({
        draftSnapshotId: row.draft_snapshot_id,
        draftCheckpointId: row.draft_checkpoint_id,
        sourceEncounterId: row.source_encounter_id,
        sourceVisitAt: row.source_visit_at,
        capturedAt: row.captured_at,
        checkpointNumber: row.checkpoint_number,
        note: row.note,
        capturedByUserId: row.captured_by_user_id,
        availableSections: row.available_sections,
      })),
      total: rows[0] ? Number(rows[0].total_count) : 0,
      page,
      pageSize,
    };
  }

  findReusableSnapshot(
    snapshotId: string,
    target: opd_encounter,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdReusableDraftSnapshotRecord | null> {
    return client.opd_draft_snapshot.findFirst({
      where: {
        draft_snapshot_id: snapshotId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: target.customer_id,
        source_encounter_id: { not: target.encounter_id },
        source_encounter: {
          workflow_status: "OPEN",
          clinical_record_status: "DRAFT",
          reconciliation_status: "RECONCILED",
        },
      },
      include: { draft_checkpoint: true, source_encounter: true },
    });
  }

  usersByIds(
    userIds: string[],
    scope: RequestScope,
  ): Promise<OpdDraftAuthorRecord[]> {
    if (userIds.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: {
        user_id: { in: userIds },
        OR: [{ clinic_id: scope.clinicId }, { clinic_id: null }],
      },
      select: {
        user_id: true,
        name: true,
        lastname: true,
        nickname: true,
        email: true,
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
    input: {
      operation: string;
      idempotencyKey: string;
      requestHash: string;
      resourceType: string;
      resourceId: string;
    },
    scope: RequestScope,
    now: Date,
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
        locked_at: now,
        lock_expires_at: new Date(now.getTime() + 2 * 60_000),
        resource_type: input.resourceType,
        resource_id: input.resourceId,
        expires_at: new Date(now.getTime() + 24 * 60 * 60_000),
        created_at: now,
        updated_at: now,
      },
    });
  }

  async completeIdempotency(
    idempotencyId: string,
    resourceId: string,
    resultSnapshot: Prisma.InputJsonObject,
    responseCode: number,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.api_idempotency.updateMany({
      where: { api_idempotency_id: idempotencyId, state: "IN_PROGRESS" },
      data: {
        state: "COMPLETED",
        resource_id: resourceId,
        result_snapshot: resultSnapshot,
        response_code: responseCode,
        completed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1)
      throw new Error("Unable to complete draft idempotency claim");
  }

  findCurrentImport(
    targetEncounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdDraftImportRecord | null> {
    return client.opd_draft_import.findFirst({
      where: {
        target_encounter_id: targetEncounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { sections: { orderBy: { section_code: "asc" } } },
    });
  }

  findImportById(
    targetEncounterId: string,
    draftImportId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdDraftImportRecord | null> {
    return client.opd_draft_import.findFirst({
      where: {
        draft_import_id: draftImportId,
        target_encounter_id: targetEncounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { sections: { orderBy: { section_code: "asc" } } },
    });
  }

  createImport(
    input: {
      target: opd_encounter;
      source: opd_draft_snapshot;
      selectedSections: OpdDraftCopySectionCode[];
      targetBeforeManifest: Prisma.InputJsonObject;
      targetAfterManifest: Prisma.InputJsonObject;
      idempotencyKeyHash: string;
      sections: Array<{
        sectionCode: OpdDraftCopySectionCode;
        sourceSectionSha256: string;
        targetResourceType: string;
        targetResourceId: string;
        targetResourceVersion: number;
      }>;
    },
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    return tx.opd_draft_import
      .create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          customer_id: input.target.customer_id,
          source_snapshot_id: input.source.draft_snapshot_id,
          source_checkpoint_id: input.source.draft_checkpoint_id,
          source_encounter_id: input.source.source_encounter_id,
          target_encounter_id: input.target.encounter_id,
          selected_sections: input.selectedSections,
          source_content_sha256: input.source.content_sha256,
          target_before_manifest: input.targetBeforeManifest,
          target_after_manifest: input.targetAfterManifest,
          idempotency_key_hash: input.idempotencyKeyHash,
          imported_by_user_id: scope.userId,
          imported_at: now,
          created_at: now,
          sections: {
            create: input.sections.map((section) => ({
              clinic_id: scope.clinicId,
              branch_id: scope.branchId,
              target_encounter_id: input.target.encounter_id,
              section_code: section.sectionCode,
              source_section_sha256: section.sourceSectionSha256,
              target_resource_type: section.targetResourceType,
              target_resource_id: section.targetResourceId,
              target_resource_version: section.targetResourceVersion,
              review_status: "REVIEW_REQUIRED",
              created_at: now,
              updated_at: now,
            })),
          },
        },
        select: { draft_import_id: true },
      })
      .then((created) => created.draft_import_id);
  }

  async lockImportSection(
    targetEncounterId: string,
    draftImportId: string,
    sectionCode: OpdDraftCopySectionCode,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT section."draft_import_section_id"::TEXT AS "id"
      FROM "opd_draft_import_section" section
      INNER JOIN "opd_draft_import" import
        ON import."draft_import_id" = section."draft_import_id"
        AND import."clinic_id" = section."clinic_id"
        AND import."branch_id" = section."branch_id"
        AND import."target_encounter_id" = section."target_encounter_id"
      WHERE section."draft_import_id" = ${draftImportId}::UUID
        AND section."target_encounter_id" = ${targetEncounterId}::UUID
        AND section."section_code" = ${sectionCode}
        AND section."clinic_id" = ${scope.clinicId}
        AND section."branch_id" = ${scope.branchId}
      FOR UPDATE OF section
    `);
    return rows.length === 1;
  }

  findImportSection(
    targetEncounterId: string,
    draftImportId: string,
    sectionCode: OpdDraftCopySectionCode,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd_draft_import_section | null> {
    return client.opd_draft_import_section.findFirst({
      where: {
        draft_import_id: draftImportId,
        target_encounter_id: targetEncounterId,
        section_code: sectionCode,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
  }

  async currentImportedResourceVersion(
    section: opd_draft_import_section,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<ImportedTargetResourceVersion | null> {
    const common = {
      encounter_id: section.target_encounter_id,
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
    };
    if (section.target_resource_type === "OPD_SYMPTOM_SECTION") {
      const row = await client.opd_symptom_section.findFirst({
        where: { ...common, symptom_section_id: section.target_resource_id },
        select: { symptom_section_id: true, version: true },
      });
      return row ? { id: row.symptom_section_id, version: row.version } : null;
    }
    if (section.target_resource_type === "OPD_INTAKE") {
      const row = await client.opd_intake.findFirst({
        where: { ...common, intake_id: section.target_resource_id },
        select: { intake_id: true, version: true },
      });
      return row ? { id: row.intake_id, version: row.version } : null;
    }
    if (section.target_resource_type === "OPD_DIAGNOSIS_SECTION") {
      const row = await client.opd_diagnosis_section.findFirst({
        where: { ...common, diagnosis_section_id: section.target_resource_id },
        select: { diagnosis_section_id: true, version: true },
      });
      return row
        ? { id: row.diagnosis_section_id, version: row.version }
        : null;
    }
    if (section.target_resource_type === "OPD_NOTE_SECTION") {
      const row = await client.opd_note_section.findFirst({
        where: { ...common, note_section_id: section.target_resource_id },
        select: { note_section_id: true, version: true },
      });
      return row ? { id: row.note_section_id, version: row.version } : null;
    }
    return null;
  }

  async markImportSectionReviewed(
    sectionId: string,
    targetResourceVersion: number,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    const updated = await tx.opd_draft_import_section.updateMany({
      where: {
        draft_import_section_id: sectionId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      data: {
        review_status: "REVIEWED",
        reviewed_target_version: targetResourceVersion,
        reviewed_by_user_id: scope.userId,
        reviewed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1)
      throw new Error("Unable to record copied-section review");
  }
}
