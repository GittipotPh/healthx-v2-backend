import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdCourseVerificationController } from "./opd-course-verification.controller";
import { OpdCourseVerificationService } from "./opd-course-verification.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };

function requiredPermissions(
  method: keyof OpdCourseVerificationController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdCourseVerificationController.prototype[method],
  );
}

describe("OpdCourseVerificationController", () => {
  it("keeps read, verify, request, review, and document permissions separate", () => {
    expect(requiredPermissions("preflight")).toEqual({
      allOf: ["OPD_READ", "TREATMENT_READ", "CUSTOMER_COURSE_READ"],
      anyOf: [],
    });
    expect(requiredPermissions("verify")).toEqual({
      allOf: ["OPD_EDIT", "TREATMENT_EDIT", "OPD_COURSE_VERIFY"],
      anyOf: [],
    });
    expect(requiredPermissions("requestCompensation")).toEqual({
      allOf: ["OPD_EDIT", "TREATMENT_EDIT", "PURCHASE-COURSE_DELETE"],
      anyOf: [],
    });
    expect(requiredPermissions("rejectCompensation")).toEqual({
      allOf: ["OPD_EDIT", "TREATMENT_EDIT", "OPD_COURSE_COMPENSATE"],
      anyOf: [],
    });
    expect(requiredPermissions("approveCompensation")).toEqual({
      allOf: ["OPD_EDIT", "TREATMENT_EDIT", "OPD_COURSE_COMPENSATE"],
      anyOf: [],
    });
    expect(requiredPermissions("document")).toEqual({
      allOf: ["OPD_READ", "CUSTOMER_COURSE_READ"],
      anyOf: [],
    });
  });

  it("passes trusted scope, actor, network data, file, and idempotency key", async () => {
    const service = {
      verify: jest.fn().mockResolvedValue({ status: "USED" }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdCourseVerificationController],
      providers: [{ provide: OpdCourseVerificationService, useValue: service }],
    }).compile();
    const controller = module.get(OpdCourseVerificationController);
    const dto = {
      preflightToken: "x".repeat(32),
      expectedVersion: 1,
      acknowledgementVersion: "opd-course-use-ack-v1",
      acknowledgementLocale: "en-US" as const,
    };
    const signature = {
      buffer: Buffer.from("png"),
      mimetype: "image/png",
    } as Express.Multer.File;

    await controller.verify(
      "encounter-1",
      "reservation-1",
      dto,
      signature,
      "verification-key-1",
      SCOPE,
      PRINCIPAL,
      "127.0.0.1",
      "jest",
    );

    expect(service.verify).toHaveBeenCalledWith(
      "encounter-1",
      "reservation-1",
      dto,
      signature,
      "verification-key-1",
      SCOPE,
      PRINCIPAL,
      { clientIp: "127.0.0.1", userAgent: "jest" },
    );
  });
});
