import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type opd_note_section,
  type opd_note_workspace,
} from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import {
  OpdNoteRecordMode,
  OpdNoteSectionCode,
} from "./dto/opd-clinical-note.dto";
import type { OpdNoteWorkspaceRecord } from "./opd-clinical-note.mapper";

type DatabaseClient = Prisma.TransactionClient | PrismaService;

@Injectable()
export class OpdClinicalNoteRepository {
  constructor(private readonly prisma: PrismaService) {}

  findWorkspace(
    encounterId: string,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<OpdNoteWorkspaceRecord | null> {
    return client.opd_note_workspace.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { sections: true },
    });
  }

  findSection(
    encounterId: string,
    sectionCode: OpdNoteSectionCode,
    scope: RequestScope,
    client: DatabaseClient = this.prisma,
  ): Promise<opd_note_section | null> {
    return client.opd_note_section.findFirst({
      where: {
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        section_code: sectionCode,
      },
    });
  }

  createWorkspace(
    encounterId: string,
    selectedMode: OpdNoteRecordMode,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_note_workspace> {
    return tx.opd_note_workspace.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        selected_mode: selectedMode,
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async updateMode(
    workspaceId: string,
    encounterId: string,
    expectedVersion: number,
    selectedMode: OpdNoteRecordMode,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.opd_note_workspace.updateMany({
      where: {
        note_workspace_id: workspaceId,
        encounter_id: encounterId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        version: expectedVersion,
      },
      data: {
        selected_mode: selectedMode,
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return result.count === 1;
  }

  createSection(
    workspaceId: string,
    encounterId: string,
    sectionCode: OpdNoteSectionCode,
    content: Prisma.InputJsonObject,
    plainText: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<opd_note_section> {
    return tx.opd_note_section.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        encounter_id: encounterId,
        note_workspace_id: workspaceId,
        section_code: sectionCode,
        content_schema: "clinical-rich-text-v1",
        rich_content: content,
        plain_text: plainText,
        status: "DRAFT",
        version: 1,
        created_by: scope.userId,
        updated_by: scope.userId,
        created_at: now,
        updated_at: now,
      },
    });
  }

  async updateSection(
    section: opd_note_section,
    expectedVersion: number,
    content: Prisma.InputJsonObject,
    plainText: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient,
  ): Promise<boolean> {
    const result = await tx.opd_note_section.updateMany({
      where: {
        note_section_id: section.note_section_id,
        encounter_id: section.encounter_id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        status: "DRAFT",
        version: expectedVersion,
      },
      data: {
        content_schema: "clinical-rich-text-v1",
        rich_content: content,
        plain_text: plainText,
        version: { increment: 1 },
        updated_by: scope.userId,
        updated_at: now,
      },
    });
    return result.count === 1;
  }
}
