import type { PrismaService } from "../../prisma.service";
import type { RequestScope } from "../../auth/auth.types";
import { role_enum } from "@prisma/client";
import { OpdRepository } from "./opd.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};

describe("OpdRepository Phase 1 start lookups", () => {
  it.each([
    [{ customer_id: "customer-1", customer_status: true }, true],
    [{ customer_id: "customer-1", customer_status: false }, false],
    [null, false],
  ])("accepts only active clinic customers", async (row, expected) => {
    const customer = { findUnique: jest.fn().mockResolvedValue(row) };
    const repository = new OpdRepository({
      customer,
    } as unknown as PrismaService);

    await expect(
      repository.customerExistsInClinic("customer-1", SCOPE.clinicId),
    ).resolves.toBe(expected);
    expect(customer.findUnique).toHaveBeenCalledWith({
      where: {
        customer_id_clinic_id: {
          customer_id: "customer-1",
          clinic_id: SCOPE.clinicId,
        },
      },
      select: { customer_id: true, customer_status: true },
    });
  });

  it("finds only active same-day walk-ins inside the caller scope", async () => {
    const opdEncounter = { findFirst: jest.fn().mockResolvedValue(null) };
    const repository = new OpdRepository({
      opd_encounter: opdEncounter,
    } as unknown as PrismaService);
    const businessDate = new Date("2026-07-18T00:00:00.000Z");

    await repository.findActiveWalkInEncounter(
      "customer-1",
      businessDate,
      SCOPE,
    );

    expect(opdEncounter.findFirst).toHaveBeenCalledWith({
      where: {
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        customer_id: "customer-1",
        appointment_id: null,
        encounter_type: "WALK_IN",
        business_date: businessDate,
        workflow_status: { in: ["OPEN", "POST_VISIT"] },
      },
      orderBy: { created_at: "desc" },
    });
  });
});
