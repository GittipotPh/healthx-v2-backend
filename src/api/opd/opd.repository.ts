import { Injectable } from "@nestjs/common";
import type {
  Prisma,
  api_idempotency,
  opd,
  opd_encounter,
  opd_queue_ticket,
  queue_status,
  statusAppointment,
} from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type { OpdWithCustomer } from "./opd.mapper";
import type { QueryOpdDto } from "./dto/query-opd.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface PaginatedOpd {
  items: OpdWithCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

export interface OpdStartAppointment {
  appointment_id: string;
  customer_id: string;
  opd_id: string | null;
  date_appointment: string;
  start_time: string;
  room: string | null;
  status_appointment: statusAppointment;
}

export interface OpdWorkspaceRecord {
  encounter: opd_encounter;
  ticket: opd_queue_ticket;
  customer: {
    customer_id: string;
    name: string;
    lastname: string;
    nickname: string | null;
    phone_number: string | null;
    gender: string;
    birth_date: string | null;
    personal_id: string;
    customer_image: string | null;
    customer_info: {
      allergy: string | null;
      congenital_disease: string | null;
    } | null;
  };
  appointment: {
    status_appointment: statusAppointment;
    date_appointment: string;
    start_time: string;
    room: string | null;
  } | null;
  legacyOpd: opd;
}

