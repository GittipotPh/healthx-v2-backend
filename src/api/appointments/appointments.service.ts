import { Injectable } from "@nestjs/common";
import { auditReferenceType } from "@prisma/client";
import { AppointmentOptionsRepository } from "./appointment-options.repository";
import { AppointmentsRepository } from "./appointments.repository";
import {
  type AppointmentOptionPage,
  type AppointmentOptionsView,
  type AppointmentView,
  type BranchScopedOption,
  type StaffOption,
  toAppointmentView,
} from "./appointments.mapper";
import type { CreateAppointmentDto } from "./dto/create-appointment.dto";
import type { QueryAppointmentOptionsDto } from "./dto/query-appointment-options.dto";
import type { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import type { RequestScope } from "../../auth/auth.types";
import { CustomersService } from "../customers/customers.service";
import { AuditLogService } from "../audit-log/audit-log.service";

export interface AppointmentListResult {
  items: AppointmentView[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly repository: AppointmentsRepository,
    private readonly optionsRepository: AppointmentOptionsRepository,
    private readonly customersService: CustomersService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(query: QueryAppointmentsDto, scope: RequestScope): Promise<AppointmentListResult> {
    const result = await this.repository.findMany(query, scope);
    return {
      items: result.items.map(toAppointmentView),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  }

  async create(dto: CreateAppointmentDto, scope: RequestScope): Promise<AppointmentView> {
    // Throws NotFoundException if the customer doesn't exist in this clinic.
    await this.customersService.detail(dto.customerId, scope.clinicId);

    const created = await this.repository.create(dto, scope);

    await this.auditLogService.record({
      clinicId: scope.clinicId,
      branchId: scope.branchId,
      referenceType: auditReferenceType.APPOINTMENT,
      referenceId: created.appointment_id,
      action: "create",
      actionLabel: "สร้างนัดหมาย",
      actorUserId: scope.userId,
    });

    return toAppointmentView(created);
  }

  options(scope: RequestScope): Promise<AppointmentOptionsView> {
    return this.optionsRepository.options(scope);
  }

  procedureOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<BranchScopedOption>> {
    return this.optionsRepository.procedureOptions(query, scope);
  }

  doctorOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.optionsRepository.doctorOptions(query, scope);
  }

  assistantOptions(
    query: QueryAppointmentOptionsDto,
    scope: RequestScope,
  ): Promise<AppointmentOptionPage<StaffOption>> {
    return this.optionsRepository.assistantOptions(query, scope);
  }
}
