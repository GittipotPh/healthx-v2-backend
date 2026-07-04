import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { statusAppointment, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { INITIAL_QUEUE_STEP } from "../queue/queue.constants";
import type { AppointmentWithCustomer } from "./appointments.mapper";
import type { CreateAppointmentDto } from "./dto/create-appointment.dto";
import type { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface PaginatedAppointments {
  items: AppointmentWithCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    query: QueryAppointmentsDto,
    scope: RequestScope,
  ): Promise<PaginatedAppointments> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const where = this.buildWhere(query, scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        include: { customer: true },
        orderBy: [{ date_appointment: "asc" }, { start_time: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  /**
   * Creates the appointment and, in the same transaction, bootstraps its
   * queue_status row so the card immediately appears on today's Kanban queue
   * at step 1 (CONFIRMED). status_appointment starts at APPOINT (mirrors the
   * legacy default) and is kept independently: the Kanban step transitions
   * update it via STEP_TO_APPOINTMENT_STATUS as the card moves columns.
   */
  async create(dto: CreateAppointmentDto, scope: RequestScope): Promise<AppointmentWithCustomer> {
    const appointmentId = randomUUID();
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          appointment_id: appointmentId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          customer_id: dto.customerId,
          user_create: scope.userId,
          room: dto.room,
          date_appointment: dto.dateAppointment,
          time_arrive: dto.timeArrive,
          start_time: dto.startTime,
          end_time: dto.endTime,
          channel: dto.channel,
          is_consult: dto.isConsult,
          apply_anesthetic: dto.applyAnesthetic,
          appointment_detail: dto.detail,
          status_appointment: statusAppointment.APPOINT,
          opd_id: dto.opdId,
          updated_at: now,
          created_at: now,
        },
        include: { customer: true },
      });

      await tx.queue_status.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          appointment_id: appointmentId,
          current_step: INITIAL_QUEUE_STEP,
          entered_at: now,
          updated_at: now,
        },
      });

      return created;
    });
  }

  /**
   * True when the OPD row exists in this clinic/branch. `opd`'s PK is composite
   * [opd_id, branch_id], so an unscoped opd_id lookup could match another
   * branch's row — always check clinic AND branch before linking it.
   */
  async opdExistsInScope(opdId: string, scope: RequestScope): Promise<boolean> {
    const found = await this.prisma.opd.findFirst({
      where: {
        opd_id: opdId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      select: { opd_id: true },
    });
    return found !== null;
  }

  async findOne(id: string, scope: RequestScope): Promise<AppointmentWithCustomer | null> {
    return this.prisma.appointment.findFirst({
      where: {
        appointment_id: id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { customer: true },
    });
  }

  async reschedule(
    id: string,
    data: { dateAppointment: string; startTime: string; endTime: string },
    scope: RequestScope,
  ): Promise<AppointmentWithCustomer> {
    const now = new Date();
    return this.prisma.appointment.update({
      where: {
        appointment_id: id,
      },
      data: {
        date_appointment: data.dateAppointment,
        start_time: data.startTime,
        time_arrive: data.startTime,
        end_time: data.endTime,
        updated_at: now,
      },
      include: { customer: true },
    });
  }


  buildWhere(query: QueryAppointmentsDto, scope: RequestScope): Prisma.appointmentWhereInput {
    const where: Prisma.appointmentWhereInput = {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
    };

    if (query.customerId) where.customer_id = query.customerId;
    if (query.status) where.status_appointment = query.status;

    if (query.date) {
      where.date_appointment = query.date;
    } else if (query.dateFrom || query.dateTo) {
      where.date_appointment = {};
      if (query.dateFrom) where.date_appointment.gte = query.dateFrom;
      if (query.dateTo) where.date_appointment.lte = query.dateTo;
    }

    return where;
  }
}
