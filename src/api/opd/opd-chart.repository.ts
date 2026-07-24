import { Injectable } from "@nestjs/common";
import { Prisma, type opd_chart_document } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import type { StorageProvider } from "../../common/storage/storage.service";
import { PrismaService } from "../../prisma.service";
import type { NormalizedOpdChartContent } from "./opd-chart-content";
import type { OpdChartDocumentRecord } from "./opd-chart.mapper";
import type { OpdChartTemplateDefinition } from "./opd-chart-template.registry";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

interface LockedIdRow {
  id: string;
}

export interface OpdChartDraftObjectWrite {
  provider: StorageProvider;
  bucketName: string;
  objectKey: string;
  eTag: string;
  fileSizeBytes: number;
  rasterSha256: string;
}

export interface OpdChartArtifactWrite {
  format: "PNG" | "PDF";
  finalizationId: string;
  sourceDraftVersion: number;
  storageProvider: StorageProvider;
  storageBucket: string;
  storageObjectKey: string;
  storageETag: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256: string;
}

@Injectable()
export class OpdChartRepository {
  constructor(private readonly prisma: PrismaService) {}

  listDocuments(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdChartDocumentRecord[]> {
    return client.opd_chart_document.findMany({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { artifacts: true },
      orderBy: { template_code: "asc" },
    });
  }

  findDocument(
    encounterId: string,
    templateCode: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdChartDocumentRecord | null> {
    return client.opd_chart_document.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        template_code: templateCode,
      },
      include: { artifacts: true },
    });
  }

  async lockDocument(
    documentId: string,
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<LockedIdRow[]>(Prisma.sql`
      SELECT "chart_document_id"::TEXT AS "id"
      FROM "opd_chart_document"
      WHERE "chart_document_id" = ${documentId}::UUID
        AND "encounter_id" = ${encounterId}::UUID
        AND "clinic_id" = ${scope.clinicId}
        AND "branch_id" = ${scope.branchId}
      FOR UPDATE
    `);
    return rows.length === 1;
  }

  createDraft(
    encounter: {
      encounter_id: string;
      customer_id: string;
    },
    template: OpdChartTemplateDefinition,
    content: NormalizedOpdChartContent,
    object: OpdChartDraftObjectWrite,
    clientMutationId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_chart_document> {
    return tx.opd_chart_document.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounter.encounter_id,
        customer_id: encounter.customer_id,
        template_code: template.code,
        template_version: template.version,
        template_name_snapshot: template.name,
        status: "DRAFT",
        version: 1,
        current_revision_number: null,
        content_schema: "opd-chart-raster-v1",
        clinical_metadata: content.metadata,
        content_sha256: content.contentHash,
        raster_sha256: object.rasterSha256,
        raster_file_size_bytes: object.fileSizeBytes,
        last_client_mutation_id: clientMutationId,
        draft_storage_provider: object.provider,
        draft_storage_bucket: object.bucketName,
        draft_storage_object_key: object.objectKey,
        draft_storage_etag: object.eTag,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async updateDraft(
    document: opd_chart_document,
    expectedVersion: number,
    content: NormalizedOpdChartContent,
    object: OpdChartDraftObjectWrite,
    clientMutationId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const update = await tx.opd_chart_document.updateMany({
      where: {
        chart_document_id: document.chart_document_id,
        encounter_id: document.encounter_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
        version: expectedVersion,
      },
      data: {
        version: expectedVersion + 1,
        clinical_metadata: content.metadata,
        content_sha256: content.contentHash,
        raster_sha256: object.rasterSha256,
        raster_file_size_bytes: object.fileSizeBytes,
        last_client_mutation_id: clientMutationId,
        draft_storage_provider: object.provider,
        draft_storage_bucket: object.bucketName,
        draft_storage_object_key: object.objectKey,
        draft_storage_etag: object.eTag,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return update.count === 1;
  }

  async finalize(
    document: opd_chart_document,
    expectedVersion: number,
    finalizationId: string,
    idempotencyKeyHash: string,
    requestHash: string,
    artifacts: readonly OpdChartArtifactWrite[],
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const update = await tx.opd_chart_document.updateMany({
      where: {
        chart_document_id: document.chart_document_id,
        encounter_id: document.encounter_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
        version: expectedVersion,
        content_sha256: document.content_sha256,
        draft_storage_object_key: document.draft_storage_object_key,
      },
      data: {
        status: "FINAL",
        finalization_id: finalizationId,
        finalization_idempotency_key_hash: idempotencyKeyHash,
        finalization_request_hash: requestHash,
        finalized_by: scope.userId,
        finalized_at: now,
        draft_storage_provider: null,
        draft_storage_bucket: null,
        draft_storage_object_key: null,
        draft_storage_etag: null,
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    if (update.count !== 1) return false;

    await tx.opd_chart_artifact.createMany({
      data: artifacts.map((artifact) => ({
        chart_revision_id: null,
        chart_document_id: document.chart_document_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: document.encounter_id,
        finalization_id: artifact.finalizationId,
        source_draft_version: artifact.sourceDraftVersion,
        artifact_format: artifact.format,
        storage_provider: artifact.storageProvider,
        storage_bucket: artifact.storageBucket,
        storage_object_key: artifact.storageObjectKey,
        storage_etag: artifact.storageETag,
        mime_type: artifact.mimeType,
        file_size_bytes: artifact.fileSizeBytes,
        sha256: artifact.sha256,
        created_at: now,
      })),
    });
    return true;
  }
}
