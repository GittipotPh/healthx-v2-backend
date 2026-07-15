import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ApiProperty } from "@nestjs/swagger";
import { auditReferenceType, role_enum } from "@prisma/client";
import { ErpSalesOrderEmitter } from "../../integrations/erp-events/erp-sales-order-emitter.service";
import { PrismaService } from "../../prisma.service";
import { AuditLogService } from "../audit-log/audit-log.service";
import { AuditLogView } from "../audit-log/audit-log.mapper";
import { QueueRepository } from "./queue.repository";
import {
  QueueConfigView,
  QueueItemView,
  defaultQueueConfigView,
  toQueueConfigView,
  toQueueItemView,
} from "./queue.mapper";
import { QUEUE_STEP_COLUMNS, STEP_TO_APPOINTMENT_STATUS, stepCodeToColumnId } from "./queue.constants";
import { DEFAULT_QUEUE_CONFIG } from "./queue-config.defaults";
import type { QueryQueueDto } from "./dto/query-queue.dto";
import type { TransitionQueueDto } from "./dto/transition-queue.dto";
import type { SaveConsultationDto } from "./dto/save-consultation.dto";
import type { SaveAnestheticDto } from "./dto/save-anesthetic.dto";
import {
  QUEUE_PERMISSION_ROLES,
  SaveQueueConfigDto,
  QueueColumnSettingDto,
  QueueTransitionsSettingDto,
} from "./dto/save-queue-config.dto";
import type { Principal, RequestScope } from "../../auth/auth.types";

export class QueueTodayResult {
  @ApiProperty({ description: "The day shown (YYYY-MM-DD)" })
  date!: string;

  @ApiProperty({ type: [QueueItemView] })
  items!: QueueItemView[];
}

export class QueueTransitionResult {
  @ApiProperty()
  appointmentId!: string;

  @ApiProperty({ type: AuditLogView })
  audit!: AuditLogView;
}

export class QueueConsultationResult {
  @ApiProperty()
  appointmentId!: string;

  @ApiProperty({ type: AuditLogView })
  audit!: AuditLogView;
}

export class QueueAnestheticResult {
  @ApiProperty()
  appointmentId!: string;

  @ApiProperty({ type: AuditLogView })
  audit!: AuditLogView;
}

