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
  type opd_draft_import_section,
  type opd_encounter,
  type opd_note_section,
} from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  OpdNoteRecordMode,
  OpdNoteSectionCode,
} from "./dto/opd-clinical-note.dto";
import type {
  CreateOpdDraftCheckpointDto,
  OpdDraftExpectedVersionsDto,
  OpdExpectedNoteSectionVersionDto,
} from "./dto/opd-clinical-section.dto";
import {
  ImportOpdDraftDto,
  OpdDraftCopySectionCode,
  OpdDraftExpectedTargetVersionsDto,
  QueryReusableOpdDraftsDto,
  ReviewImportedOpdDraftSectionDto,
} from "./dto/opd-draft-library.dto";
import { OpdClinicalIntakeRepository } from "./opd-clinical-intake.repository";
import { OpdClinicalNoteRepository } from "./opd-clinical-note.repository";
import { normalizeClinicalRichText } from "./opd-clinical-note.rich-text";
import { OpdClinicalSectionRepository } from "./opd-clinical-section.repository";
import type {
  DraftNoteSectionVersion,
  DraftResourceVersion,
  DraftResourceVersionState,
} from "./opd-clinical-section.repository";
import type { OpdDraftCheckpointView } from "./opd-clinical-section.mapper";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import {
  type OpdDraftImportRecord,
  type OpdDraftTargetRecord,
  type OpdReusableDraftSnapshotRecord,
  OpdDraftLibraryRepository,
  type OpdDraftAuthorRecord,
  type ReusableDraftListRow,
} from "./opd-draft-library.repository";
import {
  CurrentOpdDraftImportView,
  OpdDraftImportedSectionView,
  OpdDraftImportView,
  ReusableOpdDraftListItemView,
  ReusableOpdDraftListView,
  ReusableOpdDraftPreviewView,
  ReviewImportedOpdDraftSectionView,
} from "./opd-draft-library.mapper";
import {
  OPD_DRAFT_SNAPSHOT_SCHEMA,
  OPD_DRAFT_SECTION_ORDER,
  canonicalSectionHash,
  canonicalSelection,
  canonicalizeOpdDraftSnapshot,
  noteCodeForCopySection,
  parseAvailableSnapshotSections,
  sha256,
  stableJson,
  toPrismaJsonObject,
  verifyOpdDraftSnapshot,
  type CanonicalOpdDraftSnapshot,
  type OpdDraftSnapshotContent,
} from "./opd-draft-snapshot";
import { toOpdDraftSnapshotCandidate } from "./opd-draft-snapshot.mapper";

const IMPORT_OPERATION = "opd.draft.import";
const CHECKPOINT_OPERATION = "opd.draft.checkpoint.create";

interface CapturedDraftSnapshot {
  draftSnapshotId: string;
  schemaVersion: "opd-draft-copy-v1";
  contentSha256: string;
  availableSections: OpdDraftCopySectionCode[];
  isReusable: boolean;
}

interface ImportedResource {
  sectionCode: OpdDraftCopySectionCode;
  targetResourceType: string;
  targetResourceId: string;
  targetResourceVersion: number;
}

