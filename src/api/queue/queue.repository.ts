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
      include: { customer: true, opd: true },
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
}
