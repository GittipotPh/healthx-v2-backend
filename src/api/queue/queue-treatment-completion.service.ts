import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  auditReferenceType,
  role_enum,
  statusAppointment,
  type opd_queue_ticket,
  type Prisma,
  type queue_config,
} from "@prisma/client";
import type { Principal, RequestScope } from "../../auth/auth.types";
import { AuditLogService } from "../audit-log/audit-log.service";
import { DEFAULT_QUEUE_CONFIG } from "./queue-config.defaults";
import { stepCodeToColumnId } from "./queue.constants";
import { QueueRepository } from "./queue.repository";

export type QueueTreatmentCompletionBlockerCode =
  | "QUEUE_TICKET_LINK_MISMATCH"
  | "QUEUE_TICKET_NOT_IN_SERVICE"
  | "QUEUE_DISPENSING_DISABLED"
  | "QUEUE_TRANSITION_PERMISSION_REQUIRED"
  | "QUEUE_TRANSITION_BLOCKED";

export interface QueueTreatmentCompletionInput {
  queueTicketId: string;
  encounterId: string;
  customerId: string;
  appointmentId: string | null;
  legacyOpdId: string;
}

export interface QueueTreatmentCompletionInspection {
  ticket: opd_queue_ticket | null;
  blockers: QueueTreatmentCompletionBlockerCode[];
}

export interface QueueTreatmentCompletionResult {
  queueTicketId: string;
  sourceVersion: number;
  resultVersion: number;
  sourceStep: "IN_SERVICE";
  resultStep: "DISPENSING";
  appointmentStatus: "DISPENSING" | null;
}

interface QueueColumnPolicy {
  id: string;
  enabled: boolean;
  order: number;
  isRequired: boolean;
  canSkip: boolean;
}

interface QueueTargetPolicy {
  columns: QueueColumnPolicy[];
  permissions: Record<string, string[]>;
}

