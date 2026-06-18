import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { AppointmentWithCustomer } from "./appointments.mapper";
import type { QueryAppointmentsDto } from "./dto/query-appointments.dto";

export interface PaginatedAppointments {
  items: AppointmentWithCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(query: QueryAppointmentsDto): Promise<PaginatedAppointments> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const where = this.buildWhere(query);

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

  buildWhere(query: QueryAppointmentsDto): Prisma.appointmentWhereInput {
    const where: Prisma.appointmentWhereInput = {};

    if (query.clinicId) where.clinic_id = query.clinicId;
    if (query.branchId) where.branch_id = query.branchId;
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
