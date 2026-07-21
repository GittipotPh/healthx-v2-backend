import { ConflictException, Injectable } from "@nestjs/common";
import type {
  appointment_anesthetic,
  appointment_consultation,
  opd_queue_ticket,
  Prisma,
  queue_status,
  queue_config,
  statusAppointment,
} from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import type {
  AppointmentForQueue,
  AppointmentRecord,
  WalkInForQueue,
} from "./queue.mapper";
import type { SaveConsultationDto } from "./dto/save-consultation.dto";
import type { SaveAnestheticDto } from "./dto/save-anesthetic.dto";
import { SaveQueueConfigDto } from "./dto/save-queue-config.dto";

export interface LegacyQueueStatusIdentity {
  queueStatusId: string;
  currentStep: string;
  enteredAt: Date;
}

export interface V2QueueIdentity {
  queueTicketId: string;
  encounterId: string | null;
  legacyQueueStatusId: string | null;
  currentStep: string;
  displayNumber: string;
  enteredAt: Date;
}

export type V2QueueTransitionOutcome =
  | "NOT_FOUND"
  | "UNCHANGED"
  | "UPDATED"
  | "CONFLICT";

const APPOINTMENT_RECORD_SELECT = {
  appointment_id: true,
  clinic_id: true,
  branch_id: true,
  customer_id: true,
  room: true,
  channel: true,
  date_appointment: true,
  time_arrive: true,
  start_time: true,
  end_time: true,
  is_consult: true,
  apply_anesthetic: true,
  appointment_detail: true,
  status_appointment: true,
  opd_id: true,
} satisfies Prisma.appointmentSelect;

const QUEUE_APPOINTMENT_SELECT = {
  ...APPOINTMENT_RECORD_SELECT,
  customer: {
    select: {
      name: true,
      lastname: true,
      personal_id: true,
      nickname: true,
      phone_number: true,
      gender: true,
      customer_image: true,
      customer_info: { select: { allergy: true } },
    },
  },
  opd: { select: { status_opd: true } },
} satisfies Prisma.appointmentSelect;

