import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import { OpdVitalTrendMetric } from "./dto/opd-clinical-history.dto";
import { OpdClinicalHistoryRepository } from "./opd-clinical-history.repository";
import { OpdClinicalHistoryService } from "./opd-clinical-history.service";

const SCOPE: RequestScope = {
  userId: "user-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.NURSE],
};
const MEASURED_AT = new Date("2026-07-20T03:00:00.000Z");

const VITAL = {
  vital_observation_id: "33333333-3333-4333-8333-333333333333",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: "11111111-1111-4111-8111-111111111111",
  examination_id: "22222222-2222-4222-8222-222222222222",
  weight_kg: 70,
  height_cm: 175,
  body_mass_index: 22.86,
  systolic_blood_pressure_mmhg: 120,
  diastolic_blood_pressure_mmhg: 80,
  pulse_rate_per_minute: 78,
  temperature_celsius: 36.5,
  oxygen_saturation_percent: 98,
  respiratory_rate_per_minute: 18,
  dtx_mg_dl: 92,
  pain_score: 2,
  reference_rule_version: null,
  interpretation_snapshot: null,
  version: 3,
  created_by: "user-1",
  updated_by: "user-1",
  created_at: MEASURED_AT,
  updated_at: MEASURED_AT,
};

const SYMPTOM_SECTION = {
  symptom_section_id: "44444444-4444-4444-8444-444444444444",
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: VITAL.encounter_id,
  examination_id: VITAL.examination_id,
  patient_quote: "Headache since yesterday",
  version: 2,
  created_by: "user-1",
  updated_by: "user-1",
  created_at: MEASURED_AT,
  updated_at: MEASURED_AT,
  symptoms: [
    {
      symptom_id: "55555555-5555-4555-8555-555555555555",
      clinic_id: SCOPE.clinicId,
      branch_id: SCOPE.branchId,
      encounter_id: VITAL.encounter_id,
      symptom_section_id: "44444444-4444-4444-8444-444444444444",
      display_order: 1,
      main_code: null,
      main_text: "Headache",
      duration_value: 1,
      duration_unit: "DAY",
      location: "Head",
      laterality: "BILATERAL",
      severity: 4,
      character: null,
      modifying_factors: null,
      staff_summary: null,
      created_by: "user-1",
      updated_by: "user-1",
      created_at: MEASURED_AT,
      updated_at: MEASURED_AT,
      associations: [],
    },
  ],
};

const HISTORY_ROW = {
  examination_id: VITAL.examination_id,
  clinic_id: SCOPE.clinicId,
  branch_id: SCOPE.branchId,
  encounter_id: VITAL.encounter_id,
  examination_number: 1,
  status: "FINAL",
  version: 2,
  measured_at: MEASURED_AT,
  recorder_user_id: "recorder-1",
  examiner_user_id: null,
  finalized_at: MEASURED_AT,
  finalized_by: "doctor-1",
  voided_at: null,
  voided_by: null,
  void_reason: null,
  created_by: "user-1",
  updated_by: "user-1",
  created_at: MEASURED_AT,
  updated_at: MEASURED_AT,
  vital_observation: VITAL,
  symptom_section: SYMPTOM_SECTION,
  encounter: {
    customer_id: "customer-1",
    legacy_opd_id: "OPDV2-20260720-000001",
    business_date: new Date("2026-07-20T00:00:00.000Z"),
  },
};

async function makeService() {
  const repository = {
    customerExists: jest.fn().mockResolvedValue(true),
    listCustomerExaminations: jest.fn().mockResolvedValue({
      items: [HISTORY_ROW],
      total: 1,
      recorderUserIds: ["recorder-1"],
      page: 1,
      pageSize: 20,
    }),
    findCustomerExamination: jest.fn().mockResolvedValue(HISTORY_ROW),
    listVitalTrend: jest.fn().mockResolvedValue({
      items: [HISTORY_ROW],
      total: 1,
      limit: 200,
    }),
    branchName: jest.fn().mockResolvedValue("Siam"),
    usersByIds: jest.fn().mockResolvedValue([
      {
        user_id: "recorder-1",
        name: "Nurse",
        lastname: "One",
        nickname: null,
        email: "nurse@example.com",
      },
    ]),
  };
  const module = await Test.createTestingModule({
    providers: [
      OpdClinicalHistoryService,
      { provide: OpdClinicalHistoryRepository, useValue: repository },
    ],
  }).compile();
  return { service: module.get(OpdClinicalHistoryService), repository };
}

