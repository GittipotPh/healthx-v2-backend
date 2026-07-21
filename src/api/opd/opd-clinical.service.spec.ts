import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { createHash } from "node:crypto";
import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { VersionConflictException } from "../../common/version-conflict.exception";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { OpdClinicalRepository } from "./opd-clinical.repository";
import { OpdClinicalIntakeRepository } from "./opd-clinical-intake.repository";
import { OpdClinicalSectionRepository } from "./opd-clinical-section.repository";
import { OpdClinicalService } from "./opd-clinical.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};
const PRINCIPAL: Principal = { email: "nurse@example.com", name: "Nurse One" };
const NOW = new Date("2026-07-20T03:00:00.000Z");

const ENCOUNTER = {
  encounter_id: "11111111-1111-4111-8111-111111111111",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  workflow_status: "OPEN",
  clinical_record_status: "DRAFT",
};

const VITAL = {
  vital_observation_id: "33333333-3333-4333-8333-333333333333",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER.encounter_id,
  examination_id: "22222222-2222-4222-8222-222222222222",
  weight_kg: null,
  height_cm: null,
  body_mass_index: null,
  systolic_blood_pressure_mmhg: 120,
  diastolic_blood_pressure_mmhg: 80,
  pulse_rate_per_minute: null,
  temperature_celsius: null,
  oxygen_saturation_percent: null,
  respiratory_rate_per_minute: null,
  dtx_mg_dl: null,
  pain_score: null,
  reference_rule_version: null,
  interpretation_snapshot: null,
  version: 1,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
};

const EXAMINATION = {
  examination_id: VITAL.examination_id,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER.encounter_id,
  examination_number: 1,
  status: "DRAFT",
  version: 1,
  measured_at: NOW,
  recorder_user_id: SCOPE.userId,
  examiner_user_id: null,
  corrects_examination_id: null,
  supersedes_examination_id: null,
  correction_source_version: null,
  correction_reason: null,
  finalized_at: null,
  finalized_by: null,
  voided_at: null,
  voided_by: null,
  void_reason: null,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
  vital_observation: VITAL,
};

const SYMPTOM_SECTION = {
  symptom_section_id: "44444444-4444-4444-8444-444444444444",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER.encounter_id,
  examination_id: EXAMINATION.examination_id,
  patient_quote: null,
  version: 3,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
  symptoms: [],
};

const INTAKE = {
  intake_id: "77777777-7777-4777-8777-777777777777",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER.encounter_id,
  examination_id: EXAMINATION.examination_id,
  urinary_status: "NORMAL",
  urinary_other_text: null,
  bowel_status: "CONSTIPATION",
  bowel_other_text: null,
  version: 2,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
};

function finalizedExamination() {
  return {
    ...EXAMINATION,
    status: "FINAL",
    version: 2,
    finalized_at: NOW,
    finalized_by: SCOPE.userId,
  };
}

function correctionExamination() {
  const examinationId = "55555555-5555-4555-8555-555555555555";
  return {
    ...EXAMINATION,
    examination_id: examinationId,
    examination_number: 2,
    corrects_examination_id: EXAMINATION.examination_id,
    supersedes_examination_id: EXAMINATION.examination_id,
    correction_source_version: 2,
    correction_reason: "Correct transcribed blood pressure",
    vital_observation: {
      ...VITAL,
      vital_observation_id: "66666666-6666-4666-8666-666666666666",
      examination_id: examinationId,
    },
  };
}

function finalizedCorrection() {
  return {
    ...correctionExamination(),
    status: "FINAL",
    version: 2,
    finalized_at: NOW,
    finalized_by: SCOPE.userId,
  };
}