@Injectable()
export class QueueRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findTodayQueue(
    clinicId: string,
    branchId: string,
    date: string,
  ): Promise<AppointmentForQueue[]> {
    return this.prisma.appointment.findMany({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        date_appointment: date,
      },
      select: QUEUE_APPOINTMENT_SELECT,
      orderBy: { start_time: "asc" },
    }) as Promise<AppointmentForQueue[]>;
  }

  async findWalkInQueue(
    clinicId: string,
    branchId: string,
    businessDate: string,
  ): Promise<WalkInForQueue[]> {
    const tickets = await this.prisma.opd_queue_ticket.findMany({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        source_type: "WALK_IN",
        business_date: new Date(`${businessDate}T00:00:00.000Z`),
        cancelled_at: null,
      },
      orderBy: { queue_sequence: "asc" },
    });
    if (tickets.length === 0) return [];

    const ticketIds = tickets.map((ticket) => ticket.queue_ticket_id);
    const customerIds = Array.from(
      new Set(tickets.map((ticket) => ticket.customer_id)),
    );
    const [encounters, customers] = await Promise.all([
      this.prisma.opd_encounter.findMany({
        where: {
          clinic_id: clinicId,
          branch_id: branchId,
          queue_ticket_id: { in: ticketIds },
        },
        select: {
          queue_ticket_id: true,
          encounter_id: true,
          legacy_opd_id: true,
        },
      }),
      this.prisma.customer.findMany({
        where: { clinic_id: clinicId, customer_id: { in: customerIds } },
        select: {
          customer_id: true,
          name: true,
          lastname: true,
          personal_id: true,
          nickname: true,
          phone_number: true,
          gender: true,
          customer_image: true,
          customer_info: { select: { allergy: true } },
        },
      }),
    ]);
    const encounterByTicket = new Map(
      encounters.map((encounter) => [encounter.queue_ticket_id, encounter]),
    );
    const customerById = new Map(
      customers.map((customer) => [customer.customer_id, customer]),
    );
    const legacyOpdIds = encounters.flatMap((encounter) =>
      encounter.legacy_opd_id ? [encounter.legacy_opd_id] : [],
    );
    const legacyOpds = await this.prisma.opd.findMany({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        opd_id: { in: legacyOpdIds },
      },
      select: { opd_id: true, customer_id: true, status_opd: true },
    });
    const legacyOpdById = new Map(
      legacyOpds.map((legacyOpd) => [legacyOpd.opd_id, legacyOpd]),
    );

    return tickets.map((ticket) => {
      const encounter = encounterByTicket.get(ticket.queue_ticket_id);
      const customer = customerById.get(ticket.customer_id);
      const legacyOpd = encounter?.legacy_opd_id
        ? legacyOpdById.get(encounter.legacy_opd_id)
        : null;
      if (!encounter || !encounter.legacy_opd_id || !customer || !legacyOpd) {
        throw new Error(
          `Walk-in queue ticket ${ticket.queue_ticket_id} is not reconciled`,
        );
      }
      if (legacyOpd.customer_id !== ticket.customer_id) {
        throw new Error(
          `Walk-in queue ticket ${ticket.queue_ticket_id} has mismatched customer data`,
        );
      }
      return {
        queue_ticket_id: ticket.queue_ticket_id,
        legacy_queue_status_id: ticket.legacy_queue_status_id,
        customer_id: ticket.customer_id,
        display_number: ticket.display_number,
        current_step: ticket.current_step,
        entered_at: ticket.entered_at,
        version: ticket.version,
        encounter_id: encounter.encounter_id,
        legacy_opd_id: encounter.legacy_opd_id,
        opd_status: legacyOpd.status_opd,
        customer: {
          name: customer.name,
          lastname: customer.lastname,
          personal_id: customer.personal_id,
          nickname: customer.nickname,
          phone_number: customer.phone_number,
          gender: customer.gender,
          customer_image: customer.customer_image,
          allergy: customer.customer_info?.allergy ?? null,
        },
      };
    });
  }

  async findAppointment(
    clinicId: string,
    branchId: string,
    appointmentId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<AppointmentRecord | null> {
    const found = await tx.appointment.findUnique({
      where: { appointment_id: appointmentId },
      select: APPOINTMENT_RECORD_SELECT,
    });
    if (
      !found ||
      found.clinic_id !== clinicId ||
      found.branch_id !== branchId
    ) {
      return null;
    }
    return found;
  }

  async updateAppointmentStatus(
    clinicId: string,
    branchId: string,
    appointmentId: string,
    status: statusAppointment,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<void> {
    const updated = await tx.appointment.updateMany({
      where: {
        appointment_id: appointmentId,
        clinic_id: clinicId,
        branch_id: branchId,
      },
      data: { status_appointment: status, updated_at: new Date() },
    });
    if (updated.count !== 1) {
      throw new ConflictException(
        "Appointment scope changed while updating queue state",
      );
    }
  }

  async findQueueStatusesByAppointmentIds(
    clinicId: string,
    branchId: string,
    appointmentIds: string[],
  ): Promise<Record<string, LegacyQueueStatusIdentity>> {
    if (appointmentIds.length === 0) return {};
    const rows = await this.prisma.queue_status.findMany({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        appointment_id: { in: appointmentIds },
      },
      select: {
        queue_status_id: true,
        appointment_id: true,
        current_step: true,
        entered_at: true,
      },
    });
    return Object.fromEntries(
      rows.map((row) => [
        row.appointment_id,
        {
          queueStatusId: row.queue_status_id,
          currentStep: row.current_step,
          enteredAt: row.entered_at,
        },
      ]),
    );
  }

  async findV2QueueIdentitiesByAppointmentIds(
    clinicId: string,
    branchId: string,
    appointmentIds: string[],
  ): Promise<Record<string, V2QueueIdentity>> {
    if (appointmentIds.length === 0) return {};

    const tickets = await this.prisma.opd_queue_ticket.findMany({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        appointment_id: { in: appointmentIds },
      },
      select: {
        queue_ticket_id: true,
        appointment_id: true,
        legacy_queue_status_id: true,
        current_step: true,
        display_number: true,
        entered_at: true,
      },
    });
    const ticketIds = tickets.map((ticket) => ticket.queue_ticket_id);
    const encounters = ticketIds.length
      ? await this.prisma.opd_encounter.findMany({
          where: {
            clinic_id: clinicId,
            branch_id: branchId,
            queue_ticket_id: { in: ticketIds },
          },
          select: { encounter_id: true, queue_ticket_id: true },
        })
      : [];
    const encounterByTicket = new Map(
      encounters.map((encounter) => [
        encounter.queue_ticket_id,
        encounter.encounter_id,
      ]),
    );

    return Object.fromEntries(
      tickets.flatMap((ticket) =>
        ticket.appointment_id
          ? [
              [
                ticket.appointment_id,
                {
                  queueTicketId: ticket.queue_ticket_id,
                  encounterId:
                    encounterByTicket.get(ticket.queue_ticket_id) ?? null,
                  legacyQueueStatusId: ticket.legacy_queue_status_id,
                  currentStep: ticket.current_step,
                  displayNumber: ticket.display_number,
                  enteredAt: ticket.entered_at,
                },
              ],
            ]
          : [],
      ),
    );
  }

  async findQueueStatus(
    clinicId: string,
    branchId: string,
    appointmentId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<queue_status | null> {
    const existing = await tx.queue_status.findUnique({
      where: { appointment_id: appointmentId },
    });
    if (
      existing &&
      (existing.clinic_id !== clinicId || existing.branch_id !== branchId)
    ) {
      throw new ConflictException(
        "Queue status belongs to another clinic/branch",
      );
    }
    return existing;
  }

  /** Advances (or creates) an appointment's queue card to `stepCode`, refreshing `entered_at` only when the step actually changes. */
  async upsertQueueStep(
    clinicId: string,
    branchId: string,
    appointmentId: string,
    stepCode: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<queue_status> {
    const now = new Date();
    const existing = await tx.queue_status.findUnique({
      where: { appointment_id: appointmentId },
    });
    if (
      existing &&
      (existing.clinic_id !== clinicId || existing.branch_id !== branchId)
    ) {
      throw new ConflictException(
        "Queue status belongs to another clinic/branch",
      );
    }
    if (!existing) {
      return tx.queue_status.create({
        data: {
          clinic_id: clinicId,
          branch_id: branchId,
          appointment_id: appointmentId,
          current_step: stepCode,
          entered_at: now,
          updated_at: now,
        },
      });
    }
    return tx.queue_status.update({
      where: { queue_status_id: existing.queue_status_id },
      data: {
        current_step: stepCode,
        entered_at:
          existing.current_step === stepCode ? existing.entered_at : now,
        updated_at: now,
      },
    });
  }

  async transitionV2QueueTicket(
    input: {
      clinicId: string;
      branchId: string;
      appointmentId: string | null;
      queueTicketId?: string;
      toStep: string;
      actorUserId: string;
      reason: string | null;
    },
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<V2QueueTransitionOutcome> {
    const ticket = input.queueTicketId
      ? await tx.opd_queue_ticket.findUnique({
          where: {
            queue_ticket_id_clinic_id_branch_id: {
              queue_ticket_id: input.queueTicketId,
              clinic_id: input.clinicId,
              branch_id: input.branchId,
            },
          },
        })
      : input.appointmentId
        ? await tx.opd_queue_ticket.findUnique({
            where: {
              clinic_id_branch_id_appointment_id: {
                clinic_id: input.clinicId,
                branch_id: input.branchId,
                appointment_id: input.appointmentId,
              },
            },
          })
        : null;
    if (!ticket) return "NOT_FOUND";
    if (ticket.current_step === input.toStep) return "UNCHANGED";

    const now = new Date();
    const resultVersion = ticket.version + 1;
    const updated = await tx.opd_queue_ticket.updateMany({
      where: {
        queue_ticket_id: ticket.queue_ticket_id,
        clinic_id: input.clinicId,
        branch_id: input.branchId,
        version: ticket.version,
      },
      data: {
        current_step: input.toStep,
        entered_at: now,
        version: { increment: 1 },
        updated_at: now,
      },
    });
    if (updated.count !== 1) return "CONFLICT";

    const encounter = await tx.opd_encounter.findUnique({
      where: {
        queue_ticket_id_clinic_id_branch_id: {
          queue_ticket_id: ticket.queue_ticket_id,
          clinic_id: input.clinicId,
          branch_id: input.branchId,
        },
      },
      select: { encounter_id: true },
    });
    await tx.queue_transition.create({
      data: {
        clinic_id: input.clinicId,
        branch_id: input.branchId,
        queue_ticket_id: ticket.queue_ticket_id,
        encounter_id: encounter?.encounter_id ?? null,
        appointment_id: ticket.appointment_id,
        from_step: ticket.current_step,
        to_step: input.toStep,
        actor_user_id: input.actorUserId,
        reason: input.reason,
        expected_version: ticket.version,
        result_version: resultVersion,
        occurred_at: now,
      },
    });
    return "UPDATED";
  }

  async findV2QueueTicketById(
    clinicId: string,
    branchId: string,
    queueTicketId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<opd_queue_ticket | null> {
    return tx.opd_queue_ticket.findUnique({
      where: {
        queue_ticket_id_clinic_id_branch_id: {
          queue_ticket_id: queueTicketId,
          clinic_id: clinicId,
          branch_id: branchId,
        },
      },
    });
  }

  /** Upserts the consult detail record for an appointment (one row per appointment). */
  async upsertConsultation(
    scope: { clinicId: string; branchId: string; userId: string },
    dto: SaveConsultationDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<appointment_consultation> {
    const now = new Date();
    const data = {
      consultant_ref: dto.consultantRef ?? null,
      budget: dto.budget ?? null,
      promotion: dto.promotion ?? null,
      outcome: dto.outcome,
      services_interested: (dto.servicesInterested ??
        []) as Prisma.InputJsonValue,
      notes: dto.notes ?? null,
      updated_at: now,
    };
    const existing = await tx.appointment_consultation.findUnique({
      where: { appointment_id: dto.appointmentId },
    });
    if (
      existing &&
      (existing.clinic_id !== scope.clinicId ||
        existing.branch_id !== scope.branchId)
    ) {
      throw new ConflictException(
        "Consultation belongs to another clinic/branch",
      );
    }
    if (!existing) {
      return tx.appointment_consultation.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          appointment_id: dto.appointmentId,
          created_by: scope.userId,
          ...data,
        },
      });
    }
    return tx.appointment_consultation.update({
      where: { consultation_id: existing.consultation_id },
      data,
    });
  }

  /**
   * Upserts the anaesthetic detail record for an appointment (one row per
   * appointment). Every save — create or update — restarts `started_at`,
   * because resubmitting the modal means the nurse re-applied the anaesthetic.
   */
  async upsertAnesthetic(
    scope: { clinicId: string; branchId: string; userId: string },
    dto: SaveAnestheticDto,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<appointment_anesthetic> {
    const now = new Date();
    const data = {
      allergy_status: dto.allergyStatus,
      allergy_notes: dto.allergyNotes ?? null,
      nurse_ref: dto.nurseRef,
      room: dto.room ?? null,
      bed: dto.bed ?? null,
      duration_minutes: dto.durationMinutes,
      notes: dto.notes ?? null,
      started_at: now,
      updated_at: now,
    };
    const existing = await tx.appointment_anesthetic.findUnique({
      where: { appointment_id: dto.appointmentId },
    });
    if (
      existing &&
      (existing.clinic_id !== scope.clinicId ||
        existing.branch_id !== scope.branchId)
    ) {
      throw new ConflictException(
        "Anesthetic record belongs to another clinic/branch",
      );
    }
    if (!existing) {
      return tx.appointment_anesthetic.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          appointment_id: dto.appointmentId,
          created_by: scope.userId,
          ...data,
        },
      });
    }
    return tx.appointment_anesthetic.update({
      where: { anesthetic_id: existing.anesthetic_id },
      data,
    });
  }

  /** How far back cancel/late/reschedule history counts look. */
  private static readonly HISTORY_WINDOW_MONTHS = 12;

  async findCustomersHistories(
    clinicId: string,
    customerIds: string[],
  ): Promise<
    Record<
      string,
      { cancelHistory: number; lateHistory: number; rescheduleHistory: number }
    >
  > {
    if (customerIds.length === 0) return {};

    // Customer PK is composite [customer_id, clinic_id]: a bare customer_id
    // IN (...) could match another clinic's rows, so always scope by clinic.
    // date_appointment is a YYYY-MM-DD varchar, so a lexicographic gte bounds
    // the window without loading every appointment ever.
    const since = new Date();
    since.setMonth(since.getMonth() - QueueRepository.HISTORY_WINDOW_MONTHS);
    const sinceDate = since.toISOString().slice(0, 10);

    // 1. Fetch appointments of these customers to check cancellations and lateness
    const appointments = await this.prisma.appointment.findMany({
      where: {
        clinic_id: clinicId,
        customer_id: { in: customerIds },
        date_appointment: { gte: sinceDate },
      },
      select: {
        customer_id: true,
        status_appointment: true,
        start_time: true,
        time_arrive: true,
        appointment_id: true,
      },
    });

    // 2. Fetch reschedule history from audit_log table
    const allApptIds = appointments.map((a) => a.appointment_id);
    const rescheduleLogs = await this.prisma.audit_log.findMany({
      where: {
        clinic_id: clinicId,
        reference_type: "APPOINTMENT",
        action: "reschedule",
        reference_id: { in: allApptIds },
      },
      select: {
        reference_id: true,
      },
    });

    const rescheduleApptIds = new Set(
      rescheduleLogs.map((log) => log.reference_id),
    );

    // Aggregate counts
    const result: Record<
      string,
      { cancelHistory: number; lateHistory: number; rescheduleHistory: number }
    > = {};

    customerIds.forEach((id) => {
      result[id] = { cancelHistory: 0, lateHistory: 0, rescheduleHistory: 0 };
    });

    appointments.forEach((appt) => {
      const cid = appt.customer_id;
      if (!result[cid]) return;

      if (appt.status_appointment === "CANCEL") {
        result[cid].cancelHistory++;
      }

      // Check if they arrived late (e.g. time_arrive is after start_time)
      if (
        appt.time_arrive &&
        appt.start_time &&
        appt.time_arrive > appt.start_time
      ) {
        result[cid].lateHistory++;
      }

      if (rescheduleApptIds.has(appt.appointment_id)) {
        result[cid].rescheduleHistory++;
      }
    });

    return result;
  }

  // queue_config is keyed by branch_id alone (unique), but reads/writes always
  // scope by clinic too: ScopeGuard proves the branch belongs to the clinic, so
  // adding clinic_id is defense-in-depth against a drifted/foreign row.
  async findQueueConfig(
    clinicId: string,
    branchId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<queue_config | null> {
    return tx.queue_config.findFirst({
      where: { branch_id: branchId, clinic_id: clinicId },
    });
  }

  async upsertQueueConfig(
    clinicId: string,
    branchId: string,
    data: SaveQueueConfigDto,
    userId?: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<queue_config> {
    const now = new Date();
    const sections = {
      columns: data.columns as unknown as Prisma.InputJsonValue,
      sla: data.sla as unknown as Prisma.InputJsonValue,
      transitions: data.transitions as unknown as Prisma.InputJsonValue,
      automation: data.automation as unknown as Prisma.InputJsonValue,
      tracking: data.tracking as unknown as Prisma.InputJsonValue,
      notifications: data.notifications as unknown as Prisma.InputJsonValue,
      permissions: data.permissions as Prisma.InputJsonValue,
    };
    return tx.queue_config.upsert({
      where: { branch_id: branchId },
      create: {
        clinic_id: clinicId,
        branch_id: branchId,
        ...sections,
        updated_by: userId,
        updated_at: now,
        created_at: now,
      },
      update: {
        // Re-stamp clinic_id so a row that ever drifted from its branch's real
        // clinic converges to the ScopeGuard-validated pair instead of keeping
        // the mismatch forever.
        clinic_id: clinicId,
        ...sections,
        updated_by: userId,
        updated_at: now,
      },
    });
  }

  async countActiveCardsInStep(
    clinicId: string,
    branchId: string,
    stepCode: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<number> {
    return tx.queue_status.count({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        current_step: stepCode,
      },
    });
  }

  async hasAssignedDoctor(
    appointmentId: string,
    branchId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const count = await tx.user_appointment.count({
      where: {
        appointment_id: appointmentId,
        user: {
          user_branch: {
            some: {
              branch_id: branchId,
              role_id: "DOCTOR",
              status: "ACTIVE",
            },
          },
        },
      },
    });
    return count > 0;
  }

  async hasAnesthetic(
    clinicId: string,
    branchId: string,
    appointmentId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const count = await tx.appointment_anesthetic.count({
      where: {
        clinic_id: clinicId,
        branch_id: branchId,
        appointment_id: appointmentId,
      },
    });
    return count > 0;
  }

  async hasUnpaidPrescriptions(
    opdId: string,
    branchId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const prescriptions = await tx.prescription.findMany({
      where: { opd_id: opdId, branch_id: branchId },
      include: { sale_order: true },
    });
    if (prescriptions.length === 0) return false;
    return prescriptions.some(
      (p) => !p.sale_order || p.sale_order.sale_order_status !== "PAID",
    );
  }

  async hasPrescriptions(
    opdId: string,
    branchId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const count = await tx.prescription.count({
      where: { opd_id: opdId, branch_id: branchId },
    });
    return count > 0;
  }

  async hasUsedCourse(
    opdId: string,
    branchId: string,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<boolean> {
    const opd = await tx.opd.findFirst({
      where: { opd_id: opdId, branch_id: branchId },
      select: { management_item: true },
    });
    if (!opd || !opd.management_item) return false;
    const count = await tx.service_usage.count({
      where: {
        service_usage_id: opd.management_item,
        branch_id: branchId,
        service_usage_status: "APPROVED",
      },
    });
    return count > 0;
  }
}
