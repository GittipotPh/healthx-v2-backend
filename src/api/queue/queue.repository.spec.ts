import { ConflictException } from "@nestjs/common";
import { statusAppointment } from "@prisma/client";
import type { PrismaService } from "../../prisma.service";
import type { SaveAnestheticDto } from "./dto/save-anesthetic.dto";
import type { SaveConsultationDto } from "./dto/save-consultation.dto";
import { QueueRepository } from "./queue.repository";

const CLINIC_ID = "clinic-1";
const BRANCH_ID = "branch-1";
const APPOINTMENT_ID = "appointment-1";

function makeRepository() {
  const prisma = {
    appointment: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    queue_status: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    appointment_consultation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    appointment_anesthetic: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    prescription: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    opd: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    service_usage: {
      count: jest.fn().mockResolvedValue(0),
    },
  };
  return {
    repository: new QueueRepository(prisma as unknown as PrismaService),
    prisma,
  };
}

describe("QueueRepository tenant-scoped writes", () => {
  it("scopes appointment status updates and rejects a missing scoped row", async () => {
    const { repository, prisma } = makeRepository();
    prisma.appointment.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      repository.updateAppointmentStatus(
        CLINIC_ID,
        BRANCH_ID,
        APPOINTMENT_ID,
        statusAppointment.ARRIVED,
      ),
    ).rejects.toThrow(ConflictException);

    expect(prisma.appointment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          appointment_id: APPOINTMENT_ID,
          clinic_id: CLINIC_ID,
          branch_id: BRANCH_ID,
        },
      }),
    );
  });

  it("does not update a queue status owned by another branch", async () => {
    const { repository, prisma } = makeRepository();
    prisma.queue_status.findUnique.mockResolvedValue({
      queue_status_id: "queue-status-foreign",
      clinic_id: CLINIC_ID,
      branch_id: "branch-foreign",
      appointment_id: APPOINTMENT_ID,
      current_step: "ARRIVED",
      entered_at: new Date(),
    });

    await expect(
      repository.upsertQueueStep(
        CLINIC_ID,
        BRANCH_ID,
        APPOINTMENT_ID,
        "CONSULTING",
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.queue_status.update).not.toHaveBeenCalled();
  });

  it("does not update a consultation owned by another clinic", async () => {
    const { repository, prisma } = makeRepository();
    prisma.appointment_consultation.findUnique.mockResolvedValue({
      consultation_id: "consultation-foreign",
      clinic_id: "clinic-foreign",
      branch_id: BRANCH_ID,
      appointment_id: APPOINTMENT_ID,
    });
    const dto: SaveConsultationDto = {
      appointmentId: APPOINTMENT_ID,
      outcome: "interested",
    };

    await expect(
      repository.upsertConsultation(
        { clinicId: CLINIC_ID, branchId: BRANCH_ID, userId: "user-1" },
        dto,
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.appointment_consultation.update).not.toHaveBeenCalled();
  });

  it("does not update an anesthetic record owned by another branch", async () => {
    const { repository, prisma } = makeRepository();
    prisma.appointment_anesthetic.findUnique.mockResolvedValue({
      anesthetic_id: "anesthetic-foreign",
      clinic_id: CLINIC_ID,
      branch_id: "branch-foreign",
      appointment_id: APPOINTMENT_ID,
    });
    const dto: SaveAnestheticDto = {
      appointmentId: APPOINTMENT_ID,
      allergyStatus: "none",
      nurseRef: "Nurse",
      durationMinutes: 30,
    };

    await expect(
      repository.upsertAnesthetic(
        { clinicId: CLINIC_ID, branchId: BRANCH_ID, userId: "user-1" },
        dto,
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.appointment_anesthetic.update).not.toHaveBeenCalled();
  });
});

describe("QueueRepository OPD prerequisites", () => {
  it("treats a scoped prescription without a sale order as unpaid", async () => {
    const { repository, prisma } = makeRepository();
    prisma.prescription.findMany.mockResolvedValue([
      { prescribe_id: "prescription-1", sale_order: null },
    ]);

    await expect(
      repository.hasUnpaidPrescriptions("opd-1", BRANCH_ID),
    ).resolves.toBe(true);
    expect(prisma.prescription.findMany).toHaveBeenCalledWith({
      where: { opd_id: "opd-1", branch_id: BRANCH_ID },
      include: { sale_order: true },
    });
  });

  it("uses the complete branch-scoped OPD identity for medicine and course checks", async () => {
    const { repository, prisma } = makeRepository();
    prisma.prescription.count.mockResolvedValue(1);
    prisma.opd.findFirst.mockResolvedValue({ management_item: "usage-1" });
    prisma.service_usage.count.mockResolvedValue(1);

    await expect(repository.hasPrescriptions("opd-1", BRANCH_ID)).resolves.toBe(
      true,
    );
    await expect(repository.hasUsedCourse("opd-1", BRANCH_ID)).resolves.toBe(
      true,
    );

    expect(prisma.prescription.count).toHaveBeenCalledWith({
      where: { opd_id: "opd-1", branch_id: BRANCH_ID },
    });
    expect(prisma.opd.findFirst).toHaveBeenCalledWith({
      where: { opd_id: "opd-1", branch_id: BRANCH_ID },
      select: { management_item: true },
    });
    expect(prisma.service_usage.count).toHaveBeenCalledWith({
      where: {
        service_usage_id: "usage-1",
        branch_id: BRANCH_ID,
        service_usage_status: "APPROVED",
      },
    });
  });
});
