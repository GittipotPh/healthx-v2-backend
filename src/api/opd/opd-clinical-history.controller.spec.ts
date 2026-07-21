import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdClinicalHistoryController } from "./opd-clinical-history.controller";
import { OpdClinicalHistoryService } from "./opd-clinical-history.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};

function requiredPermissions(
  method: keyof OpdClinicalHistoryController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdClinicalHistoryController.prototype[method],
  );
}

describe("OpdClinicalHistoryController", () => {
  it.each<keyof OpdClinicalHistoryController>([
    "listExaminations",
    "examination",
    "vitalTrend",
  ])("%s requires OPD_READ", (method) => {
    expect(requiredPermissions(method)).toEqual({
      allOf: ["OPD_READ"],
      anyOf: [],
    });
  });

  it("forwards the server-validated scope to customer history", async () => {
    const service = {
      listExaminations: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdClinicalHistoryController],
      providers: [{ provide: OpdClinicalHistoryService, useValue: service }],
    }).compile();
    const controller = module.get(OpdClinicalHistoryController);
    const query = { dateFrom: "2026-07-01", page: 2, pageSize: 10 };

    await controller.listExaminations("customer-1", query, SCOPE);

    expect(service.listExaminations).toHaveBeenCalledWith(
      "customer-1",
      query,
      SCOPE,
    );
  });
});
