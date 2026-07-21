import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { OpdNoteSectionCode } from "./dto/opd-clinical-note.dto";
import { OpdClinicalSectionRepository } from "./opd-clinical-section.repository";
import { OpdClinicalSectionService } from "./opd-clinical-section.service";
import { OpdClinicalRepository } from "./opd-clinical.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };
const NOW = new Date("2026-07-20T03:00:00.000Z");
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const EXAMINATION_ID = "22222222-2222-4222-8222-222222222222";

const ENCOUNTER = {
  encounter_id: ENCOUNTER_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  workflow_status: "OPEN",
  clinical_record_status: "DRAFT",
  version: 5,
  updated_at: NOW,
};
const EXAMINATION = {
  examination_id: EXAMINATION_ID,
  encounter_id: ENCOUNTER_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  status: "DRAFT",
};
const SYMPTOM_SECTION = {
  symptom_section_id: "33333333-3333-4333-8333-333333333333",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  examination_id: EXAMINATION_ID,
  patient_quote: "ปวดหัวมาก",
  version: 2,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
  symptoms: [],
};
const DIAGNOSIS_SECTION = {
  diagnosis_section_id: "44444444-4444-4444-8444-444444444444",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  status: "DRAFT",
  version: 3,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
  diagnoses: [],
};

async function makeService() {
  const tx = { id: "transaction-client" };
  const clinicalRepository = {
    findExamination: jest.fn().mockResolvedValue(EXAMINATION),
    findEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
    lockExamination: jest.fn().mockResolvedValue(true),
    lockEncounter: jest.fn().mockResolvedValue(true),
  };
  const repository = {
    findSymptomSection: jest.fn().mockResolvedValue(SYMPTOM_SECTION),
    createSymptomSection: jest.fn().mockResolvedValue(SYMPTOM_SECTION),
    replaceSymptoms: jest.fn().mockResolvedValue(true),
    findDiagnosisSection: jest.fn().mockResolvedValue(DIAGNOSIS_SECTION),
    createDiagnosisSection: jest.fn().mockResolvedValue(DIAGNOSIS_SECTION),
    replaceDiagnoses: jest.fn().mockResolvedValue(true),
    nextCheckpointNumber: jest.fn().mockResolvedValue(4),
    buildResourceVersionManifest: jest.fn().mockResolvedValue({
      manifest: {
        encounter: { id: ENCOUNTER_ID, version: ENCOUNTER.version },
        symptoms: { id: SYMPTOM_SECTION.symptom_section_id, version: 2 },
        noteSections: [],
      },
      examination: null,
      vitals: null,
      symptoms: {
        id: SYMPTOM_SECTION.symptom_section_id,
        version: 2,
        status: "DRAFT",
        updatedAt: NOW,
      },
      diagnoses: null,
      noteWorkspace: null,
      noteSections: [],
    }),
    createDraftCheckpoint: jest.fn().mockResolvedValue({
      draft_checkpoint_id: "55555555-5555-4555-8555-555555555555",
      encounter_id: ENCOUNTER_ID,
      checkpoint_number: 4,
      resource_versions: {},
      actor_user_id: SCOPE.userId,
      note: "before lunch",
      created_at: NOW,
    }),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    ),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue({}) };
  const module = await Test.createTestingModule({
    providers: [
      OpdClinicalSectionService,
      { provide: OpdClinicalSectionRepository, useValue: repository },
      { provide: OpdClinicalRepository, useValue: clinicalRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLogService },
    ],
  }).compile();
  return {
    service: module.get(OpdClinicalSectionService),
    repository,
    clinicalRepository,
    auditLogService,
    tx,
  };
}

