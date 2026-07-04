import { Injectable } from "@nestjs/common";
import type {
  appointment,
  appointment_anesthetic,
  appointment_consultation,
  Prisma,
  queue_status,
  statusAppointment,
} from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { AppointmentForQueue } from "./queue.mapper";
import type { SaveConsultationDto } from "./dto/save-consultation.dto";
import type { SaveAnestheticDto } from "./dto/save-anesthetic.dto";

@Injectable()
export class QueueRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTodayQueue(
    clinicId: string,
    branchId: string,
    date: string,
  ): Promise<AppointmentForQueue[]> {
    return this.prisma.appointment.findMany({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        date_appointment: date,
      },
      include: {
        customer: {
          include: {
            customer_info: true,
          },
        },
        opd: true,
      },
      orderBy: { start_time: "asc" },
    });
  }

  async findAppointment(
    clinicId: string,
    branchId: string,
    appointmentId: string,
  ): Promise<appointment | null> {
    const found = await this.prisma.appointment.findUnique({
      where: { appointment_id: appointmentId },
    });
    if (!found || found.clinic_id !== clinicId || found.branch_id !== branchId) {
      return null;
    }
    return found;
  }

  async updateAppointmentStatus(
    appointmentId: string,
    status: statusAppointment,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<appointment> {
    return tx.appointment.update({
      where: { appointment_id: appointmentId },
      data: { status_appointment: status, updated_at: new Date() },
    });
  }

  async findQueueStatusesByAppointmentIds(
    appointmentIds: string[],
  ): Promise<Record<string, string>> {
    if (appointmentIds.length === 0) return {};
    const rows = await this.prisma.queue_status.findMany({
      where: { appointment_id: { in: appointmentIds } },
      select: { appointment_id: true, current_step: true },
    });
    return Object.fromEntries(rows.map((row) => [row.appointment_id, row.current_step]));
  }

  async findQueueStatus(appointmentId: string): Promise<queue_status | null> {
    return this.prisma.queue_status.findUnique({ where: { appointment_id: appointmentId } });
  }

  /** Advances (or creates) an appointment's queue card to `stepCode`, refreshing `entered_at` only when the step actually changes. */
  async upsertQueueStep(
    clinicId: string,
    branchId: string,
    appointmentId: string,
    stepCode: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<queue_status> {
    const now = new Date();
    const existing = await tx.queue_status.findUnique({ where: { appointment_id: appointmentId } });
    if (!existing) {
      return tx.queue_status.create({
        data: {
          clinic_id: clinicId,
          branch_id: branchId,
          appointment_id: appointmentId,
          current_step: stepCode,
          entered_at: now,
          updated_at: now,
        },
      });
    }
    return tx.queue_status.update({
      where: { appointment_id: appointmentId },
      data: {
        current_step: stepCode,
        entered_at: existing.current_step === stepCode ? existing.entered_at : now,
        updated_at: now,
      },
    });
  }

  /** Upserts the consult detail record for an appointment (one row per appointment). */
  async upsertConsultation(
    scope: { clinicId: string; branchId: string; userId: string },
    dto: SaveConsultationDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<appointment_consultation> {
    const now = new Date();
    const data = {
      consultant_ref: dto.consultantRef ?? null,
      budget: dto.budget ?? null,
      promotion: dto.promotion ?? null,
      outcome: dto.outcome,
      services_interested: (dto.servicesInterested ?? []) as Prisma.InputJsonValue,
      notes: dto.notes ?? null,
      updated_at: now,
    };
    return tx.appointment_consultation.upsert({
      where: { appointment_id: dto.appointmentId },
      create: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        appointment_id: dto.appointmentId,
        created_by: scope.userId,
        ...data,
      },
      update: data,
    });
  }

  /**
   * Upserts the anaesthetic detail record for an appointment (one row per
   * appointment). Every save — create or update — restarts `started_at`,
   * because resubmitting the modal means the nurse re-applied the anaesthetic.
   */
  async upsertAnesthetic(
    scope: { clinicId: string; branchId: string; userId: string },
    dto: SaveAnestheticDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<appointment_anesthetic> {
    const now = new Date();
    const data = {
      allergy_status: dto.allergyStatus,
      allergy_notes: dto.allergyNotes ?? null,
      nurse_ref: dto.nurseRef,
      room: dto.room ?? null,
      bed: dto.bed ?? null,
      duration_minutes: dto.durationMinutes,
      notes: dto.notes ?? null,
      started_at: now,
      updated_at: now,
    };
    return tx.appointment_anesthetic.upsert({
      where: { appointment_id: dto.appointmentId },
      create: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        appointment_id: dto.appointmentId,
        created_by: scope.userId,
        ...data,
      },
      update: data,
    });
  }

  /** How far back cancel/late/reschedule history counts look. */
  private static readonly HISTORY_WINDOW_MONTHS = 12;

  async findCustomersHistories(
    clinicId: string,
    customerIds: string[],
  ): Promise<
    Record<
      string,
      { cancelHistory: number; lateHistory: number; rescheduleHistory: number }
    >
  > {
    if (customerIds.length === 0) return {};

    // Customer PK is composite [customer_id, clinic_id]: a bare customer_id
    // IN (...) could match another clinic's rows, so always scope by clinic.
    // date_appointment is a YYYY-MM-DD varchar, so a lexicographic gte bounds
    // the window without loading every appointment ever.
    const since = new Date();
    since.setMonth(since.getMonth() - QueueRepository.HISTORY_WINDOW_MONTHS);
    const sinceDate = since.toISOString().slice(0, 10);

    // 1. Fetch appointments of these customers to check cancellations and lateness
    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinic_id: clinicId,
        customer_id: { in: customerIds },
        date_appointment: { gte: sinceDate },
      },
      select: {
        customer_id: true,
        status_appointment: true,
        start_time: true,
        time_arrive: true,
        appointment_id: true,
      },
    });

    // 2. Fetch reschedule history from audit_log table
    const allApptIds = appointments.map((a) => a.appointment_id);
    const rescheduleLogs = await this.prisma.audit_log.findMany({
      where: {
        clinic_id: clinicId,
        reference_type: "APPOINTMENT",
        action: "reschedule",
        reference_id: { in: allApptIds },
      },
      select: {
        reference_id: true,
      },
    });

    const rescheduleApptIds = new Set(rescheduleLogs.map((log) => log.reference_id));

    // Aggregate counts
    const result: Record<
      string,
      { cancelHistory: number; lateHistory: number; rescheduleHistory: number }
    > = {};

    customerIds.forEach((id) => {
      result[id] = { cancelHistory: 0, lateHistory: 0, rescheduleHistory: 0 };
    });

    appointments.forEach((appt) => {
      const cid = appt.customer_id;
      if (!result[cid]) return;

      if (appt.status_appointment === "CANCEL") {
        result[cid].cancelHistory++;
      }

      // Check if they arrived late (e.g. time_arrive is after start_time)
      if (appt.time_arrive && appt.start_time && appt.time_arrive > appt.start_time) {
        result[cid].lateHistory++;
      }

      if (rescheduleApptIds.has(appt.appointment_id)) {
        result[cid].rescheduleHistory++;
      }
    });

    return result;
  }
}
