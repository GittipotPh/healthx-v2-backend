import { Injectable } from "@nestjs/common";
import { AppointmentsRepository } from "./appointments.repository";
import { type AppointmentView, toAppointmentView } from "./appointments.mapper";
import type { QueryAppointmentsDto } from "./dto/query-appointments.dto";

export interface AppointmentListResult {
  items: AppointmentView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AppointmentsService {
  constructor(private readonly repository: AppointmentsRepository) {}

  async list(query: QueryAppointmentsDto): Promise<AppointmentListResult> {
    const result = await this.repository.findMany(query);
    return {
      items: result.items.map(toAppointmentView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }
}
