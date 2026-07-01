import { Injectable } from "@nestjs/common";
import { AppointmentsRepository } from "./appointments.repository";
import {
  type AppointmentOptionPage,
  type AppointmentOptionsView,
  type AppointmentView,
  type BranchScopedOption,
  type StaffOption,
  toAppointmentView,
} from "./appointments.mapper";
import type { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import type { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface AppointmentListResult {
  items: AppointmentView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AppointmentsService {
  constructor(private readonly repository: AppointmentsRepository) {}

  async list(query: QueryAppointmentsDto, scope: RequestScope): Promise<AppointmentListResult> {
    const result = await this.repository.findMany(query, scope);
    return {
      items: result.items.map(toAppointmentView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  options(scope: RequestScope): Promise<AppointmentOptionsView> {
    return this.repository.options(scope);
  }

  procedureOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<BranchScopedOption>> {
    return this.repository.procedureOptions(query, scope);
  }

  doctorOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.repository.doctorOptions(query, scope);
  }

  assistantOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.repository.assistantOptions(query, scope);
  }
}
