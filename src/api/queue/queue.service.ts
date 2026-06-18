import { Injectable, NotFoundException } from "@nestjs/common";
import { auditReferenceType } from "@prisma/client";
import { AuditLogService } from "../audit-log/audit-log.service";
import type { AuditLogView } from "../audit-log/audit-log.mapper";
import { QueueRepository } from "./queue.repository";
import { type QueueItemView, toQueueItemView } from "./queue.mapper";
import type { QueryQueueDto } from "./dto/query-queue.dto";
import type { TransitionQueueDto } from "./dto/transition-queue.dto";

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

  async today(query: QueryQueueDto): Promise<QueueTodayResult> {
    const date = query.date ?? new Date().toISOString().slice(0, 10);
    const rows = await this.repository.findTodayQueue(query.clinicId, query.branchId, date);
    return { date, items: rows.map((row, index) => toQueueItemView(row, index)) };
  }

  async transition(dto: TransitionQueueDto): Promise<QueueTransitionResult> {
    const appointment = await this.repository.findAppointment(
      dto.clinicId,
      dto.branchId,
      dto.appointmentId,
    );
    if (!appointment) {
      throw new NotFoundException("Appointment not found for this clinic/branch");
    }

    if (dto.appointmentStatus) {
      await this.repository.updateAppointmentStatus(dto.appointmentId, dto.appointmentStatus);
    }

    const audit = await this.auditLogService.create({
      clinicId: dto.clinicId,
      branchId: dto.branchId,
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