@Injectable()
export class OpdDraftLibraryService {
  constructor(
    private readonly repository: OpdDraftLibraryRepository,
    private readonly clinicalRepository: OpdClinicalRepository,
    private readonly sectionRepository: OpdClinicalSectionRepository,
    private readonly intakeRepository: OpdClinicalIntakeRepository,
    private readonly noteRepository: OpdClinicalNoteRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async captureSnapshotForCheckpoint(
    encounter: opd_encounter,
    checkpointId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<CapturedDraftSnapshot> {
    const source = await this.repository.findSnapshotSource(
      encounter.encounter_id,
      scope,
      tx,
    );
    if (!source) throw new Error("Draft snapshot source encounter disappeared");
    const canonical = canonicalizeOpdDraftSnapshot(
      toOpdDraftSnapshotCandidate(source),
    );
    const created = await this.repository.createSnapshot(
      {
        encounter,
        checkpointId,
        schemaVersion: OPD_DRAFT_SNAPSHOT_SCHEMA,
        copyableContent: toPrismaJsonObject(canonical.content),
        availableSections: canonical.availableSections,
        contentSha256: canonical.contentSha256,
      },
      scope,
      now,
      tx,
    );
    return {
      draftSnapshotId: created.draft_snapshot_id,
      schemaVersion: OPD_DRAFT_SNAPSHOT_SCHEMA,
      contentSha256: created.content_sha256,
      availableSections: canonical.availableSections,
      isReusable: canonical.availableSections.length > 0,
    };
  }

  async createDraftCheckpoint(
    encounterId: string,
    dto: CreateOpdDraftCheckpointDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdDraftCheckpointView> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const normalizedNote = this.nullableText(dto.note);
    const requestHash = sha256(
      stableJson({
        operation: CHECKPOINT_OPERATION,
        encounterId,
        expectedVersions: dto.expectedVersions,
        note: normalizedNote,
      }),
    );
    return this.checkpointWithRetry(
      encounterId,
      dto,
      normalizedNote,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  async listReusableDrafts(
    targetEncounterId: string,
    query: QueryReusableOpdDraftsDto,
    scope: RequestScope,
  ): Promise<ReusableOpdDraftListView> {
    const target = await this.requireEditableTarget(targetEncounterId, scope);
    const result = await this.repository.listReusableSnapshots(
      target,
      query,
      scope,
    );
    const authors = await this.authorMap(
      result.items.map((item) => item.capturedByUserId),
      scope,
    );
    return {
      ...result,
      items: result.items.map((item) =>
        this.toListItem(item, authors.get(item.capturedByUserId)),
      ),
    };
  }

  async previewReusableDraft(
    targetEncounterId: string,
    snapshotId: string,
    scope: RequestScope,
  ): Promise<ReusableOpdDraftPreviewView> {
    const target = await this.requireEditableTarget(targetEncounterId, scope);
    const snapshot = await this.repository.findReusableSnapshot(
      snapshotId,
      target,
      scope,
    );
    if (!snapshot) this.throwSourceNotFound();
    const canonical = this.verifySnapshot(snapshot);
    const authors = await this.authorMap([snapshot.captured_by_user_id], scope);
    const listItem = this.toSnapshotListItem(
      snapshot,
      authors.get(snapshot.captured_by_user_id),
      canonical.availableSections,
    );
    return {
      ...listItem,
      schemaVersion: OPD_DRAFT_SNAPSHOT_SCHEMA,
      contentSha256: canonical.contentSha256,
      content: canonical.content,
      isReusable: canonical.availableSections.length > 0,
    };
  }

  async currentImport(
    targetEncounterId: string,
    scope: RequestScope,
  ): Promise<CurrentOpdDraftImportView> {
    const target = await this.repository.findEncounter(
      targetEncounterId,
      scope,
    );
    if (!target) this.throwTargetNotFound();
    const imported = await this.repository.findCurrentImport(
      targetEncounterId,
      scope,
    );
    return {
      draftImport: imported ? await this.toImportView(imported, scope) : null,
    };
  }

  async importDraft(
    targetEncounterId: string,
    dto: ImportOpdDraftDto,
    idempotencyKeyHeader: string | undefined,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdDraftImportView> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const selectedSections = canonicalSelection(dto.selectedSections);
    if (selectedSections.length !== dto.selectedSections.length) {
      throw new BadRequestException({
        code: "COPY_SECTION_NOT_ALLOWED",
        message: "Draft selection contains an unsupported or duplicate section",
      });
    }
    this.validateExpectedNoteVersions(
      dto.expectedTargetVersions.noteSections ?? {},
    );
    const requestHash = sha256(
      stableJson({
        operation: IMPORT_OPERATION,
        targetEncounterId,
        sourceSnapshotId: dto.sourceSnapshotId,
        selectedSections,
        expectedTargetVersions: dto.expectedTargetVersions,
      }),
    );
    return this.importWithRetry(
      targetEncounterId,
      dto,
      selectedSections,
      idempotencyKey,
      requestHash,
      scope,
      principal,
      true,
    );
  }

  async reviewImportedSection(
    targetEncounterId: string,
    draftImportId: string,
    sectionCode: OpdDraftCopySectionCode,
    dto: ReviewImportedOpdDraftSectionDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<ReviewImportedOpdDraftSectionView> {
    return this.prisma.$transaction(
      async (tx) => {
        const lockedTarget = await this.clinicalRepository.lockEncounter(
          targetEncounterId,
          scope,
          tx,
        );
        if (!lockedTarget) this.throwTargetNotFound();
        const target = await this.repository.findEncounter(
          targetEncounterId,
          scope,
          tx,
        );
        if (!target) this.throwTargetNotFound();
        this.assertEditableTarget(target);
        const lockedSection = await this.repository.lockImportSection(
          targetEncounterId,
          draftImportId,
          sectionCode,
          scope,
          tx,
        );
        if (!lockedSection) this.throwImportSectionNotFound();
        const section = await this.repository.findImportSection(
          targetEncounterId,
          draftImportId,
          sectionCode,
          scope,
          tx,
        );
        if (!section) this.throwImportSectionNotFound();
        const current = await this.repository.currentImportedResourceVersion(
          section,
          scope,
          tx,
        );
        if (
          !current ||
          current.id !== dto.targetResourceId ||
          current.version !== dto.targetResourceVersion
        ) {
          this.throwConflict(
            "TARGET_VERSION_STALE",
            "The copied section changed before it was reviewed",
            current
              ? {
                  currentResourceId: current.id,
                  currentVersion: current.version,
                }
              : undefined,
          );
        }
        if (
          section.review_status !== "REVIEWED" ||
          section.reviewed_target_version !== current.version
        ) {
          const now = new Date();
          await this.repository.markImportSectionReviewed(
            section.draft_import_section_id,
            current.version,
            scope,
            now,
            tx,
          );
          await this.auditLogService.create(
            {
              clinicId: scope.clinicId,
              branchId: scope.branchId,
              referenceType: auditReferenceType.OPD,
              referenceId: targetEncounterId,
              action: "draft.import.section.review",
              actionLabel: "Review copied OPD draft section",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                draftImportId,
                sectionCode,
                targetResourceType: section.target_resource_type,
                targetResourceId: current.id,
                targetResourceVersion: current.version,
              },
            },
            tx,
          );
        }
        const imported = await this.repository.findImportById(
          targetEncounterId,
          draftImportId,
          scope,
          tx,
        );
        if (!imported) this.throwImportSectionNotFound();
        const view = await this.toImportView(imported, scope, tx);
        const reviewed = view.sections.find(
          (candidate) => candidate.sectionCode === sectionCode,
        );
        if (!reviewed)
          throw new Error("Reviewed copied section could not be reloaded");
        return { draftImportId, section: reviewed };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async importWithRetry(
    targetEncounterId: string,
    dto: ImportOpdDraftDto,
    selectedSections: OpdDraftCopySectionCode[],
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetrySerialization: boolean,
  ): Promise<OpdDraftImportView> {
    const existing = await this.repository.findIdempotency(
      IMPORT_OPERATION,
      idempotencyKey,
      scope,
    );
    if (existing) {
      return this.replayImport(existing, requestHash, targetEncounterId, scope);
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const claim = await this.repository.createIdempotency(
            {
              operation: IMPORT_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_DRAFT_IMPORT",
              resourceId: targetEncounterId,
            },
            scope,
            now,
            tx,
          );
          const locked = await this.clinicalRepository.lockEncounter(
            targetEncounterId,
            scope,
            tx,
          );
          if (!locked) this.throwTargetNotFound();
          const target = await this.repository.findTarget(
            targetEncounterId,
            scope,
            tx,
          );
          if (!target) this.throwTargetNotFound();
          this.assertEditableTarget(target);
          if (target.queue_ticket.current_step !== "IN_SERVICE") {
            this.throwConflict(
              "TARGET_NOT_OPEN_DRAFT",
              "Draft content can only be copied while the target queue is in service",
            );
          }
          this.assertExpectedTargetVersions(target, dto.expectedTargetVersions);
          const previousImport = await this.repository.findCurrentImport(
            targetEncounterId,
            scope,
            tx,
          );
          if (previousImport) {
            this.throwConflict(
              "IMPORT_ALREADY_APPLIED",
              "This target encounter already contains a reusable-draft import",
              { draftImportId: previousImport.draft_import_id },
            );
          }
          const snapshot = await this.repository.findReusableSnapshot(
            dto.sourceSnapshotId,
            target,
            scope,
            tx,
          );
          if (!snapshot) this.throwSourceNotFound();
          const canonical = this.verifySnapshot(snapshot);
          this.assertSelectedSourceSections(selectedSections, canonical);
          this.assertSelectedTargetSectionsEmpty(target, selectedSections);

          const beforeState =
            await this.sectionRepository.buildResourceVersionManifest(
              targetEncounterId,
              target.version,
              scope,
              tx,
            );
          const importedResources = await this.applySelectedSections(
            target,
            canonical.content,
            selectedSections,
            scope,
            now,
            tx,
          );
          const afterState =
            await this.sectionRepository.buildResourceVersionManifest(
              targetEncounterId,
              target.version,
              scope,
              tx,
            );
          const importId = await this.repository.createImport(
            {
              target,
              source: snapshot,
              selectedSections,
              targetBeforeManifest: beforeState.manifest,
              targetAfterManifest: afterState.manifest,
              idempotencyKeyHash: sha256(idempotencyKey),
              sections: importedResources.map((resource) => ({
                ...resource,
                sourceSectionSha256: canonicalSectionHash(
                  resource.sectionCode,
                  canonical.content,
                ),
              })),
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
              referenceId: targetEncounterId,
              action: "draft.import.create",
              actionLabel: "Copy selected reusable OPD draft sections",
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                draftImportId: importId,
                sourceSnapshotId: snapshot.draft_snapshot_id,
                sourceCheckpointId: snapshot.draft_checkpoint_id,
                sourceEncounterId: snapshot.source_encounter_id,
                selectedSections,
                sourceContentSha256: snapshot.content_sha256,
              },
            },
            tx,
          );
          const imported = await this.repository.findImportById(
            targetEncounterId,
            importId,
            scope,
            tx,
          );
          if (!imported) throw new Error("Draft import could not be reloaded");
          const view = await this.toImportView(imported, scope, tx);
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            importId,
            {
              draftImportId: importId,
              targetEncounterId,
              sourceSnapshotId: snapshot.draft_snapshot_id,
              selectedSections,
              importedAt: view.importedAt,
            },
            201,
            now,
            tx,
          );
          return view;
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
          IMPORT_OPERATION,
          idempotencyKey,
          scope,
        );
        if (replay) {
          return this.replayImport(
            replay,
            requestHash,
            targetEncounterId,
            scope,
          );
        }
        const imported = await this.repository.findCurrentImport(
          targetEncounterId,
          scope,
        );
        if (imported) {
          this.throwConflict(
            "IMPORT_ALREADY_APPLIED",
            "This target encounter was imported concurrently",
          );
        }
      }
      if (
        canRetrySerialization &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return this.importWithRetry(
          targetEncounterId,
          dto,
          selectedSections,
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

  private async checkpointWithRetry(
    encounterId: string,
    dto: CreateOpdDraftCheckpointDto,
    normalizedNote: string | null,
    idempotencyKey: string,
    requestHash: string,
    scope: RequestScope,
    principal: Principal,
    canRetrySerialization: boolean,
  ): Promise<OpdDraftCheckpointView> {
    const existing = await this.repository.findIdempotency(
      CHECKPOINT_OPERATION,
      idempotencyKey,
      scope,
    );
    if (existing) {
      return this.replayCheckpoint(existing, requestHash, encounterId, scope);
    }

    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const claim = await this.repository.createIdempotency(
            {
              operation: CHECKPOINT_OPERATION,
              idempotencyKey,
              requestHash,
              resourceType: "OPD_DRAFT_CHECKPOINT",
              resourceId: encounterId,
            },
            scope,
            now,
            tx,
          );
          const locked = await this.clinicalRepository.lockEncounter(
            encounterId,
            scope,
            tx,
          );
          if (!locked) this.throwTargetNotFound();
          const encounter = await this.clinicalRepository.findEncounter(
            encounterId,
            scope,
            tx,
          );
          if (!encounter) this.throwTargetNotFound();
          this.assertEditableTarget(encounter);
          const checkpointNumber =
            await this.sectionRepository.nextCheckpointNumber(
              encounterId,
              scope,
              tx,
            );
          const resourceState =
            await this.sectionRepository.buildResourceVersionManifest(
              encounterId,
              encounter.version,
              scope,
              tx,
            );
          this.assertDraftExpectedVersions(
            dto.expectedVersions,
            encounter,
            resourceState,
          );
          const checkpoint = await this.sectionRepository.createDraftCheckpoint(
            encounterId,
            checkpointNumber,
            resourceState.manifest,
            normalizedNote,
            scope,
            now,
            tx,
          );
          const snapshot = await this.captureSnapshotForCheckpoint(
            encounter,
            checkpoint.draft_checkpoint_id,
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
              action: "draft.checkpoint.create",
              actionLabel: "Save reusable OPD draft checkpoint",
              fromStatus: encounter.clinical_record_status,
              toStatus: encounter.clinical_record_status,
              actorUserId: scope.userId,
              actorName: principal.name,
              actorRole: this.actorRole(scope),
              metadata: {
                checkpointNumber,
                draftSnapshotId: snapshot.draftSnapshotId,
                snapshotSchemaVersion: snapshot.schemaVersion,
                snapshotContentSha256: snapshot.contentSha256,
                availableSections: snapshot.availableSections,
                isReusable: snapshot.isReusable,
              },
            },
            tx,
          );
          const result: OpdDraftCheckpointView = {
            draftCheckpointId: checkpoint.draft_checkpoint_id,
            encounterId: checkpoint.encounter_id,
            checkpointNumber: checkpoint.checkpoint_number,
            resourceVersions: resourceState.manifest,
            note: checkpoint.note,
            actorUserId: checkpoint.actor_user_id,
            createdAt: checkpoint.created_at.toISOString(),
            draftSnapshotId: snapshot.draftSnapshotId,
            snapshotSchemaVersion: snapshot.schemaVersion,
            snapshotContentSha256: snapshot.contentSha256,
            availableSections: snapshot.availableSections,
            isReusable: snapshot.isReusable,
          };
          await this.repository.completeIdempotency(
            claim.api_idempotency_id,
            checkpoint.draft_checkpoint_id,
            {
              draftCheckpointId: checkpoint.draft_checkpoint_id,
              encounterId,
              checkpointNumber,
              draftSnapshotId: snapshot.draftSnapshotId,
              snapshotContentSha256: snapshot.contentSha256,
              availableSections: snapshot.availableSections,
              createdAt: result.createdAt,
            },
            201,
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
          CHECKPOINT_OPERATION,
          idempotencyKey,
          scope,
        );
        if (replay) {
          return this.replayCheckpoint(replay, requestHash, encounterId, scope);
        }
      }
      if (
        canRetrySerialization &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2034"
      ) {
        return this.checkpointWithRetry(
          encounterId,
          dto,
          normalizedNote,
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

  private async applySelectedSections(
    target: OpdDraftTargetRecord,
    content: OpdDraftSnapshotContent,
    selectedSections: OpdDraftCopySectionCode[],
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<ImportedResource[]> {
    const imported: ImportedResource[] = [];
    let examination: OpdDraftTargetRecord["examinations"][number] | null =
      target.examinations[0] ?? null;
    if (
      !examination &&
      (selectedSections.includes(OpdDraftCopySectionCode.SYMPTOMS) ||
        selectedSections.includes(OpdDraftCopySectionCode.INTAKE))
    ) {
      const examinationNumber =
        await this.clinicalRepository.nextExaminationNumber(
          target.encounter_id,
          scope,
          tx,
        );
      await this.clinicalRepository.createExamination(
        target.encounter_id,
        examinationNumber,
        scope,
        now,
        tx,
      );
      const refreshed = await this.repository.findTarget(
        target.encounter_id,
        scope,
        tx,
      );
      examination = refreshed?.examinations[0] ?? null;
      if (!examination)
        throw new Error("Imported examination shell could not be reloaded");
    }

    if (selectedSections.includes(OpdDraftCopySectionCode.SYMPTOMS)) {
      if (!content.symptoms || !examination) {
        throw new Error("Validated symptom snapshot content disappeared");
      }
      let section = await this.sectionRepository.findSymptomSection(
        target.encounter_id,
        examination.examination_id,
        scope,
        tx,
      );
      if (!section) {
        section = await this.sectionRepository.createSymptomSection(
          target.encounter_id,
          examination.examination_id,
          scope,
          now,
          tx,
        );
      }
      const updated = await this.sectionRepository.replaceSymptoms(
        section,
        section.version,
        content.symptoms.patientQuote,
        content.symptoms.items,
        scope,
        now,
        tx,
      );
      if (!updated) this.throwTargetVersionStale();
      const reloaded = await this.sectionRepository.findSymptomSection(
        target.encounter_id,
        examination.examination_id,
        scope,
        tx,
      );
      if (!reloaded)
        throw new Error("Imported symptom section could not be reloaded");
      imported.push({
        sectionCode: OpdDraftCopySectionCode.SYMPTOMS,
        targetResourceType: "OPD_SYMPTOM_SECTION",
        targetResourceId: reloaded.symptom_section_id,
        targetResourceVersion: reloaded.version,
      });
    }

    if (selectedSections.includes(OpdDraftCopySectionCode.INTAKE)) {
      if (!content.intake || !examination) {
        throw new Error("Validated intake snapshot content disappeared");
      }
      const created = await this.intakeRepository.createIntake(
        target.encounter_id,
        examination.examination_id,
        content.intake,
        scope,
        now,
        tx,
      );
      imported.push({
        sectionCode: OpdDraftCopySectionCode.INTAKE,
        targetResourceType: "OPD_INTAKE",
        targetResourceId: created.intake_id,
        targetResourceVersion: created.version,
      });
    }

    if (selectedSections.includes(OpdDraftCopySectionCode.DIAGNOSES)) {
      if (!content.diagnoses) {
        throw new Error("Validated diagnosis snapshot content disappeared");
      }
      let section = await this.sectionRepository.findDiagnosisSection(
        target.encounter_id,
        scope,
        tx,
      );
      if (!section) {
        section = await this.sectionRepository.createDiagnosisSection(
          target.encounter_id,
          scope,
          now,
          tx,
        );
      }
      const updated = await this.sectionRepository.replaceDiagnoses(
        section,
        section.version,
        content.diagnoses.items,
        scope,
        now,
        tx,
      );
      if (!updated) this.throwTargetVersionStale();
      const reloaded = await this.sectionRepository.findDiagnosisSection(
        target.encounter_id,
        scope,
        tx,
      );
      if (!reloaded)
        throw new Error("Imported diagnosis section could not be reloaded");
      imported.push({
        sectionCode: OpdDraftCopySectionCode.DIAGNOSES,
        targetResourceType: "OPD_DIAGNOSIS_SECTION",
        targetResourceId: reloaded.diagnosis_section_id,
        targetResourceVersion: reloaded.version,
      });
    }

    const selectedNotes = selectedSections
      .map((sectionCode) => ({
        sectionCode,
        noteCode: noteCodeForCopySection(sectionCode),
      }))
      .filter(
        (
          value,
        ): value is {
          sectionCode: OpdDraftCopySectionCode;
          noteCode: OpdNoteSectionCode;
        } => value.noteCode !== null,
      );
    if (selectedNotes.length > 0) {
      if (!content.notes)
        throw new Error("Validated note snapshot content disappeared");
      let workspace = await this.noteRepository.findWorkspace(
        target.encounter_id,
        scope,
        tx,
      );
      if (!workspace) {
        workspace = {
          ...(await this.noteRepository.createWorkspace(
            target.encounter_id,
            content.notes.selectedMode,
            scope,
            now,
            tx,
          )),
          sections: [],
        };
      } else if (workspace.selected_mode !== content.notes.selectedMode) {
        const updated = await this.noteRepository.updateMode(
          workspace.note_workspace_id,
          target.encounter_id,
          workspace.version,
          content.notes.selectedMode,
          scope,
          now,
          tx,
        );
        if (!updated) this.throwTargetVersionStale();
      }
      for (const selected of selectedNotes) {
        const source = content.notes.sections.find(
          (section) => section.sectionCode === selected.noteCode,
        );
        if (!source)
          throw new Error("Validated selected note content disappeared");
        const normalized = normalizeClinicalRichText(source.content);
        const existing = await this.noteRepository.findSection(
          target.encounter_id,
          selected.noteCode,
          scope,
          tx,
        );
        const section = existing
          ? await this.updateImportedNote(
              existing,
              normalized.content,
              normalized.plainText,
              scope,
              now,
              tx,
            )
          : await this.noteRepository.createSection(
              workspace.note_workspace_id,
              target.encounter_id,
              selected.noteCode,
              normalized.content,
              normalized.plainText,
              scope,
              now,
              tx,
            );
        imported.push({
          sectionCode: selected.sectionCode,
          targetResourceType: "OPD_NOTE_SECTION",
          targetResourceId: section.note_section_id,
          targetResourceVersion: section.version,
        });
      }
    }
    return imported.sort(
      (left, right) =>
        OPD_DRAFT_SECTION_ORDER.indexOf(left.sectionCode) -
        OPD_DRAFT_SECTION_ORDER.indexOf(right.sectionCode),
    );
  }

  private async updateImportedNote(
    existing: opd_note_section,
    content: Prisma.InputJsonObject,
    plainText: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_note_section> {
    const updated = await this.noteRepository.updateSection(
      existing,
      existing.version,
      content,
      plainText,
      scope,
      now,
      tx,
    );
    if (!updated) this.throwTargetVersionStale();
    const reloaded = await this.noteRepository.findSection(
      existing.encounter_id,
      this.parseNoteSectionCode(existing.section_code),
      scope,
      tx,
    );
    if (!reloaded)
      throw new Error("Imported note section could not be reloaded");
    return reloaded;
  }

  private assertExpectedTargetVersions(
    target: OpdDraftTargetRecord,
    expected: OpdDraftExpectedTargetVersionsDto,
  ): void {
    const examination = target.examinations[0];
    const actualNoteVersions = new Map(
      (target.note_workspace?.sections ?? []).map((section) => [
        section.section_code,
        section.version,
      ]),
    );
    const expectedNoteVersions = expected.noteSections ?? {};
    const matches =
      target.version === expected.encounterVersion &&
      (examination?.version ?? 0) === (expected.examinationVersion ?? 0) &&
      (examination?.symptom_section?.version ?? 0) ===
        (expected.symptomSectionVersion ?? 0) &&
      (examination?.intake?.version ?? 0) === (expected.intakeVersion ?? 0) &&
      (target.diagnosis_section?.version ?? 0) ===
        (expected.diagnosisSectionVersion ?? 0) &&
      (target.note_workspace?.version ?? 0) ===
        (expected.noteWorkspaceVersion ?? 0) &&
      actualNoteVersions.size === Object.keys(expectedNoteVersions).length &&
      [...actualNoteVersions].every(
        ([code, version]) => expectedNoteVersions[code] === version,
      );
    if (!matches) this.throwTargetVersionStale();
  }

  private assertSelectedTargetSectionsEmpty(
    target: OpdDraftTargetRecord,
    selected: OpdDraftCopySectionCode[],
  ): void {
    const examination = target.examinations[0];
    if (
      selected.includes(OpdDraftCopySectionCode.SYMPTOMS) &&
      examination?.symptom_section &&
      ((examination.symptom_section.patient_quote?.trim().length ?? 0) > 0 ||
        examination.symptom_section.symptoms.length > 0)
    ) {
      this.throwTargetSectionNotEmpty(OpdDraftCopySectionCode.SYMPTOMS);
    }
    if (
      selected.includes(OpdDraftCopySectionCode.INTAKE) &&
      examination?.intake
    ) {
      this.throwTargetSectionNotEmpty(OpdDraftCopySectionCode.INTAKE);
    }
    if (
      selected.includes(OpdDraftCopySectionCode.DIAGNOSES) &&
      (target.diagnosis_section?.diagnoses.length ?? 0) > 0
    ) {
      this.throwTargetSectionNotEmpty(OpdDraftCopySectionCode.DIAGNOSES);
    }
    for (const sectionCode of selected) {
      const noteCode = noteCodeForCopySection(sectionCode);
      if (!noteCode) continue;
      const section = target.note_workspace?.sections.find(
        (candidate) => candidate.section_code === noteCode,
      );
      if (section?.plain_text.trim())
        this.throwTargetSectionNotEmpty(sectionCode);
    }
  }

  private assertSelectedSourceSections(
    selected: OpdDraftCopySectionCode[],
    canonical: CanonicalOpdDraftSnapshot,
  ): void {
    for (const section of selected) {
      if (!canonical.availableSections.includes(section)) {
        throw new BadRequestException({
          code: "COPY_SECTION_NOT_ALLOWED",
          message: `Section ${section} is not available in this snapshot`,
        });
      }
    }
  }

  private verifySnapshot(
    snapshot: OpdReusableDraftSnapshotRecord,
  ): CanonicalOpdDraftSnapshot {
    const canonical = verifyOpdDraftSnapshot(
      snapshot.schema_version,
      snapshot.copyable_content,
      snapshot.content_sha256,
    );
    const storedSections = parseAvailableSnapshotSections(
      snapshot.available_sections,
    );
    if (
      stableJson(storedSections) !== stableJson(canonical.availableSections)
    ) {
      this.throwConflict(
        "SOURCE_NOT_REUSABLE",
        "Draft snapshot section manifest does not match its content",
      );
    }
    return canonical;
  }

  private async replayImport(
    claim: api_idempotency,
    requestHash: string,
    targetEncounterId: string,
    scope: RequestScope,
  ): Promise<OpdDraftImportView> {
    if (claim.request_hash !== requestHash) {
      this.throwConflict(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used with a different draft import request",
      );
    }
    if (claim.state !== "COMPLETED") {
      this.throwConflict(
        "IDEMPOTENCY_IN_PROGRESS",
        "The draft import request is already in progress",
      );
    }
    const imported = claim.resource_id
      ? await this.repository.findImportById(
          targetEncounterId,
          claim.resource_id,
          scope,
        )
      : null;
    if (!imported) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The committed draft import result cannot be replayed",
      );
    }
    return this.toImportView(imported, scope);
  }

  private async replayCheckpoint(
    claim: api_idempotency,
    requestHash: string,
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdDraftCheckpointView> {
    if (claim.request_hash !== requestHash) {
      this.throwConflict(
        "IDEMPOTENCY_KEY_REUSED",
        "Idempotency-Key was already used with a different draft checkpoint request",
      );
    }
    if (claim.state !== "COMPLETED") {
      this.throwConflict(
        "IDEMPOTENCY_IN_PROGRESS",
        "The draft checkpoint request is already in progress",
      );
    }
    const snapshot = claim.resource_id
      ? await this.repository.findCheckpointSnapshot(
          claim.resource_id,
          encounterId,
          scope,
        )
      : null;
    if (!snapshot) {
      this.throwConflict(
        "IDEMPOTENCY_RESULT_UNAVAILABLE",
        "The committed draft checkpoint result cannot be replayed",
      );
    }
    const canonical = this.verifySnapshot(snapshot);
    return {
      draftCheckpointId: snapshot.draft_checkpoint_id,
      encounterId: snapshot.source_encounter_id,
      checkpointNumber: snapshot.draft_checkpoint.checkpoint_number,
      resourceVersions: this.jsonRecord(
        snapshot.draft_checkpoint.resource_versions,
      ),
      note: snapshot.draft_checkpoint.note,
      actorUserId: snapshot.draft_checkpoint.actor_user_id,
      createdAt: snapshot.draft_checkpoint.created_at.toISOString(),
      draftSnapshotId: snapshot.draft_snapshot_id,
      snapshotSchemaVersion: OPD_DRAFT_SNAPSHOT_SCHEMA,
      snapshotContentSha256: canonical.contentSha256,
      availableSections: canonical.availableSections,
      isReusable: canonical.availableSections.length > 0,
    };
  }

  private assertDraftExpectedVersions(
    expected: OpdDraftExpectedVersionsDto,
    encounter: opd_encounter,
    current: DraftResourceVersionState,
  ): void {
    if (
      expected.encounter.id !== encounter.encounter_id ||
      expected.encounter.version !== encounter.version
    ) {
      throw new VersionConflictException({
        resourceType: "OPD_ENCOUNTER",
        resourceId: encounter.encounter_id,
        currentVersion: encounter.version,
        currentStatus: encounter.clinical_record_status,
        updatedAt: encounter.updated_at.toISOString(),
      });
    }
    this.assertExpectedDraftResource(
      "OPD_EXAMINATION",
      expected.examination,
      current.examination,
    );
    this.assertExpectedDraftResource(
      "OPD_VITAL_OBSERVATION",
      expected.vitals,
      current.vitals,
    );
    this.assertExpectedDraftResource(
      "OPD_INTAKE",
      expected.intake,
      current.intake,
    );
    this.assertExpectedDraftResource(
      "OPD_SYMPTOM_SECTION",
      expected.symptoms,
      current.symptoms,
    );
    this.assertExpectedDraftResource(
      "OPD_DIAGNOSIS_SECTION",
      expected.diagnoses,
      current.diagnoses,
    );
    this.assertExpectedDraftResource(
      "OPD_ORDER",
      expected.order,
      current.order,
    );
    this.assertExpectedDraftResource(
      "OPD_NOTE_WORKSPACE",
      expected.noteWorkspace,
      current.noteWorkspace,
    );
    this.assertExpectedNoteSections(
      expected.noteSections,
      current.noteSections,
    );
  }

  private assertExpectedNoteSections(
    expected: OpdExpectedNoteSectionVersionDto[],
    current: DraftNoteSectionVersion[],
  ): void {
    if (expected.length !== current.length) {
      const changed = current.find(
        (section) =>
          !expected.some(
            (candidate) => candidate.sectionCode === section.sectionCode,
          ),
      );
      if (changed) this.throwDraftNoteSectionConflict(changed);
      throw new ConflictException({
        code: "TARGET_VERSION_STALE",
        message:
          "The clinical note section set changed after this draft was loaded",
      });
    }
    for (const section of current) {
      const candidate = expected.find(
        (item) => item.sectionCode === section.sectionCode,
      );
      if (
        !candidate ||
        candidate.id !== section.id ||
        candidate.version !== section.version
      ) {
        this.throwDraftNoteSectionConflict(section);
      }
    }
  }

  private assertExpectedDraftResource(
    resourceType: string,
    expected: { id: string; version: number } | undefined,
    current: DraftResourceVersion | null,
  ): void {
    if (!current && !expected) return;
    if (!current) {
      this.throwConflict(
        "TARGET_VERSION_STALE",
        `${resourceType} is no longer part of the current OPD draft`,
      );
    }
    if (
      !expected ||
      expected.id !== current.id ||
      expected.version !== current.version
    ) {
      throw new VersionConflictException({
        resourceType,
        resourceId: current.id,
        currentVersion: current.version,
        currentStatus: current.status,
        updatedAt: current.updatedAt.toISOString(),
      });
    }
  }

  private throwDraftNoteSectionConflict(
    section: DraftNoteSectionVersion,
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_NOTE_SECTION",
      resourceId: section.id,
      currentVersion: section.version,
      currentStatus: section.status,
      updatedAt: section.updatedAt.toISOString(),
    });
  }

  private async toImportView(
    imported: OpdDraftImportRecord,
    scope: RequestScope,
    client?: Prisma.TransactionClient,
  ): Promise<OpdDraftImportView> {
    const sections: OpdDraftImportedSectionView[] = [];
    for (const section of imported.sections) {
      const current = await this.repository.currentImportedResourceVersion(
        section,
        scope,
        client,
      );
      const reviewIsCurrent =
        current !== null &&
        section.review_status === "REVIEWED" &&
        section.reviewed_target_version === current.version;
      sections.push(
        this.toImportedSectionView(
          section,
          current?.version ?? section.target_resource_version,
          reviewIsCurrent,
        ),
      );
    }
    const selectedSections = parseAvailableSnapshotSections(
      imported.selected_sections,
    );
    return {
      draftImportId: imported.draft_import_id,
      targetEncounterId: imported.target_encounter_id,
      sourceSnapshotId: imported.source_snapshot_id,
      sourceCheckpointId: imported.source_checkpoint_id,
      sourceEncounterId: imported.source_encounter_id,
      selectedSections,
      targetBeforeManifest: this.jsonRecord(imported.target_before_manifest),
      targetAfterManifest: this.jsonRecord(imported.target_after_manifest),
      sections,
      importedByUserId: imported.imported_by_user_id,
      importedAt: imported.imported_at.toISOString(),
      allSectionsReviewed:
        sections.length > 0 &&
        sections.every((section) => section.reviewIsCurrent),
    };
  }

  private toImportedSectionView(
    section: opd_draft_import_section,
    currentVersion: number,
    reviewIsCurrent: boolean,
  ): OpdDraftImportedSectionView {
    const sectionCode = this.parseSectionCode(section.section_code);
    return {
      sectionCode,
      targetResourceType: section.target_resource_type,
      targetResourceId: section.target_resource_id,
      targetResourceVersion: currentVersion,
      reviewStatus: reviewIsCurrent ? "REVIEWED" : "REVIEW_REQUIRED",
      reviewedTargetVersion: section.reviewed_target_version,
      reviewIsCurrent,
      reviewedByUserId: section.reviewed_by_user_id,
      reviewedAt: section.reviewed_at?.toISOString() ?? null,
    };
  }

  private toListItem(
    item: ReusableDraftListRow,
    author: OpdDraftAuthorRecord | undefined,
  ): ReusableOpdDraftListItemView {
    return {
      draftSnapshotId: item.draftSnapshotId,
      draftCheckpointId: item.draftCheckpointId,
      sourceEncounterId: item.sourceEncounterId,
      sourceVisitAt: item.sourceVisitAt.toISOString(),
      capturedAt: item.capturedAt.toISOString(),
      checkpointNumber: item.checkpointNumber,
      note: item.note,
      author: {
        userId: item.capturedByUserId,
        displayName: this.authorDisplayName(author, item.capturedByUserId),
      },
      availableSections: parseAvailableSnapshotSections(item.availableSections),
      canPreview: true,
    };
  }

  private toSnapshotListItem(
    snapshot: OpdReusableDraftSnapshotRecord,
    author: OpdDraftAuthorRecord | undefined,
    sections: OpdDraftCopySectionCode[],
  ): ReusableOpdDraftListItemView {
    return {
      draftSnapshotId: snapshot.draft_snapshot_id,
      draftCheckpointId: snapshot.draft_checkpoint_id,
      sourceEncounterId: snapshot.source_encounter_id,
      sourceVisitAt: snapshot.source_encounter.started_at.toISOString(),
      capturedAt: snapshot.captured_at.toISOString(),
      checkpointNumber: snapshot.draft_checkpoint.checkpoint_number,
      note: snapshot.draft_checkpoint.note,
      author: {
        userId: snapshot.captured_by_user_id,
        displayName: this.authorDisplayName(
          author,
          snapshot.captured_by_user_id,
        ),
      },
      availableSections: sections,
      canPreview: true,
    };
  }

  private async authorMap(
    userIds: string[],
    scope: RequestScope,
  ): Promise<Map<string, OpdDraftAuthorRecord>> {
    const uniqueIds = [...new Set(userIds)];
    const authors = await this.repository.usersByIds(uniqueIds, scope);
    return new Map(authors.map((author) => [author.user_id, author]));
  }

  private authorDisplayName(
    author: OpdDraftAuthorRecord | undefined,
    fallbackUserId: string,
  ): string {
    const fullName = [author?.name, author?.lastname]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" ")
      .trim();
    return (
      fullName || author?.nickname?.trim() || author?.email || fallbackUserId
    );
  }

  private async requireEditableTarget(
    targetEncounterId: string,
    scope: RequestScope,
  ): Promise<opd_encounter> {
    const target = await this.repository.findEncounter(
      targetEncounterId,
      scope,
    );
    if (!target) this.throwTargetNotFound();
    this.assertEditableTarget(target);
    return target;
  }

  private assertEditableTarget(target: opd_encounter): void {
    if (
      target.workflow_status !== "OPEN" ||
      target.clinical_record_status !== "DRAFT"
    ) {
      this.throwConflict(
        "TARGET_NOT_OPEN_DRAFT",
        "Reusable drafts require an open draft target encounter",
      );
    }
  }

  private validateExpectedNoteVersions(values: Record<string, number>): void {
    const allowed = new Set<string>(Object.values(OpdNoteSectionCode));
    for (const [code, version] of Object.entries(values)) {
      if (!allowed.has(code) || !Number.isInteger(version) || version < 0) {
        throw new BadRequestException({
          code: "COPY_SECTION_NOT_ALLOWED",
          message: "expectedTargetVersions.noteSections is invalid",
        });
      }
    }
  }

  private parseSectionCode(value: string): OpdDraftCopySectionCode {
    const match = Object.values(OpdDraftCopySectionCode).find(
      (candidate) => candidate === value,
    );
    if (!match) throw new Error(`Unsupported stored copied section ${value}`);
    return match;
  }

  private parseNoteSectionCode(value: string): OpdNoteSectionCode {
    const match = Object.values(OpdNoteSectionCode).find(
      (candidate) => candidate === value,
    );
    if (!match) throw new Error(`Unsupported stored note section ${value}`);
    return match;
  }

  private jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (value === null || Array.isArray(value) || typeof value !== "object") {
      throw new Error("Stored draft manifest is not an object");
    }
    return value;
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

  private nullableText(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    return normalized.length > 0 ? normalized : null;
  }

  private actorRole(scope: RequestScope): string | undefined {
    return (
      scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined)
    );
  }

  private throwTargetSectionNotEmpty(
    sectionCode: OpdDraftCopySectionCode,
  ): never {
    this.throwConflict(
      "TARGET_SECTION_NOT_EMPTY",
      `Target section ${sectionCode} already contains persisted content`,
      { sectionCode },
    );
  }

  private throwTargetVersionStale(): never {
    this.throwConflict(
      "TARGET_VERSION_STALE",
      "The target draft changed after the reusable-draft modal was loaded",
    );
  }

  private throwConflict(
    code: string,
    message: string,
    details?: Prisma.JsonObject,
  ): never {
    throw new ConflictException({
      code,
      message,
      ...(details ? { details } : {}),
    });
  }

  private throwTargetNotFound(): never {
    throw new NotFoundException({
      code: "TARGET_NOT_FOUND",
      message: "OPD target encounter was not found in the active scope",
    });
  }

  private throwSourceNotFound(): never {
    throw new NotFoundException({
      code: "SOURCE_CUSTOMER_MISMATCH",
      message:
        "Reusable draft snapshot was not found for this customer and scope",
    });
  }

  private throwImportSectionNotFound(): never {
    throw new NotFoundException(
      "Copied OPD draft section was not found in the active target scope",
    );
  }
}
