import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import { OpdBowelStatus, OpdUrinaryStatus } from "./dto/opd-intake.dto";
import { OpdClinicalIntakeRepository } from "./opd-clinical-intake.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const EXAMINATION_ID = "22222222-2222-4222-8222-222222222222";
const INTAKE_ID = "33333333-3333-4333-8333-333333333333";

describe("OpdClinicalIntakeRepository", () => {
  it("scopes intake reads by examination, encounter, clinic, and branch", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        OpdClinicalIntakeRepository,
        {
          provide: PrismaService,
          useValue: { opd_intake: { findFirst } },
        },
      ],
    }).compile();
    const repository = module.get(OpdClinicalIntakeRepository);

    await repository.findIntake(ENCOUNTER_ID, EXAMINATION_ID, SCOPE);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        examination_id: EXAMINATION_ID,
        encounter_id: ENCOUNTER_ID,
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
      },
    });
  });

  it("carries tenant scope and expected version in the mutation itself", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [
        OpdClinicalIntakeRepository,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();
    const repository = module.get(OpdClinicalIntakeRepository);
    const tx = { opd_intake: { updateMany } };
    const now = new Date("2026-07-21T03:00:00.000Z");

    await repository.updateIntake(
      INTAKE_ID,
      ENCOUNTER_ID,
      EXAMINATION_ID,
      4,
      {
        urinaryStatus: OpdUrinaryStatus.NORMAL,
        urinaryOtherText: null,
        bowelStatus: OpdBowelStatus.DIARRHEA,
        bowelOtherText: null,
      },
      SCOPE,
      now,
      tx,
    );

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          intake_id: INTAKE_ID,
          examination_id: EXAMINATION_ID,
          encounter_id: ENCOUNTER_ID,
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          version: 4,
        },
      }),
    );
  });
});
