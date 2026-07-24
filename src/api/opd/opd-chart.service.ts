import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  Prisma,
  auditReferenceType,
  type opd_chart_document,
  type opd_encounter,
} from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import type { Principal, RequestScope } from "../../auth/auth.types";
import {
  StorageService,
  type StorageProvider,
  type StoredObject,
} from "../../common/storage/storage.service";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  type FinalizeOpdChartDocumentDto,
  OpdChartArtifactFormat,
  type SaveOpdChartDocumentDto,
} from "./dto/opd-chart.dto";
import {
  hashOpdChartArtifact,
  normalizeOpdChartPng,
  renderOpdChartPdf,
  type NormalizedOpdChartPng,
} from "./opd-chart-artifact";
import {
  normalizeOpdChartContent,
  type NormalizedOpdChartContent,
} from "./opd-chart-content";
import {
  FinalizeOpdChartDocumentResult,
  OpdChartArtifactAccessResult,
  OpdChartDocumentListResult,
  OpdChartDocumentView,
  OpdChartTemplateView,
  SaveOpdChartDocumentResult,
  toOpdChartDocumentView,
  toOpdChartTemplateView,
  type OpdChartDocumentRecord,
} from "./opd-chart.mapper";
import {
  type OpdChartArtifactWrite,
  type OpdChartDraftObjectWrite,
  OpdChartRepository,
} from "./opd-chart.repository";
import {
  findOpdChartTemplate,
  OPD_CHART_TEMPLATES,
  type OpdChartTemplateCode,
  type OpdChartTemplateDefinition,
} from "./opd-chart-template.registry";
import { OpdClinicalRepository } from "./opd-clinical.repository";

const CHART_PNG_LIMIT_BYTES = 6 * 1024 * 1024;
const ARTIFACT_URL_TTL_SECONDS = 10 * 60;
const LIFECYCLE_TAG = "healthx-lifecycle";

interface StoredObjectLocator {
  provider: StorageProvider;
  bucketName: string;
  objectKey: string;
}

interface SaveTransactionResult {
  document: OpdChartDocumentRecord;
  committedCandidate: boolean;
  noOp: boolean;
  previousObject: StoredObjectLocator | null;
}

interface UploadedFinalArtifacts {
  writes: readonly OpdChartArtifactWrite[];
  objects: readonly StoredObjectLocator[];
}

interface FinalizeTransactionResult {
  document: OpdChartDocumentRecord;
  committedFinalArtifacts: boolean;
  replayed: boolean;
}

@Injectable()
export class OpdChartService {
  private readonly logger = new Logger(OpdChartService.name);

  constructor(
    private readonly repository: OpdChartRepository,
    private readonly clinicalRepository: OpdClinicalRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
    private readonly storageService: StorageService,
  ) {}

  templates(): OpdChartTemplateView[] {
    return OPD_CHART_TEMPLATES.map(toOpdChartTemplateView);
  }

