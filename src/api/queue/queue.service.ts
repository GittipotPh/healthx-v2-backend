import { Injectable, NotFoundException } from "@nestjs/common";
import { auditReferenceType } from "@prisma/client";
import { AuditLogService } from "../audit-log/audit-log.service";
import type { AuditLogView } from "../audit-log/audit-log.mapper";
import { QueueRepository } from "./queue.repository";
import { type QueueItemView, toQueueItemView } from "./queue.mapper";
import type { QueryQueueDto } from "./dto/query-queue.dto";
import type { TransitionQueueDto } from "./dto/transition-queue.dto";
import type { RequestScope } from "../../auth/auth.types";

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
    private readonly repository: QueueRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async today(query: QueryQueueDto, scope: RequestScope): Promise<QueueTodayResult> {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const rows = await this.repository.findTodayQueue(scope.clinicId, scope.branchId, date);
    const customerIds = Array.from(new Set(rows.map((row) => row.customer_id)));
    const histories = await this.repository.findCustomersHistories(customerIds);
    return {
      date,
      items: rows.map((row, index) => {
        const history = histories[row.customer_id];
        return toQueueItemView(row, index, history);
      }),
    };
  }

  async transition(dto: TransitionQueueDto, scope: RequestScope): Promise<QueueTransitionResult> {
    const appointment = await this.repository.findAppointment(
      scope.clinicId,
      scope.branchId,
      dto.appointmentId,
    );
    if (!appointment) {
      throw new NotFoundException("Appointment not found for this clinic/branch");
    }

    if (dto.appointmentStatus) {
      await this.repository.updateAppointmentStatus(dto.appointmentId, dto.appointmentStatus);
    }

    const audit = await this.auditLogService.create({
      clinicId: scope.clinicId,
      branchId: scope.branchId,
      referenceType: auditReferenceType.QUEUE,
      referenceId: dto.appointmentId,
      action: dto.action,
      actionLabel: dto.actionLabel,
      fromStatus: dto.fromStatus,
      toStatus: dto.toStatus,
      actorUserId: dto.actorUserId,
      actorName: dto.actorName,
      actorRole: dto.actorRole,
      onBehalfOfUserId: dto.onBehalfOfUserId,
      onBehalfOfName: dto.onBehalfOfName,
      durationSec: dto.durationSec,
      notes: dto.notes,
      reason: dto.reason,
      metadata: dto.metadata,
    });

    return { appointmentId: dto.appointmentId, audit };
  }
}
