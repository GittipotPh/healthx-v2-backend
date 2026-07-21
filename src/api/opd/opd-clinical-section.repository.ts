import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type opd_draft_checkpoint,
  type opd_symptom_section,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import type {
  OpdDiagnosisInputDto,
  OpdSymptomInputDto,
} from "./dto/opd-clinical-section.dto";
import type {
  OpdDiagnosisSectionRecord,
  OpdSymptomSectionRecord,
} from "./opd-clinical-section.mapper";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

export interface DraftResourceVersion {
  id: string;
  version: number;
  status: string;
  updatedAt: Date;
}

export interface DraftResourceVersionState {
  manifest: Prisma.InputJsonObject;
  examination: DraftResourceVersion | null;
  vitals: DraftResourceVersion | null;
  intake: DraftResourceVersion | null;
  symptoms: DraftResourceVersion | null;
  diagnoses: DraftResourceVersion | null;
  noteWorkspace: DraftResourceVersion | null;
  noteSections: DraftNoteSectionVersion[];
}

export interface DraftNoteSectionVersion extends DraftResourceVersion {
  sectionCode: string;
}

@Injectable()
export class OpdClinicalSectionRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findSymptomSection(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdSymptomSectionRecord | null> {
    return client.opd_symptom_section.findFirst({
      where: {
        encounter_id: encounterId,
        examination_id: examinationId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: {
        symptoms: {
          orderBy: { display_order: "asc" },
          include: {
            associations: { orderBy: { display_order: "asc" } },
          },
        },
      },
    });
  }

  async createSymptomSection(
    encounterId: string,
    examinationId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<OpdSymptomSectionRecord> {
    await tx.opd_symptom_section.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        examination_id: examinationId,
        patient_quote: null,
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
    const created = await this.findSymptomSection(
      encounterId,
      examinationId,
      scope,
      tx,
    );
    if (!created)
      throw new Error("Created symptom section could not be reloaded");
    return created;
  }

  async replaceSymptoms(
    section: opd_symptom_section,
    expectedVersion: number,
    patientQuote: string | null,
    items: OpdSymptomInputDto[],
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const updated = await tx.opd_symptom_section.updateMany({
      where: {
        symptom_section_id: section.symptom_section_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: section.encounter_id,
        version: expectedVersion,
      },
      data: {
        patient_quote: patientQuote,
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    if (updated.count !== 1) return false;

    await tx.opd_symptom.deleteMany({
      where: {
        symptom_section_id: section.symptom_section_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: section.encounter_id,
      },
    });
    for (const [symptomIndex, item] of items.entries()) {
      await tx.opd_symptom.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          encounter_id: section.encounter_id,
          symptom_section_id: section.symptom_section_id,
          display_order: symptomIndex + 1,
          main_code: this.nullableText(item.mainCode),
          main_text: item.mainText.trim(),
          duration_value: item.durationValue ?? null,
          duration_unit: this.nullableText(item.durationUnit),
          location: this.nullableText(item.location),
          laterality: item.laterality ?? null,
          severity: item.severity ?? null,
          character: this.nullableText(item.character),
          modifying_factors: this.nullableText(item.modifyingFactors),
          staff_summary: this.nullableText(item.staffSummary),
          created_by: scope.userId,
          updated_by: scope.userId,
          created_at: now,
          updated_at: now,
          associations: {
            create: item.associations.map((association, associationIndex) => ({
              clinic_id: scope.clinicId,
              branch_id: scope.branchId,
              encounter_id: section.encounter_id,
              display_order: associationIndex + 1,
              code: this.nullableText(association.code),
              label: association.label.trim(),
              created_at: now,
            })),
          },
        },
      });
    }
    return true;
  }

  async findDiagnosisSection(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdDiagnosisSectionRecord | null> {
    return client.opd_diagnosis_section.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { diagnoses: { orderBy: { display_order: "asc" } } },
    });
  }

  async createDiagnosisSection(
    encounterId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<OpdDiagnosisSectionRecord> {
    await tx.opd_diagnosis_section.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        status: "DRAFT",
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
    const created = await this.findDiagnosisSection(encounterId, scope, tx);
    if (!created)
      throw new Error("Created diagnosis section could not be reloaded");
    return created;
  }

  async replaceDiagnoses(
    section: OpdDiagnosisSectionRecord,
    expectedVersion: number,
    items: OpdDiagnosisInputDto[],
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const updated = await tx.opd_diagnosis_section.updateMany({
      where: {
        diagnosis_section_id: section.diagnosis_section_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: section.encounter_id,
        status: "DRAFT",
        version: expectedVersion,
      },
      data: {
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    if (updated.count !== 1) return false;

    await tx.opd_diagnosis.deleteMany({
      where: {
        diagnosis_section_id: section.diagnosis_section_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: section.encounter_id,
      },
    });
    for (const [index, item] of items.entries()) {
      await tx.opd_diagnosis.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          encounter_id: section.encounter_id,
          diagnosis_section_id: section.diagnosis_section_id,
          display_order: index + 1,
          code_system: item.codeSystem.trim(),
          code_edition: this.nullableText(item.codeEdition),
          code: this.nullableText(item.code),
          label: item.label.trim(),
          is_primary: item.isPrimary,
          onset_text: this.nullableText(item.onsetText),
          note: this.nullableText(item.note),
          created_by: scope.userId,
          updated_by: scope.userId,
          created_at: now,
          updated_at: now,
        },
      });
    }
    return true;
  }

  async buildResourceVersionManifest(
    encounterId: string,
    encounterVersion: number,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<DraftResourceVersionState> {
    const examination = await tx.opd_examination.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
      },
      include: { vital_observation: true, intake: true, symptom_section: true },
      orderBy: { examination_number: "desc" },
    });
    const diagnosis = await tx.opd_diagnosis_section.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
    const noteWorkspace = await tx.opd_note_workspace.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { sections: { orderBy: { section_code: "asc" } } },
    });

    const manifest: Prisma.InputJsonObject = {
      encounter: { id: encounterId, version: encounterVersion },
      ...(examination
        ? {
            examination: {
              id: examination.examination_id,
              version: examination.version,
            },
            ...(examination.vital_observation
              ? {
                  vitals: {
                    id: examination.vital_observation.vital_observation_id,
                    version: examination.vital_observation.version,
                  },
                }
              : {}),
            ...(examination.intake
              ? {
                  intake: {
                    id: examination.intake.intake_id,
                    version: examination.intake.version,
                  },
                }
              : {}),
            ...(examination.symptom_section
              ? {
                  symptoms: {
                    id: examination.symptom_section.symptom_section_id,
                    version: examination.symptom_section.version,
                  },
                }
              : {}),
          }
        : {}),
      ...(diagnosis
        ? {
            diagnoses: {
              id: diagnosis.diagnosis_section_id,
              version: diagnosis.version,
            },
          }
        : {}),
      ...(noteWorkspace
        ? {
            noteWorkspace: {
              id: noteWorkspace.note_workspace_id,
              version: noteWorkspace.version,
            },
          }
        : {}),
      noteSections:
        noteWorkspace?.sections.map((section) => ({
          id: section.note_section_id,
          sectionCode: section.section_code,
          version: section.version,
        })) ?? [],
    };
    return {
      manifest,
      examination: examination
        ? {
            id: examination.examination_id,
            version: examination.version,
            status: examination.status,
            updatedAt: examination.updated_at,
          }
        : null,
      vitals: examination?.vital_observation
        ? {
            id: examination.vital_observation.vital_observation_id,
            version: examination.vital_observation.version,
            status: examination.status,
            updatedAt: examination.vital_observation.updated_at,
          }
        : null,
      intake: examination?.intake
        ? {
            id: examination.intake.intake_id,
            version: examination.intake.version,
            status: examination.status,
            updatedAt: examination.intake.updated_at,
          }
        : null,
      symptoms: examination?.symptom_section
        ? {
            id: examination.symptom_section.symptom_section_id,
            version: examination.symptom_section.version,
            status: examination.status,
            updatedAt: examination.symptom_section.updated_at,
          }
        : null,
      diagnoses: diagnosis
        ? {
            id: diagnosis.diagnosis_section_id,
            version: diagnosis.version,
            status: diagnosis.status,
            updatedAt: diagnosis.updated_at,
          }
        : null,
      noteWorkspace: noteWorkspace
        ? {
            id: noteWorkspace.note_workspace_id,
            version: noteWorkspace.version,
            status: "DRAFT",
            updatedAt: noteWorkspace.updated_at,
          }
        : null,
      noteSections:
        noteWorkspace?.sections.map((section) => ({
          id: section.note_section_id,
          sectionCode: section.section_code,
          version: section.version,
          status: section.status,
          updatedAt: section.updated_at,
        })) ?? [],
    };
  }

  async nextCheckpointNumber(
    encounterId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    const aggregate = await tx.opd_draft_checkpoint.aggregate({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      _max: { checkpoint_number: true },
    });
    return (aggregate._max.checkpoint_number ?? 0) + 1;
  }

  createDraftCheckpoint(
    encounterId: string,
    checkpointNumber: number,
    resourceVersions: Prisma.InputJsonObject,
    note: string | null,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_draft_checkpoint> {
    return tx.opd_draft_checkpoint.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        checkpoint_number: checkpointNumber,
        resource_versions: resourceVersions,
        actor_user_id: scope.userId,
        note,
        created_at: now,
      },
    });
  }

  private nullableText(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    return normalized.length > 0 ? normalized : null;
  }
}