async function makeService() {
  const transactionClient = { id: "tx" };
  const repository = {
    findEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
    lockEncounter: jest.fn().mockResolvedValue(true),
    lockExamination: jest.fn().mockResolvedValue(true),
    listExaminations: jest.fn().mockResolvedValue({
      items: [EXAMINATION],
      total: 1,
      page: 1,
      pageSize: 20,
    }),
    findDraft: jest.fn().mockResolvedValue(null),
    findExamination: jest.fn().mockResolvedValue(EXAMINATION),
    nextExaminationNumber: jest.fn().mockResolvedValue(1),
    createExamination: jest.fn().mockResolvedValue(EXAMINATION),
    findCorrectionSuccessor: jest.fn().mockResolvedValue(null),
    createCorrectionExamination: jest
      .fn()
      .mockResolvedValue(correctionExamination()),
    updateVitals: jest.fn().mockResolvedValue(1),
    finalizeExamination: jest.fn().mockResolvedValue(1),
    markExaminationCorrected: jest.fn().mockResolvedValue(1),
    findIdempotency: jest.fn().mockResolvedValue(null),
    createIdempotency: jest
      .fn()
      .mockResolvedValue({ api_idempotency_id: "claim-1" }),
    completeIdempotency: jest.fn().mockResolvedValue(undefined),
    completeCorrectionIdempotency: jest.fn().mockResolvedValue(undefined),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    ),
  };
  const sectionRepository = {
    findSymptomSection: jest.fn().mockResolvedValue(null),
  };
  const intakeRepository = {
    findIntake: jest.fn().mockResolvedValue(null),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue({}) };
  const module = await Test.createTestingModule({
    providers: [
      OpdClinicalService,
      { provide: OpdClinicalRepository, useValue: repository },
      { provide: OpdClinicalIntakeRepository, useValue: intakeRepository },
      { provide: OpdClinicalSectionRepository, useValue: sectionRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLogService },
    ],
  }).compile();
  return {
    service: module.get(OpdClinicalService),
    repository,
    intakeRepository,
    sectionRepository,
    prisma,
    auditLogService,
    transactionClient,
  };
}

