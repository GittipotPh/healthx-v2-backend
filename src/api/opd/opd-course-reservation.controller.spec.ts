import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import {
  REQUIRED_PERMISSIONS_KEY,
  type PermissionRequirement,
} from "../../auth/permissions.decorator";
import { OpdCourseReservationController } from "./opd-course-reservation.controller";
import { OpdCourseReservationService } from "./opd-course-reservation.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const PRINCIPAL: Principal = { email: "doctor@example.com", name: "Doctor" };

function requiredPermissions(
  method: keyof OpdCourseReservationController,
): PermissionRequirement | undefined {
  return Reflect.getMetadata(
    REQUIRED_PERMISSIONS_KEY,
    OpdCourseReservationController.prototype[method],
  );
}

describe("OpdCourseReservationController", () => {
  it.each<keyof OpdCourseReservationController>([
    "entitlements",
    "preflight",
    "current",
  ])("%s requires the complete read permission set", (method) => {
    expect(requiredPermissions(method)).toEqual({
      allOf: ["OPD_READ", "TREATMENT_READ", "CUSTOMER_COURSE_READ"],
      anyOf: [],
    });
  });

  it("uses separate reserve and bounded-void permission sets", () => {
    expect(requiredPermissions("reserve")).toEqual({
      allOf: ["OPD_EDIT", "TREATMENT_EDIT", "PURCHASE-COURSE_CREATE"],
      anyOf: [],
    });
    expect(requiredPermissions("voidReservation")).toEqual({
      allOf: ["OPD_EDIT", "TREATMENT_EDIT", "PURCHASE-COURSE_DELETE"],
      anyOf: [],
    });
  });

  it("delegates scoped reads and preflight", async () => {
    const service = {
      entitlements: jest.fn().mockResolvedValue({ items: [] }),
      preflight: jest.fn().mockResolvedValue({ eligible: false }),
      current: jest.fn().mockResolvedValue({ reservation: null }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdCourseReservationController],
      providers: [{ provide: OpdCourseReservationService, useValue: service }],
    }).compile();
    const controller = module.get(OpdCourseReservationController);
    const query = { page: 1, pageSize: 20 };
    const preflight = {
      selections: [{ entitlementToken: "x".repeat(32), quantity: 1 }],
    };

    await controller.entitlements("encounter-1", query, SCOPE);
    await controller.preflight("encounter-1", preflight, SCOPE);
    await controller.current("encounter-1", SCOPE);

    expect(service.entitlements).toHaveBeenCalledWith(
      "encounter-1",
      query,
      SCOPE,
    );
    expect(service.preflight).toHaveBeenCalledWith(
      "encounter-1",
      preflight,
      SCOPE,
    );
    expect(service.current).toHaveBeenCalledWith("encounter-1", SCOPE);
  });

  it("passes the stable key and trusted actor to reserve and void", async () => {
    const service = {
      reserve: jest.fn().mockResolvedValue({ status: "RESERVED" }),
      voidReservation: jest.fn().mockResolvedValue({ status: "VOIDED" }),
    };
    const module = await Test.createTestingModule({
      controllers: [OpdCourseReservationController],
      providers: [{ provide: OpdCourseReservationService, useValue: service }],
    }).compile();
    const controller = module.get(OpdCourseReservationController);
    const reserveDto = {
      selections: [{ entitlementToken: "x".repeat(32), quantity: 1 }],
      preflightToken: "y".repeat(32),
    };
    const voidDto = { expectedVersion: 1, reason: "Entered in error" };

    await controller.reserve(
      "encounter-1",
      reserveDto,
      "reserve-key-1",
      SCOPE,
      PRINCIPAL,
    );
    await controller.voidReservation(
      "encounter-1",
      "reservation-1",
      voidDto,
      "void-key-1",
      SCOPE,
      PRINCIPAL,
    );

    expect(service.reserve).toHaveBeenCalledWith(
      "encounter-1",
      reserveDto,
      "reserve-key-1",
      SCOPE,
      PRINCIPAL,
    );
    expect(service.voidReservation).toHaveBeenCalledWith(
      "encounter-1",
      "reservation-1",
      voidDto,
      "void-key-1",
      SCOPE,
      PRINCIPAL,
    );
  });
});
