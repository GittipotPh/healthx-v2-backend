import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import { OpdOrderRepository } from "./opd-order.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "22222222-2222-4222-8222-222222222222";

describe("OpdOrderRepository", () => {
  it("scopes order reads through encounter, clinic, and branch identity", async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const module = await Test.createTestingModule({
      providers: [
        OpdOrderRepository,
        {
          provide: PrismaService,
          useValue: { opd_order: { findFirst } },
        },
      ],
    }).compile();
    const repository = module.get(OpdOrderRepository);

    await repository.findDraftOrder(ENCOUNTER_ID, SCOPE);

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        encounter_id: ENCOUNTER_ID,
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
      },
      include: {
        items: {
          orderBy: { display_order: "asc" },
          include: { medication_instruction: true },
        },
      },
    });
  });

  it("carries both tenant scope and expected aggregate version in recalculation", async () => {
    const aggregate = jest.fn().mockResolvedValue({
      _sum: { gross_amount: null },
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const module = await Test.createTestingModule({
      providers: [OpdOrderRepository, { provide: PrismaService, useValue: {} }],
    }).compile();
    const repository = module.get(OpdOrderRepository);
    const tx = {
      opd_order_item: { aggregate },
      opd_order: { updateMany },
    };

    await repository.recalculateAndBumpOrder(
      ORDER_ID,
      ENCOUNTER_ID,
      7,
      SCOPE,
      new Date("2026-07-21T03:00:00.000Z"),
      tx,
    );

    expect(aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order_id: ORDER_ID,
          encounter_id: ENCOUNTER_ID,
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          status: "ACTIVE",
        },
      }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          order_id: ORDER_ID,
          encounter_id: ENCOUNTER_ID,
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          status: "DRAFT",
          version: 7,
        },
      }),
    );
  });
});
