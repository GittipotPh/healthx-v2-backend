import { role_enum } from "@prisma/client";
import type { RequestScope } from "../../auth/auth.types";
import type { PrismaService } from "../../prisma.service";
import type { AuditLogService } from "../audit-log/audit-log.service";
import type { QueueTreatmentCompletionService } from "../queue/queue-treatment-completion.service";
import { OPD_NOTE_SECTION_ORDER } from "./opd-clinical-note.mapper";
import type { OpdClinicalFinalizationManifestDto } from "./dto/opd-clinical-finalization.dto";
import type {
  OpdClinicalFinalizationRepository,
  OpdFinalizationAggregate,
} from "./opd-clinical-finalization.repository";
import { OpdClinicalFinalizationService } from "./opd-clinical-finalization.service";

const ENCOUNTER_ID = "11111111-1111-4111-8111-111111111111";
const QUEUE_TICKET_ID = "22222222-2222-4222-8222-222222222222";
const EXAMINATION_ID = "33333333-3333-4333-8333-333333333333";
const FINALIZATION_ID = "44444444-4444-4444-8444-444444444444";

const scope: RequestScope = {
  userId: "doctor-1",
  clinicId: "clinic-1",
  branchId: "branch-1",
  isClinicRootUser: false,
  roles: [role_enum.DOCTOR],
};

function aggregate(
  overrides: Partial<OpdFinalizationAggregate> = {},
): OpdFinalizationAggregate {
  return {
    encounter_id: ENCOUNTER_ID,
    clinic_id: "clinic-1",
    branch_id: "branch-1",
    customer_id: "customer-1",
    appointment_id: "appointment-1",
    queue_ticket_id: QUEUE_TICKET_ID,
    legacy_opd_id: "legacy-opd-1",
    attending_user_id: "doctor-1",
    encounter_type: "APPOINTMENT",
    workflow_status: "OPEN",
    clinical_record_status: "DRAFT",
    reconciliation_status: "RECONCILED",
    business_date: new Date("2026-07-22T00:00:00.000Z"),
    started_at: new Date("2026-07-22T01:00:00.000Z"),
    started_by: "doctor-1",
    finalized_at: null,
    finalized_by: null,
    closed_at: null,
    closed_by: null,
    cancelled_at: null,
    cancelled_by: null,
    close_reason: null,
    cancellation_reason: null,
    version: 7,
    created_at: new Date("2026-07-22T01:00:00.000Z"),
    updated_at: new Date("2026-07-22T02:00:00.000Z"),
    queue_ticket: {
      queue_ticket_id: QUEUE_TICKET_ID,
      clinic_id: "clinic-1",
      branch_id: "branch-1",
      customer_id: "customer-1",
      appointment_id: "appointment-1",
      legacy_queue_status_id: null,
      source_type: "APPOINTMENT",
      business_date: new Date("2026-07-22T00:00:00.000Z"),
      current_step: "IN_SERVICE",
      entered_at: new Date("2026-07-22T02:00:00.000Z"),
      queue_sequence: 1,
      display_number: "A001",
      version: 5,
      cancelled_at: null,
      cancelled_by: null,
      cancellation_reason: null,
      created_by: "doctor-1",
      created_at: new Date("2026-07-22T01:00:00.000Z"),
      updated_at: new Date("2026-07-22T02:00:00.000Z"),
    },
    examinations: [
      {
        examination_id: EXAMINATION_ID,
        clinic_id: "clinic-1",
        branch_id: "branch-1",
        encounter_id: ENCOUNTER_ID,
        examination_number: 1,
        status: "FINAL",
        version: 3,
        measured_at: new Date("2026-07-22T02:00:00.000Z"),
        recorder_user_id: "nurse-1",
        examiner_user_id: "doctor-1",
        corrects_examination_id: null,
        supersedes_examination_id: null,
        correction_source_version: null,
        correction_reason: null,
        finalized_at: new Date("2026-07-22T02:30:00.000Z"),
        finalized_by: "doctor-1",
        voided_at: null,
        voided_by: null,
        void_reason: null,
        created_by: "nurse-1",
        updated_by: "doctor-1",
        created_at: new Date("2026-07-22T02:00:00.000Z"),
        updated_at: new Date("2026-07-22T02:30:00.000Z"),
        vital_observation: null,
        intake: null,
        symptom_section: null,
      },
    ],
    diagnosis_section: null,
    note_workspace: null,
    orders: [],
    draft_imports: [],
    clinical_finalization: null,
    ...overrides,
  } as OpdFinalizationAggregate;
}

