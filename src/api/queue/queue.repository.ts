import { Injectable } from "@nestjs/common";
import type { appointment, statusAppointment } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { AppointmentForQueue } from "./queue.mapper";

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
  ): Promise<appointment> {
    return this.prisma.appointment.update({
      where: { appointment_id: appointmentId },
      data: { status_appointment: status, updated_at: new Date() },
    });
  }

  async findCustomersHistories(
    customerIds: string[],
  ): Promise<
    Record<
      string,
      { cancelHistory: number; lateHistory: number; rescheduleHistory: number }
    >
  > {
    if (customerIds.length === 0) return {};

    // 1. Fetch appointments of these customers to check cancellations and lateness
    const appointments = await this.prisma.appointment.findMany({
      where: {
        customer_id: { in: customerIds },
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