@Injectable()
export class QueueTreatmentCompletionService {
  constructor(
    private readonly repository: QueueRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  async inspect(
    input: QueueTreatmentCompletionInput,
    scope: RequestScope,
    client?: Prisma.TransactionClient,
  ): Promise<QueueTreatmentCompletionInspection> {
    const ticket = await this.repository.findV2QueueTicketById(
      scope.clinicId,
      scope.branchId,
      input.queueTicketId,
      client,
    );
    const encounterIdentity = ticket
      ? await this.repository.findV2QueueEncounterIdentity(
          scope.clinicId,
          scope.branchId,
          input.queueTicketId,
          client,
        )
      : null;
    const blockers: QueueTreatmentCompletionBlockerCode[] = [];
    if (
      !ticket ||
      ticket.customer_id !== input.customerId ||
      ticket.appointment_id !== input.appointmentId ||
      ticket.cancelled_at !== null ||
      !encounterIdentity ||
      encounterIdentity.encounterId !== input.encounterId ||
      encounterIdentity.queueTicketId !== input.queueTicketId ||
      encounterIdentity.customerId !== input.customerId ||
      encounterIdentity.appointmentId !== input.appointmentId
    ) {
      blockers.push("QUEUE_TICKET_LINK_MISMATCH");
    }
    if (ticket && ticket.current_step !== "IN_SERVICE") {
      blockers.push("QUEUE_TICKET_NOT_IN_SERVICE");
    }

    const configRow = await this.repository.findQueueConfig(
      scope.clinicId,
      scope.branchId,
      client,
    );
    const policy = this.toPolicy(configRow);
    const targetColumnId = stepCodeToColumnId("DISPENSING");
    const target = policy.columns.find(
      (column) => column.id === targetColumnId,
    );
    if (!target?.enabled) {
      blockers.push("QUEUE_DISPENSING_DISABLED");
    } else {
      if (!this.canEnterTarget(policy, targetColumnId, scope)) {
        blockers.push("QUEUE_TRANSITION_PERMISSION_REQUIRED");
      }
      if (
        ticket &&
        !this.canAdvance(policy, ticket.current_step, targetColumnId)
      ) {
        blockers.push("QUEUE_TRANSITION_BLOCKED");
      }
    }

    if (ticket && ticket.appointment_id) {
      const appointment = await this.repository.findAppointment(
        scope.clinicId,
        scope.branchId,
        ticket.appointment_id,
        client,
      );
      if (
        !appointment ||
        appointment.customer_id !== input.customerId ||
        appointment.opd_id !== input.legacyOpdId
      ) {
        blockers.push("QUEUE_TICKET_LINK_MISMATCH");
      }
    }

    return { ticket, blockers: [...new Set(blockers)] };
  }

  async complete(
    input: QueueTreatmentCompletionInput & { expectedVersion: number },
    scope: RequestScope,
    principal: Principal,
    tx: Prisma.TransactionClient,
  ): Promise<QueueTreatmentCompletionResult> {
    const locked = await this.repository.lockV2QueueTicket(
      scope.clinicId,
      scope.branchId,
      input.queueTicketId,
      tx,
    );
    if (!locked) {
      throw new NotFoundException(
        "Queue ticket not found for this clinic/branch",
      );
    }

    const inspection = await this.inspect(input, scope, tx);
    const ticket = inspection.ticket;
    if (!ticket) {
      throw new NotFoundException(
        "Queue ticket not found for this clinic/branch",
      );
    }
    if (ticket.version !== input.expectedVersion) {
      throw new ConflictException({
        message: "Queue ticket changed; refresh readiness before retrying",
        code: "QUEUE_TICKET_VERSION_STALE",
        resourceType: "OPD_QUEUE_TICKET",
        resourceId: ticket.queue_ticket_id,
        currentVersion: ticket.version,
        currentStatus: ticket.current_step,
      });
    }
    if (inspection.blockers.length > 0) {
      throw new ConflictException({
        message: "Queue transition is no longer ready",
        code: inspection.blockers[0],
        blockers: inspection.blockers,
      });
    }

    if (input.appointmentId) {
      await this.repository.updateAppointmentStatus(
        scope.clinicId,
        scope.branchId,
        input.appointmentId,
        statusAppointment.DISPENSING,
        tx,
      );
      await this.repository.upsertQueueStep(
        scope.clinicId,
        scope.branchId,
        input.appointmentId,
        "DISPENSING",
        tx,
      );
    }

    const outcome = await this.repository.transitionV2QueueTicket(
      {
        clinicId: scope.clinicId,
        branchId: scope.branchId,
        appointmentId: input.appointmentId,
        queueTicketId: input.queueTicketId,
        expectedVersion: input.expectedVersion,
        toStep: "DISPENSING",
        actorUserId: scope.userId,
        reason: "OPD clinical record finalized",
      },
      tx,
    );
    if (outcome !== "UPDATED") {
      throw new ConflictException({
        message: "Queue ticket changed; refresh readiness before retrying",
        code: "QUEUE_TICKET_VERSION_STALE",
        resourceType: "OPD_QUEUE_TICKET",
        resourceId: ticket.queue_ticket_id,
        currentVersion: ticket.version,
        currentStatus: ticket.current_step,
      });
    }

    await this.auditLogService.create(
      {
        clinicId: scope.clinicId,
        branchId: scope.branchId,
        referenceType: auditReferenceType.QUEUE,
        referenceId: ticket.queue_ticket_id,
        action: "enter-dispensing-after-treatment",
        actionLabel: "Enter dispensing after OPD treatment",
        fromStatus: "IN_SERVICE",
        toStatus: "DISPENSING",
        actorUserId: scope.userId,
        actorName: principal.name,
        actorRole:
          scope.roles[0] ??
          (scope.isClinicRootUser ? "CLINIC_ROOT" : undefined),
        metadata: {
          encounterId: input.encounterId,
          appointmentId: input.appointmentId,
          expectedVersion: input.expectedVersion,
          resultVersion: input.expectedVersion + 1,
        },
      },
      tx,
    );

    return {
      queueTicketId: ticket.queue_ticket_id,
      sourceVersion: input.expectedVersion,
      resultVersion: input.expectedVersion + 1,
      sourceStep: "IN_SERVICE",
      resultStep: "DISPENSING",
      appointmentStatus: input.appointmentId ? "DISPENSING" : null,
    };
  }

  private toPolicy(row: queue_config | null): QueueTargetPolicy {
    const fallback: QueueTargetPolicy = {
      columns: DEFAULT_QUEUE_CONFIG.columns.map((column) => ({
        id: column.id,
        enabled: column.enabled,
        order: column.order,
        isRequired: column.isRequired,
        canSkip: column.canSkip,
      })),
      permissions: Object.fromEntries(
        Object.entries(DEFAULT_QUEUE_CONFIG.permissions).map(([key, value]) => [
          key,
          [...value],
        ]),
      ),
    };
    if (!row) return fallback;

    const columns = this.parseColumns(row.columns);
    const permissions = this.parsePermissions(row.permissions);
    return {
      columns: columns ?? [],
      permissions: permissions ?? {},
    };
  }

  private parseColumns(value: Prisma.JsonValue): QueueColumnPolicy[] | null {
    if (!Array.isArray(value)) return null;
    const result: QueueColumnPolicy[] = [];
    for (const item of value) {
      if (!this.isRecord(item)) return null;
      if (
        typeof item.id !== "string" ||
        typeof item.enabled !== "boolean" ||
        typeof item.order !== "number" ||
        typeof item.isRequired !== "boolean" ||
        typeof item.canSkip !== "boolean"
      ) {
        return null;
      }
      result.push({
        id: item.id,
        enabled: item.enabled,
        order: item.order,
        isRequired: item.isRequired,
        canSkip: item.canSkip,
      });
    }
    return result;
  }

  private parsePermissions(
    value: Prisma.JsonValue,
  ): Record<string, string[]> | null {
    if (!this.isRecord(value)) return null;
    const result: Record<string, string[]> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (
        !Array.isArray(raw) ||
        !raw.every((item) => typeof item === "string")
      ) {
        return null;
      }
      result[key] = raw;
    }
    return result;
  }