describe("OpdClinicalService", () => {
  it("returns a paged examination history for the scoped encounter", async () => {
    const { service, repository } = await makeService();

    const result = await service.listExaminations(
      ENCOUNTER.encounter_id,
      { page: 1, pageSize: 20 },
      SCOPE,
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({ examinationId: EXAMINATION.examination_id }),
      ],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    expect(repository.listExaminations).toHaveBeenCalledWith(
      ENCOUNTER.encounter_id,
      SCOPE,
      { page: 1, pageSize: 20 },
    );
  });

  it("creates an app-owned examination and its audit in one transaction", async () => {
    const { service, repository, auditLogService, transactionClient } =
      await makeService();

    const result = await service.createExamination(
      ENCOUNTER.encounter_id,
      SCOPE,
      PRINCIPAL,
    );

    expect(result.resumed).toBe(false);
    expect(result.examination.examinationId).toBe(EXAMINATION.examination_id);
    expect(repository.lockEncounter).toHaveBeenCalledWith(
      ENCOUNTER.encounter_id,
      SCOPE,
      transactionClient,
    );
    expect(repository.createExamination).toHaveBeenCalledWith(
      ENCOUNTER.encounter_id,
      1,
      SCOPE,
      expect.any(Date),
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "examination.create",
        actorUserId: SCOPE.userId,
      }),
      transactionClient,
    );
  });

  it("resumes the one active draft instead of creating a duplicate", async () => {
    const { service, repository, auditLogService } = await makeService();
    repository.findDraft.mockResolvedValue(EXAMINATION);

    const result = await service.createExamination(
      ENCOUNTER.encounter_id,
      SCOPE,
      PRINCIPAL,
    );

    expect(result.resumed).toBe(true);
    expect(repository.createExamination).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("rejects a cross-scope examination without leaking whether it exists", async () => {
    const { service, repository } = await makeService();
    repository.lockExamination.mockResolvedValue(false);

    await expect(
      service.patchVitals(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        { expectedVersion: 1, weightKg: 70 },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(repository.updateVitals).not.toHaveBeenCalled();
  });

  it("updates a draft vital section with expectedVersion and server-derived BMI", async () => {
    const { service, repository, auditLogService, transactionClient } =
      await makeService();
    const updated = {
      ...EXAMINATION,
      vital_observation: {
        ...VITAL,
        weight_kg: 70,
        height_cm: 175,
        body_mass_index: 22.86,
        version: 2,
      },
    };
    repository.findExamination
      .mockResolvedValueOnce(EXAMINATION)
      .mockResolvedValueOnce(updated);

    const result = await service.patchVitals(
      ENCOUNTER.encounter_id,
      EXAMINATION.examination_id,
      { expectedVersion: 1, weightKg: 70, heightCm: 175 },
      SCOPE,
      PRINCIPAL,
    );

    expect(result.vitals.bodyMassIndex).toBe(22.86);
    expect(result.vitals.version).toBe(2);
    expect(repository.updateVitals).toHaveBeenCalledWith(
      VITAL.vital_observation_id,
      EXAMINATION.examination_id,
      1,
      SCOPE,
      expect.objectContaining({
        weight_kg: 70,
        height_cm: 175,
        body_mass_index: 22.86,
        version: { increment: 1 },
        updated_by: SCOPE.userId,
      }),
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "vitals.update" }),
      transactionClient,
    );
  });

  it("rejects a computed BMI that cannot fit the storage contract", async () => {
    const { service, repository } = await makeService();

    await expect(
      service.patchVitals(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        { expectedVersion: 1, weightKg: 100, heightCm: 1 },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.updateVitals).not.toHaveBeenCalled();
  });

  it("returns current version metadata for a stale vital write", async () => {
    const { service, repository, auditLogService } = await makeService();
    repository.findExamination.mockResolvedValue({
      ...EXAMINATION,
      vital_observation: { ...VITAL, version: 4 },
    });

    let caught: unknown;
    try {
      await service.patchVitals(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        { expectedVersion: 3, pulseRatePerMinute: 82 },
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
        code: "CLINICAL_VERSION_CONFLICT",
        resourceType: "OPD_VITAL_OBSERVATION",
        currentVersion: 4,
      }),
    );
    expect(repository.updateVitals).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("never overwrites a finalized examination", async () => {
    const { service, repository } = await makeService();
    repository.findExamination.mockResolvedValue(finalizedExamination());

    await expect(
      service.patchVitals(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        { expectedVersion: 1, weightKg: 72 },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.updateVitals).not.toHaveBeenCalled();
  });

  it("creates a reasoned correction draft from the exact finalized versions", async () => {
    const {
      service,
      repository,
      intakeRepository,
      sectionRepository,
      auditLogService,
      transactionClient,
    } = await makeService();
    const source = finalizedExamination();
    const correction = correctionExamination();
    repository.findExamination.mockResolvedValue(source);
    repository.nextExaminationNumber.mockResolvedValue(2);
    repository.createCorrectionExamination.mockResolvedValue(correction);
    intakeRepository.findIntake.mockResolvedValue(INTAKE);
    sectionRepository.findSymptomSection.mockResolvedValue(SYMPTOM_SECTION);

    const result = await service.createExaminationCorrection(
      ENCOUNTER.encounter_id,
      source.examination_id,
      {
        expectedExaminationVersion: 2,
        expectedVitalVersion: 1,
        expectedIntakeVersion: 2,
        expectedSymptomVersion: 3,
        reason: "  Correct transcribed blood pressure  ",
      },
      "correction-attempt-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toEqual(
      expect.objectContaining({
        sourceExaminationId: source.examination_id,
        correctionRootExaminationId: source.examination_id,
        examination: expect.objectContaining({
          examinationId: correction.examination_id,
          status: "DRAFT",
          supersedesExaminationId: source.examination_id,
          correctionReason: "Correct transcribed blood pressure",
        }),
      }),
    );
    expect(repository.createCorrectionExamination).toHaveBeenCalledWith(
      source,
      INTAKE,
      SYMPTOM_SECTION,
      2,
      source.examination_id,
      "Correct transcribed blood pressure",
      SCOPE,
      expect.any(Date),
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "examination.correction.create",
        metadata: expect.objectContaining({
          sourceExaminationVersion: 2,
          sourceVitalVersion: 1,
          sourceIntakeId: INTAKE.intake_id,
          sourceIntakeVersion: 2,
          sourceSymptomVersion: 3,
          reason: "Correct transcribed blood pressure",
        }),
      }),
      transactionClient,
    );
    expect(repository.completeCorrectionIdempotency).toHaveBeenCalledWith(
      "claim-1",
      correction.examination_id,
      SCOPE,
      {
        examinationId: correction.examination_id,
        sourceExaminationId: source.examination_id,
        correctionRootExaminationId: source.examination_id,
      },
      expect.any(Date),
      transactionClient,
    );
  });

  it("returns current examination metadata for a stale correction source", async () => {
    const { service, repository } = await makeService();
    repository.findExamination.mockResolvedValue({
      ...finalizedExamination(),
      version: 4,
    });

    await expect(
      service.createExaminationCorrection(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        {
          expectedExaminationVersion: 2,
          expectedVitalVersion: 1,
          reason: "Correct transcribed blood pressure",
        },
        "correction-attempt-2",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(VersionConflictException);
    expect(repository.createCorrectionExamination).not.toHaveBeenCalled();
  });

  it("hides a cross-scope correction source behind not found", async () => {
    const { service, repository } = await makeService();
    repository.lockExamination.mockResolvedValue(false);

    await expect(
      service.createExaminationCorrection(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        {
          expectedExaminationVersion: 2,
          expectedVitalVersion: 1,
          reason: "Correct transcribed blood pressure",
        },
        "correction-attempt-3",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(NotFoundException);
    expect(repository.createCorrectionExamination).not.toHaveBeenCalled();
  });

  it("rejects correction creation for a non-final examination", async () => {
    const { service, repository } = await makeService();

    await expect(
      service.createExaminationCorrection(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        {
          expectedExaminationVersion: 1,
          expectedVitalVersion: 1,
          reason: "Correct transcribed blood pressure",
        },
        "correction-attempt-4",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(ConflictException);
    expect(repository.createCorrectionExamination).not.toHaveBeenCalled();
  });

  it("surfaces a correction audit failure before idempotency completion", async () => {
    const { service, repository, auditLogService } = await makeService();
    repository.findExamination.mockResolvedValue(finalizedExamination());
    auditLogService.create.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.createExaminationCorrection(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        {
          expectedExaminationVersion: 2,
          expectedVitalVersion: 1,
          reason: "Correct transcribed blood pressure",
        },
        "correction-attempt-5",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow("audit unavailable");
    expect(repository.createCorrectionExamination).toHaveBeenCalled();
    expect(repository.completeCorrectionIdempotency).not.toHaveBeenCalled();
  });

  it("requires a non-blank correction reason before opening a transaction", async () => {
    const { service, repository, prisma } = await makeService();

    await expect(
      service.createExaminationCorrection(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        {
          expectedExaminationVersion: 2,
          expectedVitalVersion: 1,
          reason: "   ",
        },
        "correction-attempt-6",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(repository.createCorrectionExamination).not.toHaveBeenCalled();
  });

  it("replays a completed correction without cloning or auditing twice", async () => {
    const { service, repository, prisma, auditLogService } =
      await makeService();
    const correction = correctionExamination();
    const dto = {
      expectedExaminationVersion: 2,
      expectedVitalVersion: 1,
      reason: "Correct transcribed blood pressure",
    };
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          encounterId: ENCOUNTER.encounter_id,
          sourceExaminationId: EXAMINATION.examination_id,
          expectedExaminationVersion: 2,
          expectedVitalVersion: 1,
          reason: dto.reason,
        }),
      )
      .digest("hex");
    repository.findIdempotency.mockResolvedValue({
      request_hash: requestHash,
      state: "COMPLETED",
      result_snapshot: {
        examinationId: correction.examination_id,
        sourceExaminationId: EXAMINATION.examination_id,
        correctionRootExaminationId: EXAMINATION.examination_id,
      },
    });
    repository.findExamination.mockResolvedValue(correction);

    await expect(
      service.createExaminationCorrection(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        dto,
        "correction-attempt-1",
        SCOPE,
        PRINCIPAL,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        examination: expect.objectContaining({
          examinationId: correction.examination_id,
        }),
      }),
    );

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(repository.createCorrectionExamination).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("finalizes once with idempotency and audit in the same transaction", async () => {
    const { service, repository, auditLogService, transactionClient } =
      await makeService();
    repository.findExamination
      .mockResolvedValueOnce(EXAMINATION)
      .mockResolvedValueOnce(finalizedExamination());

    const result = await service.finalizeExamination(
      ENCOUNTER.encounter_id,
      EXAMINATION.examination_id,
      { expectedExaminationVersion: 1, expectedVitalVersion: 1 },
      "finalize-attempt-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result.status).toBe("FINAL");
    expect(repository.finalizeExamination).toHaveBeenCalledWith(
      ENCOUNTER.encounter_id,
      EXAMINATION.examination_id,
      1,
      SCOPE,
      expect.any(Date),
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "examination.finalize" }),
      transactionClient,
    );
    expect(repository.completeIdempotency).toHaveBeenCalledWith(
      "claim-1",
      EXAMINATION.examination_id,
      SCOPE,
      expect.objectContaining({ status: "FINAL" }),
      expect.any(Date),
      transactionClient,
    );
  });

  it("includes the current symptom version in finalization and its replay snapshot", async () => {
    const {
      service,
      repository,
      sectionRepository,
      auditLogService,
      transactionClient,
    } = await makeService();
    sectionRepository.findSymptomSection.mockResolvedValue(SYMPTOM_SECTION);
    repository.findExamination
      .mockResolvedValueOnce(EXAMINATION)
      .mockResolvedValueOnce(finalizedExamination());

    await service.finalizeExamination(
      ENCOUNTER.encounter_id,
      EXAMINATION.examination_id,
      {
        expectedExaminationVersion: 1,
        expectedVitalVersion: 1,
        expectedSymptomVersion: 3,
      },
      "finalize-with-symptoms",
      SCOPE,
      PRINCIPAL,
    );

    expect(sectionRepository.findSymptomSection).toHaveBeenCalledWith(
      ENCOUNTER.encounter_id,
      EXAMINATION.examination_id,
      SCOPE,
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          symptomSectionId: SYMPTOM_SECTION.symptom_section_id,
          symptomVersion: 3,
        }),
      }),
      transactionClient,
    );
    expect(repository.completeIdempotency).toHaveBeenCalledWith(
      "claim-1",
      EXAMINATION.examination_id,
      SCOPE,
      expect.objectContaining({
        symptomSectionId: SYMPTOM_SECTION.symptom_section_id,
        symptomVersion: 3,
      }),
      expect.any(Date),
      transactionClient,
    );
  });

  it("requires and snapshots the current intake version during finalization", async () => {
    const {
      service,
      repository,
      intakeRepository,
      auditLogService,
      transactionClient,
    } = await makeService();
    intakeRepository.findIntake.mockResolvedValue(INTAKE);
    repository.findExamination
      .mockResolvedValueOnce(EXAMINATION)
      .mockResolvedValueOnce(finalizedExamination());

    await service.finalizeExamination(
      ENCOUNTER.encounter_id,
      EXAMINATION.examination_id,
      {
        expectedExaminationVersion: 1,
        expectedVitalVersion: 1,
        expectedIntakeVersion: 2,
      },
      "finalize-with-intake",
      SCOPE,
      PRINCIPAL,
    );

    expect(intakeRepository.findIntake).toHaveBeenCalledWith(
      ENCOUNTER.encounter_id,
      EXAMINATION.examination_id,
      SCOPE,
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          intakeId: INTAKE.intake_id,
          intakeVersion: 2,
        }),
      }),
      transactionClient,
    );
    expect(repository.completeIdempotency).toHaveBeenCalledWith(
      "claim-1",
      EXAMINATION.examination_id,
      SCOPE,
      expect.objectContaining({
        intakeId: INTAKE.intake_id,
        intakeVersion: 2,
      }),
      expect.any(Date),
      transactionClient,
    );
  });

  it("finalizes a correction and marks its immediate source corrected atomically", async () => {
    const { service, repository, auditLogService, transactionClient } =
      await makeService();
    const correction = correctionExamination();
    const source = finalizedExamination();
    repository.findExamination
      .mockResolvedValueOnce(correction)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(finalizedCorrection());

    const result = await service.finalizeExamination(
      ENCOUNTER.encounter_id,
      correction.examination_id,
      { expectedExaminationVersion: 1, expectedVitalVersion: 1 },
      "correct-finalize-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toEqual(
      expect.objectContaining({ status: "FINAL", version: 2 }),
    );
    expect(repository.markExaminationCorrected).toHaveBeenCalledWith(
      ENCOUNTER.encounter_id,
      source.examination_id,
      2,
      SCOPE,
      expect.any(Date),
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "examination.correction.finalize",
        metadata: expect.objectContaining({
          supersededExaminationId: source.examination_id,
          supersededPreviousVersion: 2,
          supersededResultVersion: 3,
          correctionReason: correction.correction_reason,
        }),
      }),
      transactionClient,
    );
    expect(repository.completeIdempotency).toHaveBeenCalledWith(
      "claim-1",
      correction.examination_id,
      SCOPE,
      expect.objectContaining({
        supersededExaminationId: source.examination_id,
        supersededExaminationVersion: 3,
      }),
      expect.any(Date),
      transactionClient,
    );
  });

  it("rejects finalization when the browser omits an existing symptom version", async () => {
    const { service, repository, sectionRepository } = await makeService();
    sectionRepository.findSymptomSection.mockResolvedValue(SYMPTOM_SECTION);

    await expect(
      service.finalizeExamination(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        { expectedExaminationVersion: 1, expectedVitalVersion: 1 },
        "finalize-stale-symptoms",
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(repository.finalizeExamination).not.toHaveBeenCalled();
  });

  it("replays a completed finalization without a second transaction or audit", async () => {
    const { service, repository, prisma, auditLogService } =
      await makeService();
    const dto = { expectedVitalVersion: 1, expectedExaminationVersion: 1 };
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          encounterId: ENCOUNTER.encounter_id,
          examinationId: EXAMINATION.examination_id,
          expectedExaminationVersion: 1,
          expectedVitalVersion: 1,
        }),
      )
      .digest("hex");
    repository.findIdempotency.mockResolvedValue({
      request_hash: requestHash,
      state: "COMPLETED",
      result_snapshot: {
        examinationId: EXAMINATION.examination_id,
        examinationVersion: 2,
        vitalVersion: 1,
        status: "FINAL",
      },
    });
    repository.findExamination.mockResolvedValue(finalizedExamination());

    await expect(
      service.finalizeExamination(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        dto,
        "finalize-attempt-1",
        SCOPE,
        PRINCIPAL,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ status: "FINAL", version: 2 }),
    );

    expect(repository.findIdempotency).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("surfaces an audit failure so the clinical transaction rolls back", async () => {
    const { service, repository, auditLogService } = await makeService();
    auditLogService.create.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.patchVitals(
        ENCOUNTER.encounter_id,
        EXAMINATION.examination_id,
        { expectedVersion: 1, pulseRatePerMinute: 80 },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow("audit unavailable");
    expect(repository.updateVitals).toHaveBeenCalled();
  });
});
