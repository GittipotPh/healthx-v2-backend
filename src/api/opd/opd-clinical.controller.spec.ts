import { role_enum } from "@prisma/client";
import { Test } from "@nestjs/testing";
import type { Principal, RequestScope } from "../../auth/auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdBowelStatus, OpdUrinaryStatus } from "./dto/opd-intake.dto";
import { OpdClinicalController } from "./opd-clinical.controller";
import { OpdClinicalIntakeService } from "./opd-clinical-intake.service";
import { OpdClinicalService } from "./opd-clinical.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};
const PRINCIPAL: Principal = { email: "nurse@example.com", name: "Nurse One" };

function requiredPermissions(
  method: keyof OpdClinicalController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdClinicalController.prototype[method],
  );
}

describe("OpdClinicalController", () => {
  it.each<[keyof OpdClinicalController, string]>([
    ["listExaminations", "OPD_READ"],
    ["examination", "OPD_READ"],
    ["createExamination", "OPD_EDIT"],
    ["patchVitals", "OPD_EDIT"],
    ["intake", "OPD_READ"],
    ["patchIntake", "OPD_EDIT"],
    ["finalizeExamination", "OPD_EDIT"],
  ])("%s requires %s", (method, permission) => {
    expect(requiredPermissions(method)).toEqual({
      allOf: [permission],
      anyOf: [],
    });
  });

  it("requires both edit and sensitive correction permission", () => {
    expect(requiredPermissions("createExaminationCorrection")).toEqual({
      allOf: ["OPD_EDIT", "OPD_CORRECT"],
      anyOf: [],
    });
  });

  it("derives patch actor identity from scope/principal rather than the body", async () => {
    const clinicalService = {
      patchVitals: jest.fn().mockResolvedValue({ examinationId: "exam-1" }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdClinicalController],
      providers: [
        { provide: OpdClinicalService, useValue: clinicalService },
        { provide: OpdClinicalIntakeService, useValue: {} },
      ],
    }).compile();
    const controller = module.get(OpdClinicalController);
    const dto = { expectedVersion: 1, weightKg: 70 };

    await controller.patchVitals(
      "encounter-1",
      "exam-1",
      dto,
      SCOPE,
      PRINCIPAL,
    );

    expect(clinicalService.patchVitals).toHaveBeenCalledWith(
      "encounter-1",
      "exam-1",
      dto,
      SCOPE,
      PRINCIPAL,
    );
  });

  it("delegates intake writes with trusted actor context", async () => {
    const intakeService = {
      patchIntake: jest.fn().mockResolvedValue({ intakeId: "intake-1" }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdClinicalController],
      providers: [
        { provide: OpdClinicalService, useValue: {} },
        { provide: OpdClinicalIntakeService, useValue: intakeService },
      ],
    }).compile();
    const controller = module.get(OpdClinicalController);
    const dto = {
      expectedVersion: 0,
      urinaryStatus: OpdUrinaryStatus.NORMAL,
      bowelStatus: OpdBowelStatus.NORMAL,
    };

    await controller.patchIntake(
      "encounter-1",
      "exam-1",
      dto,
      SCOPE,
      PRINCIPAL,
    );

    expect(intakeService.patchIntake).toHaveBeenCalledWith(
      "encounter-1",
      "exam-1",
      dto,
      SCOPE,
      PRINCIPAL,
    );
  });

  it("delegates a correction with header idempotency and trusted actor context", async () => {
    const clinicalService = {
      createExaminationCorrection: jest
        .fn()
        .mockResolvedValue({ examination: { examinationId: "exam-2" } }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdClinicalController],
      providers: [
        { provide: OpdClinicalService, useValue: clinicalService },
        { provide: OpdClinicalIntakeService, useValue: {} },
      ],
    }).compile();
    const controller = module.get(OpdClinicalController);
    const dto = {
      expectedExaminationVersion: 2,
      expectedVitalVersion: 1,
      reason: "Correct transcribed blood pressure",
    };

    await controller.createExaminationCorrection(
      "encounter-1",
      "exam-1",
      dto,
      "correction-attempt-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(clinicalService.createExaminationCorrection).toHaveBeenCalledWith(
      "encounter-1",
      "exam-1",
      dto,
      "correction-attempt-1",
      SCOPE,
      PRINCIPAL,
    );
  });
});