describe("OpdClinicalHistoryService", () => {
  it("returns scoped paged history with full vitals and repeatable symptoms", async () => {
    const { service, repository } = await makeService();
    const query = {
      dateFrom: "2026-07-01",
      dateTo: "2026-07-20",
      page: 1,
      pageSize: 20,
    };

    const result = await service.listExaminations("customer-1", query, SCOPE);

    expect(repository.listCustomerExaminations).toHaveBeenCalledWith(
      "customer-1",
      query,
      SCOPE,
    );
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        businessDate: "2026-07-20",
        branchId: SCOPE.branchId,
        branchName: "Siam",
        recorderDisplayName: "Nurse One",
        examination: expect.objectContaining({
          examinationId: VITAL.examination_id,
          vitals: expect.objectContaining({ weightKg: 70, heightCm: 175 }),
        }),
        symptoms: expect.objectContaining({
          patientQuote: "Headache since yesterday",
          items: [expect.objectContaining({ mainText: "Headache" })],
        }),
      }),
    );
    expect(result.facets.recorders).toEqual([
      { userId: "recorder-1", displayName: "Nurse One" },
    ]);
  });

  it("rejects invalid calendar ranges before querying clinical history", async () => {
    const { service, repository } = await makeService();

    await expect(
      service.listExaminations("customer-1", { dateFrom: "2026-02-30" }, SCOPE),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.listExaminations(
        "customer-1",
        { dateFrom: "2026-07-20", dateTo: "2026-07-01" },
        SCOPE,
      ),
    ).rejects.toThrow("dateFrom must not be after dateTo");
    expect(repository.listCustomerExaminations).not.toHaveBeenCalled();
  });

  it("does not leak a cross-customer or cross-branch examination", async () => {
    const { service, repository } = await makeService();
    repository.findCustomerExamination.mockResolvedValue(null);

    await expect(
      service.examination("customer-1", VITAL.examination_id, SCOPE),
    ).rejects.toThrow(NotFoundException);
    expect(repository.findCustomerExamination).toHaveBeenCalledWith(
      "customer-1",
      VITAL.examination_id,
      SCOPE,
    );
  });

  it("returns chronological server metric points without invented ranges", async () => {
    const { service, repository } = await makeService();
    const older = {
      ...HISTORY_ROW,
      examination_id: "66666666-6666-4666-8666-666666666666",
      measured_at: new Date("2026-07-10T03:00:00.000Z"),
      vital_observation: {
        ...VITAL,
        examination_id: "66666666-6666-4666-8666-666666666666",
        weight_kg: 72,
      },
      encounter: {
        ...HISTORY_ROW.encounter,
        business_date: new Date("2026-07-10T00:00:00.000Z"),
      },
    };
    repository.listVitalTrend.mockResolvedValue({
      items: [HISTORY_ROW, older],
      total: 3,
      limit: 2,
    });

    const result = await service.vitalTrend(
      "customer-1",
      { metric: OpdVitalTrendMetric.WEIGHT_KG, limit: 2 },
      SCOPE,
    );

    expect(result.points.map((point) => point.primaryValue)).toEqual([72, 70]);
    expect(result.referenceRanges).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(result.unit).toBe("kg");
  });

  it("returns a clinic-scoped not-found before touching OPD history", async () => {
    const { service, repository } = await makeService();
    repository.customerExists.mockResolvedValue(false);

    await expect(
      service.listExaminations("missing", {}, SCOPE),
    ).rejects.toThrow("Customer not found for this clinic");
    expect(repository.listCustomerExaminations).not.toHaveBeenCalled();
  });
});
