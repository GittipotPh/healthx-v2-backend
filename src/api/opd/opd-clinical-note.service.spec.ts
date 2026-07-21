import { ConflictException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import {
  OpdNoteRecordMode,
  OpdNoteSectionCode,
} from "./dto/opd-clinical-note.dto";
import { OpdClinicalNoteRepository } from "./opd-clinical-note.repository";
import { OpdClinicalNoteService } from "./opd-clinical-note.service";
import { OpdClinicalRepository } from "./opd-clinical.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };
const NOW = new Date("2026-07-20T08:00:00.000Z");
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";
const CONTENT = {
  schema: "clinical-rich-text-v1" as const,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "No acute distress" }],
      },
    ],
  },
};

const ENCOUNTER = {
  encounter_id: ENCOUNTER_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  workflow_status: "OPEN",
  clinical_record_status: "DRAFT",
  version: 3,
  updated_at: NOW,
};
const WORKSPACE = {
  note_workspace_id: WORKSPACE_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  selected_mode: "FORM",
  version: 1,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
  sections: [],
};
const SECTION = {
  note_section_id: SECTION_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  note_workspace_id: WORKSPACE_ID,
  section_code: OpdNoteSectionCode.PHYSICAL_EXAMINATION,
  content_schema: "clinical-rich-text-v1",
  rich_content: CONTENT,
  plain_text: "No acute distress",
  status: "DRAFT",
  version: 1,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
};

async function makeService() {
  const tx = { id: "transaction-client" };
  const clinicalRepository = {
    findEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
    lockEncounter: jest.fn().mockResolvedValue(true),
  };
  const repository = {
    findWorkspace: jest.fn().mockResolvedValue(WORKSPACE),
    findSection: jest.fn().mockResolvedValue(SECTION),
    createWorkspace: jest.fn().mockResolvedValue(WORKSPACE),
    updateMode: jest.fn().mockResolvedValue(true),
    createSection: jest.fn().mockResolvedValue(SECTION),
    updateSection: jest.fn().mockResolvedValue(true),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue({}) };
  const module = await Test.createTestingModule({
    providers: [
      OpdClinicalNoteService,
      { provide: OpdClinicalNoteRepository, useValue: repository },
      { provide: OpdClinicalRepository, useValue: clinicalRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLogService },
    ],
  }).compile();
  return {
    service: module.get(OpdClinicalNoteService),
    repository,
    clinicalRepository,
    auditLogService,
    tx,
  };
}

describe("OpdClinicalNoteService", () => {
  it("conceals an out-of-scope encounter on read", async () => {
    const { service, clinicalRepository, repository } = await makeService();
    clinicalRepository.findEncounter.mockResolvedValue(null);

    await expect(service.workspace(ENCOUNTER_ID, SCOPE)).rejects.toThrow(
      NotFoundException,
    );
    expect(repository.findWorkspace).not.toHaveBeenCalled();
  });

  it("creates the workspace and first section with audit in one transaction", async () => {
    const { service, repository, auditLogService, tx } = await makeService();
    repository.findWorkspace
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(WORKSPACE);
    repository.findSection.mockResolvedValueOnce(null);

    const result = await service.patchSection(
      ENCOUNTER_ID,
      OpdNoteSectionCode.PHYSICAL_EXAMINATION,
      { expectedVersion: 0, content: CONTENT },
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toEqual(
      expect.objectContaining({
        noteSectionId: SECTION_ID,
        sectionCode: OpdNoteSectionCode.PHYSICAL_EXAMINATION,
        version: 1,
        plainText: "No acute distress",
      }),
    );
    expect(repository.createWorkspace).toHaveBeenCalledWith(
      ENCOUNTER_ID,
      OpdNoteRecordMode.FORM,
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(repository.createSection).toHaveBeenCalledWith(
      WORKSPACE_ID,
      ENCOUNTER_ID,
      OpdNoteSectionCode.PHYSICAL_EXAMINATION,
      expect.objectContaining({ schema: "clinical-rich-text-v1" }),
      "No acute distress",
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "note.section.create",
        metadata: expect.objectContaining({ workspaceCreated: true }),
      }),
      tx,
    );
  });

  it("rejects a stale section update with current version metadata", async () => {
    const { service, repository } = await makeService();
    repository.findSection.mockResolvedValue({ ...SECTION, version: 4 });

    await expect(
      service.patchSection(
        ENCOUNTER_ID,
        OpdNoteSectionCode.PHYSICAL_EXAMINATION,
        { expectedVersion: 1, content: CONTENT },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(VersionConflictException);
    expect(repository.updateSection).not.toHaveBeenCalled();
  });

  it("does not mutate a finalized note section", async () => {
    const { service, repository } = await makeService();
    repository.findSection.mockResolvedValue({ ...SECTION, status: "FINAL" });

    await expect(
      service.patchSection(
        ENCOUNTER_ID,
        OpdNoteSectionCode.PHYSICAL_EXAMINATION,
        { expectedVersion: 1, content: CONTENT },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.updateSection).not.toHaveBeenCalled();
  });

  it("creates and persists FREE mode without deleting structured content", async () => {
    const { service, repository, auditLogService, tx } = await makeService();
    repository.findWorkspace.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ...WORKSPACE,
      selected_mode: "FREE",
    });
    repository.createWorkspace.mockResolvedValue({
      ...WORKSPACE,
      selected_mode: "FREE",
    });

    const result = await service.patchMode(
      ENCOUNTER_ID,
      { expectedVersion: 0, selectedMode: OpdNoteRecordMode.FREE },
      SCOPE,
      PRINCIPAL,
    );

    expect(result.selectedMode).toBe(OpdNoteRecordMode.FREE);
    expect(repository.createWorkspace).toHaveBeenCalledWith(
      ENCOUNTER_ID,
      OpdNoteRecordMode.FREE,
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(repository.createSection).not.toHaveBeenCalled();
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "note.workspace.create" }),
      tx,
    );
  });
});