describe("OpdClinicalSectionService", () => {
  it("conceals an out-of-scope examination when reading symptoms", async () => {
    const { service, clinicalRepository, repository } = await makeService();
    clinicalRepository.findExamination.mockResolvedValue(null);

    await expect(
      service.symptomSection(ENCOUNTER_ID, EXAMINATION_ID, SCOPE),
    ).rejects.toThrow(NotFoundException);
    expect(repository.findSymptomSection).not.toHaveBeenCalled();
  });

  it("creates a symptom root and audit record in the same transaction", async () => {
    const { service, repository, auditLogService, tx } = await makeService();
    repository.findSymptomSection.mockResolvedValueOnce(null);

    const result = await service.createSymptomSection(
      ENCOUNTER_ID,
      EXAMINATION_ID,
      SCOPE,
      PRINCIPAL,
    );

    expect(result.resumed).toBe(false);
    expect(repository.createSymptomSection).toHaveBeenCalledWith(
      ENCOUNTER_ID,
      EXAMINATION_ID,
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "symptoms.create" }),
      tx,
    );
  });

  it("replaces repeatable symptoms using expectedVersion and audits it", async () => {
    const { service, repository, auditLogService, tx } = await makeService();
    repository.findSymptomSection
      .mockResolvedValueOnce(SYMPTOM_SECTION)
      .mockResolvedValueOnce({ ...SYMPTOM_SECTION, version: 3 });
    const items = [
      {
        mainText: "Headache",
        durationValue: 2,
        durationUnit: "DAY",
        associations: [{ label: "Nausea" }],
      },
    ];

    const result = await service.patchSymptoms(
      ENCOUNTER_ID,
      EXAMINATION_ID,
      { expectedVersion: 2, patientQuote: " ปวดหัวมาก ", items },
      SCOPE,
      PRINCIPAL,
    );

    expect(result.version).toBe(3);
    expect(repository.replaceSymptoms).toHaveBeenCalledWith(
      SYMPTOM_SECTION,
      2,
      "ปวดหัวมาก",
      items,
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "symptoms.update",
        metadata: expect.objectContaining({
          symptomCount: 1,
          previousVersion: 2,
          resultVersion: 3,
        }),
      }),
      tx,
    );
  });

  it("returns current symptom version metadata for a stale write", async () => {
    const { service, repository } = await makeService();
    repository.findSymptomSection.mockResolvedValue({
      ...SYMPTOM_SECTION,
      version: 7,
    });

    let caught: unknown;
    try {
      await service.patchSymptoms(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        { expectedVersion: 6, items: [] },
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VersionConflictException);
    if (!(caught instanceof VersionConflictException)) throw caught;
    expect(caught.getResponse()).toEqual(
      expect.objectContaining({
        resourceType: "OPD_SYMPTOM_SECTION",
        currentVersion: 7,
      }),
    );
    expect(repository.replaceSymptoms).not.toHaveBeenCalled();
  });

  it("does not edit symptoms after their examination is finalized", async () => {
    const { service, clinicalRepository, repository } = await makeService();
    clinicalRepository.findExamination.mockResolvedValue({
      ...EXAMINATION,
      status: "FINAL",
    });

    await expect(
      service.patchSymptoms(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        { expectedVersion: 2, items: [] },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.replaceSymptoms).not.toHaveBeenCalled();
  });

  it("requires exactly one primary diagnosis for a non-empty list", async () => {
    const { service, repository } = await makeService();

    await expect(
      service.patchDiagnoses(
        ENCOUNTER_ID,
        {
          expectedVersion: 3,
          items: [
            {
              codeSystem: "ICD-10",
              code: "R51",
              label: "Headache",
              isPrimary: false,
            },
          ],
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.replaceDiagnoses).not.toHaveBeenCalled();
  });

  it("replaces structured diagnoses and writes their audit atomically", async () => {
    const { service, repository, auditLogService, tx } = await makeService();
    repository.findDiagnosisSection
      .mockResolvedValueOnce(DIAGNOSIS_SECTION)
      .mockResolvedValueOnce({ ...DIAGNOSIS_SECTION, version: 4 });
    const items = [
      {
        codeSystem: "ICD-10",
        codeEdition: "2019",
        code: "R51",
        label: "Headache",
        isPrimary: true,
      },
    ];

    const result = await service.patchDiagnoses(
      ENCOUNTER_ID,
      { expectedVersion: 3, items },
      SCOPE,
      PRINCIPAL,
    );

    expect(result.version).toBe(4);
    expect(repository.replaceDiagnoses).toHaveBeenCalledWith(
      DIAGNOSIS_SECTION,
      3,
      items,
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "diagnoses.update" }),
      tx,
    );
  });

  it("creates a draft checkpoint without changing encounter or queue state", async () => {
    const { service, repository, clinicalRepository, auditLogService, tx } =
      await makeService();

    const result = await service.createDraftCheckpoint(
      ENCOUNTER_ID,
      {
        expectedVersions: {
          encounter: { id: ENCOUNTER_ID, version: ENCOUNTER.version },
          symptoms: { id: SYMPTOM_SECTION.symptom_section_id, version: 2 },
          noteSections: [],
        },
        note: " before lunch ",
      },
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toEqual(
      expect.objectContaining({
        encounterId: ENCOUNTER_ID,
        checkpointNumber: 4,
        note: "before lunch",
      }),
    );
    expect(repository.buildResourceVersionManifest).toHaveBeenCalledWith(
      ENCOUNTER_ID,
      ENCOUNTER.version,
      SCOPE,
      tx,
    );
    expect(repository.createDraftCheckpoint).toHaveBeenCalledWith(
      ENCOUNTER_ID,
      4,
      expect.objectContaining({ encounter: expect.any(Object) }),
      "before lunch",
      SCOPE,
      expect.any(Date),
      tx,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "draft.checkpoint.create",
        fromStatus: "DRAFT",
        toStatus: "DRAFT",
      }),
      tx,
    );
    expect(Object.keys(clinicalRepository).sort()).toEqual([
      "findEncounter",
      "findExamination",
      "lockEncounter",
      "lockExamination",
    ]);
  });

  it("rejects a draft checkpoint when any expected section version is stale", async () => {
    const { service, repository } = await makeService();

    await expect(
      service.createDraftCheckpoint(
        ENCOUNTER_ID,
        {
          expectedVersions: {
            encounter: { id: ENCOUNTER_ID, version: ENCOUNTER.version },
            symptoms: { id: SYMPTOM_SECTION.symptom_section_id, version: 1 },
            noteSections: [],
          },
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(VersionConflictException);
    expect(repository.createDraftCheckpoint).not.toHaveBeenCalled();
  });

  it("rejects a draft checkpoint when a clinical-note section version is stale", async () => {
    const { service, repository } = await makeService();
    const noteWorkspaceId = "66666666-6666-4666-8666-666666666666";
    const noteSectionId = "77777777-7777-4777-8777-777777777777";
    repository.buildResourceVersionManifest.mockResolvedValue({
      manifest: {
        encounter: { id: ENCOUNTER_ID, version: ENCOUNTER.version },
        noteWorkspace: { id: noteWorkspaceId, version: 1 },
        noteSections: [
          {
            id: noteSectionId,
            sectionCode: OpdNoteSectionCode.TREATMENT_PLAN,
            version: 3,
          },
        ],
      },
      examination: null,
      vitals: null,
      symptoms: null,
      diagnoses: null,
      noteWorkspace: {
        id: noteWorkspaceId,
        version: 1,
        status: "DRAFT",
        updatedAt: NOW,
      },
      noteSections: [
        {
          id: noteSectionId,
          sectionCode: OpdNoteSectionCode.TREATMENT_PLAN,
          version: 3,
          status: "DRAFT",
          updatedAt: NOW,
        },
      ],
    });

    let caught: unknown;
    try {
      await service.createDraftCheckpoint(
        ENCOUNTER_ID,
        {
          expectedVersions: {
            encounter: { id: ENCOUNTER_ID, version: ENCOUNTER.version },
            noteWorkspace: { id: noteWorkspaceId, version: 1 },
            noteSections: [
              {
                id: noteSectionId,
                sectionCode: OpdNoteSectionCode.TREATMENT_PLAN,
                version: 2,
              },
            ],
          },
        },
        SCOPE,
        PRINCIPAL,
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(VersionConflictException);
    if (!(caught instanceof VersionConflictException)) throw caught;
    expect(caught.getResponse()).toEqual(
      expect.objectContaining({
        resourceType: "OPD_NOTE_SECTION",
        resourceId: noteSectionId,
        currentVersion: 3,
      }),
    );
    expect(repository.createDraftCheckpoint).not.toHaveBeenCalled();
  });
});
