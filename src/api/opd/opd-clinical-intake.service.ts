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
import {
  OpdBowelStatus,
  OpdUrinaryStatus,
  type PatchOpdIntakeDto,
} from "./dto/opd-intake.dto";
import { OpdIntakeView, toOpdIntakeView } from "./opd-clinical-intake.mapper";
import {
  OpdClinicalIntakeRepository,
  type OpdIntakeWriteData,
} from "./opd-clinical-intake.repository";
import { OpdClinicalRepository } from "./opd-clinical.repository";

@Injectable()
export class OpdClinicalIntakeService {
  constructor(
    private readonly repository: OpdClinicalIntakeRepository,
    private readonly clinicalRepository: OpdClinicalRepository,
    private readonly prisma: PrismaService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async intake(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
  ): Promise<OpdIntakeView> {
    const examination = await this.clinicalRepository.findExamination(
      encounterId,
      examinationId,
      scope,
    );
    if (!examination) this.throwExaminationNotFound();
    const intake = await this.repository.findIntake(
      encounterId,
      examinationId,
      scope,
    );
    return toOpdIntakeView(intake, examinationId);
  }

  async patchIntake(
    encounterId: string,
    examinationId: string,
    dto: PatchOpdIntakeDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<OpdIntakeView> {
    const data = this.normalize(dto);
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
      if (examination.status !== "DRAFT") {
        throw new ConflictException(
          "Finalized, corrected, or void examinations are immutable",
        );
      }

      const current = await this.repository.findIntake(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      const now = new Date();
      let resultVersion: number;
      let intakeId: string;
      let changedFields: string[];

      if (dto.expectedVersion === 0) {
        if (current) this.throwVersionConflict(current, examination.status);
        const created = await this.repository.createIntake(
          encounterId,
          examinationId,
          data,
          scope,
          now,
          tx,
        );
        resultVersion = created.version;
        intakeId = created.intake_id;
        changedFields = [
          "urinaryStatus",
          "urinaryOtherText",
          "bowelStatus",
          "bowelOtherText",
        ];
      } else {
        if (!current) {
          throw new VersionConflictException({
            resourceType: "OPD_INTAKE",
            resourceId: examinationId,
            currentVersion: 0,
            currentStatus: examination.status,
            updatedAt: examination.updated_at.toISOString(),
          });
        }
        if (current.version !== dto.expectedVersion) {
          this.throwVersionConflict(current, examination.status);
        }
        changedFields = this.changedFields(current, data);
        const updatedCount = await this.repository.updateIntake(
          current.intake_id,
          encounterId,
          examinationId,
          dto.expectedVersion,
          data,
          scope,
          now,
          tx,
        );
        if (updatedCount !== 1) {
          const latest = await this.repository.findIntake(
            encounterId,
            examinationId,
            scope,
            tx,
          );
          if (latest) this.throwVersionConflict(latest, examination.status);
          throw new ConflictException(
            "The intake resource changed after it was loaded",
          );
        }
        resultVersion = dto.expectedVersion + 1;
        intakeId = current.intake_id;
      }

      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.OPD,
          referenceId: encounterId,
          action: "intake.update",
          actionLabel: "Update OPD urinary and bowel intake draft",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole: this.actorRole(scope),
          metadata: {
            examinationId,
            intakeId,
            changedFields,
            previousVersion: dto.expectedVersion,
            resultVersion,
          },
        },
        tx,
      );

      const updated = await this.repository.findIntake(
        encounterId,
        examinationId,
        scope,
        tx,
      );
      if (!updated) throw new Error("Updated OPD intake could not be reloaded");
      return toOpdIntakeView(updated, examinationId);
    });
  }

  private normalize(dto: PatchOpdIntakeDto): OpdIntakeWriteData {
    return {
      urinaryStatus: dto.urinaryStatus,
      urinaryOtherText: this.otherText(
        dto.urinaryStatus === OpdUrinaryStatus.OTHER,
        dto.urinaryOtherText,
        "Urinary",
      ),
      bowelStatus: dto.bowelStatus,
      bowelOtherText: this.otherText(
        dto.bowelStatus === OpdBowelStatus.OTHER,
        dto.bowelOtherText,
        "Bowel",
      ),
    };
  }

  private otherText(
    required: boolean,
    value: string | null | undefined,
    label: string,
  ): string | null {
    const normalized = value?.trim() || null;
    if (required && !normalized) {
      throw new BadRequestException(
        `${label} other text is required when status is OTHER`,
      );
    }
    if (!required && normalized) {
      throw new BadRequestException(
        `${label} other text is only allowed when status is OTHER`,
      );
    }
    return required ? normalized : null;
  }

  private changedFields(
    current: {
      urinary_status: string;
      urinary_other_text: string | null;
      bowel_status: string;
      bowel_other_text: string | null;
    },
    data: OpdIntakeWriteData,
  ): string[] {
    const changed: string[] = [];
    if (current.urinary_status !== data.urinaryStatus)
      changed.push("urinaryStatus");
    if (current.urinary_other_text !== data.urinaryOtherText)
      changed.push("urinaryOtherText");
    if (current.bowel_status !== data.bowelStatus) changed.push("bowelStatus");
    if (current.bowel_other_text !== data.bowelOtherText)
      changed.push("bowelOtherText");
    return changed;
  }

  private throwVersionConflict(
    intake: {
      intake_id: string;
      version: number;
      updated_at: Date;
    },
    currentStatus: string,
  ): never {
    throw new VersionConflictException({
      resourceType: "OPD_INTAKE",
      resourceId: intake.intake_id,
      currentVersion: intake.version,
      currentStatus,
      updatedAt: intake.updated_at.toISOString(),
    });
  }

  private assertEncounterEditable(encounter: opd_encounter): void {
    if (
      encounter.workflow_status !== "OPEN" ||
      encounter.clinical_record_status !== "DRAFT"
    ) {
      throw new ConflictException(
        "Clinical intake can only be edited on an open draft encounter",
      );
    }
  }

  private actorRole(scope: RequestScope): string | undefined {
    return scope.roles[0];
  }

  private throwEncounterNotFound(): never {
    throw new NotFoundException("OPD encounter not found in the active scope");
  }

  private throwExaminationNotFound(): never {
    throw new NotFoundException(
      "OPD examination not found in the active scope",
    );
  }
}
