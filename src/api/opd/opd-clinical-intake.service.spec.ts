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
import { OpdBowelStatus, OpdUrinaryStatus } from "./dto/opd-intake.dto";
import { OpdClinicalIntakeRepository } from "./opd-clinical-intake.repository";
import { OpdClinicalIntakeService } from "./opd-clinical-intake.service";
import { OpdClinicalRepository } from "./opd-clinical.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};
const PRINCIPAL: Principal = { email: "nurse@example.com", name: "Nurse One" };
const NOW = new Date("2026-07-21T03:00:00.000Z");
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const EXAMINATION_ID = "22222222-2222-4222-8222-222222222222";

const ENCOUNTER = {
  encounter_id: ENCOUNTER_ID,
  workflow_status: "OPEN",
  clinical_record_status: "DRAFT",
};

const EXAMINATION = {
  examination_id: EXAMINATION_ID,
  encounter_id: ENCOUNTER_ID,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  status: "DRAFT",
  updated_at: NOW,
};

const INTAKE = {
  intake_id: "33333333-3333-4333-8333-333333333333",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: ENCOUNTER_ID,
  examination_id: EXAMINATION_ID,
  urinary_status: OpdUrinaryStatus.OTHER,
  urinary_other_text: "Nocturia",
  bowel_status: OpdBowelStatus.CONSTIPATION,
  bowel_other_text: null,
  version: 1,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
};

async function makeService() {
  const transactionClient = { id: "tx" };
  const intakeRepository = {
    findIntake: jest.fn().mockResolvedValue(null),
    createIntake: jest.fn().mockResolvedValue(INTAKE),
    updateIntake: jest.fn().mockResolvedValue(1),
  };
  const clinicalRepository = {
    findExamination: jest.fn().mockResolvedValue(EXAMINATION),
    lockExamination: jest.fn().mockResolvedValue(true),
    findEncounter: jest.fn().mockResolvedValue(ENCOUNTER),
  };
  const prisma = {
    $transaction: jest.fn(
      async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
        callback(transactionClient),
    ),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue({}) };
  const module = await Test.createTestingModule({
    providers: [
      OpdClinicalIntakeService,
      {
        provide: OpdClinicalIntakeRepository,
        useValue: intakeRepository,
      },
      { provide: OpdClinicalRepository, useValue: clinicalRepository },
      { provide: PrismaService, useValue: prisma },
      { provide: AuditLogService, useValue: auditLogService },
    ],
  }).compile();
  return {
    service: module.get(OpdClinicalIntakeService),
    intakeRepository,
    clinicalRepository,
    prisma,
    auditLogService,
    transactionClient,
  };
}