  private isRecord(value: Prisma.JsonValue): value is Prisma.JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private canEnterTarget(
    policy: QueueTargetPolicy,
    targetColumnId: string,
    scope: RequestScope,
  ): boolean {
    if (scope.isClinicRootUser) return true;
    const allowedRoles = policy.permissions[targetColumnId] ?? [];
    return scope.roles.some((role) => {
      if (allowedRoles.includes(role)) return true;
      if (role === role_enum.CLINIC_OWNER || role === role_enum.MANAGER) {
        return allowedRoles.some((value) =>
          ["ADMIN", "CLINIC_OWNER", "MANAGER"].includes(value),
        );
      }
      return (
        (role === role_enum.ACCOUNTANT || role === role_enum.SALE) &&
        allowedRoles.includes("CASHIER")
      );
    });
  }

  private canAdvance(
    policy: QueueTargetPolicy,
    currentStep: string,
    targetColumnId: string,
  ): boolean {
    const active = policy.columns
      .filter((column) => column.enabled)
      .sort((left, right) => left.order - right.order);
    const currentIndex = active.findIndex(
      (column) => column.id === stepCodeToColumnId(currentStep),
    );
    const targetIndex = active.findIndex(
      (column) => column.id === targetColumnId,
    );
    if (currentIndex < 0 || targetIndex <= currentIndex) return false;
    return !active
      .slice(currentIndex + 1, targetIndex)
      .some((column) => column.isRequired && !column.canSkip);
  }
}
