import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { operator_type, statusAppointment, type Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma.service";
import { INITIAL_QUEUE_STEP } from "../queue/queue.constants";
import type { AppointmentWithCustomer } from "./appointments.mapper";
import type { CreateAppointmentDto } from "./dto/create-appointment.dto";
import type { QueryAppointmentsDto } from "./dto/query-appointments.dto";
import type { RequestScope } from "../../auth/auth.types";

export interface PaginatedAppointments {
  items: AppointmentWithCustomer[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AppointmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findMany(
    query: QueryAppointmentsDto,
    scope: RequestScope,
  ): Promise<PaginatedAppointments> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 100;
    const where = this.buildWhere(query, scope);

    const [items, total] = await this.prisma.$transaction([
      this.prisma.appointment.findMany({
        where,
        include: { customer: true },
        orderBy: [{ date_appointment: "asc" }, { start_time: "asc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.appointment.count({ where }),
    ]);

    return { items: await this.attachExtras(items), total, page, pageSize };
  }

  /**
   * Creates the appointment and, in the same transaction, bootstraps its
   * queue_status row so the card immediately appears on today's Kanban queue
   * at step 1 (CONFIRMED). status_appointment starts at APPOINT (mirrors the
   * legacy default) and is kept independently: the Kanban step transitions
   * update it via STEP_TO_APPOINTMENT_STATUS as the card moves columns.
   */
  async create(dto: CreateAppointmentDto, scope: RequestScope): Promise<AppointmentWithCustomer> {
    const appointmentId = randomUUID();
    const now = new Date();

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.appointment.create({
        data: {
          appointment_id: appointmentId,
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          customer_id: dto.customerId,
          user_create: scope.userId,
          room: dto.room,
          date_appointment: dto.dateAppointment,
          time_arrive: dto.timeArrive,
          start_time: dto.startTime,
          end_time: dto.endTime,
          channel: dto.channel,
          is_consult: dto.isConsult,
          apply_anesthetic: dto.applyAnesthetic,
          appointment_detail: dto.detail,
          status_appointment: statusAppointment.APPOINT,
          opd_id: dto.opdId,
          updated_at: now,
          created_at: now,
        },
        include: { customer: true },
      });

      await tx.queue_status.create({
        data: {
          clinic_id: scope.clinicId,
          branch_id: scope.branchId,
          appointment_id: appointmentId,
          current_step: INITIAL_QUEUE_STEP,
          entered_at: now,
          updated_at: now,
        },
      });

      const userAssignments = this.userAssignments(appointmentId, dto);
      if (userAssignments.length > 0) {
        await tx.user_appointment.createMany({
          data: userAssignments,
          skipDuplicates: true,
        });
      }

      const procedureIds = this.unique(dto.procedures ?? []);
      if (procedureIds.length > 0) {
        await tx.operation_appointment.createMany({
          data: procedureIds.map((productId) => ({
            appointment_id: appointmentId,
            product_id: productId,
          })),
          skipDuplicates: true,
        });
      }

      const extraData = this.extraData(appointmentId, dto, scope, now);
      const extra = extraData
        ? await tx.appointment_detail_extra.create({ data: extraData })
        : null;

      return this.mergeExtra(created, extra);
    });
  }

  /**
   * True when the OPD row exists in this clinic/branch. `opd`'s PK is composite
   * [opd_id, branch_id], so an unscoped opd_id lookup could match another
   * branch's row — always check clinic AND branch before linking it.
   */
  async opdExistsInScope(opdId: string, scope: RequestScope): Promise<boolean> {
    const found = await this.prisma.opd.findFirst({
      where: {
        opd_id: opdId,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      select: { opd_id: true },
    });
    return found !== null;
  }

  async findOne(id: string, scope: RequestScope): Promise<AppointmentWithCustomer | null> {
    const found = await this.prisma.appointment.findFirst({
      where: {
        appointment_id: id,
        clinic_id: scope.clinicId,
        branch_id: scope.branchId,
      },
      include: { customer: true },
    });

    return found ? this.attachExtra(found) : null;
  }

  async reschedule(
    id: string,
    data: { dateAppointment: string; startTime: string; endTime: string },
    scope: RequestScope,
  ): Promise<AppointmentWithCustomer> {
    const now = new Date();
    const updated = await this.prisma.appointment.update({
      where: {
        appointment_id: id,
      },
      data: {
        date_appointment: data.dateAppointment,
        start_time: data.startTime,
        time_arrive: data.startTime,
        end_time: data.endTime,
        updated_at: now,
      },
      include: { customer: true },
    });

    return this.attachExtra(updated);
  }


  buildWhere(query: QueryAppointmentsDto, scope: RequestScope): Prisma.appointmentWhereInput {
    const where: Prisma.appointmentWhereInput = {
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
    };

    if (query.customerId) where.customer_id = query.customerId;
    if (query.status) where.status_appointment = query.status;

    if (query.date) {
      where.date_appointment = query.date;
    } else if (query.dateFrom || query.dateTo) {
      where.date_appointment = {};
      if (query.dateFrom) where.date_appointment.gte = query.dateFrom;
      if (query.dateTo) where.date_appointment.lte = query.dateTo;
    }

    return where;
  }

  private async attachExtras<T extends AppointmentWithCustomer>(
    appointments: T[],
  ): Promise<AppointmentWithCustomer[]> {
    if (appointments.length === 0) return appointments;

    const extras = await this.prisma.appointment_detail_extra.findMany({
      where: {
        appointment_id: {
          in: appointments.map((appointment) => appointment.appointment_id),
        },
      },
    });
    const extrasByAppointmentId = new Map(
      extras.map((extra) => [extra.appointment_id, extra]),
    );

    return appointments.map((appointment) =>
      this.mergeExtra(appointment, extrasByAppointmentId.get(appointment.appointment_id) ?? null),
    );
  }

  private async attachExtra<T extends AppointmentWithCustomer>(
    appointment: T,
  ): Promise<AppointmentWithCustomer> {
    const extra = await this.prisma.appointment_detail_extra.findUnique({
      where: { appointment_id: appointment.appointment_id },
    });
    return this.mergeExtra(appointment, extra);
  }

  private mergeExtra<T extends AppointmentWithCustomer>(
    appointment: T,
    extra:
      | {
          marketing_platform?: string | null;
          campaign?: string | null;
          numbing_time?: number | null;
          preparation?: string | null;
          preparation_tags?: Prisma.JsonValue | null;
          internal_note?: string | null;
          internal_tags?: Prisma.JsonValue | null;
          notifications?: Prisma.JsonValue | null;
          recurring?: Prisma.JsonValue | null;
        }
      | null,
  ): AppointmentWithCustomer {
    if (!extra) return appointment;

    return {
      ...appointment,
      marketing_platform: extra.marketing_platform ?? null,
      campaign: extra.campaign ?? null,
      numbing_time: extra.numbing_time ?? null,
      preparation: extra.preparation ?? null,
      preparation_tags: extra.preparation_tags ?? null,
      internal_note: extra.internal_note ?? null,
      internal_tags: extra.internal_tags ?? null,
      notifications: extra.notifications ?? null,
      recurring: extra.recurring ?? null,
    };
  }

  private extraData(
    appointmentId: string,
    dto: CreateAppointmentDto,
    scope: RequestScope,
    now: Date,
  ): Prisma.appointment_detail_extraCreateInput | null {
    const hasExtra =
      dto.marketingPlatform ||
      dto.campaign ||
      dto.numbingTime !== undefined ||
      dto.preparation ||
      (dto.preparationTags?.length ?? 0) > 0 ||
      dto.internalNote ||
      (dto.internalTags?.length ?? 0) > 0 ||
      dto.notifications ||
      dto.recurring;

    if (!hasExtra) return null;

    return {
      appointment_id: appointmentId,
      clinic_id: scope.clinicId,
      branch_id: scope.branchId,
      marketing_platform: dto.marketingPlatform,
      campaign: dto.campaign,
      numbing_time: dto.numbingTime,
      preparation: dto.preparation,
      preparation_tags: dto.preparationTags ?? undefined,
      internal_note: dto.internalNote,
      internal_tags: dto.internalTags ?? undefined,
      notifications: dto.notifications as Prisma.InputJsonValue | undefined,
      recurring: dto.recurring as Prisma.InputJsonValue | undefined,
      created_by: scope.userId,
      updated_at: now,
      created_at: now,
    };
  }

  private userAssignments(
    appointmentId: string,
    dto: CreateAppointmentDto,
  ): Prisma.user_appointmentCreateManyInput[] {
    return [
      ...this.unique(dto.doctors ?? []).map((userId) => ({
        appointment_id: appointmentId,
        user_id: userId,
        operator_type: operator_type.OPERATOR,
      })),
      ...this.unique(dto.assistants ?? []).map((userId) => ({
        appointment_id: appointmentId,
        user_id: userId,
        operator_type: operator_type.ASSISTANT,
      })),
    ];
  }

  private unique(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }
}
