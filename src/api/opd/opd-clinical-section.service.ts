import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { auditReferenceType, type opd_encounter } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type {
  CreateOpdDraftCheckpointDto,
  OpdDraftExpectedVersionsDto,
  OpdExpectedNoteSectionVersionDto,
  PatchOpdDiagnosisSectionDto,
  PatchOpdSymptomSectionDto,
} from "./dto/opd-clinical-section.dto";
import {
  CreateOpdDiagnosisSectionResult,
  CreateOpdSymptomSectionResult,
  OpdDiagnosisSectionResult,
  OpdDiagnosisSectionView,
  OpdDraftCheckpointView,
  OpdSymptomSectionResult,
  OpdSymptomSectionView,
  toOpdDiagnosisSectionView,
  toOpdSymptomSectionView,
} from "./opd-clinical-section.mapper";
import {
  type DraftNoteSectionVersion,
  type DraftResourceVersion,
  type DraftResourceVersionState,
  OpdClinicalSectionRepository,
} from "./opd-clinical-section.repository";
import { OpdClinicalRepository } from "./opd-clinical.repository";

@Injectable()
export class OpdClinicalSectionService {
  constructor(
    private readonly repository: OpdClinicalSectionRepository,
    private readonly clinicalRepository: OpdClinicalRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async symptomSection(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
  ): Promise<OpdSymptomSectionResult> {
    const examination = await this.clinicalRepository.findExamination(
      encounterId,
      examinationId,
      scope,
    );
    if (!examination) this.throwExaminationNotFound();
    const section = await this.repository.findSymptomSection(
      encounterId,
      examinationId,
      scope,
    );
    return { section: section ? toOpdSymptomSectionView(section) : null };
  }

  async createSymptomSection(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
    principal: Principal,
  ): Promise<CreateOpdSymptomSectionResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.clinicalRepository.lockExamination(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!locked) this.throwExaminationNotFound();
      const encounter = await this.clinicalRepository.findEncounter(
        encounterId,
        scope,
        tx,
      );
      if (!encounter) this.throwEncounterNotFound();
      this.assertEncounterEditable(encounter);
      const examination = await this.clinicalRepository.findExamination(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!examination) this.throwExaminationNotFound();
      this.assertExaminationDraft(examination.status);

      const existing = await this.repository.findSymptomSection(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (existing) {
        return { section: toOpdSymptomSectionView(existing), resumed: true };
      }

      const created = await this.repository.createSymptomSection(
        encounterId,
        examinationId,
        scope,
        new Date(),
        tx,
      );
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "symptoms.create",
          actionLabel: "Create OPD symptom section draft",
          toStatus: "DRAFT",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            examinationId,
            symptomSectionId: created.symptom_section_id,
            version: created.version,
          },
        },
        tx,
      );
      return { section: toOpdSymptomSectionView(created), resumed: false };
    });
  }

  async patchSymptoms(
    encounterId: string,
    examinationId: string,
    dto: PatchOpdSymptomSectionDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdSymptomSectionView> {
    this.validateSymptoms(dto);
    return this.prisma.$transaction(async (tx) => {
      const locked = await this.clinicalRepository.lockExamination(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!locked) this.throwExaminationNotFound();
      const encounter = await this.clinicalRepository.findEncounter(
        encounterId,
        scope,
        tx,
      );
      if (!encounter) this.throwEncounterNotFound();
      this.assertEncounterEditable(encounter);
      const examination = await this.clinicalRepository.findExamination(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!examination) this.throwExaminationNotFound();
      this.assertExaminationDraft(examination.status);
      const section = await this.repository.findSymptomSection(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!section) this.throwSymptomSectionNotFound();
      if (section.version !== dto.expectedVersion) {
        this.throwSymptomConflict(section);
      }

      const now = new Date();
      const updated = await this.repository.replaceSymptoms(
        section,
        dto.expectedVersion,
        this.nullableText(dto.patientQuote),
        dto.items,
        scope,
        now,
        tx,
      );
      if (!updated) {
        const current = await this.repository.findSymptomSection(
          encounterId,
          examinationId,
          scope,
          tx,
        );
        if (current) this.throwSymptomConflict(current);
        this.throwSymptomSectionNotFound();
      }
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "symptoms.update",
          actionLabel: "Update OPD symptom section draft",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            examinationId,
            symptomSectionId: section.symptom_section_id,
            symptomCount: dto.items.length,
            previousVersion: dto.expectedVersion,
            resultVersion: dto.expectedVersion + 1,
          },
        },
        tx,
      );
      const reloaded = await this.repository.findSymptomSection(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!reloaded)
        throw new Error("Updated symptom section could not be reloaded");
      return toOpdSymptomSectionView(reloaded);
    });
  }

  async diagnosisSection(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdDiagnosisSectionResult> {
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
    );
    if (!encounter) this.throwEncounterNotFound();
    const section = await this.repository.findDiagnosisSection(
      encounterId,
      scope,
    );
    return { section: section ? toOpdDiagnosisSectionView(section) : null };
  }

  async createDiagnosisSection(
    encounterId: string,
    scope: RequestScope,
    principal: Principal,
  ): Promise<CreateOpdDiagnosisSectionResult> {
    return this.prisma.$transaction(async (tx) => {
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
      const existing = await this.repository.findDiagnosisSection(
        encounterId,
        scope,
        tx,
      );
      if (existing) {
        return { section: toOpdDiagnosisSectionView(existing), resumed: true };
      }

      const created = await this.repository.createDiagnosisSection(
        encounterId,
        scope,
        new Date(),
        tx,
      );
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "diagnoses.create",
          actionLabel: "Create OPD diagnosis section draft",
          toStatus: "DRAFT",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            diagnosisSectionId: created.diagnosis_section_id,
            version: created.version,
          },
        },
        tx,
      );
      return { section: toOpdDiagnosisSectionView(created), resumed: false };
    });
  }

  async patchDiagnoses(
    encounterId: string,
    dto: PatchOpdDiagnosisSectionDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdDiagnosisSectionView> {
    this.validateDiagnoses(dto);
    return this.prisma.$transaction(async (tx) => {
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
      const section = await this.repository.findDiagnosisSection(
        encounterId,
        scope,
        tx,
      );
      if (!section) this.throwDiagnosisSectionNotFound();
      if (section.status !== "DRAFT") {
        throw new ConflictException(
          "Finalized, corrected, or void diagnosis sections are immutable",
        );
      }
      if (section.version !== dto.expectedVersion) {
        this.throwDiagnosisConflict(section);
      }

      const now = new Date();
      const updated = await this.repository.replaceDiagnoses(
        section,
        dto.expectedVersion,
        dto.items,
        scope,
        now,
        tx,
      );
      if (!updated) {
        const current = await this.repository.findDiagnosisSection(
          encounterId,
          scope,
          tx,
        );
        if (current) this.throwDiagnosisConflict(current);
        this.throwDiagnosisSectionNotFound();
      }
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "diagnoses.update",
          actionLabel: "Update OPD diagnosis section draft",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            diagnosisSectionId: section.diagnosis_section_id,
            diagnosisCount: dto.items.length,
            previousVersion: dto.expectedVersion,
            resultVersion: dto.expectedVersion + 1,
          },
        },
        tx,
      );
      const reloaded = await this.repository.findDiagnosisSection(
        encounterId,
        scope,
        tx,
      );
      if (!reloaded)
        throw new Error("Updated diagnosis section could not be reloaded");
      return toOpdDiagnosisSectionView(reloaded);
    });
  }

  async createDraftCheckpoint(
    encounterId: string,
    dto: CreateOpdDraftCheckpointDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdDraftCheckpointView> {
    return this.prisma.$transaction(async (tx) => {
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

      const checkpointNumber = await this.repository.nextCheckpointNumber(
        encounterId,
        scope,
        tx,
      );
      const resourceState = await this.repository.buildResourceVersionManifest(
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
      const now = new Date();
      const created = await this.repository.createDraftCheckpoint(
        encounterId,
        checkpointNumber,
        resourceState.manifest,
        this.nullableText(dto.note),
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
          actionLabel: "Save OPD draft checkpoint",
          fromStatus: encounter.clinical_record_status,
          toStatus: encounter.clinical_record_status,
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: { checkpointNumber },
        },
        tx,
      );

      return {
        draftCheckpointId: created.draft_checkpoint_id,
        encounterId: created.encounter_id,
        checkpointNumber: created.checkpoint_number,
        resourceVersions: resourceState.manifest,
        note: created.note,
        actorUserId: created.actor_user_id,
        createdAt: created.created_at.toISOString(),
      };
    });
  }

  private validateSymptoms(dto: PatchOpdSymptomSectionDto): void {
    for (const item of dto.items) {
      if (!item.mainText.trim()) {
        throw new BadRequestException("Every symptom requires a main symptom");
      }
      if (item.durationValue !== null && item.durationValue !== undefined) {
        if (!item.durationUnit?.trim()) {
          throw new BadRequestException(
            "A symptom duration unit is required when duration is supplied",
          );
        }
      }
      if (item.associations.some((association) => !association.label.trim())) {
        throw new BadRequestException(
          "Associated symptom labels cannot be blank",
        );
      }
    }
  }

  private validateDiagnoses(dto: PatchOpdDiagnosisSectionDto): void {
    const primaryCount = dto.items.filter((item) => item.isPrimary).length;
    if (dto.items.length > 0 && primaryCount !== 1) {
      throw new BadRequestException(
        "Exactly one primary diagnosis is required when diagnoses are recorded",
      );
    }
    if (
      dto.items.some((item) => !item.codeSystem.trim() || !item.label.trim())
    ) {
      throw new BadRequestException(
        "Diagnosis code system and label cannot be blank",
      );
    }
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
      throw new ConflictException(
        "The clinical note section set changed after this draft was loaded",
      );
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

  private assertExpectedDraftResource(
    resourceType: string,
    expected: { id: string; version: number } | undefined,
    current: DraftResourceVersion | null,
  ): void {
    if (!current && !expected) return;
    if (!current) {
      throw new ConflictException(
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

  private assertEncounterEditable(encounter: opd_encounter): void {
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      throw new ConflictException(
        "Clinical sections can only be edited on an open draft encounter",
      );
    }
  }

  private assertExaminationDraft(status: string): void {
    if (status !== "DRAFT") {
      throw new ConflictException(
        "Finalized, corrected, or void examinations are immutable",
      );
    }
  }

  private throwSymptomConflict(section: {
    symptom_section_id: string;
    version: number;
    updated_at: Date;
  }): never {
    throw new VersionConflictException({
      resourceType: "OPD_SYMPTOM_SECTION",
      resourceId: section.symptom_section_id,
      currentVersion: section.version,
      currentStatus: "DRAFT",
      updatedAt: section.updated_at.toISOString(),
    });
  }

  private throwDiagnosisConflict(section: {
    diagnosis_section_id: string;
    version: number;
    status: string;
    updated_at: Date;
  }): never {
    throw new VersionConflictException({
      resourceType: "OPD_DIAGNOSIS_SECTION",
      resourceId: section.diagnosis_section_id,
      currentVersion: section.version,
      currentStatus: section.status,
      updatedAt: section.updated_at.toISOString(),
    });
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

  private throwSymptomSectionNotFound(): never {
    throw new NotFoundException(
      "OPD symptom section not found for this examination and scope",
    );
  }

  private throwDiagnosisSectionNotFound(): never {
    throw new NotFoundException(
      "OPD diagnosis section not found for this encounter and scope",
    );
  }
}
