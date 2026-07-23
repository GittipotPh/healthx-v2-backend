import { Prisma, role_enum, type opd_symptom_section } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import type { PrismaService } from "../../prisma.service";
import { OpdClinicalSectionRepository } from "./opd-clinical-section.repository";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};
const NOW = new Date("2026-07-23T09:00:00.000Z");
const SECTION: opd_symptom_section = {
  symptom_section_id: "11111111-1111-4111-8111-111111111111",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: "22222222-2222-4222-8222-222222222222",
  examination_id: "33333333-3333-4333-8333-333333333333",
  patient_quote: null,
  version: 1,
  created_by: SCOPE.userId,
  updated_by: SCOPE.userId,
  created_at: NOW,
  updated_at: NOW,
};

describe("OpdClinicalSectionRepository.replaceSymptoms", () => {
  it("lets the nested symptom relation derive association tenant keys", async () => {
    const symptomCreate = jest.fn().mockResolvedValue({});
    const tx = {
      opd_symptom_section: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      opd_symptom: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: symptomCreate,
      },
    } as unknown as Prisma.TransactionClient;
    const repository = new OpdClinicalSectionRepository({} as PrismaService);

    await expect(
      repository.replaceSymptoms(
        SECTION,
        1,
        "itching",
        [
          {
            mainText: "Facial itching",
            associations: [{ code: null, label: "Dry skin" }],
          },
        ],
        SCOPE,
        NOW,
        tx,
      ),
    ).resolves.toBe(true);

    expect(symptomCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        clinic_id: SCOPE.clinicId,
        branch_id: SCOPE.branchId,
        encounter_id: SECTION.encounter_id,
        associations: {
          create: [
            {
              display_order: 1,
              code: null,
              label: "Dry skin",
              created_at: NOW,
            },
          ],
        },
      }),
    });
  });
});
