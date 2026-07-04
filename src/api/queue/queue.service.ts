import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { auditReferenceType } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import type { AuditLogView } from "../audit-log/audit-log.mapper";
import { QueueRepository } from "./queue.repository";
import { type QueueItemView, toQueueItemView } from "./queue.mapper";
import { STEP_TO_APPOINTMENT_STATUS } from "./queue.constants";
import type { QueryQueueDto } from "./dto/query-queue.dto";
import type { TransitionQueueDto } from "./dto/transition-queue.dto";
import type { SaveConsultationDto } from "./dto/save-consultation.dto";
import type { SaveAnestheticDto } from "./dto/save-anesthetic.dto";
import type { Principal, RequestScope } from "../../auth/auth.types";

export interface QueueTodayResult {
  date: string;
  items: QueueItemView[];
}

export interface QueueTransitionResult {
  appointmentId: string;
  audit: AuditLogView;
}

export interface QueueConsultationResult {
  appointmentId: string;
  audit: AuditLogView;
}

export interface QueueAnestheticResult {
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
      this.repository.findCustomersHistories(scope.clinicId, customerIds),
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

  /**
   * Persists the "ส่งปรึกษา" consult detail fields and advances the card to
   * CONSULTING in one audited transaction: upsert appointment_consultation →
   * sync status_appointment (step-derived) → upsert queue_status(CONSULTING) →
   * exactly one audit_log entry. Mirrors `transition()`; the actor is derived
   * server-side from scope/principal.
   */
  async saveConsultation(
    dto: SaveConsultationDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<QueueConsultationResult> {
    const appointment = await this.repository.findAppointment(
      scope.clinicId,
      scope.branchId,
      dto.appointmentId,
    );
    if (!appointment) {
      throw new NotFoundException("Appointment not found for this clinic/branch");
    }

    const step = "CONSULTING";
    const appointmentStatus = STEP_TO_APPOINTMENT_STATUS[step];
    const actorRole = scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined);

    const audit = await this.prisma.$transaction(async (tx) => {
      await this.repository.upsertConsultation(
        { clinicId: scope.clinicId, branchId: scope.branchId, userId: scope.userId },
        dto,
        tx,
      );
      await this.repository.updateAppointmentStatus(dto.appointmentId, appointmentStatus, tx);
      await this.repository.upsertQueueStep(
        scope.clinicId,
        scope.branchId,
        dto.appointmentId,
        step,
        tx,
      );
      return this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.QUEUE,
          referenceId: dto.appointmentId,
          action: "send-to-consulting",
          actionLabel: "ส่งปรึกษา",
          toStatus: step,
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole,
          notes: dto.notes,
          metadata: {
            consultantRef: dto.consultantRef,
            budget: dto.budget,
            promotion: dto.promotion,
            outcome: dto.outcome,
            servicesInterested: dto.servicesInterested ?? [],
          },
        },
        tx,
      );
    });

    return { appointmentId: dto.appointmentId, audit };
  }

  /**
   * Persists the "แปะยาชา" anaesthetic detail fields and keeps the card on
   * ANESTHETIC in one audited transaction: upsert appointment_anesthetic →
   * sync status_appointment (step-derived) → upsert queue_status(ANESTHETIC) →
   * exactly one audit_log entry. Mirrors `saveConsultation()`; the actor is
   * derived server-side from scope/principal.
   */
  async saveAnesthetic(
    dto: SaveAnestheticDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<QueueAnestheticResult> {
    // Cross-field rule the DTO can't express: a recorded allergy needs detail.
    if (dto.allergyStatus === "has" && !dto.allergyNotes?.trim()) {
      throw new BadRequestException("allergyNotes is required when allergyStatus is 'has'");
    }

    const appointment = await this.repository.findAppointment(
      scope.clinicId,
      scope.branchId,
      dto.appointmentId,
    );
    if (!appointment) {
      throw new NotFoundException("Appointment not found for this clinic/branch");
    }

    const step = "ANESTHETIC";
    const appointmentStatus = STEP_TO_APPOINTMENT_STATUS[step];
    const actorRole = scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined);

    const audit = await this.prisma.$transaction(async (tx) => {
      await this.repository.upsertAnesthetic(
        { clinicId: scope.clinicId, branchId: scope.branchId, userId: scope.userId },
        dto,
        tx,
      );
      await this.repository.updateAppointmentStatus(dto.appointmentId, appointmentStatus, tx);
      await this.repository.upsertQueueStep(
        scope.clinicId,
        scope.branchId,
        dto.appointmentId,
        step,
        tx,
      );
      return this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.QUEUE,
          referenceId: dto.appointmentId,
          action: "apply-anesthetic",
          actionLabel: "แปะยาชา",
          toStatus: step,
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole,
          notes: dto.notes,
          metadata: {
            allergyStatus: dto.allergyStatus,
            allergyNotes: dto.allergyNotes,
            nurseRef: dto.nurseRef,
            room: dto.room,
            bed: dto.bed,
            durationMinutes: dto.durationMinutes,
          },
        },
        tx,
      );
    });

    return { appointmentId: dto.appointmentId, audit };
  }
}