describe("OpdClinicalIntakeService", () => {
  it("returns a virtual version-zero resource without writing on read", async () => {
    const { service, intakeRepository, prisma, auditLogService } =
      await makeService();

    await expect(
      service.intake(ENCOUNTER_ID, EXAMINATION_ID, SCOPE),
    ).resolves.toEqual({
      intakeId: null,
      examinationId: EXAMINATION_ID,
      urinaryStatus: null,
      urinaryOtherText: null,
      bowelStatus: null,
      bowelOtherText: null,
      version: 0,
      createdBy: null,
      updatedBy: null,
      createdAt: null,
      updatedAt: null,
    });
    expect(intakeRepository.createIntake).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLogService.create).not.toHaveBeenCalled();
  });

  it("creates normalized intake version one with audit in the same transaction", async () => {
    const { service, intakeRepository, auditLogService, transactionClient } =
      await makeService();
    intakeRepository.findIntake
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(INTAKE);

    const result = await service.patchIntake(
      ENCOUNTER_ID,
      EXAMINATION_ID,
      {
        expectedVersion: 0,
        urinaryStatus: OpdUrinaryStatus.OTHER,
        urinaryOtherText: "  Nocturia  ",
        bowelStatus: OpdBowelStatus.CONSTIPATION,
        bowelOtherText: "",
      },
      SCOPE,
      PRINCIPAL,
    );

    expect(result).toEqual(
      expect.objectContaining({
        intakeId: INTAKE.intake_id,
        urinaryOtherText: "Nocturia",
        version: 1,
      }),
    );
    expect(intakeRepository.createIntake).toHaveBeenCalledWith(
      ENCOUNTER_ID,
      EXAMINATION_ID,
      {
        urinaryStatus: OpdUrinaryStatus.OTHER,
        urinaryOtherText: "Nocturia",
        bowelStatus: OpdBowelStatus.CONSTIPATION,
        bowelOtherText: null,
      },
      SCOPE,
      expect.any(Date),
      transactionClient,
    );
    expect(auditLogService.create).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: SCOPE.userId,
        action: "intake.update",
        metadata: expect.objectContaining({
          previousVersion: 0,
          resultVersion: 1,
        }),
      }),
      transactionClient,
    );
  });

  it("rejects missing OTHER text before opening a transaction", async () => {
    const { service, prisma } = await makeService();

    await expect(
      service.patchIntake(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        {
          expectedVersion: 0,
          urinaryStatus: OpdUrinaryStatus.OTHER,
          bowelStatus: OpdBowelStatus.NORMAL,
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects other text for a non-OTHER status", async () => {
    const { service, prisma } = await makeService();

    await expect(
      service.patchIntake(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        {
          expectedVersion: 0,
          urinaryStatus: OpdUrinaryStatus.NORMAL,
          urinaryOtherText: "should not persist",
          bowelStatus: OpdBowelStatus.NORMAL,
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns a stable version conflict for a stale update", async () => {
    const { service, intakeRepository } = await makeService();
    intakeRepository.findIntake.mockResolvedValue({ ...INTAKE, version: 3 });

    await expect(
      service.patchIntake(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        {
          expectedVersion: 2,
          urinaryStatus: OpdUrinaryStatus.NORMAL,
          bowelStatus: OpdBowelStatus.NORMAL,
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(VersionConflictException);
    expect(intakeRepository.updateIntake).not.toHaveBeenCalled();
  });

  it("rejects cross-scope or missing examinations before any intake write", async () => {
    const { service, clinicalRepository, intakeRepository } =
      await makeService();
    clinicalRepository.lockExamination.mockResolvedValue(false);

    await expect(
      service.patchIntake(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        {
          expectedVersion: 0,
          urinaryStatus: OpdUrinaryStatus.NORMAL,
          bowelStatus: OpdBowelStatus.NORMAL,
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(intakeRepository.createIntake).not.toHaveBeenCalled();
  });

  it("keeps finalized examinations immutable", async () => {
    const { service, clinicalRepository, intakeRepository } =
      await makeService();
    clinicalRepository.findExamination.mockResolvedValue({
      ...EXAMINATION,
      status: "FINAL",
    });

    await expect(
      service.patchIntake(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        {
          expectedVersion: 0,
          urinaryStatus: OpdUrinaryStatus.NORMAL,
          bowelStatus: OpdBowelStatus.NORMAL,
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(intakeRepository.createIntake).not.toHaveBeenCalled();
  });

  it("surfaces audit failure so the surrounding transaction can roll back", async () => {
    const { service, intakeRepository, auditLogService } = await makeService();
    intakeRepository.findIntake
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(INTAKE);
    auditLogService.create.mockRejectedValue(new Error("audit unavailable"));

    await expect(
      service.patchIntake(
        ENCOUNTER_ID,
        EXAMINATION_ID,
        {
          expectedVersion: 0,
          urinaryStatus: OpdUrinaryStatus.OTHER,
          urinaryOtherText: "Nocturia",
          bowelStatus: OpdBowelStatus.CONSTIPATION,
        },
        SCOPE,
        PRINCIPAL,
      ),
    ).rejects.toThrow("audit unavailable");
    expect(intakeRepository.createIntake).toHaveBeenCalled();
  });
});