@Injectable()
export class QueueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: QueueRepository,
    private readonly auditLogService: AuditLogService,
    private readonly erpSalesOrderEmitter: ErpSalesOrderEmitter,
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

    // Set when the card lands on the visit's end step — that's the billing
    // moment (payment prerequisites were just enforced), so the visit's PAID
    // sale orders are exported to ERP in the same transaction.
    let emitErpSalesOrders = false;

    // 1. Enforce queue config transition rules if step is changing
    if (dto.step) {
      const configRow = await this.repository.findQueueConfig(scope.clinicId, scope.branchId);
      const activeConfig = configRow
        ? {
            columns: configRow.columns as unknown as QueueColumnSettingDto[],
            transitions: configRow.transitions as unknown as QueueTransitionsSettingDto,
            permissions: configRow.permissions as unknown as Record<string, string[]>,
          }
        : DEFAULT_QUEUE_CONFIG;

      const targetColId = stepCodeToColumnId(dto.step);
      const columnSetting = activeConfig.columns.find((c) => c.id === targetColId);

      // A. Target Step Enabled Check
      if (!columnSetting || !columnSetting.enabled) {
        throw new BadRequestException(
          `Target column "${targetColId}" is not enabled in this branch's configuration.`,
        );
      }

      // B. Role Permission Check
      if (!scope.isClinicRootUser) {
        const allowedRoles = activeConfig.permissions[targetColId] ?? [];
        const isAllowed = scope.roles.some((r) => {
          if (allowedRoles.includes(r)) return true;
          if (r === role_enum.CLINIC_OWNER || r === role_enum.MANAGER) {
            if (
              allowedRoles.includes("ADMIN") ||
              allowedRoles.includes("CLINIC_OWNER") ||
              allowedRoles.includes("MANAGER")
            ) {
              return true;
            }
          }
          if (r === role_enum.ACCOUNTANT || r === role_enum.SALE) {
            if (allowedRoles.includes("CASHIER")) return true;
          }
          return false;
        });

        if (!isAllowed) {
          throw new ForbiddenException(
            `Your role is not authorized to transition cards into "${columnSetting.label}".`,
          );
        }
      }

      // C. Skipped Columns Check
      const currentQueueStatus = await this.repository.findQueueStatus(dto.appointmentId);
      const currentStepCode = currentQueueStatus?.current_step;
      const currentColId = currentStepCode ? stepCodeToColumnId(currentStepCode) : null;

      if (currentColId) {
        const activeCols = activeConfig.columns
          .filter((c) => c.enabled)
          .sort((a, b) => a.order - b.order);
        const currentIdx = activeCols.findIndex((c) => c.id === currentColId);
        const targetIdx = activeCols.findIndex((c) => c.id === targetColId);

        if (currentIdx !== -1 && targetIdx !== -1 && targetIdx > currentIdx + 1) {
          const skippedCols = activeCols.slice(currentIdx + 1, targetIdx);
          for (const col of skippedCols) {
            if (col.isRequired && !col.canSkip) {
              throw new BadRequestException(
                `Cannot skip required column "${col.label}". Cards must pass through it.`,
              );
            }
          }
        }
      }

      // D. Prerequisites Validation
      if (targetColId === "in-service") {
        const rule = activeConfig.transitions["in-service"];
        if (rule.requiresPayment && appointment.opd_id) {
          const hasUnpaid = await this.repository.hasUnpaidPrescriptions(appointment.opd_id);
          if (hasUnpaid) {
            throw new BadRequestException(
              "Cannot transition to In-Service: Unpaid items exist. Please process payment first.",
            );
          }
        }
        if (rule.requiresAnesthetic) {
          const hasAnaesthetic = await this.repository.hasAnesthetic(dto.appointmentId);
          if (!hasAnaesthetic) {
            throw new BadRequestException(
              "Cannot transition to In-Service: Anesthetic must be applied first.",
            );
          }
        }
        if (rule.requiresDoctor) {
          const hasDoctor = await this.repository.hasAssignedDoctor(dto.appointmentId, scope.branchId);
          if (!hasDoctor) {
            throw new BadRequestException(
              "Cannot transition to In-Service: A doctor must be assigned first.",
            );
          }
        }
      } else if (targetColId === "completed" || columnSetting.isEndStep) {
        emitErpSalesOrders = true;
        const rule = activeConfig.transitions.completed;
        if (rule.requiresPayment && appointment.opd_id) {
          const hasUnpaid = await this.repository.hasUnpaidPrescriptions(appointment.opd_id);
          if (hasUnpaid) {
            throw new BadRequestException(
              "Cannot transition to Completed: Unpaid items exist. Please process payment first.",
            );
          }
        }
        if (rule.requiresOPD && !appointment.opd_id) {
          throw new BadRequestException(
            "Cannot transition to Completed: An OPD record must be created first.",
          );
        }
        if (rule.requiresCourse) {
          if (appointment.opd_id) {
            const hasCourse = await this.repository.hasUsedCourse(appointment.opd_id);
            if (!hasCourse) {
              throw new BadRequestException(
                "Cannot transition to Completed: A course or service usage must be logged first.",
              );
            }
          } else {
            throw new BadRequestException(
              "Cannot transition to Completed: An OPD record with service usage is required.",
            );
          }
        }
        if (rule.requiresMedicine) {
          if (appointment.opd_id) {
            const hasPresc = await this.repository.hasPrescriptions(appointment.opd_id);
            if (!hasPresc) {
              throw new BadRequestException(
                "Cannot transition to Completed: Medicine prescriptions must be created first.",
              );
            }
          } else {
            throw new BadRequestException(
              "Cannot transition to Completed: An OPD record with prescriptions is required.",
            );
          }
        }
      }
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
      if (emitErpSalesOrders && appointment.opd_id) {
        await this.erpSalesOrderEmitter.emitPaidSaleOrdersForOpd(
          tx,
          { clinicId: scope.clinicId, branchId: scope.branchId },
          appointment.opd_id,
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

  /**
   * Returns the branch's saved queue config, or the built-in defaults when no
   * row exists yet. Deliberately read-only: the row is only created by an
   * explicit save (a GET that writes would race on concurrent first reads).
   */
  async getQueueConfig(scope: RequestScope): Promise<QueueConfigView> {
    const config = await this.repository.findQueueConfig(scope.clinicId, scope.branchId);
    if (config) {
      return toQueueConfigView(config);
    }
    return defaultQueueConfigView(scope.clinicId, scope.branchId, DEFAULT_QUEUE_CONFIG);
  }

  /**
   * Full-replace save of the branch's queue config. Restricted to clinic root
   * users and ADMINs — the payload includes the permissions matrix itself, so
   * an open endpoint would let any role grant itself access. Upsert + audit
   * entry commit atomically.
   */
  async updateQueueConfig(
    dto: SaveQueueConfigDto,
    scope: RequestScope,
    principal: Principal,
  ): Promise<QueueConfigView> {
    const allowedRoles: role_enum[] = [role_enum.ADMIN, role_enum.CLINIC_OWNER, role_enum.MANAGER];
    if (!scope.isClinicRootUser && !scope.roles.some((r) => allowedRoles.includes(r))) {
      throw new ForbiddenException(
        "Only clinic root users, ADMIN, CLINIC_OWNER, or MANAGER can update queue config",
      );
    }
    this.assertConfigConsistent(dto);

    // Validate that disabled columns do not contain active queue cards
    const disabledCols = dto.columns.filter((c) => !c.enabled);
    for (const col of disabledCols) {
      const stepCode = col.id.toUpperCase().replace(/-/g, "_");
      const activeCount = await this.repository.countActiveCardsInStep(
        scope.clinicId,
        scope.branchId,
        stepCode,
      );
      if (activeCount > 0) {
        throw new BadRequestException(
          `Cannot disable column "${col.label}" because there are ${activeCount} active card(s) in it.`,
        );
      }
    }

    const actorRole = scope.roles[0] ?? (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined);
    const enabledColumns = dto.columns.filter((c) => c.enabled).map((c) => c.id);

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await this.repository.upsertQueueConfig(
        scope.clinicId,
        scope.branchId,
        dto,
        scope.userId,
        tx,
      );
      await this.auditLogService.create(
        {
          clinicId: scope.clinicId,
          branchId: scope.branchId,
          referenceType: auditReferenceType.QUEUE,
          referenceId: scope.branchId,
          action: "update-queue-config",
          actionLabel: "ตั้งค่าคิววันนี้",
          actorUserId: scope.userId,
          actorName: principal.name,
          actorRole,
          metadata: {
            enabledColumns,
            defaultColumn: dto.automation.defaultColumn,
          },
        },
        tx,
      );
      return row;
    });

    return toQueueConfigView(saved);
  }

  /** Cross-field rules the DTO can't express; violations are 400s. */
  private assertConfigConsistent(dto: SaveQueueConfigDto): void {
    const columnIds = dto.columns.map((c) => c.id);
    const columnIdSet = new Set(columnIds);
    if (columnIdSet.size !== columnIds.length) {
      throw new BadRequestException("columns contain duplicate ids");
    }

    const slaColumnIds = new Set<string>();
    for (const sla of dto.sla) {
      if (!columnIdSet.has(sla.columnId)) {
        throw new BadRequestException(`sla references unknown column "${sla.columnId}"`);
      }
      if (slaColumnIds.has(sla.columnId)) {
        throw new BadRequestException(`sla contains duplicate entries for "${sla.columnId}"`);
      }
      slaColumnIds.add(sla.columnId);
      // 0 means "off", so the ordering rule only applies when critical is set.
      if (sla.criticalMinutes > 0 && sla.warningMinutes > sla.criticalMinutes) {
        throw new BadRequestException(
          `sla for "${sla.columnId}": warningMinutes must not exceed criticalMinutes`,
        );
      }
    }

    const enabledIds = new Set(dto.columns.filter((c) => c.enabled).map((c) => c.id));
    if (!enabledIds.has(dto.automation.defaultColumn)) {
      throw new BadRequestException("automation.defaultColumn must be an enabled column");
    }

    // permissions is a plain record on the DTO, so its values need runtime checks.
    const knownRoles = QUEUE_PERMISSION_ROLES as readonly string[];
    for (const [columnId, roles] of Object.entries(dto.permissions)) {
      if (!QUEUE_STEP_COLUMNS.includes(columnId)) {
        throw new BadRequestException(`permissions references unknown column "${columnId}"`);
      }
      if (!Array.isArray(roles)) {
        throw new BadRequestException(`permissions for "${columnId}" must be an array of roles`);
      }
      for (const role of roles) {
        if (typeof role !== "string" || !knownRoles.includes(role)) {
          throw new BadRequestException(`permissions for "${columnId}" contain unknown role`);
        }
      }
    }
  }
}
