import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { PrismaService } from "../../prisma.service";
import { OpdVitalTrendMetric } from "./dto/opd-clinical-history.dto";
import { OpdClinicalHistoryRepository } from "./opd-clinical-history.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};

async function makeRepository() {
  const prisma = {
    customer: { findFirst: jest.fn() },
    opd_examination: {
      findMany: jest.fn(),
      count: jest.fn(),
      findFirst: jest.fn(),
    },
    branch: { findFirst: jest.fn() },
    user: { findMany: jest.fn() },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations),
    ),
  };
  const module = await Test.createTestingModule({
    providers: [
      OpdClinicalHistoryRepository,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return {
    repository: module.get(OpdClinicalHistoryRepository),
    prisma,
  };
}

describe("OpdClinicalHistoryRepository", () => {
  it("scopes paged history and recorder facets to clinic, branch, customer, and date", async () => {
    const { repository, prisma } = await makeRepository();
    prisma.opd_examination.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ recorder_user_id: "recorder-1" }]);
    prisma.opd_examination.count.mockResolvedValue(0);

    const result = await repository.listCustomerExaminations(
      "customer-1",
      {
        dateFrom: "2026-07-01",
        dateTo: "2026-07-20",
        recorderUserId: "recorder-1",
        page: 2,
        pageSize: 10,
      },
      SCOPE,
    );

    expect(prisma.opd_examination.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          status: { not: "VOID" },
          recorder_user_id: "recorder-1",
          encounter: {
            customer_id: "customer-1",
            business_date: {
              gte: new Date("2026-07-01T00:00:00.000Z"),
              lte: new Date("2026-07-20T00:00:00.000Z"),
            },
          },
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(prisma.opd_examination.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.not.objectContaining({
          recorder_user_id: expect.anything(),
        }),
        distinct: ["recorder_user_id"],
      }),
    );
    expect(result.recorderUserIds).toEqual(["recorder-1"]);
  });

  it("uses only current draft/final rows with a non-empty selected trend metric", async () => {
    const { repository, prisma } = await makeRepository();
    prisma.opd_examination.findMany.mockResolvedValue([]);
    prisma.opd_examination.count.mockResolvedValue(0);

    await repository.listVitalTrend(
      "customer-1",
      { metric: OpdVitalTrendMetric.BLOOD_PRESSURE, limit: 25 },
      SCOPE,
    );

    expect(prisma.opd_examination.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          clinic_id: SCOPE.clinicId,
          branch_id: SCOPE.branchId,
          status: { in: ["DRAFT", "FINAL"] },
          OR: [
            { status: "FINAL" },
            { status: "DRAFT", supersedes_examination_id: null },
          ],
          encounter: { customer_id: "customer-1" },
          vital_observation: {
            is: {
              OR: [
                { systolic_blood_pressure_mmhg: { not: null } },
                { diastolic_blood_pressure_mmhg: { not: null } },
              ],
            },
          },
        }),
        orderBy: [
          { measured_at: "desc" },
          { examination_number: "desc" },
          { examination_id: "desc" },
        ],
        take: 25,
      }),
    );
  });

  it("hydrates staff names without reading another clinic's user row", async () => {
    const { repository, prisma } = await makeRepository();
    prisma.user.findMany.mockResolvedValue([]);

    await repository.usersByIds(["user-1"], SCOPE);

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user_id: { in: ["user-1"] },
          OR: [{ clinic_id: SCOPE.clinicId }, { clinic_id: null }],
        },
      }),
    );
  });
});
