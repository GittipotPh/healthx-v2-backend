import { role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdController } from "./opd.controller";
import type { OpdService } from "./opd.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};

function requiredPermissions(
  method: keyof OpdController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdController.prototype[method],
  ) as PermissionRequirement | undefined;
}

describe("OpdController", () => {
  it.each<[keyof OpdController, string]>([
    ["list", "OPD_READ"],
    ["history", "OPD_READ"],
    ["start", "OPD_CREATE"],
    ["worklist", "OPD_READ"],
    ["workspace", "OPD_READ"],
  ])("%s requires %s", (method, permission) => {
    expect(requiredPermissions(method)).toEqual({
      allOf: [permission],
      anyOf: [],
    });
  });

  it("delegates the OPD worklist to the dedicated OPD service", async () => {
    const result = {
      date: "2026-07-18",
      items: [],
      facets: { total: 0, appointments: 0, walkIns: 0, byStep: {} },
    };
    const opdService = {
      worklist: jest.fn().mockResolvedValue(result),
    };
    const controller = new OpdController(opdService as unknown as OpdService);

    await expect(
      controller.worklist({ date: "2026-07-18" }, SCOPE),
    ).resolves.toEqual(result);
    expect(opdService.worklist).toHaveBeenCalledWith(
      { date: "2026-07-18" },
      SCOPE,
    );
  });
});
