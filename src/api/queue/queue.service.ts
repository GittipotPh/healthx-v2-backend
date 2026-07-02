import { Injectable, NotFoundException } from "@nestjs/common";
import { auditReferenceType } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type { AuditLogView } from "../audit-log/audit-log.mapper";
import { QueueRepository } from "./queue.repository";
import { type QueueItemView, toQueueItemView } from "./queue.mapper";
import { STEP_TO_APPOINTMENT_STATUS } from "./queue.constants";
import type { QueryQueueDto } from "./dto/query-queue.dto";
import type { TransitionQueueDto } from "./dto/transition-queue.dto";
import type { Principal, RequestScope } from "../../auth/auth.types";

export interface QueueTodayResult {
  date: string;
  items: QueueItemView[];
}

export interface QueueTransitionResult {
  appointmentId: string;
  audit: AuditLogView;
}

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: QueueRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async today(query: QueryQueueDto, scope: RequestScope): Promise<QueueTodayResult> {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const rows = await this.repository.findTodayQueue(scope.clinicId, scope.branchId, date);
    const customerIds = Array.from(new Set(rows.map((row) => row.customer_id)));
    const appointmentIds = rows.map((row) => row.appointment_id);
    const [histories, steps] = await Promise.all([
      this.repository.findCustomersHistories(customerIds),
      this.repository.findQueueStatusesByAppointmentIds(appointmentIds),
    ]);
    return {
      date,
      items: rows.map((row, index) => {
        const history = histories[row.customer_id];
        return toQueueItemView(row, index, history, steps[row.appointment_id] ?? null);
      }),
    };
  }

  async transition(
    dto: TransitionQueueDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<QueueTransitionResult> {
    const appointment = await this.repository.findAppointment(
      scope.clinicId,
      scope.branchId,
      dto.appointmentId,
    );
    if (!appointment) {
      throw new NotFoundException("Appointment not found for this clinic/branch");
    }

    // A step move best-effort syncs the legacy status_appointment via the
    // step->status map, unless the caller explicitly overrides it.
    const appointmentStatus =
      dto.appointmentStatus ?? (dto.step ? STEP_TO_APPOINTMENT_STATUS[dto.step] : undefined);

    const actorUserId = scope.userId;
    const actorName = principal.name;
    const actorRole = scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined);

    const audit = await this.prisma.$transaction(async (tx) => {
      if (appointmentStatus) {
        await this.repository.updateAppointmentStatus(dto.appointmentId, appointmentStatus, tx);
      }
      if (dto.step) {
        await this.repository.upsertQueueStep(
          scope.clinicId,
          scope.branchId,
          dto.appointmentId,
          dto.step,
          tx,
        );
      }
      return this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.QUEUE,
          referenceId: dto.appointmentId,
          action: dto.action,
          actionLabel: dto.actionLabel,
          fromStatus: dto.fromStatus,
          toStatus: dto.toStatus,
          actorUserId,
          actorName,
          actorRole,
          onBehalfOfUserId: dto.onBehalfOfUserId,
          onBehalfOfName: dto.onBehalfOfName,
          durationSec: dto.durationSec,
          notes: dto.notes,
          reason: dto.reason,
          metadata: dto.metadata,
        },
        tx,
      );
    });

    return { appointmentId: dto.appointmentId, audit };
  }
}