function makeFixture(initial = aggregate()) {
  const tx = { name: "transaction-client" };
  const repository = {
    findAggregate: jest.fn().mockResolvedValue(initial),
    hasScopedLegacyOpd: jest.fn().mockResolvedValue(true),
    findEffectivePermissions: jest
      .fn()
      .mockResolvedValue(new Set(["OPD_EDIT", "OPD_FINALIZE"])),
    isValidAttendingDoctor: jest.fn().mockResolvedValue(true),
    findIdempotency: jest.fn().mockResolvedValue(null),
    createIdempotency: jest.fn().mockResolvedValue({
      api_idempotency_id: "claim-1",
    }),
    lockAggregate: jest.fn().mockResolvedValue(true),
    finalizeClinicalResources: jest.fn().mockResolvedValue(undefined),
    createClinicalFinalization: jest.fn().mockResolvedValue({}),
    completeIdempotency: jest.fn().mockResolvedValue(undefined),
    findFinalizationById: jest.fn(),
    findPostVisitContext: jest.fn(),
    assignAttendingClinician: jest.fn().mockResolvedValue(1),
  };
  const queueCompletion = {
    inspect: jest.fn().mockResolvedValue({
      ticket: initial.queue_ticket,
      blockers: [],
    }),
    complete: jest.fn().mockResolvedValue({
      queueTicketId: QUEUE_TICKET_ID,
      sourceVersion: 5,
      resultVersion: 6,
      sourceStep: "IN_SERVICE",
      resultStep: "DISPENSING",
      appointmentStatus: "DISPENSING",
    }),
  };
  const auditLogService = { create: jest.fn().mockResolvedValue({}) };
  const prisma = {
    $transaction: jest
      .fn()
      .mockImplementation(async (callback) => callback(tx)),
  };
  const service = new OpdClinicalFinalizationService(
    prisma as unknown as PrismaService,
    repository as unknown as OpdClinicalFinalizationRepository,
    queueCompletion as unknown as QueueTreatmentCompletionService,
    auditLogService as unknown as AuditLogService,
  );
  return {
    service,
    repository,
    queueCompletion,
    auditLogService,
    prisma,
    tx,
  };
}

