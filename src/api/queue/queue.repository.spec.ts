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