@Injectable()
export class OpdRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    query: QueryOpdDto,
    scope: RequestScope,
  ): Promise<PaginatedOpd> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.buildWhere(query, scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.opd.findMany({
        where,
        include: { customer: true },
        orderBy: { opd_date: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.opd.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }

  async findHistoryByCustomer(
    customerId: string,
    scope: RequestScope,
  ): Promise<OpdWithCustomer[]> {
    return this.prisma.opd.findMany({
      where: {
        customer_id: customerId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { customer: true },
      orderBy: { opd_date: "desc" },
    });
  }

  async findIdempotency(
    scope: RequestScope,
    operation: string,
    idempotencyKey: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<api_idempotency | null> {
    return tx.api_idempotency.findUnique({
      where: {
        clinic_id_branch_id_actor_user_id_operation_idempotency_key: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          actor_user_id: scope.userId,
          operation,
          idempotency_key: idempotencyKey,
        },
      },
    });
  }

  async createIdempotency(
    scope: RequestScope,
    input: {
      operation: string;
      idempotencyKey: string;
      requestHash: string;
      now: Date;
      lockExpiresAt: Date;
      expiresAt: Date;
    },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<api_idempotency> {
    return tx.api_idempotency.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        operation: input.operation,
        idempotency_key: input.idempotencyKey,
        request_hash: input.requestHash,
        state: "IN_PROGRESS",
        locked_at: input.now,
        lock_expires_at: input.lockExpiresAt,
        expires_at: input.expiresAt,
        created_at: input.now,
        updated_at: input.now,
      },
    });
  }

  async completeIdempotency(
    idempotencyId: string,
    scope: RequestScope,
    resourceId: string,
    resultSnapshot: Prisma.InputJsonValue,
    now: Date,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const updated = await tx.api_idempotency.updateMany({
      where: {
        api_idempotency_id: idempotencyId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        actor_user_id: scope.userId,
        state: "IN_PROGRESS",
      },
      data: {
        state: "COMPLETED",
        resource_type: "OPD_ENCOUNTER",
        resource_id: resourceId,
        result_snapshot: resultSnapshot,
        response_code: 201,
        completed_at: now,
        updated_at: now,
      },
    });
    if (updated.count !== 1) {
      throw new Error("Unable to complete OPD start idempotency claim");
    }
  }

  async findAppointmentForStart(
    appointmentId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<OpdStartAppointment | null> {
    return tx.appointment.findFirst({
      where: {
        appointment_id: appointmentId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      select: {
        appointment_id: true,
        customer_id: true,
        opd_id: true,
        date_appointment: true,
        start_time: true,
        room: true,
        status_appointment: true,
      },
    });
  }

  async customerExistsInClinic(
    customerId: string,
    clinicId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const found = await tx.customer.findUnique({
      where: {
        customer_id_clinic_id: { customer_id: customerId, clinic_id: clinicId },
      },
      select: { customer_id: true, customer_status: true },
    });
    return found?.customer_status === true;
  }

  async findEncounterByAppointment(
    appointmentId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_encounter | null> {
    return tx.opd_encounter.findFirst({
      where: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        appointment_id: appointmentId,
      },
      orderBy: { created_at: "desc" },
    });
  }

  async findEncounterByTicket(
    queueTicketId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_encounter | null> {
    return tx.opd_encounter.findUnique({
      where: {
        queue_ticket_id_clinic_id_branch_id: {
          queue_ticket_id: queueTicketId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
        },
      },
    });
  }

  async findActiveWalkInEncounter(
    customerId: string,
    businessDate: Date,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_encounter | null> {
    return tx.opd_encounter.findFirst({
      where: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: customerId,
        appointment_id: null,
        encounter_type: "WALK_IN",
        business_date: businessDate,
        workflow_status: { in: ["OPEN", "POST_VISIT"] },
      },
      orderBy: { created_at: "desc" },
    });
  }

  async findQueueTicketById(
    queueTicketId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_queue_ticket | null> {
    return tx.opd_queue_ticket.findUnique({
      where: {
        queue_ticket_id_clinic_id_branch_id: {
          queue_ticket_id: queueTicketId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
        },
      },
    });
  }

  async findQueueTicketByAppointment(
    appointmentId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_queue_ticket | null> {
    return tx.opd_queue_ticket.findUnique({
      where: {
        clinic_id_branch_id_appointment_id: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          appointment_id: appointmentId,
        },
      },
    });
  }

  async findLegacyQueueStatus(
    appointmentId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<queue_status | null> {
    return tx.queue_status.findFirst({
      where: {
        appointment_id: appointmentId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
  }

  async createLegacyQueueStatus(
    appointmentId: string,
    currentStep: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<queue_status> {
    return tx.queue_status.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        appointment_id: appointmentId,
        current_step: currentStep,
        entered_at: now,
        updated_at: now,
      },
    });
  }

  async allocateNumber(
    numberKind: string,
    periodKey: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    const sequence = await tx.opd_number_sequence.upsert({
      where: {
        clinic_id_branch_id_number_kind_period_key: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          number_kind: numberKind,
          period_key: periodKey,
        },
      },
      create: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        number_kind: numberKind,
        period_key: periodKey,
        next_value: 2n,
      },
      update: {
        next_value: { increment: 1n },
        version: { increment: 1 },
      },
      select: { next_value: true },
    });
    const allocated = sequence.next_value - 1n;
    if (allocated > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(
        `Number sequence ${numberKind}/${periodKey} exceeded the safe range`,
      );
    }
    return Number(allocated);
  }

  async createQueueTicket(
    input: {
      customerId: string;
      appointmentId: string | null;
      legacyQueueStatusId: string | null;
      sourceType: "APPOINTMENT" | "WALK_IN";
      businessDate: Date;
      currentStep: string;
      enteredAt: Date;
      queueSequence: number;
      displayNumber: string;
    },
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_queue_ticket> {
    return tx.opd_queue_ticket.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: input.customerId,
        appointment_id: input.appointmentId,
        legacy_queue_status_id: input.legacyQueueStatusId,
        source_type: input.sourceType,
        business_date: input.businessDate,
        current_step: input.currentStep,
        entered_at: input.enteredAt,
        queue_sequence: input.queueSequence,
        display_number: input.displayNumber,
        created_by: scope.userId,
      },
    });
  }

  async findLegacyOpd(
    legacyOpdId: string,
    customerId: string,
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd | null> {
    return tx.opd.findFirst({
      where: {
        opd_id: legacyOpdId,
        customer_id: customerId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
    });
  }

  async createLegacyOpd(
    legacyOpdId: string,
    customerId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd> {
    return tx.opd.create({
      data: {
        opd_id: legacyOpdId,
        branch_id: scope.branchId,
        clinic_id: scope.clinicId,
        customer_id: customerId,
        user_create: scope.userId,
        status_opd: "PENDING",
        opd_date: now,
        updated_at: now,
        created_at: now,
      },
    });
  }

  async linkAppointmentToLegacyOpd(
    appointmentId: string,
    customerId: string,
    legacyOpdId: string,
    scope: RequestScope,
    now: Date,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const updated = await tx.appointment.updateMany({
      where: {
        appointment_id: appointmentId,
        customer_id: customerId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        OR: [{ opd_id: null }, { opd_id: legacyOpdId }],
      },
      data: { opd_id: legacyOpdId, updated_at: now },
    });
    return updated.count === 1;
  }

  async createEncounter(
    input: {
      customerId: string;
      appointmentId: string | null;
      queueTicketId: string;
      legacyOpdId: string;
      encounterType: "APPOINTMENT" | "WALK_IN";
      businessDate: Date;
      startedAt: Date;
    },
    scope: RequestScope,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_encounter> {
    return tx.opd_encounter.create({
      data: {
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
        customer_id: input.customerId,
        appointment_id: input.appointmentId,
        queue_ticket_id: input.queueTicketId,
        legacy_opd_id: input.legacyOpdId,
        attending_user_id: null,
        encounter_type: input.encounterType,
        workflow_status: "OPEN",
        clinical_record_status: "DRAFT",
        reconciliation_status: "RECONCILED",
        business_date: input.businessDate,
        started_at: input.startedAt,
        started_by: scope.userId,
      },
    });
  }

  async findWorkspace(
    encounterId: string,
    scope: RequestScope,
  ): Promise<OpdWorkspaceRecord | null> {
    const encounter = await this.prisma.opd_encounter.findUnique({
      where: {
        encounter_id_clinic_id_branch_id: {
          encounter_id: encounterId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
        },
      },
    });
    if (!encounter || !encounter.legacy_opd_id) return null;

    const [ticket, customer, appointment, legacyOpd] = await Promise.all([
      this.prisma.opd_queue_ticket.findUnique({
        where: {
          queue_ticket_id_clinic_id_branch_id: {
            queue_ticket_id: encounter.queue_ticket_id,
            clinic_id: scope.clinicId,
            branch_id: scope.branchId,
          },
        },
      }),
      this.prisma.customer.findUnique({
        where: {
          customer_id_clinic_id: {
            customer_id: encounter.customer_id,
            clinic_id: scope.clinicId,
          },
        },
        select: {
          customer_id: true,
          name: true,
          lastname: true,
          nickname: true,
          phone_number: true,
          gender: true,
          birth_date: true,
          personal_id: true,
          customer_image: true,
          customer_info: {
            select: { allergy: true, congenital_disease: true },
          },
        },
      }),
      encounter.appointment_id
        ? this.prisma.appointment.findFirst({
            where: {
              appointment_id: encounter.appointment_id,
              customer_id: encounter.customer_id,
              clinic_id: scope.clinicId,
              branch_id: scope.branchId,
            },
            select: {
              status_appointment: true,
              date_appointment: true,
              start_time: true,
              room: true,
            },
          })
        : null,
      this.prisma.opd.findUnique({
        where: {
          opd_id_branch_id: {
            opd_id: encounter.legacy_opd_id,
            branch_id: scope.branchId,
          },
        },
      }),
    ]);

    if (!ticket || !customer || !legacyOpd) return null;
    if (
      legacyOpd.clinic_id !== scope.clinicId ||
      legacyOpd.customer_id !== encounter.customer_id
    ) {
      return null;
    }

    return { encounter, ticket, customer, appointment, legacyOpd };
  }

  private buildWhere(
    query: QueryOpdDto,
    scope: RequestScope,
  ): Prisma.opdWhereInput {
    const where: Prisma.opdWhereInput = {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
    };

    if (query.customerId) where.customer_id = query.customerId;
    if (query.status) where.status_opd = query.status;

    return where;
  }
}
