import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdOrderReleaseController } from "./opd-order-release.controller";
import { OpdOrderReleaseService } from "./opd-order-release.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };

function requiredPermissions(
  method: keyof OpdOrderReleaseController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdOrderReleaseController.prototype[method],
  );
}

describe("OpdOrderReleaseController", () => {
  it.each<keyof OpdOrderReleaseController>([
    "preflight",
    "release",
    "voidRelease",
  ])("%s requires the full medication-release permission set", (method) => {
    expect(requiredPermissions(method)).toEqual({
      allOf: ["OPD_EDIT", "TREATMENT_EDIT", "SALE-ORDER_CREATE"],
      anyOf: [],
    });
  });

  it("delegates preflight with trusted scope", async () => {
    const service = {
      preflight: jest.fn().mockResolvedValue({ eligible: true }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdOrderReleaseController],
      providers: [{ provide: OpdOrderReleaseService, useValue: service }],
    }).compile();
    const controller = module.get(OpdOrderReleaseController);
    const dto = {
      expectedOrderVersion: 2,
      itemVersions: [{ orderItemId: "item-1", version: 2 }],
      selectedLots: [{ orderItemId: "item-1", lotId: "LOT-1" }],
    };

    await controller.preflight("encounter-1", "order-1", dto, SCOPE);

    expect(service.preflight).toHaveBeenCalledWith(
      "encounter-1",
      "order-1",
      dto,
      SCOPE,
    );
  });

  it("passes the idempotency key and actor to release and void", async () => {
    const service = {
      release: jest.fn().mockResolvedValue({ orderStatus: "RELEASED" }),
      voidRelease: jest.fn().mockResolvedValue({ orderStatus: "VOIDED" }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdOrderReleaseController],
      providers: [{ provide: OpdOrderReleaseService, useValue: service }],
    }).compile();
    const controller = module.get(OpdOrderReleaseController);
    const releaseDto = {
      expectedOrderVersion: 2,
      itemVersions: [{ orderItemId: "item-1", version: 2 }],
      selectedLots: [{ orderItemId: "item-1", lotId: "LOT-1" }],
      preflightToken: "token",
      safetyAcknowledgement: {
        safetySnapshotHash: "a".repeat(64),
        acknowledged: true as const,
      },
    };
    const voidDto = { expectedOrderVersion: 3, reason: "Entered in error" };

    await controller.release(
      "encounter-1",
      "order-1",
      releaseDto,
      "release-key-1",
      SCOPE,
      PRINCIPAL,
    );
    await controller.voidRelease(
      "encounter-1",
      "order-1",
      voidDto,
      "void-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(service.release).toHaveBeenCalledWith(
      "encounter-1",
      "order-1",
      releaseDto,
      "release-key-1",
      SCOPE,
      PRINCIPAL,
    );
    expect(service.voidRelease).toHaveBeenCalledWith(
      "encounter-1",
      "order-1",
      voidDto,
      "void-key-1",
      SCOPE,
      PRINCIPAL,
    );
  });
});