describe("OpdClinicalFinalizationService", () => {
  it("returns a complete ready manifest with explicit zero-version optional resources", async () => {
    const { service } = makeFixture();

    const result = await service.readiness(ENCOUNTER_ID, scope);

    expect(result.ready).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.expectedVersions).toMatchObject({
      schema: "opd-clinical-finalization-v1",
      encounterId: ENCOUNTER_ID,
      encounterVersion: 7,
      examination: { id: EXAMINATION_ID, version: 3, status: "FINAL" },
      vitals: { id: null, version: 0, status: null },
      intake: { id: null, version: 0, status: null },
      symptoms: { id: null, version: 0, status: null },
      diagnoses: { id: null, version: 0, status: null },
      noteWorkspace: { id: null, version: 0, status: null },
      draftImport: { id: null, sections: [] },
      order: { id: null, version: 0, status: null, items: [] },
      queue: { id: QUEUE_TICKET_ID, version: 5, currentStep: "IN_SERVICE" },
      appointmentId: "appointment-1",
    });
    expect(result.expectedVersions.noteSections).toEqual(
      OPD_NOTE_SECTION_ORDER.map((sectionCode) => ({
        sectionCode,
        id: null,
        version: 0,
        status: null,
      })),
    );
  });

  it("returns stable blockers for a missing doctor, draft examination, draft order, and queue policy", async () => {
    const draftExamination = {
      ...aggregate().examinations[0],
      examination_id: "55555555-5555-4555-8555-555555555555",
      status: "DRAFT",
    };
    const blocked = aggregate({
      attending_user_id: null,
      examinations: [draftExamination],
      orders: [
        {
          order_id: "66666666-6666-4666-8666-666666666666",
          status: "DRAFT",
          version: 1,
          items: [],
          release: null,
        },
      ] as never,
    });
    const { service, repository, queueCompletion } = makeFixture(blocked);
    repository.isValidAttendingDoctor.mockResolvedValue(false);
    queueCompletion.inspect.mockResolvedValue({
      ticket: blocked.queue_ticket,
      blockers: ["QUEUE_DISPENSING_DISABLED"],
    });

    const result = await service.readiness(ENCOUNTER_ID, scope);

    expect(result.ready).toBe(false);
    expect(result.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "ATTENDING_DOCTOR_REQUIRED",
        "FINAL_EXAMINATION_REQUIRED",
        "EXAMINATION_DRAFT_PENDING",
        "ORDER_DRAFT_PENDING",
        "QUEUE_DISPENSING_DISABLED",
      ]),
    );
  });

  it("commits queue completion, clinical state, evidence, both audits, and idempotency through one transaction", async () => {
    const fixture = makeFixture();
    const readiness = await fixture.service.readiness(ENCOUNTER_ID, scope);

    const result = await fixture.service.finalize(
      ENCOUNTER_ID,
      { expectedVersions: readiness.expectedVersions },
      "finalize-key-1",
      scope,
      { email: "doctor@example.test", name: "Doctor One" },
    );

    expect(fixture.queueCompletion.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        queueTicketId: QUEUE_TICKET_ID,
        expectedVersion: 5,
      }),
      scope,
      expect.any(Object),
      fixture.tx,
    );
    expect(fixture.repository.finalizeClinicalResources).toHaveBeenCalledWith(
      expect.objectContaining({ encounter_id: ENCOUNTER_ID }),
      scope,
      expect.any(Date),
      fixture.tx,
    );
    expect(fixture.repository.createClinicalFinalization).toHaveBeenCalledWith(
      expect.objectContaining({
        encounterId: ENCOUNTER_ID,
        sourceEncounterVersion: 7,
        resultEncounterVersion: 8,
        sourceQueueTicketVersion: 5,
        resultQueueTicketVersion: 6,
      }),
      scope,
      expect.any(Date),
      fixture.tx,
    );
    expect(fixture.auditLogService.create).toHaveBeenCalledTimes(1);
    expect(fixture.repository.completeIdempotency).toHaveBeenCalledWith(
      "claim-1",
      expect.any(String),
      expect.objectContaining({ encounterId: ENCOUNTER_ID }),
      expect.any(Date),
      fixture.tx,
    );
    expect(result).toMatchObject({
      encounterId: ENCOUNTER_ID,
      workflowStatus: "POST_VISIT",
      clinicalRecordStatus: "FINALIZED",
      encounterVersion: 8,
      queueStep: "DISPENSING",
      queueTicketVersion: 6,
      replayed: false,
    });
  });

  it("rejects a stale manifest before queue or clinical writes", async () => {
    const fixture = makeFixture();
    const readiness = await fixture.service.readiness(ENCOUNTER_ID, scope);
    const stale: OpdClinicalFinalizationManifestDto = {
      ...readiness.expectedVersions,
      encounterVersion: 6,
    };

    await expect(
      fixture.service.finalize(
        ENCOUNTER_ID,
        { expectedVersions: stale },
        "finalize-key-2",
        scope,
        { email: "doctor@example.test", name: "Doctor One" },
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "CLINICAL_RESOURCE_VERSION_STALE",
      }),
    });

    expect(fixture.queueCompletion.complete).not.toHaveBeenCalled();
    expect(fixture.repository.finalizeClinicalResources).not.toHaveBeenCalled();
    expect(
      fixture.repository.createClinicalFinalization,
    ).not.toHaveBeenCalled();
    expect(fixture.repository.completeIdempotency).not.toHaveBeenCalled();
  });
});