  async documents(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdChartDocumentListResult> {
    await this.requireEncounter(encounterId, scope);
    const rows = await this.repository.listDocuments(encounterId, scope);
    return {
      documents: await Promise.all(rows.map((row) => this.toView(row))),
    };
  }

  async saveDraft(
    encounterId: string,
    templateCode: OpdChartTemplateCode,
    dto: SaveOpdChartDocumentDto,
    renderedPng: Express.Multer.File | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<SaveOpdChartDocumentResult> {
    const template = this.requireTemplate(templateCode, dto.templateVersion);
    this.assertPngUpload(renderedPng);
    const image = this.normalizePng(renderedPng.buffer);
    const content = normalizeOpdChartContent(dto, image.hash);

    const encounter = await this.requireEncounter(encounterId, scope);
    this.assertEncounterEditable(encounter);
    const preliminary = await this.repository.findDocument(
      encounterId,
      templateCode,
      scope,
    );
    if (preliminary) {
      this.assertTemplatePinned(preliminary, template);
      this.assertDocumentDraft(preliminary);
      this.assertMutationIdAvailable(preliminary, dto, content);
      if (preliminary.content_sha256 === content.contentHash) {
        return {
          document: await this.toView(preliminary),
          noOp: true,
          cleanupPending: false,
        };
      }
      this.assertDocumentVersion(
        encounterId,
        templateCode,
        preliminary,
        dto.expectedVersion,
      );
    } else if (dto.expectedVersion !== 0) {
      this.throwVersionConflict(encounterId, templateCode, null);
    }

    const candidate = await this.uploadDraftCandidate(
      encounterId,
      templateCode,
      image,
      scope,
    );
    let committedCandidate = false;
    let transactionResult: SaveTransactionResult | undefined;
    try {
      transactionResult = await this.prisma.$transaction(async (tx) => {
        const lockedEncounter = await this.lockEditableEncounter(
          encounterId,
          scope,
          tx,
        );
        let current = await this.repository.findDocument(
          encounterId,
          templateCode,
          scope,
          tx,
        );
        const now = new Date();
        let previousObject: StoredObjectLocator | null = null;

        if (!current) {
          if (dto.expectedVersion !== 0) {
            this.throwVersionConflict(encounterId, templateCode, null);
          }
          const created = await this.repository.createDraft(
            lockedEncounter,
            template,
            content,
            this.toDraftWrite(candidate, image),
            dto.clientMutationId,
            scope,
            now,
            tx,
          );
          await this.auditDraft(
            lockedEncounter,
            created,
            template,
            content,
            image,
            0,
            principal,
            scope,
            tx,
          );
        } else {
          const locked = await this.repository.lockDocument(
            current.chart_document_id,
            encounterId,
            scope,
            tx,
          );
          if (!locked) this.throwDocumentNotFound();
          current = await this.repository.findDocument(
            encounterId,
            templateCode,
            scope,
            tx,
          );
          if (!current) this.throwDocumentNotFound();
          this.assertTemplatePinned(current, template);
          this.assertDocumentDraft(current);
          this.assertMutationIdAvailable(current, dto, content);
          if (current.content_sha256 === content.contentHash) {
            return {
              document: current,
              committedCandidate: false,
              noOp: true,
              previousObject: null,
            };
          }
          this.assertDocumentVersion(
            encounterId,
            templateCode,
            current,
            dto.expectedVersion,
          );
          previousObject = this.requireDraftObject(current);
          const updated = await this.repository.updateDraft(
            current,
            dto.expectedVersion,
            content,
            this.toDraftWrite(candidate, image),
            dto.clientMutationId,
            scope,
            now,
            tx,
          );
          if (!updated) {
            this.throwVersionConflict(
              encounterId,
              templateCode,
              await this.repository.findDocument(
                encounterId,
                templateCode,
                scope,
                tx,
              ),
            );
          }
          await this.auditDraft(
            lockedEncounter,
            current,
            template,
            content,
            image,
            dto.expectedVersion,
            principal,
            scope,
            tx,
          );
        }

        const saved = await this.repository.findDocument(
          encounterId,
          templateCode,
          scope,
          tx,
        );
        if (!saved) {
          throw new Error("Saved Chart document could not be reloaded");
        }
        return {
          document: saved,
          committedCandidate: true,
          noOp: false,
          previousObject,
        };
      });
      committedCandidate = transactionResult.committedCandidate;
    } finally {
      if (!committedCandidate) {
        await this.deleteObjectBestEffort(
          this.toStoredObjectLocator(candidate),
          "uncommitted-candidate",
        );
      }
    }

    if (!transactionResult) {
      throw new Error("Chart autosave transaction returned no result");
    }
    const cleanupPending = transactionResult.committedCandidate
      ? await this.commitDraftObjectLifecycle(
          this.toStoredObjectLocator(candidate),
          transactionResult.previousObject,
        )
      : false;
    return {
      document: await this.toView(transactionResult.document),
      noOp: transactionResult.noOp,
      cleanupPending,
    };
  }

  async finalize(
    encounterId: string,
    templateCode: OpdChartTemplateCode,
    dto: FinalizeOpdChartDocumentDto,
    idempotencyKey: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<FinalizeOpdChartDocumentResult> {
    const key = this.requireIdempotencyKey(idempotencyKey);
    const keyHash = sha256(key);
    const preliminary = await this.repository.findDocument(
      encounterId,
      templateCode,
      scope,
    );
    if (!preliminary) this.throwDocumentNotFound();
    const template = this.requireTemplate(
      templateCode,
      preliminary.template_version,
    );
    this.assertTemplatePinned(preliminary, template);
    const requestHash = this.finalizationRequestHash(
      encounterId,
      templateCode,
      dto.expectedVersion,
      preliminary.content_sha256,
    );

    if (preliminary.status === "FINAL") {
      this.assertFinalizationReplay(preliminary, keyHash, requestHash);
      return {
        document: await this.toView(preliminary),
        replayed: true,
        cleanupPending: false,
      };
    }
    this.assertDocumentVersion(
      encounterId,
      templateCode,
      preliminary,
      dto.expectedVersion,
    );

    const draftObject = this.requireDraftObject(preliminary);
    const image = await this.readVerifiedDraft(preliminary, draftObject);
    const finalizedAt = new Date();
    const finalizationId = randomUUID();
    const pdf = renderOpdChartPdf({
      templateCode,
      templateVersion: template.version,
      contentHash: preliminary.content_sha256,
      finalizedAt: finalizedAt.toISOString(),
      image,
    });
    const uploaded = await this.uploadFinalArtifacts(
      preliminary,
      finalizationId,
      image,
      pdf,
      scope,
    );

    let committedFinalArtifacts = false;
    let transactionResult: FinalizeTransactionResult | undefined;
    try {
      transactionResult = await this.prisma.$transaction(async (tx) => {
        const locked = await this.clinicalRepository.lockEncounter(
          encounterId,
          scope,
          tx,
        );
        if (!locked) this.throwEncounterNotFound();
        const encounter = await this.clinicalRepository.findEncounter(
          encounterId,
          scope,
          tx,
        );
        if (!encounter) this.throwEncounterNotFound();

        const documentLocked = await this.repository.lockDocument(
          preliminary.chart_document_id,
          encounterId,
          scope,
          tx,
        );
        if (!documentLocked) this.throwDocumentNotFound();
        const current = await this.repository.findDocument(
          encounterId,
          templateCode,
          scope,
          tx,
        );
        if (!current) this.throwDocumentNotFound();
        if (current.status === "FINAL") {
          const currentRequestHash = this.finalizationRequestHash(
            encounterId,
            templateCode,
            dto.expectedVersion,
            current.content_sha256,
          );
          this.assertFinalizationReplay(
            current,
            keyHash,
            currentRequestHash,
          );
          return {
            document: current,
            committedFinalArtifacts: false,
            replayed: true,
          };
        }

        this.assertEncounterEditable(encounter);
        this.assertTemplatePinned(current, template);
        this.assertDocumentVersion(
          encounterId,
          templateCode,
          current,
          dto.expectedVersion,
        );
        if (
          current.content_sha256 !== preliminary.content_sha256 ||
          current.raster_sha256 !== preliminary.raster_sha256 ||
          current.draft_storage_object_key !==
            preliminary.draft_storage_object_key ||
          current.draft_storage_etag !== preliminary.draft_storage_etag
        ) {
          this.throwVersionConflict(encounterId, templateCode, current);
        }

        const updated = await this.repository.finalize(
          current,
          dto.expectedVersion,
          finalizationId,
          keyHash,
          requestHash,
          uploaded.writes,
          scope,
          finalizedAt,
          tx,
        );
        if (!updated) {
          this.throwVersionConflict(
            encounterId,
            templateCode,
            await this.repository.findDocument(
              encounterId,
              templateCode,
              scope,
              tx,
            ),
          );
        }
        const result = await this.repository.findDocument(
          encounterId,
          templateCode,
          scope,
          tx,
        );
        if (!result) {
          throw new Error("Finalized Chart document could not be reloaded");
        }
        await this.auditFinalize(
          encounter,
          result,
          image.hash,
          hashOpdChartArtifact(pdf),
          principal,
          scope,
          tx,
        );
        return {
          document: result,
          committedFinalArtifacts: true,
          replayed: false,
        };
      });
      committedFinalArtifacts =
        transactionResult.committedFinalArtifacts;
    } finally {
      if (!committedFinalArtifacts) {
        await this.cleanupObjects(
          uploaded.objects,
          "uncommitted-final-artifact",
        );
      }
    }

    if (!transactionResult) {
      throw new Error("Chart finalization transaction returned no result");
    }
    const cleanupPending = committedFinalArtifacts
      ? await this.retireDraftObject(draftObject)
      : false;
    return {
      document: await this.toView(transactionResult.document),
      replayed: transactionResult.replayed,
      cleanupPending,
    };
  }

  async artifactAccess(
    encounterId: string,
    templateCode: OpdChartTemplateCode,
    format: OpdChartArtifactFormat,
    scope: RequestScope,
  ): Promise<OpdChartArtifactAccessResult> {
    await this.requireEncounter(encounterId, scope);
    const document = await this.repository.findDocument(
      encounterId,
      templateCode,
      scope,
    );
    if (!document || document.status !== "FINAL") {
      throw new NotFoundException(
        "Finalized Chart artifact not found for this encounter/template",
      );
    }
    const artifact = document.artifacts.find(
      (entry) => entry.artifact_format === format.toUpperCase(),
    );
    if (!artifact) {
      throw new NotFoundException(
        "Finalized Chart artifact not found for this format",
      );
    }
    const url = await this.readUrl({
      provider: this.requireStorageProvider(artifact.storage_provider),
      bucketName: artifact.storage_bucket,
      objectKey: artifact.storage_object_key,
    });
    return {
      format,
      mimeType: artifact.mime_type,
      fileName: `opd-chart-${templateCode}.${format}`,
      sha256: artifact.sha256,
      url,
      expiresAt: this.readUrlExpiry(),
    };
  }

  private async uploadDraftCandidate(
    encounterId: string,
    templateCode: OpdChartTemplateCode,
    image: NormalizedOpdChartPng,
    scope: RequestScope,
  ): Promise<StoredObject> {
    const requestId = randomUUID();
    const objectKey = [
      "clinics",
      scope.clinicId,
      "branches",
      scope.branchId,
      "opd",
      encounterId,
      "charts",
      templateCode,
      "draft",
      requestId,
      "chart.png",
    ].join("/");
    try {
      return await this.storageService.uploadObject({
        objectKey,
        body: image.bytes,
        mimeType: "image/png",
        fileSize: image.bytes.length,
        createOnly: true,
        tags: { [LIFECYCLE_TAG]: "candidate" },
      });
    } catch {
      this.throwStorageUnavailable(
        "The Chart autosave image could not be staged",
      );
    }
  }

  private async uploadFinalArtifacts(
    document: OpdChartDocumentRecord,
    finalizationId: string,
    image: NormalizedOpdChartPng,
    pdf: Buffer,
    scope: RequestScope,
  ): Promise<UploadedFinalArtifacts> {
    const prefix = [
      "clinics",
      scope.clinicId,
      "branches",
      scope.branchId,
      "opd",
      document.encounter_id,
      "charts",
      document.template_code,
      "final",
      finalizationId,
    ].join("/");
    const objects: StoredObjectLocator[] = [];
    try {
      const png = await this.storageService.uploadObject({
        objectKey: `${prefix}/chart.png`,
        body: image.bytes,
        mimeType: "image/png",
        fileSize: image.bytes.length,
        createOnly: true,
        tags: { [LIFECYCLE_TAG]: "final" },
      });
      objects.push(this.toStoredObjectLocator(png));
      const pdfObject = await this.storageService.uploadObject({
        objectKey: `${prefix}/chart.pdf`,
        body: pdf,
        mimeType: "application/pdf",
        fileSize: pdf.length,
        createOnly: true,
        tags: { [LIFECYCLE_TAG]: "final" },
      });
      objects.push(this.toStoredObjectLocator(pdfObject));
      return {
        objects,
        writes: [
          {
            format: "PNG",
            finalizationId,
            sourceDraftVersion: document.version,
            storageProvider: png.provider,
            storageBucket: png.bucketName,
            storageObjectKey: png.objectKey,
            storageETag: png.eTag,
            mimeType: "image/png",
            fileSizeBytes: image.bytes.length,
            sha256: image.hash,
          },
          {
            format: "PDF",
            finalizationId,
            sourceDraftVersion: document.version,
            storageProvider: pdfObject.provider,
            storageBucket: pdfObject.bucketName,
            storageObjectKey: pdfObject.objectKey,
            storageETag: pdfObject.eTag,
            mimeType: "application/pdf",
            fileSizeBytes: pdf.length,
            sha256: hashOpdChartArtifact(pdf),
          },
        ],
      };
    } catch {
      await this.cleanupObjects(objects, "partial-final-upload");
      this.throwStorageUnavailable(
        "The immutable Chart artifacts could not be staged",
      );
    }
  }

  private async readVerifiedDraft(
    document: OpdChartDocumentRecord,
    object: StoredObjectLocator,
  ): Promise<NormalizedOpdChartPng> {
    try {
      const [properties, bytes] = await Promise.all([
        this.storageService.inspectObject(object),
        this.storageService.readObject(object),
      ]);
      if (
        properties.eTag !== document.draft_storage_etag ||
        properties.fileSize !== document.raster_file_size_bytes ||
        properties.mimeType !== "image/png" ||
        bytes.length !== document.raster_file_size_bytes ||
        sha256(bytes) !== document.raster_sha256
      ) {
        throw new ConflictException({
          code: "CHART_STORAGE_RECONCILIATION_REQUIRED",
          message:
            "The stored Chart draft does not match its committed database pointer",
        });
      }
      const image = this.normalizePng(bytes);
      if (image.hash !== document.raster_sha256) {
        throw new ConflictException({
          code: "CHART_STORAGE_RECONCILIATION_REQUIRED",
          message:
            "The stored Chart draft hash does not match its committed database hash",
        });
      }
      return image;
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      this.throwStorageUnavailable(
        "The exact saved Chart draft could not be read for finalization",
      );
    }
  }

  private async toView(
    document: OpdChartDocumentRecord,
  ): Promise<OpdChartDocumentView> {
    const object =
      document.status === "FINAL"
        ? this.requireFinalPngObject(document)
        : this.requireDraftObject(document);
    const url = await this.readUrl(object);
    return toOpdChartDocumentView(document, {
      url,
      expiresAt: this.readUrlExpiry(),
    });
  }

  private async readUrl(object: StoredObjectLocator): Promise<string> {
    try {
      return await this.storageService.getReadUrl({
        ...object,
        expiresInSeconds: ARTIFACT_URL_TTL_SECONDS,
      });
    } catch {
      this.throwStorageUnavailable(
        "A short-lived Chart image URL could not be issued",
      );
    }
  }

  private async commitDraftObjectLifecycle(
    current: StoredObjectLocator,
    previous: StoredObjectLocator | null,
  ): Promise<boolean> {
    let cleanupPending = false;
    try {
      await this.storageService.tagObject({
        ...current,
        tags: { [LIFECYCLE_TAG]: "current" },
      });
    } catch {
      cleanupPending = true;
      this.logObjectCleanupFailure(current, "tag-current");
    }
    if (previous) {
      try {
        await this.storageService.tagObject({
          ...previous,
          tags: { [LIFECYCLE_TAG]: "superseded" },
        });
      } catch {
        cleanupPending = true;
        this.logObjectCleanupFailure(previous, "tag-superseded");
      }
      const deleted = await this.deleteObjectBestEffort(
        previous,
        "delete-superseded",
      );
      cleanupPending ||= !deleted;
    }
    return cleanupPending;
  }

  private async retireDraftObject(
    object: StoredObjectLocator,
  ): Promise<boolean> {
    let cleanupPending = false;
    try {
      await this.storageService.tagObject({
        ...object,
        tags: { [LIFECYCLE_TAG]: "superseded" },
      });
    } catch {
      cleanupPending = true;
      this.logObjectCleanupFailure(object, "tag-finalized-draft");
    }
    const deleted = await this.deleteObjectBestEffort(
      object,
      "delete-finalized-draft",
    );
    return cleanupPending || !deleted;
  }

  private async cleanupObjects(
    objects: readonly StoredObjectLocator[],
    reason: string,
  ): Promise<void> {
    await Promise.all(
      objects.map((object) =>
        this.deleteObjectBestEffort(object, reason),
      ),
    );
  }

  private async deleteObjectBestEffort(
    object: StoredObjectLocator,
    reason: string,
  ): Promise<boolean> {
    try {
      await this.storageService.deleteObject(object);
      return true;
    } catch {
      this.logObjectCleanupFailure(object, reason);
      return false;
    }
  }

  private logObjectCleanupFailure(
    object: StoredObjectLocator,
    reason: string,
  ): void {
    this.logger.warn({
      event: "opd.chart.storage_cleanup_pending",
      reason,
      provider: object.provider,
      bucketHash: sha256(object.bucketName),
      objectKeyHash: sha256(object.objectKey),
    });
  }

  private toDraftWrite(
    object: StoredObject,
    image: NormalizedOpdChartPng,
  ): OpdChartDraftObjectWrite {
    return {
      provider: object.provider,
      bucketName: object.bucketName,
      objectKey: object.objectKey,
      eTag: object.eTag,
      fileSizeBytes: image.bytes.length,
      rasterSha256: image.hash,
    };
  }

  private toStoredObjectLocator(
    object: StoredObject,
  ): StoredObjectLocator {
    return {
      provider: object.provider,
      bucketName: object.bucketName,
      objectKey: object.objectKey,
    };
  }

  private requireDraftObject(
    document: OpdChartDocumentRecord,
  ): StoredObjectLocator {
    if (
      !document.draft_storage_provider ||
      !document.draft_storage_bucket ||
      !document.draft_storage_object_key ||
      !document.draft_storage_etag
    ) {
      throw new ConflictException({
        code: "CHART_STORAGE_RECONCILIATION_REQUIRED",
        message: "The Chart draft storage pointer is incomplete",
      });
    }
    return {
      provider: this.requireStorageProvider(
        document.draft_storage_provider,
      ),
      bucketName: document.draft_storage_bucket,
      objectKey: document.draft_storage_object_key,
    };
  }

  private requireFinalPngObject(
    document: OpdChartDocumentRecord,
  ): StoredObjectLocator {
    const artifact = document.artifacts.find(
      (entry) => entry.artifact_format === "PNG",
    );
    if (!artifact) {
      throw new ConflictException({
        code: "CHART_STORAGE_RECONCILIATION_REQUIRED",
        message: "The finalized Chart PNG artifact is missing",
      });
    }
    return {
      provider: this.requireStorageProvider(artifact.storage_provider),
      bucketName: artifact.storage_bucket,
      objectKey: artifact.storage_object_key,
    };
  }

  private requireStorageProvider(value: string): StorageProvider {
    if (value !== "minio" && value !== "azure") {
      throw new ConflictException({
        code: "CHART_STORAGE_RECONCILIATION_REQUIRED",
        message: "The stored Chart provider is unsupported",
      });
    }
    return value;
  }

  private normalizePng(source: Buffer): NormalizedOpdChartPng {
    try {
      return normalizeOpdChartPng(source);
    } catch (error) {
      throw new BadRequestException({
        code: "CHART_RENDER_INVALID",
        message:
          error instanceof Error
            ? error.message.replace(/^CHART_RENDER_INVALID:\s*/u, "")
            : "Chart render is invalid",
      });
    }
  }

  private assertPngUpload(
    file: Express.Multer.File | undefined,
  ): asserts file is Express.Multer.File {
    if (!file) {
      throw new BadRequestException({
        code: "CHART_RENDER_REQUIRED",
        message: "A complete flattened Chart PNG is required",
      });
    }
    if (file.mimetype !== "image/png" || file.size > CHART_PNG_LIMIT_BYTES) {
      throw new BadRequestException({
        code: "CHART_RENDER_INVALID",
        message: "Chart render must be a PNG no larger than 6 MiB",
      });
    }
  }

  private requireTemplate(
    templateCode: OpdChartTemplateCode,
    templateVersion: string,
  ): OpdChartTemplateDefinition {
    const template = findOpdChartTemplate(templateCode);
    if (!template || template.version !== templateVersion) {
      throw new BadRequestException({
        code: "CHART_TEMPLATE_VERSION_UNSUPPORTED",
        message:
          "Chart template code/version is unsupported or stale; reload templates before saving",
      });
    }
    return template;
  }

  private assertTemplatePinned(
    document: opd_chart_document,
    template: OpdChartTemplateDefinition,
  ): void {
    if (
      document.template_code !== template.code ||
      document.template_version !== template.version ||
      document.template_name_snapshot !== template.name
    ) {
      throw new ConflictException({
        code: "CHART_TEMPLATE_VERSION_CONFLICT",
        message:
          "This Chart document is pinned to a different template revision",
      });
    }
  }

  private assertDocumentDraft(document: opd_chart_document): void {
    if (document.status !== "DRAFT") {
      throw new ConflictException({
        code: "CHART_DOCUMENT_FINAL",
        message:
          "Finalized Chart documents are immutable; correction/reissue is not enabled",
      });
    }
  }

  private assertMutationIdAvailable(
    document: opd_chart_document,
    dto: SaveOpdChartDocumentDto,
    content: NormalizedOpdChartContent,
  ): void {
    if (
      document.last_client_mutation_id === dto.clientMutationId &&
      document.content_sha256 !== content.contentHash
    ) {
      throw new ConflictException({
        code: "CHART_CLIENT_MUTATION_ID_REUSED",
        message:
          "This Chart client mutation ID was already used for different content",
      });
    }
  }

  private assertDocumentVersion(
    encounterId: string,
    templateCode: OpdChartTemplateCode,
    document: OpdChartDocumentRecord,
    expectedVersion: number,
  ): void {
    this.assertDocumentDraft(document);
    if (document.version !== expectedVersion) {
      this.throwVersionConflict(encounterId, templateCode, document);
    }
  }

  private assertFinalizationReplay(
    document: OpdChartDocumentRecord,
    keyHash: string,
    requestHash: string,
  ): void {
    if (
      document.finalization_idempotency_key_hash === keyHash &&
      document.finalization_request_hash === requestHash
    ) {
      return;
    }
    if (document.finalization_idempotency_key_hash === keyHash) {
      throw new ConflictException({
        code: "IDEMPOTENCY_KEY_REUSED",
        message:
          "This idempotency key was already used with a different Chart version",
      });
    }
    throw new ConflictException({
      code: "CHART_DOCUMENT_FINAL",
      message:
        "This Chart is already finalized; use its existing immutable artifacts",
    });
  }

  private async requireEncounter(
    encounterId: string,
    scope: RequestScope,
  ): Promise<opd_encounter> {
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
    );
    if (!encounter) this.throwEncounterNotFound();
    return encounter;
  }

  private async lockEditableEncounter(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<opd_encounter> {
    const locked = await this.clinicalRepository.lockEncounter(
      encounterId,
      scope,
      tx,
    );
    if (!locked) this.throwEncounterNotFound();
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
      tx,
    );
    if (!encounter) this.throwEncounterNotFound();
    this.assertEncounterEditable(encounter);
    return encounter;
  }

  private assertEncounterEditable(encounter: opd_encounter): void {
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      throw new ConflictException({
        code: "CHART_ENCOUNTER_NOT_EDITABLE",
        message: "Charts can only be edited on an open draft encounter",
      });
    }
  }

  private async auditDraft(
    encounter: opd_encounter,
    document: opd_chart_document,
    template: OpdChartTemplateDefinition,
    content: NormalizedOpdChartContent,
    image: NormalizedOpdChartPng,
    previousVersion: number,
    principal: Principal,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.auditLogService.create(
      {
        clinicId: scope.clinicId,
        branchId: scope.branchId,
        referenceType: auditReferenceType.OPD,
        referenceId: encounter.encounter_id,
        action: "chart.document.draft.autosave",
        actionLabel: "Autosave OPD Chart raster draft",
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
        actorUserId: scope.userId,
        actorName: principal.name,
        actorRole: this.actorRole(scope),
        metadata: {
          chartDocumentId: document.chart_document_id,
          templateCode: template.code,
          templateVersion: template.version,
          previousVersion,
          resultVersion: previousVersion + 1,
          contentHash: content.contentHash,
          rasterSha256: image.hash,
          rasterBytes: image.bytes.length,
          hasClinicalMetadata: content.hasClinicalMetadata,
        },
      },
      tx,
    );
  }

  private async auditFinalize(
    encounter: opd_encounter,
    document: OpdChartDocumentRecord,
    pngHash: string,
    pdfHash: string,
    principal: Principal,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.auditLogService.create(
      {
        clinicId: scope.clinicId,
        branchId: scope.branchId,
        referenceType: auditReferenceType.OPD,
        referenceId: encounter.encounter_id,
        action: "chart.document.finalize",
        actionLabel: "Finalize OPD Chart document",
        fromStatus: "DRAFT",
        toStatus: "FINAL",
        actorUserId: scope.userId,
        actorName: principal.name,
        actorRole: this.actorRole(scope),
        metadata: {
          chartDocumentId: document.chart_document_id,
          templateCode: document.template_code,
          templateVersion: document.template_version,
          sourceDraftVersion: document.version,
          contentHash: document.content_sha256,
          pngHash,
          pdfHash,
        },
      },
      tx,
    );
  }

  private throwVersionConflict(
    encounterId: string,
    templateCode: OpdChartTemplateCode,
    document: OpdChartDocumentRecord | null,
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_CHART_DOCUMENT",
      resourceId:
        document?.chart_document_id ?? `${encounterId}:${templateCode}`,
      currentVersion: document?.version ?? 0,
      currentStatus: document?.status ?? "DRAFT",
      updatedAt: document?.updated_at.toISOString(),
    });
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = value?.trim() ?? "";
    if (key.length < 8 || key.length > 200) {
      throw new BadRequestException({
        code: "IDEMPOTENCY_KEY_REQUIRED",
        message: "Idempotency-Key must contain 8 to 200 characters",
      });
    }
    return key;
  }

  private finalizationRequestHash(
    encounterId: string,
    templateCode: OpdChartTemplateCode,
    expectedVersion: number,
    contentHash: string,
  ): string {
    return sha256(
      [
        encounterId,
        templateCode,
        String(expectedVersion),
        contentHash,
      ].join("\n"),
    );
  }

  private readUrlExpiry(): string {
    return new Date(
      Date.now() + ARTIFACT_URL_TTL_SECONDS * 1000,
    ).toISOString();
  }

  private actorRole(scope: RequestScope): string | undefined {
    return (
      scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined)
    );
  }

  private throwStorageUnavailable(message: string): never {
    throw new ServiceUnavailableException({
      code: "CHART_STORAGE_UNAVAILABLE",
      message,
    });
  }

  private throwEncounterNotFound(): never {
    throw new NotFoundException(
      "OPD encounter not found for this clinic/branch",
    );
  }

  private throwDocumentNotFound(): never {
    throw new NotFoundException(
      "Chart document not found for this encounter/template",
    );
  }
}

function sha256(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}
