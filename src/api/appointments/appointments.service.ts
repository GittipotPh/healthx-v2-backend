import { Injectable, NotFoundException } from "@nestjs/common";
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
import { RescheduleAppointmentDto } from "./dto/reschedule-appointment.dto";
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

    if (dto.opdId && !(await this.repository.opdExistsInScope(dto.opdId, scope))) {
      throw new NotFoundException("OPD record not found for this clinic/branch");
    }

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

  async reschedule(
    id: string,
    dto: RescheduleAppointmentDto,
    scope: RequestScope,
  ): Promise<AppointmentView> {
    const appointment = await this.repository.findOne(id, scope);
    if (!appointment) {
      throw new NotFoundException("Appointment not found");
    }

    const endTime = this.calculateNewEndTime(
      appointment.start_time,
      appointment.end_time,
      dto.startTime,
    );

    const updated = await this.repository.reschedule(
      id,
      {
        dateAppointment: dto.dateAppointment,
        startTime: dto.startTime,
        endTime,
      },
      scope,
    );

    await this.auditLogService.record({
      clinicId: scope.clinicId,
      branchId: scope.branchId,
      referenceType: auditReferenceType.APPOINTMENT,
      referenceId: id,
      action: "reschedule",
      actionLabel: "เลื่อนนัดหมาย",
      actorUserId: scope.userId,
      notes: `เลื่อนนัดหมายเป็นวันที่ ${dto.dateAppointment} เวลา ${dto.startTime}`,
    });

    return toAppointmentView(updated);
  }

  private calculateNewEndTime(
    originalStartTime: string,
    originalEndTime: string,
    newStartTime: string,
  ): string {
    try {
      const [origStartH, origStartM] = originalStartTime.split(":").map(Number);
      const [origEndH, origEndM] = originalEndTime.split(":").map(Number);
      const [newStartH, newStartM] = newStartTime.split(":").map(Number);

      if (
        isNaN(origStartH) || isNaN(origStartM) ||
        isNaN(origEndH) || isNaN(origEndM) ||
        isNaN(newStartH) || isNaN(newStartM)
      ) {
        return this.add30Minutes(newStartTime);
      }

      const durationMin = (origEndH * 60 + origEndM) - (origStartH * 60 + origStartM);
      if (durationMin <= 0) {
        return this.add30Minutes(newStartTime);
      }

      const newEndTotalMin = (newStartH * 60 + newStartM) + durationMin;
      const newEndH = Math.floor(newEndTotalMin / 60) % 24;
      const newEndM = newEndTotalMin % 60;

      return `${String(newEndH).padStart(2, "0")}:${String(newEndM).padStart(2, "0")}`;
    } catch {
      return this.add30Minutes(newStartTime);
    }
  }

  private add30Minutes(time: string): string {
    const [h, m] = time.split(":").map(Number);
    const total = (h * 60 + m) + 30;
    const newH = Math.floor(total / 60) % 24;
    const newM = total % 60;
    return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
  }
}
