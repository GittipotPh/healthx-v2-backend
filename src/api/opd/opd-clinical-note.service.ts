import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Prisma,
  auditReferenceType,
  type opd_encounter,
  type opd_note_section,
  type opd_note_workspace,
} from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  OpdNoteRecordMode,
  OpdNoteSectionCode,
  type PatchOpdNoteModeDto,
  type PatchOpdNoteSectionDto,
} from "./dto/opd-clinical-note.dto";
import {
  OpdNoteSectionView,
  OpdNoteWorkspaceView,
  toOpdNoteSectionView,
  toOpdNoteWorkspaceView,
} from "./opd-clinical-note.mapper";
import { OpdClinicalNoteRepository } from "./opd-clinical-note.repository";
import { normalizeClinicalRichText } from "./opd-clinical-note.rich-text";
import { OpdClinicalRepository } from "./opd-clinical.repository";

@Injectable()
export class OpdClinicalNoteService {
  constructor(
    private readonly repository: OpdClinicalNoteRepository,
    private readonly clinicalRepository: OpdClinicalRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async workspace(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdNoteWorkspaceView> {
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
    );
    if (!encounter) this.throwEncounterNotFound();
    return toOpdNoteWorkspaceView(
      await this.repository.findWorkspace(encounterId, scope),
    );
  }

  async section(
    encounterId: string,
    sectionCode: OpdNoteSectionCode,
    scope: RequestScope,
  ): Promise<OpdNoteSectionView> {
    const encounter = await this.clinicalRepository.findEncounter(
      encounterId,
      scope,
    );
    if (!encounter) this.throwEncounterNotFound();
    const section = await this.repository.findSection(
      encounterId,
      sectionCode,
      scope,
    );
    return toOpdNoteSectionView(section, sectionCode);
  }

  async patchMode(
    encounterId: string,
    dto: PatchOpdNoteModeDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdNoteWorkspaceView> {
    return this.prisma.$transaction(async (tx) => {
      const encounter = await this.lockEditableEncounter(
        encounterId,
        scope,
        tx,
      );
      const existing = await this.repository.findWorkspace(
        encounterId,
        scope,
        tx,
      );
      const now = new Date();

      if (!existing) {
        if (dto.expectedVersion !== 0) {
          this.throwWorkspaceConflict(encounterId, null);
        }
        const created = await this.repository.createWorkspace(
          encounterId,
          dto.selectedMode,
          scope,
          now,
          tx,
        );
        await this.auditMode(
          encounter,
          scope,
          principal,
          null,
          created,
          "note.workspace.create",
          tx,
        );
      } else {
        if (existing.version !== dto.expectedVersion) {
          this.throwWorkspaceConflict(encounterId, existing);
        }
        if (existing.selected_mode === dto.selectedMode) {
          return toOpdNoteWorkspaceView(existing);
        }
        const updated = await this.repository.updateMode(
          existing.note_workspace_id,
          encounterId,
          dto.expectedVersion,
          dto.selectedMode,
          scope,
          now,
          tx,
        );
        if (!updated) {
          this.throwWorkspaceConflict(
            encounterId,
            await this.repository.findWorkspace(encounterId, scope, tx),
          );
        }
        const reloaded = await this.repository.findWorkspace(
          encounterId,
          scope,
          tx,
        );
        if (!reloaded) {
          throw new Error("Updated OPD note workspace could not be reloaded");
        }
        await this.auditMode(
          encounter,
          scope,
          principal,
          existing,
          reloaded,
          "note.workspace.mode.update",
          tx,
        );
      }

      const workspace = await this.repository.findWorkspace(
        encounterId,
        scope,
        tx,
      );
      if (!workspace) {
        throw new Error("OPD note workspace could not be reloaded");
      }
      return toOpdNoteWorkspaceView(workspace);
    });
  }

  async patchSection(
    encounterId: string,
    sectionCode: OpdNoteSectionCode,
    dto: PatchOpdNoteSectionDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdNoteSectionView> {
    const normalized = normalizeClinicalRichText(dto.content);
    return this.prisma.$transaction(async (tx) => {
      const encounter = await this.lockEditableEncounter(
        encounterId,
        scope,
        tx,
      );
      const now = new Date();
      let workspace = await this.repository.findWorkspace(
        encounterId,
        scope,
        tx,
      );
      let workspaceCreated = false;
      if (!workspace) {
        await this.repository.createWorkspace(
          encounterId,
          sectionCode === OpdNoteSectionCode.FREE_NOTE
            ? OpdNoteRecordMode.FREE
            : OpdNoteRecordMode.FORM,
          scope,
          now,
          tx,
        );
        workspace = await this.repository.findWorkspace(encounterId, scope, tx);
        workspaceCreated = true;
      }
      if (!workspace) {
        throw new Error("Created OPD note workspace could not be reloaded");
      }

      const existing = await this.repository.findSection(
        encounterId,
        sectionCode,
        scope,
        tx,
      );
      let result: opd_note_section;
      let action: string;
      if (!existing) {
        if (dto.expectedVersion !== 0) {
          this.throwSectionConflict(encounterId, sectionCode, null);
        }
        result = await this.repository.createSection(
          workspace.note_workspace_id,
          encounterId,
          sectionCode,
          normalized.content,
          normalized.plainText,
          scope,
          now,
          tx,
        );
        action = "note.section.create";
      } else {
        this.assertSectionDraft(existing);
        if (existing.version !== dto.expectedVersion) {
          this.throwSectionConflict(encounterId, sectionCode, existing);
        }
        const updated = await this.repository.updateSection(
          existing,
          dto.expectedVersion,
          normalized.content,
          normalized.plainText,
          scope,
          now,
          tx,
        );
        if (!updated) {
          this.throwSectionConflict(
            encounterId,
            sectionCode,
            await this.repository.findSection(
              encounterId,
              sectionCode,
              scope,
              tx,
            ),
          );
        }
        const reloaded = await this.repository.findSection(
          encounterId,
          sectionCode,
          scope,
          tx,
        );
        if (!reloaded) {
          throw new Error("Updated OPD note section could not be reloaded");
        }
        result = reloaded;
        action = "note.section.update";
      }

      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action,
          actionLabel:
            action === "note.section.create"
              ? "Create OPD clinical note section draft"
              : "Update OPD clinical note section draft",
          fromStatus: "DRAFT",
          toStatus: "DRAFT",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            noteWorkspaceId: workspace.note_workspace_id,
            noteSectionId: result.note_section_id,
            sectionCode,
            previousVersion: dto.expectedVersion,
            resultVersion: result.version,
            plainTextLength: normalized.plainText.length,
            workspaceCreated,
          },
        },
        tx,
      );
      return toOpdNoteSectionView(result, sectionCode);
    });
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

  private async auditMode(
    encounter: opd_encounter,
    scope: RequestScope,
    principal: Principal,
    previous: opd_note_workspace | null,
    result: opd_note_workspace,
    action: string,
    tx: Prisma.TransactionClient,
  ): Promise<void> {
    await this.auditLogService.create(
      {
        clinicId: result.clinic_id,
        branchId: result.branch_id,
        referenceType: auditReferenceType.OPD,
        referenceId: encounter.encounter_id,
        action,
        actionLabel:
          action === "note.workspace.create"
            ? "Create OPD clinical note workspace"
            : "Change OPD clinical note display mode",
        actorUserId: result.updated_by,
        actorName: principal.name,
        actorRole: this.actorRole(scope),
        metadata: {
          noteWorkspaceId: result.note_workspace_id,
          previousMode: previous?.selected_mode ?? null,
          selectedMode: result.selected_mode,
          previousVersion: previous?.version ?? 0,
          resultVersion: result.version,
        },
      },
      tx,
    );
  }

  private assertEncounterEditable(encounter: opd_encounter): void {
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      throw new ConflictException(
        "Clinical notes can only be edited on an open draft encounter",
      );
    }
  }

  private assertSectionDraft(section: opd_note_section): void {
    if (section.status !== "DRAFT") {
      throw new ConflictException(
        "Finalized, corrected, or void clinical note sections are immutable",
      );
    }
  }

  private throwWorkspaceConflict(
    encounterId: string,
    workspace: opd_note_workspace | null,
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_NOTE_WORKSPACE",
      resourceId: workspace?.note_workspace_id ?? encounterId,
      currentVersion: workspace?.version ?? 0,
      currentStatus: "DRAFT",
      updatedAt: workspace?.updated_at.toISOString(),
    });
  }

  private throwSectionConflict(
    encounterId: string,
    sectionCode: OpdNoteSectionCode,
    section: opd_note_section | null,
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_NOTE_SECTION",
      resourceId: section?.note_section_id ?? `${encounterId}:${sectionCode}`,
      currentVersion: section?.version ?? 0,
      currentStatus: section?.status ?? "DRAFT",
      updatedAt: section?.updated_at.toISOString(),
    });
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
}
