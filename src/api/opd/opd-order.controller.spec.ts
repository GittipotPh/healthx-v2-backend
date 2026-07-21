import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdOrderSourceType } from "./dto/opd-order.dto";
import { OpdOrderController } from "./opd-order.controller";
import { OpdOrderService } from "./opd-order.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };

function requiredPermissions(
  method: keyof OpdOrderController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdOrderController.prototype[method],
  );
}

describe("OpdOrderController", () => {
  it.each<[keyof OpdOrderController, string]>([
    ["catalog", "OPD_READ"],
    ["draftOrder", "OPD_READ"],
    ["createDraftOrder", "OPD_EDIT"],
    ["addItem", "OPD_EDIT"],
    ["patchItem", "OPD_EDIT"],
    ["voidItem", "OPD_EDIT"],
  ])("%s requires %s", (method, permission) => {
    expect(requiredPermissions(method)).toEqual({
      allOf: [permission],
      anyOf: [],
    });
  });

  it("delegates item creation with trusted scope and actor context", async () => {
    const service = { addItem: jest.fn().mockResolvedValue({ version: 2 }) };
    const module = await Test.createTestingModule({
      controllers: [OpdOrderController],
      providers: [{ provide: OpdOrderService, useValue: service }],
    }).compile();
    const controller = module.get(OpdOrderController);
    const dto = {
      expectedOrderVersion: 1,
      sourceType: OpdOrderSourceType.PRODUCT,
      sourceId: "product-1",
      quantity: 1,
    };

    await controller.addItem("encounter-1", "order-1", dto, SCOPE, PRINCIPAL);

    expect(service.addItem).toHaveBeenCalledWith(
      "encounter-1",
      "order-1",
      dto,
      SCOPE,
      PRINCIPAL,
    );
  });
});
